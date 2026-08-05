import * as ort from 'onnxruntime-web'

// ===== ffocr 内部常量(已 export,我们直接复用同 URL 走浏览器缓存) =====
const DEFAULT_MODEL_BASE_URL = 'https://zxc88645.github.io/ffocr/models/pp-ocrv5'
const DEFAULT_DICTIONARY_URL = 'https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/dict/ppocrv5_dict.txt'
const PPOCRV5_MODEL_PATHS = {
  detection: { mobile: 'det_mobile.onnx' },
  recognition: { mobile: 'rec_mobile.onnx' },
} as const

const DEFAULT_ORT_WASM_PATHS = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/'

// ===== Det 预处理常量(沿 ffocr) =====
const DET_MEAN_BGR = [0.485, 0.456, 0.406]
const DET_STD_BGR = [0.229, 0.224, 0.225]

// ===== Rec shape =====
const REC_CHANNELS = 3
const REC_HEIGHT = 48
const REC_WIDTH = 48        // ROI 缩放目标宽(按原比保留的上限)
const REC_PAD_WIDTH = 320   // Rec 模型训练时固定宽(右补零到 320)

// ===== Det 默认参数(沿 ffocr) =====
const DET_LIMIT_SIDE_LEN = 960
const DET_THRESHOLD = 0.3
const DET_BOX_THRESHOLD = 0.6
const DET_UNCLIP_RATIO = 1.5
const DET_MIN_SIZE = 3

// ===== 批大小 + 阈值 =====
const REC_BATCH_SIZE = 256
const EMPTY_VAR_THRESHOLD = 40

// ===== ort env 配置一次性标志 =====
let ortConfigured = false

function configureOrtEnv() {
  if (ortConfigured) return
  if (ort.env?.wasm) {
    ort.env.wasm.wasmPaths = DEFAULT_ORT_WASM_PATHS
  }
  ortConfigured = true
}

// ===== Cache API(复用 ffocr 的缓存 key,同 URL 直接命中) =====
const MODEL_CACHE_NAME = 'ffocr-models'

async function fetchWithCache(url: string): Promise<ArrayBuffer> {
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(MODEL_CACHE_NAME)
      const cached = await cache.match(url)
      if (cached) return await cached.arrayBuffer()
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`)
      const cloned = response.clone()
      cache.put(url, cloned)
      return await response.arrayBuffer()
    } catch {
      // Cache API 不可用时回退到普通 fetch
    }
  }
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`)
  return await response.arrayBuffer()
}

// ===== Provider 候选:只返回真实可用 provider,免 VerifyEachNodeIsAssignedToAnEp 警告 =====
// navigator.gpu 存在不代表可用(浏览器禁用 / WebGPU 占用 / 上下文丢失都会让 session 分不上去)
//ORT 会把分不上去的首选 provider 回退到 wasm 触发性能警告,所以只放真实可用的
let providerCache: readonly (ort.InferenceSession.ExecutionProviderConfig | string)[] | null = null
async function getProviderCandidates(): Promise<readonly (ort.InferenceSession.ExecutionProviderConfig | string)[]> {
  if (providerCache) return providerCache
  const providers: (ort.InferenceSession.ExecutionProviderConfig | string)[] = ['wasm']
  // WebGPU 真实可用性试探: navigator.gpu 存在 + adapter 可取才算可用
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    try {
      const adapter = await navigator.gpu.requestAdapter()
      if (adapter) providers.unshift('webgpu')
    } catch {
      // requestAdapter 抛错或返回 null → webgpu 不可用,只留 wasm
    }
  }
  providerCache = providers
  console.log(`[OCR] ORT provider 候选(真实可用): ${providers.join(', ')}`)
  return providers
}

// ===== 模块级单例资源 =====
let detSession: ort.InferenceSession | null = null
let recSession: ort.InferenceSession | null = null
let detInputName = ''
let detOutputName = ''
let recInputName = ''
let recOutputName = ''
let dictionary: string[] = []
let initPromise: Promise<void> | null = null

// ===== 类型定义(对外兼容) =====
export interface GridCellResult {
  row: number
  col: number
  text: string
  confidence: number
}

export type OcrPhase = 'loading' | 'downloading' | 'initializing' | 'ready' | 'recognizing' |
  'loading_dictionary' | 'loading_detection_model' | 'loading_recognition_model' | 'warmup' |
  'roi-slicing' | 'batch-rec' | 'preprocessing' | 'detecting' | 'recognizing-batch' | string

export interface OcrProgressInfo {
  phase: string
  phaseLabel: string
  percent?: number
}

export type OcrProgressCallback = (info: OcrProgressInfo) => void

const phaseLabels: Record<string, string> = {
  'loading': '加载模型中',
  'downloading': '下载模型中',
  'initializing': '初始化中',
  'ready': '准备就绪',
  'recognizing': '识别中',
  'loading_dictionary': '加载字典中',
  'loading_detection_model': '加载检测模型中',
  'loading_recognition_model': '加载识别模型中',
  'warmup': '预热模型中',
  'roi-slicing': '切片区识别中',
  'batch-rec': '批量识别中',
  'preprocessing': '预处理中',
  'detecting': '检测中',
  'recognizing-batch': '批量识别中',
}

function getPhaseLabel(phase: string): string {
  return phaseLabels[phase] || phase
}

// ===== canvas 工具 =====
function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function getCtx(canvas: HTMLCanvasElement | OffscreenCanvas): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Unable to create 2D context')
  return ctx
}

async function ensureImageData(source: ort.OnnxValue | ImageData | HTMLCanvasElement): Promise<ImageData> {
  if (source instanceof ImageData) return source
  if (source instanceof HTMLCanvasElement || (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas)) {
    const ctx = getCtx(source as HTMLCanvasElement)
    return ctx.getImageData(0, 0, (source as HTMLCanvasElement).width, (source as HTMLCanvasElement).height)
  }
  throw new Error('Unsupported image source for recognize')
}

function resizeImageData(source: ImageData, targetW: number, targetH: number): ImageData {
  const inputCanvas = createCanvas(source.width, source.height)
  getCtx(inputCanvas).putImageData(source, 0, 0)
  const outputCanvas = createCanvas(targetW, targetH)
  const outCtx = getCtx(outputCanvas)
  outCtx.drawImage(inputCanvas as unknown as CanvasImageSource, 0, 0, targetW, targetH)
  return outCtx.getImageData(0, 0, targetW, targetH)
}

function cropImageData(source: ImageData, left: number, top: number, width: number, height: number): ImageData {
  const x = Math.max(0, Math.min(Math.floor(left), source.width - 1))
  const y = Math.max(0, Math.min(Math.floor(top), source.height - 1))
  const w = Math.max(1, Math.min(Math.ceil(width), source.width - x))
  const h = Math.max(1, Math.min(Math.ceil(height), source.height - y))
  const pixels = new Uint8ClampedArray(w * h * 4)
  for (let row = 0; row < h; row++) {
    const srcOffset = ((y + row) * source.width + x) * 4
    const dstOffset = row * w * 4
    pixels.set(source.data.subarray(srcOffset, srcOffset + w * 4), dstOffset)
  }
  return new ImageData(pixels, w, h)
}

// ===== 预处理:Det =====
function preprocessDetection(source: ImageData): { data: Float32Array, dims: number[], resizedWidth: number, resizedHeight: number } {
  const maxSide = Math.max(source.width, source.height)
  const scale = maxSide > DET_LIMIT_SIDE_LEN ? DET_LIMIT_SIDE_LEN / maxSide : 1
  const roundUp32 = (v: number) => Math.max(32, Math.ceil(v / 32) * 32)
  const resizedWidth = roundUp32(Math.round(source.width * scale))
  const resizedHeight = roundUp32(Math.round(source.height * scale))
  const resized = resizeImageData(source, resizedWidth, resizedHeight)
  const spatial = resizedWidth * resizedHeight
  const tensor = new Float32Array(3 * spatial)
  for (let y = 0; y < resizedHeight; y++) {
    for (let x = 0; x < resizedWidth; x++) {
      const p = (y * resizedWidth + x) * 4
      const spatialOffset = y * resizedWidth + x
      const blue = resized.data[p + 2] / 255
      const green = resized.data[p + 1] / 255
      const red = resized.data[p] / 255
      tensor[spatialOffset] = (blue - DET_MEAN_BGR[0]) / DET_STD_BGR[0]
      tensor[spatial + spatialOffset] = (green - DET_MEAN_BGR[1]) / DET_STD_BGR[1]
      tensor[2 * spatial + spatialOffset] = (red - DET_MEAN_BGR[2]) / DET_STD_BGR[2]
    }
  }
  return { data: tensor, dims: [1, 3, resizedHeight, resizedWidth], resizedWidth, resizedHeight }
}

// ===== 预处理:Rec(高 48、宽按原比缩放,右补零到 320 固定宽,对齐 ffocr ppocrv5 Rec) =====
function preprocessRecognition(source: ImageData): Float32Array {
  const ratio = source.width / Math.max(source.height, 1)
  const resizedWidth = Math.min(REC_PAD_WIDTH, Math.max(1, Math.round(REC_HEIGHT * ratio)))
  const resized = resizeImageData(source, resizedWidth, REC_HEIGHT)
  // tensor 长度按固定宽 320 右补零,与 ppocrv5 Rec 训练分布对齐
  const spatial = REC_HEIGHT * REC_PAD_WIDTH
  const tensor = new Float32Array(3 * spatial) // 默认全 0,右侧 padding 区天然为 0
  for (let y = 0; y < REC_HEIGHT; y++) {
    for (let x = 0; x < resizedWidth; x++) {
      const p = (y * resizedWidth + x) * 4
      const spatialOffset = y * REC_PAD_WIDTH + x
      tensor[spatialOffset] = resized.data[p + 2] / 127.5 - 1          // B
      tensor[spatial + spatialOffset] = resized.data[p + 1] / 127.5 - 1  // G
      tensor[2 * spatial + spatialOffset] = resized.data[p] / 127.5 - 1   // R
    }
  }
  return tensor
}

// ===== Det 后处理:DB BFS(逐行复刻 ffocr) =====
interface DetectedBox {
  score: number
  points: { x: number, y: number }[]
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function postprocessDetection(
  raw: Float32Array,
  dims: number[],
  opts: {
    sourceWidth: number, sourceHeight: number,
    resizedWidth: number, resizedHeight: number,
    threshold: number, boxThreshold: number, unclipRatio: number, minSize: number,
  },
): DetectedBox[] {
  let height: number, width: number
  if (dims.length === 4) { height = dims[2] ?? 0; width = dims[3] ?? 0 }
  else if (dims.length === 3) { height = dims[1] ?? 0; width = dims[2] ?? 0 }
  else throw new Error(`Unsupported detection output shape: ${dims.join('x')}`)

  const map = raw
  const visited = new Uint8Array(width * height)
  const queue = new Uint32Array(width * height)
  const results: DetectedBox[] = []

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const root = y * width + x
      if (visited[root] || map[root] < opts.threshold) continue
      let head = 0, tail = 0
      const component = { minX: x, minY: y, maxX: x, maxY: y, pixels: 0, scoreSum: 0 }
      visited[root] = 1
      queue[tail++] = root
      while (head < tail) {
        const current = queue[head++]
        const cx = current % width
        const cy = Math.floor(current / width)
        component.minX = Math.min(component.minX, cx)
        component.minY = Math.min(component.minY, cy)
        component.maxX = Math.max(component.maxX, cx)
        component.maxY = Math.max(component.maxY, cy)
        component.pixels++
        component.scoreSum += map[current]
        for (let ny = cy - 1; ny <= cy + 1; ny++) {
          if (ny < 0 || ny >= height) continue
          for (let nx = cx - 1; nx <= cx + 1; nx++) {
            if (nx < 0 || nx >= width) continue
            const next = ny * width + nx
            if (visited[next] || map[next] < opts.threshold) continue
            visited[next] = 1
            queue[tail++] = next
          }
        }
      }
      // createAxisAlignedBox
      const w = component.maxX - component.minX + 1
      const h = component.maxY - component.minY + 1
      const score = component.scoreSum / component.pixels
      if (w < opts.minSize || h < opts.minSize || score < opts.boxThreshold) continue
      const distance = w * h * opts.unclipRatio / Math.max(2 * (w + h), 1)
      const left = clamp(component.minX - distance, 0, opts.resizedWidth - 1)
      const top = clamp(component.minY - distance, 0, opts.resizedHeight - 1)
      const right = clamp(component.maxX + distance, 0, opts.resizedWidth - 1)
      const bottom = clamp(component.maxY + distance, 0, opts.resizedHeight - 1)
      const scaleX = opts.sourceWidth / opts.resizedWidth
      const scaleY = opts.sourceHeight / opts.resizedHeight
      results.push({
        score,
        points: [
          { x: left * scaleX, y: top * scaleY },
          { x: right * scaleX, y: top * scaleY },
          { x: right * scaleX, y: bottom * scaleY },
          { x: left * scaleX, y: bottom * scaleY },
        ],
      })
    }
  }
  return results
}

// ===== CTC 解码(逐行复刻 ffocr decodeRecognitionOutput) =====
interface DecodedItem { text: string, score: number }

function maxIndex(values: Float32Array): { index: number, value: number } {
  let index = 0
  let value = values[0] ?? Number.NEGATIVE_INFINITY
  for (let i = 1; i < values.length; i++) {
    if (values[i] > value) { index = i; value = values[i] }
  }
  return { index, value }
}

function maxProbability(values: Float32Array): number {
  let min = Number.POSITIVE_INFINITY, max = Number.NEGATIVE_INFINITY
  for (const v of values) { if (v < min) min = v; if (v > max) max = v }
  if (min >= 0 && max <= 1) return max
  let total = 0
  for (const v of values) total += Math.exp(v - max)
  return 1 / total
}

function decodeRecognitionOutput(output: Float32Array, dims: number[], dict: string[]): DecodedItem[] {
  if (dims.length !== 3) throw new Error(`Unsupported recognition output shape: ${dims.join('x')}`)
  const [batch, second, third] = dims
  const blankIndex = 0
  const isBatchTimeClass = second < third
  const timeSteps = isBatchTimeClass ? second : third
  const classes = isBatchTimeClass ? third : second
  const results: DecodedItem[] = []
  for (let b = 0; b < batch; b++) {
    let lastIndex = -1
    const pieces: string[] = []
    const confidences: number[] = []
    for (let step = 0; step < timeSteps; step++) {
      const logits = new Float32Array(classes)
      for (let c = 0; c < classes; c++) {
        logits[c] = output[isBatchTimeClass ? (b * timeSteps + step) * classes + c : (b * classes + c) * timeSteps + step]
      }
      const prediction = maxIndex(logits)
      if (prediction.index === blankIndex || prediction.index === lastIndex) {
        lastIndex = prediction.index
        continue
      }
      const token = dict[prediction.index - 1]
      if (token) {
        pieces.push(token)
        confidences.push(maxProbability(logits))
      }
      lastIndex = prediction.index
    }
    const score = confidences.length === 0 ? 0 : confidences.reduce((s, v) => s + v, 0) / confidences.length
    results.push({ text: pieces.join(''), score })
  }
  return results
}

// ===== ort session 运行工具 =====
async function runSession(
  session: ort.InferenceSession, data: Float32Array, dims: number[], inputName: string, outputName: string,
): Promise<ort.OnnxValue & { data: Float32Array, dims: number[] }> {
  const feeds: Record<string, ort.Tensor> = {}
  feeds[inputName] = new ort.Tensor('float32', data, dims)
  const output = (await session.run(feeds))[outputName]
  if (!output) throw new Error('ONNX Runtime returned no matching output tensor')
  return output as ort.OnnxValue & { data: Float32Array, dims: number[] }
}

// ===== 排序 boxes(按坐标,沿 ffocr sortBoxes) =====
function sortBoxes(boxes: DetectedBox[]): DetectedBox[] {
  return [...boxes].sort((a, b) => {
    const ly = a.points[0].y, ry = b.points[0].y
    if (Math.abs(ly - ry) > 12) return ly - ry
    return a.points[0].x - b.points[0].x
  })
}

// ===== 主接口 =====
// ===== 色号归一化:容 OCR 漏识中间零(H02→H2、B05→B5、E06→E6) =====
// 候选集生成:既补零也去零,双向兜底
function normalizeOcrText(text: string): string[] {
  const upper = text.toUpperCase()
  const candidates: string[] = [upper]
  // 字母 + 1 位数字 → 补零(H7→H07、B5→B05)
  const m1 = /^([A-Z])(\d)$/.exec(upper)
  if (m1) candidates.push(m1[1] + '0' + m1[2])
  // 字母 + 0 + 1 位数字 → 也试去零(H07→H7)
  const m2 = /^([A-Z])0(\d)$/.exec(upper)
  if (m2) candidates.push(m2[1] + m2[2])
  // 字母 + 2 位数字 → 也试单数字(H02→H2),覆盖模型漏中间零的场景
  const m3 = /^([A-Z])(\d)(\d)$/.exec(upper)
  if (m3) candidates.push(m3[1] + m3[3])
  return candidates
}

function resolveCodeFromOcr(ocrText: string, validCodes: Set<string>): string | null {
  const candidates = normalizeOcrText(ocrText)
  for (const cand of candidates) {
    if (validCodes.has(cand)) return cand
  }
  return null
}

// ===== 编辑距离纠错:识出单字 H/E/6 或错字 HT/85 时,找图例色号最近候选 =====
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (Math.abs(m - n) > 2) return Math.abs(m - n) // 编辑距离超 2 直接返回,免无意义纠错
  const dp: number[] = new Array(n + 1)
  for (let j = 0; j <= n; j++) dp[j] = j
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(
        dp[j] + 1,           // 删
        dp[j - 1] + 1,       // 插
        prev + (a[i - 1] === b[j - 1] ? 0 : 1), // 替
      )
      prev = tmp
    }
  }
  return dp[n]
}

// 识错纠错:在图例色号集里找编辑距离 ≤2 的最近候选
// 仅对识出文本长度 ≥1 且置信度尚可(≥0.3)的格启用,免低置信乱纠
function fuzzyResolveCode(ocrText: string, validCodes: string[]): string | null {
  if (ocrText.length === 0) return null
  let best: string | null = null
  let bestDist = 3 // 上限:编辑距离 ≤2 才纠
  for (const code of validCodes) {
    const dist = levenshtein(ocrText, code)
    if (dist < bestDist) {
      bestDist = dist
      best = code
    }
  }
  return best
}

export function useOcrRecognition() {
  function isReady(): boolean {
    return recSession !== null && detSession !== null && dictionary.length > 0
  }

  // 暴露给 EmbeddedCropper.vue 的 parseLegendWithOcr 兼容入口
  // 注意:此处保留一个类似 ffocr 的对象表面,但内部走自建 session
  function getOrCreateInstance(): {
    ocr: (source: ImageData | HTMLCanvasElement, options?: { onProgress?: (p: { phase: string, loaded?: number, totalBytes?: number, current?: number, total?: number }) => void }) => Promise<{ lines: { text: string, score: number, box: { points: { x: number, y: number }[] } }[] }>
  } {
    return {
      ocr: async (source, options) => {
        await ensureInit()
        const onProgress = options?.onProgress
        onProgress?.({ phase: 'preprocessing' })
        const image = await ensureImageData(source)
        const detInput = preprocessDetection(image)
        onProgress?.({ phase: 'detecting' })
        const detOutput = await runSession(detSession!, detInput.data, detInput.dims, detInputName, detOutputName)
        const boxes = sortBoxes(postprocessDetection(detOutput.data, detOutput.dims, {
          sourceWidth: image.width, sourceHeight: image.height,
          resizedWidth: detInput.resizedWidth, resizedHeight: detInput.resizedHeight,
          threshold: DET_THRESHOLD, boxThreshold: DET_BOX_THRESHOLD, unclipRatio: DET_UNCLIP_RATIO, minSize: DET_MIN_SIZE,
        }))

        const lines: { text: string, score: number, box: { points: { x: number, y: number }[] } }[] = []
        const batchSize = 8
        const totalBatches = Math.ceil(boxes.length / batchSize)
        let batchIndex = 0
        for (let cursor = 0; cursor < boxes.length; cursor += batchSize) {
          onProgress?.({ phase: 'recognizing', current: batchIndex + 1, total: totalBatches })
          const batchBoxes = boxes.slice(cursor, cursor + batchSize)
          const tensors: Float32Array[] = []
          for (const box of batchBoxes) {
            const xs = box.points.map(p => p.x)
            const ys = box.points.map(p => p.y)
            const left = Math.min(...xs), right = Math.max(...xs)
            const top = Math.min(...ys), bottom = Math.max(...ys)
            const crop = cropImageData(image, left, top, right - left, bottom - top)
            tensors.push(preprocessRecognition(crop))
          }
          const itemSize = REC_CHANNELS * REC_HEIGHT * REC_PAD_WIDTH
          const merged = new Float32Array(batchBoxes.length * itemSize)
          tensors.forEach((t, i) => merged.set(t, i * itemSize))
          const recOutput = await runSession(
            recSession!, merged,
            [batchBoxes.length, REC_CHANNELS, REC_HEIGHT, REC_PAD_WIDTH],
            recInputName, recOutputName,
          )
          decodeRecognitionOutput(recOutput.data, recOutput.dims, dictionary).forEach((item, index) => {
            const box = batchBoxes[index]
            lines.push({
              text: item.text,
              score: (item.score + box.score) / 2,
              box: { points: box.points },
            })
          })
          batchIndex++
        }
        return { lines: lines.filter(l => l.text.length > 0) }
      },
    }
  }

  // ===== 初始化:加载字典 + Det 模型 + Rec 模型 =====
  async function ensureInit(onProgress?: OcrProgressCallback): Promise<void> {
    if (initPromise) {
      await initPromise
      return
    }
    initPromise = (async () => {
      configureOrtEnv()
      try {
        // 1. 字典
        onProgress?.({ phase: 'loading_dictionary', phaseLabel: getPhaseLabel('loading_dictionary'), percent: 0 })
        const dictResp = await fetch(DEFAULT_DICTIONARY_URL)
        if (!dictResp.ok) throw new Error(`Failed to fetch dictionary: ${dictResp.status}`)
        const dictText = await dictResp.text()
        const lines = dictText.split(/\r?\n/u)
        if (lines[lines.length - 1] === '') lines.pop()
        dictionary = lines

        // 2. Det 模型
        onProgress?.({ phase: 'loading_detection_model', phaseLabel: getPhaseLabel('loading_detection_model'), percent: 10 })
        const detBuffer = await fetchWithCache(`${DEFAULT_MODEL_BASE_URL}/${PPOCRV5_MODEL_PATHS.detection.mobile}`)
        const detProviders = await getProviderCandidates()
        detSession = await ort.InferenceSession.create(detBuffer, {
          executionProviders: detProviders as ort.InferenceSession.ExecutionProviderConfig[],
          graphOptimizationLevel: 'all',
        })
        detInputName = detSession.inputNames[0]
        detOutputName = detSession.outputNames[0]

        // 3. Rec 模型
        onProgress?.({ phase: 'loading_recognition_model', phaseLabel: getPhaseLabel('loading_recognition_model'), percent: 60 })
        const recBuffer = await fetchWithCache(`${DEFAULT_MODEL_BASE_URL}/${PPOCRV5_MODEL_PATHS.recognition.mobile}`)
        const recProviders = await getProviderCandidates()
        recSession = await ort.InferenceSession.create(recBuffer, {
          executionProviders: recProviders as ort.InferenceSession.ExecutionProviderConfig[],
          graphOptimizationLevel: 'all',
        })
        recInputName = recSession.inputNames[0]
        recOutputName = recSession.outputNames[0]

        onProgress?.({ phase: 'ready', phaseLabel: getPhaseLabel('ready'), percent: 100 })
      } catch (e) {
        initPromise = null
        throw e
      }
    })()
    await initPromise
  }

  async function preload(onProgress?: OcrProgressCallback): Promise<void> {
    await ensureInit(onProgress)
  }

  // ===== 图纸切 ROI 批量识别(绕开 Det) =====
  async function recognizeGrid(
    canvas: HTMLCanvasElement,
    cols: number,
    rows: number,
    onProgress?: OcrProgressCallback,
    validCodes?: string[],
  ): Promise<GridCellResult[]> {
    await ensureInit()
    if (!recSession) throw new Error('Recognizer session is not available')

    // 字符白名单
    let allowedChars: Set<string> | null = null
    if (validCodes && validCodes.length > 0) {
      allowedChars = new Set<string>()
      for (const code of validCodes) for (const ch of code) allowedChars.add(ch)
    }

    const cellW = canvas.width / cols
    const cellH = canvas.height / rows
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Unable to get canvas 2D context')

    // Step 1+2: ROI 切片 + 空白过滤(自适应方差阈值)
    onProgress?.({ phase: 'roi-slicing', phaseLabel: getPhaseLabel('roi-slicing'), percent: 0 })
    interface CellROI { row: number, col: number, imageData: ImageData }
    const rois: CellROI[] = []
    let processed = 0
    const total = rows * cols

    // 第一遍:扫全图算各方差 + 深色像素占比,构建双特征空格判别
    // 方差单独分不开网格线噪(σ²高但深色像素细线占比低)与真色号文字(σ²高且墨色占比高)
    const variances = new Float32Array(total)
    const darkRatios = new Float32Array(total) // 深色像素占比(灰度<128 视为深色)
    const grayBuf = new Float32Array(total) // 暂存每格均值,供调试
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = Math.floor(col * cellW)
        const y = Math.floor(row * cellH)
        const w = Math.ceil(cellW)
        const h = Math.ceil(cellH)
        const imageData = ctx.getImageData(x, y, w, h)
        const px = imageData.data
        const n = px.length / 4
        let sum = 0, sumSq = 0, darkCount = 0
        for (let i = 0; i < px.length; i += 4) {
          const gray = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114)
          sum += gray
          sumSq += gray * gray
          if (gray < 128) darkCount++
        }
        const mean = sum / n
        const variance = Math.max(0, sumSq / n - mean * mean)
        variances[row * cols + col] = variance
        darkRatios[row * cols + col] = darkCount / n
        grayBuf[row * cols + col] = mean
        processed++
        if (processed % 100 === 0 || processed === total) {
          onProgress?.({ phase: 'roi-slicing', phaseLabel: getPhaseLabel('roi-slicing'), percent: Math.round((processed / total) * 15) })
        }
      }
    }

    // 双特征阈值:方差<200(纯色)或深色像素占比<5%(细线边框)判空格不入批
    // 真色号文字格:方差>200 且 墨色占比>5%;网格线/边框格:方差可能高但深色细线占比<5%
    const VAR_THRESHOLD = 200
    const DARK_RATIO_THRESHOLD = 0.01
    const sortedVars = Array.from(variances).sort((a, b) => a - b)
    const sortedDarkRatios = Array.from(darkRatios).sort((a, b) => a - b)
    console.log(`[OCR:batch] 方差分布: 中位数=${sortedVars[Math.floor(total / 2)].toFixed(1)}, 最小=${sortedVars[0].toFixed(1)}, 最大=${sortedVars[total - 1].toFixed(1)}`)
    console.log(`[OCR:batch] 深色占比分布: 中位数=${sortedDarkRatios[Math.floor(total / 2)].toFixed(3)}, 最小=${sortedDarkRatios[0].toFixed(3)}, 最大=${sortedDarkRatios[total - 1].toFixed(3)}`)
    console.log(`[OCR:batch] 双特征阈值: 方差<${VAR_THRESHOLD} 或 深色占比<${DARK_RATIO_THRESHOLD} 判空格`)

    // 第二遍:双特征超阈的格按原比保留缩放入批
    processed = 0
    let filteredByVar = 0, filteredByDark = 0
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col
        if (variances[idx] < VAR_THRESHOLD) { filteredByVar++; processed++; continue }
        if (darkRatios[idx] < DARK_RATIO_THRESHOLD) { filteredByDark++; processed++; continue }
        const x = Math.floor(col * cellW)
        const y = Math.floor(row * cellH)
        const w = Math.ceil(cellW)
        const h = Math.ceil(cellH)
        const imageData = ctx.getImageData(x, y, w, h)
        // 按原比保留:高度固定 48,宽度 = 48 × (原宽/原高),上限 320 沿 ppocrv5 Rec 默认
        const ratio = w / Math.max(h, 1)
        const roiW = Math.min(320, Math.max(8, Math.round(REC_HEIGHT * ratio)))
        const roiCanvas = createCanvas(roiW, REC_HEIGHT)
        const roiCtx = getCtx(roiCanvas)
        roiCtx.imageSmoothingEnabled = false
        // 先把原格 imageData 绘到原尺寸临时 canvas,再 drawImage 按原比缩放
        const srcCanvas = createCanvas(w, h)
        getCtx(srcCanvas).putImageData(imageData, 0, 0)
        roiCtx.drawImage(srcCanvas as unknown as CanvasImageSource, 0, 0, w, h, 0, 0, roiW, REC_HEIGHT)
        const roiImageData = roiCtx.getImageData(0, 0, roiW, REC_HEIGHT)
        rois.push({ row, col, imageData: roiImageData })
        processed++
        if (processed % 100 === 0 || processed === total) {
          onProgress?.({ phase: 'roi-slicing', phaseLabel: getPhaseLabel('roi-slicing'), percent: 15 + Math.round((processed / total) * 15) })
        }
      }
    }
    console.log(`[OCR:batch] 候选 ROI 数: ${rois.length} / ${total} 格 | 方差滤=${filteredByVar} 深色占比滤=${filteredByDark}`)

    if (rois.length === 0) return []

    // Step 3+4: 批量预处理 + ONNX 推理
    const itemSize = REC_CHANNELS * REC_HEIGHT * REC_PAD_WIDTH
    const results: GridCellResult[] = []
    const batchCount = Math.ceil(rois.length / REC_BATCH_SIZE)
    // 诊断计数器:置信度区间分布 + 识出但未命中图例的文本样本
    let textOutCount = 0           // 解码出非空文本的格数
    let highConfCount = 0          // score >= 0.85
    let midConfCount = 0           // 0.5 <= score < 0.85
    let lowConfCount = 0           // score < 0.5
    const lowConfSamples: string[] = []       // 低置信度样本(最多 30)
    const rejectedByCharWhitelist: string[] = [] // 因字符白名单被丢的文本样本(最多 30)
    const notMatchedSamples: string[] = []    // 识出但归一化也未命中图例的样本(最多 30)
    let notMatchedCount = 0
    const roisVariances: number[] = []        // 同步各方差,便于与解出结果对照
    for (let i = 0; i < rois.length; i++) roisVariances.push(variances[rois[i].row * cols + rois[i].col])

    // 图例色号归一化命中集合(大写) —— 识出 H2 也能命中 H02
    const validSet = validCodes && validCodes.length > 0
      ? new Set(validCodes.map(c => c.toUpperCase()))
      : null

    for (let bi = 0; bi < batchCount; bi++) {
      const start = bi * REC_BATCH_SIZE
      const end = Math.min(start + REC_BATCH_SIZE, rois.length)
      const N = end - start
      const tensor = new Float32Array(N * itemSize)
      for (let i = 0; i < N; i++) {
        const pre = preprocessRecognition(rois[start + i].imageData)
        tensor.set(pre, i * itemSize)
      }
      const output = await runSession(
        recSession, tensor, [N, REC_CHANNELS, REC_HEIGHT, REC_PAD_WIDTH], recInputName, recOutputName,
      )
      console.log(`[OCR:batch] 批#${bi + 1}/${batchCount} N=${N} 输出dims=${output.dims.join('x')}`)
      const decoded = decodeRecognitionOutput(output.data, output.dims, dictionary)
      for (let i = 0; i < decoded.length; i++) {
        const rawText = decoded[i].text
        const score = decoded[i].score
        if (rawText.length === 0) continue
        textOutCount++
        if (score >= 0.85) highConfCount++
        else if (score >= 0.5) midConfCount++
        else {
          lowConfCount++
          if (lowConfSamples.length < 30) lowConfSamples.push(`"${rawText}"(${score.toFixed(2)}) @r${rois[start + i].row}c${rois[start + i].col} σ²=${roisVariances[start + i].toFixed(0)}`)
        }
        const text = rawText.trim().toUpperCase()
        if (text.length === 0) continue
        // 字符白名单过滤:识出 H2$/$H2$ 等带非法字符的怪文本时,剥非法字符后再走色号匹配
        // 旧策略字符级直接丢,导致 H02 全军覆没;新策略先剥,剥完仍有内容才入色号归一化
        let cleanedText = text
        if (allowedChars) {
          cleanedText = ''
          for (const ch of text) {
            if (allowedChars.has(ch)) cleanedText += ch
          }
          if (cleanedText.length === 0) {
            // 全是非法字符 → 真"无意义"文本(如 □/国/-),记日志后丢
            if (rejectedByCharWhitelist.length < 30) {
              rejectedByCharWhitelist.push(`"${text}"(${score.toFixed(2)}) @r${rois[start + i].row}c${rois[start + i].col} σ²=${roisVariances[start + i].toFixed(0)}`)
            }
            continue
          }
          if (cleanedText !== text) {
            // 剥过非法字符:记录原文本→剥后文本对照,便于诊断
            if (rejectedByCharWhitelist.length < 30) {
              rejectedByCharWhitelist.push(`"${text}"→"${cleanedText}"(${score.toFixed(2)}) @r${rois[start + i].row}c${rois[start + i].col} σ²=${roisVariances[start + i].toFixed(0)}`)
            }
          }
        }
        // 色号归一化匹配:识出 H2/B5/E6 也命中图例的 H02/B05/E06
        let resolvedCode = cleanedText
        if (validSet) {
          const hit = resolveCodeFromOcr(cleanedText, validSet)
          if (hit) {
            resolvedCode = hit
          } else {
            // 归一化未命中 → 编辑距离纠错:识出单字 H/E/6 或错字 HT/85 时,找图例色号最近候选
            // 仅对置信度尚可(≥0.3)的格启用,免低置信乱纠
            let fuzzy: string | null = null
            if (score >= 0.3 && validCodes && validCodes.length > 0) {
              fuzzy = fuzzyResolveCode(cleanedText, validCodes)
            }
            if (fuzzy) {
              resolvedCode = fuzzy
            } else {
              notMatchedCount++
              if (notMatchedSamples.length < 30) {
                notMatchedSamples.push(`"${cleanedText}"(${score.toFixed(2)}) @r${rois[start + i].row}c${rois[start + i].col}`)
              }
              // 未命中图例的文本不入结果,免上层再做无效匹配
              continue
            }
          }
        }
        results.push({
          row: rois[start + i].row,
          col: rois[start + i].col,
          text: resolvedCode,
          confidence: score,
        })
      }
      onProgress?.({
        phase: 'batch-rec', phaseLabel: getPhaseLabel('batch-rec'),
        percent: 30 + Math.round(((bi + 1) / batchCount) * 70),
      })
    }

    // 诊断日志汇总:定位"识出但未命中图例"或"置信度偏低"的真问题
    console.log(`[OCR:batch] 解码命中(归一化后): ${results.length} 格`)
    console.log(`[OCR:batch] 解码分布: 非空文本=${textOutCount}/${rois.length} 嘱入批格 | 高置信(≥0.85)=${highConfCount} 中置信(0.5~0.85)=${midConfCount} 低置信(<0.5)=${lowConfCount}`)
    if (lowConfSamples.length > 0) {
      console.log(`[OCR:batch] 低置信度样本(前${lowConfSamples.length}个):\n  ${lowConfSamples.join('\n  ')}`)
    }
    if (rejectedByCharWhitelist.length > 0) {
      console.log(`[OCR:batch] 字符白名单拒绝样本(前${rejectedByCharWhitelist.length}个):\n  ${rejectedByCharWhitelist.join('\n  ')}`)
    }
    if (validSet) {
      console.log(`[OCR:batch] 色号归一化命中: ${results.length} | 未命中=${notMatchedCount}`)
      if (notMatchedSamples.length > 0) {
        console.log(`[OCR:batch] 归一化未命中样本(前${notMatchedSamples.length}个):\n  ${notMatchedSamples.join('\n  ')}`)
      }
    }
    return results
  }

  function dispose(): void {
    if (detSession) { detSession.release(); detSession = null }
    if (recSession) { recSession.release(); recSession = null }
    dictionary = []
    initPromise = null
  }

  return {
    preload,
    recognizeGrid,
    isReady,
    getOrCreateInstance,
    dispose,
  }
}
