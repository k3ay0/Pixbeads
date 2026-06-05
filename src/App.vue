<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, defineAsyncComponent, nextTick } from 'vue'
import {
  hexToRgb,
  calculatePixelGrid,
  mergeSimilarRegions,
  recalculateColorStats,
} from './utils/pixelation'
import {
  getMardToHexMapping,
  getColorKeyByHex,
  colorSystemOptions,
  sortColorsByHue,
} from './utils/colorSystemUtils'
import { downloadGridImage, downloadStatsImage, exportCsv, importCsvData, exportPbds, importPbds } from './utils/downloader'
import type { PbdsImportResult } from './utils/downloader'
import { useManualEditingState } from './composables/useManualEditingState'
import { usePixelEditingOperations } from './composables/usePixelEditingOperations'
import { clientToGridCoords } from './utils/canvasUtils'
import { loadPaletteSelections, savePaletteSelections, presetToSelections } from './utils/localStorageUtils'
import {
  getConnectedRegion,
  getAllConnectedRegions,
  isRegionCompleted,
  getRegionCenter,
  sortRegionsByDistance,
  sortRegionsBySize,
} from './utils/floodFillUtils'
import DownloadSettingsModal from './components/DownloadSettingsModal.vue'
import ImportConvertDialog from './components/ImportConvertDialog.vue'
import ColorPalette from './components/ColorPalette.vue'
import InstallPWA from './components/InstallPWA.vue'
import ImageCropper from './components/ImageCropper.vue'
import FocusCanvas from './components/FocusCanvas.vue'
import ColorStatusBar from './components/ColorStatusBar.vue'
import ProgressBar from './components/ProgressBar.vue'
import FocusToolBar from './components/FocusToolBar.vue'
import FocusColorPanel from './components/FocusColorPanel.vue'
import type {
  PaletteColor,
  MappedPixel,
  GridDimensions,
  ColorCounts,
  GridDownloadOptions,
  ColorSystem,
} from './types'
import {
  TRANSPARENT_KEY,
  PixelationMode,
} from './types'

// ========== 安全异步组件导入 ==========
const MagnifierTool = defineAsyncComponent(() =>
  import('./components/MagnifierTool.vue').catch(() => ({ render: () => null }))
)
const SettingsPanel = defineAsyncComponent(() =>
  import('./components/SettingsPanel.vue').catch(() => ({ render: () => null }))
)
const DonationModal = defineAsyncComponent(() =>
  import('./components/DonationModal.vue').catch(() => ({ render: () => null }))
)
const CustomPaletteEditor = defineAsyncComponent(() =>
  import('./components/CustomPaletteEditor.vue').catch(() => ({ render: () => null }))
)

// ========== 模式系统 ==========
type AppMode = 'optimize' | 'edit' | 'preview' | 'focus'
const activeMode = ref<AppMode>('optimize')
const modes = [
  { key: 'optimize' as const, label: '优化' },
  { key: 'edit' as const, label: '编辑' },
  { key: 'preview' as const, label: '预览' },
  { key: 'focus' as const, label: '专心' },
]

// ========== 调色板初始化 ==========
const mardToHexMapping = getMardToHexMapping()
const fullBeadPalette: PaletteColor[] = Object.entries(mardToHexMapping)
  .map(([mardKey, hex]) => {
    const rgb = hexToRgb(hex)
    if (!rgb) return null
    return { key: hex, hex, rgb }
  })
  .filter((c): c is PaletteColor => c !== null)

// ========== 响应式状态 ==========
const originalImageSrc = ref<string | null>(null)
const originalImage = ref<HTMLImageElement | null>(null)

// 控制参数
const granularity = ref(50)
const granularityInput = ref('50')
const granularityY = ref(0)
const granularityYInput = ref('0')
const lockAspectRatio = ref(false)
const similarityThreshold = ref(30)
const similarityThresholdInput = ref('30')
const pixelationMode = ref<PixelationMode>(PixelationMode.Dominant)
const selectedColorSystem = ref<ColorSystem>('MARD')

// 裁剪相关
const showCropper = ref(false)
const croppedImageCanvas = ref<HTMLCanvasElement | null>(null)

// 像素数据
const mappedPixelData = ref<MappedPixel[][] | null>(null)
const gridDimensions = ref<GridDimensions | null>(null)
const colorCounts = ref<ColorCounts | null>(null)
const totalBeadCount = ref(0)

// 色板选择
const customPaletteSelections = ref<Record<string, boolean>>({})
const excludedColorKeys = ref<Set<string>>(new Set())

// UI 状态
const activeBeadPalette = ref<PaletteColor[]>([])
const isProcessing = ref(false)
const showDownloadModal = ref(false)
const tooltipData = ref<{ x: number; y: number; key: string; color: string; row: number; col: number } | null>(null)
const toastMessage = ref<string | null>(null)

// 导入相关状态
const showImportMenu = ref(false)
const pbdsFileInput = ref<HTMLInputElement | null>(null)
const showImportDialog = ref(false)
const pendingPbdsData = ref<PbdsImportResult | null>(null)

// 导出相关状态
const showExportMenu = ref(false)

// Canvas 缩放和拖动状态
const canvasZoom = ref(1)
const canvasTranslate = ref({ x: 0, y: 0 })
const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })
const MIN_ZOOM = 0.1
const MAX_ZOOM = 5

const previewCanvas = ref<HTMLCanvasElement | null>(null)

function showToast(msg: string) {
  toastMessage.value = msg
  setTimeout(() => { toastMessage.value = null }, 2000)
}

// ========== 拼豆模式状态 ==========
const currentColor = ref('')
const selectedCell = ref<{ row: number; col: number } | null>(null)
const canvasScale = ref(1)
const canvasOffset = ref({ x: 0, y: 0 })
const completedCells = ref<Set<string>>(new Set())
const colorProgress = ref<Record<string, { completed: number; total: number }>>({})
const recommendedRegion = ref<Array<{ row: number; col: number }> | null>(null)
const recommendedCell = ref<{ row: number; col: number } | null>(null)
const guidanceMode = ref<'nearest' | 'largest' | 'edge-first'>('nearest')
const showColorPanel = ref(false)
const isPaused = ref(true)
const totalElapsedTime = ref(0)
const lastResumeTime = ref(Date.now())
let timerInterval: ReturnType<typeof setInterval> | null = null
const gridSectionInterval = ref(10)
const showSectionLines = ref(true)
const sectionLineColor = ref('#007acc')
const availableColors = ref<Array<{ color: string; name: string; total: number; completed: number }>>([])

// ========== 撤销/重做 ==========
const editHistory = ref<MappedPixel[][][]>([])
const editHistoryIndex = ref(-1)
const MAX_HISTORY = 50

// ========== 一键去背景 ==========
const bgRemovalSnapshot = ref<{ mappedPixelData: MappedPixel[][]; colorCounts: ColorCounts; totalBeadCount: number } | null>(null)

function handleAutoRemoveBackground() {
  if (!mappedPixelData.value || !gridDimensions.value) return

  // 保存快照用于单步撤回
  bgRemovalSnapshot.value = {
    mappedPixelData: mappedPixelData.value.map(r => r.map(c => ({ ...c }))),
    colorCounts: colorCounts.value ? { ...colorCounts.value } : {},
    totalBeadCount: totalBeadCount.value,
  }
  // 去背景会大幅改变数据，清空编辑撤回历史
  editHistory.value = []
  editHistoryIndex.value = -1

  const { N, M } = gridDimensions.value
  const borderCounts = new Map()

  const countBorderCell = (row, col) => {
    const cell = mappedPixelData.value[row]?.[col]
    if (!cell || cell.isExternal || cell.key === TRANSPARENT_KEY) return
    const key = cell.key
    borderCounts.set(key, (borderCounts.get(key) || 0) + 1)
  }

  for (let col = 0; col < N; col++) {
    countBorderCell(0, col)
    if (M > 1) countBorderCell(M - 1, col)
  }
  for (let row = 1; row < M - 1; row++) {
    countBorderCell(row, 0)
    if (N > 1) countBorderCell(row, N - 1)
  }

  if (borderCounts.size === 0) return

  let targetKey = ''
  let maxCount = -1
  borderCounts.forEach((count, key) => {
    if (count > maxCount) {
      maxCount = count
      targetKey = key
    }
  })

  const newPixelData = mappedPixelData.value.map(r => r.map(c => ({ ...c })))
  const visited = Array(M).fill(null).map(() => Array(N).fill(false))
  const stack = []

  const pushIfTarget = (row, col) => {
    if (row < 0 || row >= M || col < 0 || col >= N || visited[row][col]) return
    const cell = newPixelData[row][col]
    if (!cell || cell.isExternal || cell.key !== targetKey) return
    visited[row][col] = true
    stack.push({ row, col })
  }

  for (let col = 0; col < N; col++) {
    pushIfTarget(0, col)
    if (M > 1) pushIfTarget(M - 1, col)
  }
  for (let row = 1; row < M - 1; row++) {
    pushIfTarget(row, 0)
    if (N > 1) pushIfTarget(row, N - 1)
  }

  if (stack.length === 0) return

  while (stack.length > 0) {
    const { row, col } = stack.pop()
    newPixelData[row][col] = { key: TRANSPARENT_KEY, color: '#FFFFFF', isExternal: true }
    pushIfTarget(row - 1, col)
    pushIfTarget(row + 1, col)
    pushIfTarget(row, col - 1)
    pushIfTarget(row, col + 1)
  }

  mappedPixelData.value = newPixelData
  const stats = recalculateColorStats(newPixelData)
  colorCounts.value = stats.colorCounts
  totalBeadCount.value = stats.totalCount
}

function handleUndoBgRemoval() {
  if (!bgRemovalSnapshot.value) return
  mappedPixelData.value = bgRemovalSnapshot.value.mappedPixelData
  colorCounts.value = bgRemovalSnapshot.value.colorCounts
  totalBeadCount.value = bgRemovalSnapshot.value.totalBeadCount
  bgRemovalSnapshot.value = null
}

// ========== 洪水填充擦除 ==========
const isFloodFillEraseMode = ref(false)



// ========== 悬浮调色盘 ==========
const floatingPalette = ref({
  x: 20,
  y: 200,
  isDragging: false,
  dragOffsetX: 0,
  dragOffsetY: 0,
  collapsed: false,
})

// ========== 放大镜工具 ==========
const isMagnifierActive = ref(false)
const magnifierSelectionArea = ref(null) // { x1, y1, x2, y2 } in grid coords

function toggleMagnifier() {
  if (isMagnifierActive.value) {
    exitMagnifierMode()
  } else {
    isMagnifierActive.value = true
    magnifierSelectionArea.value = null
    // 退出其他互斥编辑模式
    isEraseMode.value = false
    isFloodFillEraseMode.value = false
    colorReplaceState.value.isActive = false
    selectedEditColor.value = null
  }
}

function exitMagnifierMode() {
  isMagnifierActive.value = false
  magnifierSelectionArea.value = null
}

function handleMagnifierSelection(area) {
  magnifierSelectionArea.value = area
}

function handleMagnifierPixelEdit({ row, col, color }) {
  if (!mappedPixelData.value || !gridDimensions.value) return
  saveEditSnapshot()
  const newData = mappedPixelData.value.map(r => r.map(c => ({ ...c })))
  if (color === null) {
    // 擦除像素
    newData[row][col] = { key: TRANSPARENT_KEY, color: '#FFFFFF', isExternal: true }
  } else {
    newData[row][col] = {
      key: color.key,
      color: color.color,
      isExternal: false,
    }
  }
  mappedPixelData.value = newData
  const stats = recalculateColorStats(newData)
  colorCounts.value = stats.colorCounts
  totalBeadCount.value = stats.totalCount
}

// ========== 自定义色板编辑器 ==========
const showPaletteEditor = ref(false)

function handlePaletteEditorSave(selections) {
  customPaletteSelections.value = selections
  showPaletteEditor.value = false
}

// ========== 设置面板 ==========
const showSettingsPanel = ref(false)

// ========== 打赏弹窗 ==========
const showDonationModal = ref(false)

// 下载选项
const downloadOptions = ref<GridDownloadOptions>({
  showGrid: true,
  gridInterval: 10,
  showCoordinates: true,
  showCellNumbers: true,
  gridLineColor: '#CCCCCC',
  includeStats: true,
  exportPbds: false,
})

// ========== 初始化色板选择 ==========
onMounted(() => {
  const allHexValues = fullBeadPalette.map(c => c.hex.toUpperCase())
  const saved = loadPaletteSelections()
  if (saved) {
    // 验证
    const valid = {}
    let hasValid = false
    Object.entries(saved).forEach(([key, value]) => {
      if (/^#[0-9A-F]{6}$/i.test(key) && allHexValues.includes(key.toUpperCase())) {
        valid[key.toUpperCase()] = value
        hasValid = true
      }
    })
    if (hasValid) {
      customPaletteSelections.value = valid
    } else {
      initDefaultPalette(allHexValues)
    }
  } else {
    initDefaultPalette(allHexValues)
  }

  // 全局点击关闭导入菜单
  document.addEventListener('click', handleGlobalClick)
})

onUnmounted(() => {
  document.removeEventListener('click', handleGlobalClick)
})

function handleGlobalClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.relative')) {
    showImportMenu.value = false
    showExportMenu.value = false
  }
}

function initDefaultPalette(allHexValues) {
  const selections = {}
  allHexValues.forEach(hex => { selections[hex.toUpperCase()] = true })
  customPaletteSelections.value = selections
}

// ========== 活跃调色板 ==========
watch([customPaletteSelections, excludedColorKeys], () => {
  const palette = fullBeadPalette.filter(color => {
    const hex = color.hex.toUpperCase()
    return customPaletteSelections.value[hex] && !excludedColorKeys.value.has(hex)
  })
  activeBeadPalette.value = palette
}, { immediate: true })

// ========== 网格颜色列表 ==========
const currentGridColors = computed(() => {
  if (!mappedPixelData.value) return []
  const map = new Map()
  mappedPixelData.value.flat().forEach(cell => {
    if (cell && cell.color && !cell.isExternal) {
      const hex = cell.color.toUpperCase()
      if (!map.has(hex)) map.set(hex, { key: cell.key, color: cell.color })
    }
  })
  return sortColorsByHue(
    Array.from(map.values()).map(c => ({
      key: getColorKeyByHex(c.color, selectedColorSystem.value),
      color: c.color,
    }))
  )
})

// ========== 输入同步 ==========
watch(granularity, v => {
  granularityInput.value = v.toString()
  // 锁定比例时自动计算高度
  if (lockAspectRatio.value) {
    const src = croppedImageCanvas.value || originalImage.value
    if (src) {
      const aspectRatio = ('height' in src ? src.height : (src as HTMLCanvasElement).height) / ('width' in src ? src.width : (src as HTMLCanvasElement).width)
      const newY = Math.max(1, Math.round(v * aspectRatio))
      granularityY.value = newY
      granularityYInput.value = newY.toString()
    }
  }
})
watch(granularityY, v => { granularityYInput.value = v.toString() })
watch(similarityThreshold, v => { similarityThresholdInput.value = v.toString() })

// ========== 图片上传 ==========
const fileInput = ref(null)

function triggerFileInput() {
  showImportMenu.value = false
  fileInput.value?.click()
}

function triggerPbdsInput() {
  showImportMenu.value = false
  pbdsFileInput.value?.click()
}

function handleFileDrop(e) {
  e.preventDefault()
  const file = e.dataTransfer?.files?.[0]
  if (!file) return
  if (file.name.toLowerCase().endsWith('.pbds')) {
    loadPbds(file)
  } else if (file.type.startsWith('image/')) {
    loadImage(file)
  }
}

function handleFileChange(e) {
  const file = e.target?.files?.[0]
  if (!file) return
  loadImage(file)
}

function handlePbdsFileChange(e) {
  const file = e.target?.files?.[0]
  if (!file) return
  loadPbds(file)
}

async function loadPbds(file: File) {
  try {
    const result = await importPbds(file)
    pendingPbdsData.value = result
    showImportDialog.value = true
  } catch (error) {
    console.error('PBDS导入失败:', error)
    alert(`PBDS导入失败：${error}`)
  }
}

function handleImportConfirm(data: { mappedPixelData: MappedPixel[][]; gridDimensions: GridDimensions; colorSystem: ColorSystem }) {
  mappedPixelData.value = data.mappedPixelData
  gridDimensions.value = data.gridDimensions
  selectedColorSystem.value = data.colorSystem
  originalImageSrc.value = null
  originalImage.value = null
  bgRemovalSnapshot.value = null

  const stats = recalculateColorStats(data.mappedPixelData)
  colorCounts.value = stats.colorCounts
  totalBeadCount.value = stats.totalCount

  editHistory.value = []
  editHistoryIndex.value = -1
  saveEditSnapshot()

  granularity.value = data.gridDimensions.N
  granularityInput.value = data.gridDimensions.N.toString()

  showImportDialog.value = false
  pendingPbdsData.value = null
  showToast('导入成功')
}

function handleImportCancel() {
  showImportDialog.value = false
  pendingPbdsData.value = null
}

function loadImage(file: File) {
  const reader = new FileReader()
  reader.onload = (e) => {
    originalImageSrc.value = e.target?.result as string
    bgRemovalSnapshot.value = null
    croppedImageCanvas.value = null
    granularityY.value = 0
    granularityYInput.value = '0'
    const img = new Image()
    img.onload = () => {
      originalImage.value = img
      // 显示裁剪界面
      showCropper.value = true
    }
    img.src = e.target?.result as string
  }
  reader.readAsDataURL(file)
}

// ========== 裁剪回调 ==========
function handleCropConfirm(canvas: HTMLCanvasElement) {
  croppedImageCanvas.value = canvas
  showCropper.value = false
  // 设置高度粒度为裁剪区域的等比例默认值
  const aspectRatio = canvas.height / canvas.width
  const defaultY = Math.max(1, Math.round(granularity.value * aspectRatio))
  granularityY.value = defaultY
  granularityYInput.value = defaultY.toString()
  processImage()
}

function handleCropSkip() {
  croppedImageCanvas.value = null
  showCropper.value = false
  granularityY.value = 0
  granularityYInput.value = '0'
  processImage()
}

// ========== 核心处理 ==========
function processImage() {
  if (!originalImage.value && !croppedImageCanvas.value) return
  isProcessing.value = true

  // 使用 setTimeout 让 UI 更新
  setTimeout(() => {
    try {
      const N = granularity.value
      let sourceCanvas: HTMLCanvasElement
      let imgWidth: number
      let imgHeight: number

      if (croppedImageCanvas.value) {
        // 使用裁剪后的 canvas
        sourceCanvas = croppedImageCanvas.value
        imgWidth = sourceCanvas.width
        imgHeight = sourceCanvas.height
      } else {
        // 使用原图
        const img = originalImage.value!
        imgWidth = img.width
        imgHeight = img.height
        sourceCanvas = document.createElement('canvas')
        sourceCanvas.width = imgWidth
        sourceCanvas.height = imgHeight
        const ctx = sourceCanvas.getContext('2d')!
        ctx.drawImage(img, 0, 0)
      }

      // 计算 M：裁剪模式下使用独立值，否则根据比例自动计算
      let M: number
      if (croppedImageCanvas.value && granularityY.value > 0) {
        M = granularityY.value
      } else {
        const aspectRatio = imgHeight / imgWidth
        M = Math.max(1, Math.round(N * aspectRatio))
      }

      const ctx = sourceCanvas.getContext('2d')!

      // 像素化 — 传入原始 MARD 调色板（hex key），不进行色号系统转换
      // 回退颜色：T1 key → 任意白色 hex → 第一个调色板颜色
      const fallbackColor = activeBeadPalette.value.find(p => p.key === 'T1')
        || activeBeadPalette.value.find(p => p.hex.toUpperCase() === '#FFFFFF')
        || activeBeadPalette.value[0]
        || { key: '?', hex: '#000000', rgb: { r: 0, g: 0, b: 0 } }
      let result = calculatePixelGrid(ctx, imgWidth, imgHeight, N, M, activeBeadPalette.value, pixelationMode.value, fallbackColor)

      // 区域合并 — 传入调色板用于 key→RGB 查找
      if (similarityThreshold.value > 0) {
        result = mergeSimilarRegions(result, similarityThreshold.value, activeBeadPalette.value)
      }

      // 更新状态
      mappedPixelData.value = result
      gridDimensions.value = { N, M }

      // 统计
      const stats = recalculateColorStats(result)
      colorCounts.value = stats.colorCounts
      totalBeadCount.value = stats.totalCount

      // 初始化编辑历史
      editHistory.value = []
      editHistoryIndex.value = -1
      saveEditSnapshot()
    } catch (err) {
      console.error('处理失败:', err)
    } finally {
      isProcessing.value = false
    }
  }, 50)
}

// 重新处理
watch([granularity, granularityY, similarityThreshold, pixelationMode, activeBeadPalette], () => {
  bgRemovalSnapshot.value = null
  if (originalImage.value || croppedImageCanvas.value) processImage()
})

// ========== 手动编辑 ==========
// 使用 composable 管理手动编辑状态
const {
  isManualColoringMode,
  selectedColor,
  isEraseMode,
  colorReplaceState,
  highlightColorKey,
  enterManualMode,
  exitManualMode: exitManualModeBase,
  toggleEraseMode,
  toggleColorReplaceMode,
  selectColor,
  selectSourceColorFromCanvas,
  completeColorReplace,
  setHighlight,
  clearHighlight,
} = useManualEditingState()

// 别名：保持模板兼容性
const selectedEditColor = selectedColor

// 扩展退出手动编辑模式（额外清理 App.vue 专有状态）
function exitManualMode() {
  exitManualModeBase()
  isFloodFillEraseMode.value = false
  isMagnifierActive.value = false
  magnifierSelectionArea.value = null
}

// 委托到 composable
function selectEditColor(color) {
  selectColor(color)
}

// 使用像素编辑操作 composable
const {
  performFloodFillErase,
  performColorReplace,
  performSinglePixelPaint,
} = usePixelEditingOperations({
  mappedPixelData,
  gridDimensions,
  colorCounts,
  totalBeadCount,
  onPixelDataChange: (newData) => { mappedPixelData.value = newData },
  onColorCountsChange: (newCounts) => { colorCounts.value = newCounts },
  onTotalCountChange: (newCount) => { totalBeadCount.value = newCount },
})

// 色板展开状态（用于 ColorPalette 组件）
const showFullPalette = ref(false)

// ColorPalette 颜色选择事件处理
function handlePaletteColorSelect(colorData) {
  selectEditColor(colorData)
}

// ColorPalette 颜色替换事件处理
function handlePaletteColorReplace(sourceColor, targetColor) {
  saveEditSnapshot()
  performColorReplace(sourceColor, targetColor)
  completeColorReplace()
}

function handleCanvasClick(e) {
  if (!mappedPixelData.value || !gridDimensions.value) return
  if (!isManualColoringMode.value) return
  if (isDragging.value) return

  const canvas = e.target
  const coords = clientToGridCoords(e.clientX, e.clientY, canvas, gridDimensions.value)
  if (!coords) return

  const { i: col, j: row } = coords
  const cell = mappedPixelData.value[row][col]
  if (!cell || cell.isExternal) return

  // 洪水填充擦除模式
  if (isFloodFillEraseMode.value) {
    handleFloodFillErase(row, col)
    return
  }

  // 颜色批量替换模式
  if (colorReplaceState.value.isActive) {
    handleColorReplaceClick(row, col)
    return
  }

  if (isEraseMode.value) {
    saveEditSnapshot()
    performSinglePixelPaint(row, col, { key: TRANSPARENT_KEY, color: '#FFFFFF', isExternal: true })
  } else if (selectedEditColor.value) {
    saveEditSnapshot()
    performSinglePixelPaint(row, col, {
      key: selectedEditColor.value.key,
      color: selectedEditColor.value.color,
      isExternal: false,
    })
  } else {
    // 吸管: 选中当前颜色
    const hex = cell.color.toUpperCase()
    selectedEditColor.value = { key: getColorKeyByHex(hex, selectedColorSystem.value), color: cell.color }
  }
}

function handleCanvasHover(e) {
  if (!mappedPixelData.value || !gridDimensions.value) return
  if (isDragging.value) return
  const canvas = e.target
  const coords = clientToGridCoords(e.clientX, e.clientY, canvas, gridDimensions.value)

  if (coords) {
    const { i: col, j: row } = coords
    const cell = mappedPixelData.value[row][col]
    if (cell && !cell.isExternal) {
      const displayKey = getColorKeyByHex(cell.color, selectedColorSystem.value)
      const rect = canvas.getBoundingClientRect()
      tooltipData.value = {
        x: e.clientX - rect.left + 15,
        y: e.clientY - rect.top - 10,
        key: displayKey,
        color: cell.color,
        row: row + 1,
        col: col + 1,
      }
      return
    }
  }
  tooltipData.value = null
}

function handleCanvasLeave() {
  tooltipData.value = null
}

// ========== 撤销/重做 ==========
function saveEditSnapshot() {
  // 截断当前位置之后的历史（如果有）
  if (editHistoryIndex.value < editHistory.value.length - 1) {
    editHistory.value = editHistory.value.slice(0, editHistoryIndex.value + 1)
  }
  // 保存当前快照
  const snapshot = mappedPixelData.value.map(r => r.map(c => ({ ...c })))
  editHistory.value.push(snapshot)
  // 限制最大步数
  if (editHistory.value.length > MAX_HISTORY) {
    editHistory.value.shift()
  }
  editHistoryIndex.value = editHistory.value.length - 1
}

function undoEdit() {
  if (editHistoryIndex.value < 0) return
  const snapshot = editHistory.value[editHistoryIndex.value]
  mappedPixelData.value = snapshot.map(r => r.map(c => ({ ...c })))
  editHistoryIndex.value--
  const stats = recalculateColorStats(mappedPixelData.value)
  colorCounts.value = stats.colorCounts
  totalBeadCount.value = stats.totalCount
  showToast('已撤回上一步')
}

function redoEdit() {
  if (editHistoryIndex.value >= editHistory.value.length - 1) return
  editHistoryIndex.value++
  const snapshot = editHistory.value[editHistoryIndex.value]
  mappedPixelData.value = snapshot.map(r => r.map(c => ({ ...c })))
  const stats = recalculateColorStats(mappedPixelData.value)
  colorCounts.value = stats.colorCounts
  totalBeadCount.value = stats.totalCount
  showToast('已重做上一步')
}

// ========== 洪水填充擦除模式 ==========
function enterFloodFillEraseMode() {
  isFloodFillEraseMode.value = true
  // 退出其他互斥模式
  isEraseMode.value = false
  selectedEditColor.value = null
  colorReplaceState.value.isActive = false
  colorReplaceState.value.step = 'select-source'
  colorReplaceState.value.sourceColor = null
}

function exitFloodFillEraseMode() {
  isFloodFillEraseMode.value = false
}

// ========== 颜色批量替换模式 ==========
function enterColorReplaceMode() {
  colorReplaceState.value.isActive = true
  colorReplaceState.value.step = 'select-source'
  colorReplaceState.value.sourceColor = null
  // 退出其他互斥模式
  isEraseMode.value = false
  isFloodFillEraseMode.value = false
  selectedEditColor.value = null
}

function exitColorReplaceMode() {
  colorReplaceState.value.isActive = false
  colorReplaceState.value.step = 'select-source'
  colorReplaceState.value.sourceColor = null
}

function handleFloodFillErase(row, col) {
  if (!mappedPixelData.value || !gridDimensions.value) return
  const cell = mappedPixelData.value[row]?.[col]
  if (!cell || cell.isExternal) return

  // 保存编辑快照
  saveEditSnapshot()

  performFloodFillErase(row, col, cell.key)
}

function handleColorReplaceClick(row, col) {
  if (!mappedPixelData.value || !gridDimensions.value) return
  const cell = mappedPixelData.value[row]?.[col]
  if (!cell || cell.isExternal) return

  if (colorReplaceState.value.step === 'select-source') {
    // 第一步：选择源颜色
    colorReplaceState.value.sourceColor = {
      hex: cell.color.toUpperCase(),
      key: getColorKeyByHex(cell.color.toUpperCase(), selectedColorSystem.value),
    }
    colorReplaceState.value.step = 'select-target'
  } else if (colorReplaceState.value.step === 'select-target') {
    // 第二步：选择目标颜色并执行替换
    const targetHex = cell.color.toUpperCase()
    const targetKey = getColorKeyByHex(targetHex, selectedColorSystem.value)
    const sourceHex = colorReplaceState.value.sourceColor.hex

    if (sourceHex === targetHex) {
      // 源色和目标色相同，不替换
      exitColorReplaceMode()
      return
    }

    // 保存编辑快照
    saveEditSnapshot()

    const sourceColor = { key: colorReplaceState.value.sourceColor.key, color: colorReplaceState.value.sourceColor.hex }
    const targetColor = { key: targetKey, color: targetHex }
    performColorReplace(sourceColor, targetColor)
    exitColorReplaceMode()
  }
}

// ========== 色板编辑器关闭 ==========
function handlePaletteEditorClose() {
  showPaletteEditor.value = false
}

// ========== 悬浮调色盘拖拽 ==========
function onPaletteHeaderMouseDown(e) {
  e.preventDefault()
  floatingPalette.value.isDragging = true
  floatingPalette.value.dragOffsetX = e.clientX - floatingPalette.value.x
  floatingPalette.value.dragOffsetY = e.clientY - floatingPalette.value.y
  document.addEventListener('mousemove', onPaletteMouseMove)
  document.addEventListener('mouseup', onPaletteMouseUp)
}

function onPaletteMouseMove(e) {
  if (!floatingPalette.value.isDragging) return
  floatingPalette.value.x = e.clientX - floatingPalette.value.dragOffsetX
  floatingPalette.value.y = e.clientY - floatingPalette.value.dragOffsetY
}

function onPaletteMouseUp() {
  floatingPalette.value.isDragging = false
  document.removeEventListener('mousemove', onPaletteMouseMove)
  document.removeEventListener('mouseup', onPaletteMouseUp)
}

function togglePaletteCollapse() {
  floatingPalette.value.collapsed = !floatingPalette.value.collapsed
}

// ========== 键盘快捷键 ==========
onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
})

function handleKeyDown(e) {
  // Ctrl+Z 撤销
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault()
    undoEdit()
  }
  // Ctrl+Shift+Z 或 Ctrl+Y 重做
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
    e.preventDefault()
    redoEdit()
  }
  // Escape 退出当前模式
  if (e.key === 'Escape') {
    if (colorReplaceState.value.isActive) {
      exitColorReplaceMode()
    } else if (isFloodFillEraseMode.value) {
      exitFloodFillEraseMode()
    } else if (isMagnifierActive.value) {
      exitMagnifierMode()
    }
  }
}

// ========== 色号系统切换 ==========
watch(selectedColorSystem, () => {
  if (originalImage.value) processImage()
})

// ========== 拼豆模式逻辑 ==========
function initFocusMode() {
  if (!mappedPixelData.value || !colorCounts.value) return
  const colors = Object.entries(colorCounts.value).map(([, data]) => ({
    color: data.color,
    name: getColorKeyByHex(data.color, selectedColorSystem.value),
    total: data.count,
    completed: 0,
  }))
  availableColors.value = colors
  if (colors.length > 0) {
    currentColor.value = colors[0].color
    const progress: Record<string, { completed: number; total: number }> = {}
    colors.forEach(c => { progress[c.color] = { completed: 0, total: c.total } })
    colorProgress.value = progress
  }
  completedCells.value = new Set()
  selectedCell.value = null
  canvasScale.value = 1
  canvasOffset.value = { x: 0, y: 0 }
  startTimer()
}

function startTimer() {
  stopTimer()
  isPaused.value = false
  lastResumeTime.value = Date.now()
  totalElapsedTime.value = 0
  timerInterval = setInterval(() => {
    if (!isPaused.value) {
      const now = Date.now()
      const elapsed = Math.floor((now - lastResumeTime.value) / 1000)
      if (elapsed > 0) {
        totalElapsedTime.value += elapsed
        lastResumeTime.value = now
      }
    }
  }, 1000)
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval)
    timerInterval = null
  }
}

function handlePauseToggle() {
  if (isPaused.value) {
    isPaused.value = false
    lastResumeTime.value = Date.now()
  } else {
    const now = Date.now()
    totalElapsedTime.value += Math.floor((now - lastResumeTime.value) / 1000)
    isPaused.value = true
  }
}

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

const calculateRecommendedRegion = computed(() => {
  if (!mappedPixelData.value || !currentColor.value) return { region: null, cell: null }
  const allRegions = getAllConnectedRegions(mappedPixelData.value, currentColor.value)
  const incomplete = allRegions.filter(r => !isRegionCompleted(r, completedCells.value))
  if (incomplete.length === 0) return { region: null, cell: null }
  let selected: Array<{ row: number; col: number }>
  switch (guidanceMode.value) {
    case 'nearest': {
      const ref = selectedCell.value ?? { row: Math.floor(mappedPixelData.value.length / 2), col: Math.floor(mappedPixelData.value[0].length / 2) }
      selected = sortRegionsByDistance(incomplete, ref)[0]
      break
    }
    case 'largest':
      selected = sortRegionsBySize(incomplete)[0]
      break
    case 'edge-first': {
      const M = mappedPixelData.value.length
      const N = mappedPixelData.value[0].length
      const edge = incomplete.filter(r => r.some(c => c.row === 0 || c.row === M - 1 || c.col === 0 || c.col === N - 1))
      selected = edge.length > 0 ? edge[0] : incomplete[0]
      break
    }
    default:
      selected = incomplete[0]
  }
  return { region: selected, cell: getRegionCenter(selected) }
})

watch(calculateRecommendedRegion, val => {
  recommendedRegion.value = val.region
  recommendedCell.value = val.cell
})

const currentColorInfo = computed(() => availableColors.value.find(c => c.color === currentColor.value))
const progressPercentage = computed(() => currentColorInfo.value ? Math.round((currentColorInfo.value.completed / currentColorInfo.value.total) * 100) : 0)
const elapsedTime = computed(() => formatTime(totalElapsedTime.value))
const guidanceModeLabel = computed(() => ({ nearest: '最近优先', largest: '最大优先', 'edge-first': '边缘优先' }[guidanceMode.value] || guidanceMode.value))

function cycleGuidanceMode() {
  const modes = ['nearest', 'largest', 'edge-first'] as const
  guidanceMode.value = modes[(modes.indexOf(guidanceMode.value) + 1) % modes.length]
}

function handleCellClick(row: number, col: number) {
  if (!mappedPixelData.value) return
  const cellColor = mappedPixelData.value[row][col].color
  if (cellColor !== currentColor.value) return
  const region = getConnectedRegion(mappedPixelData.value, row, col, currentColor.value)
  if (region.length === 0) return
  const newSet = new Set(completedCells.value)
  const done = isRegionCompleted(region, completedCells.value)
  region.forEach(({ row: r, col: c }) => {
    const key = `${r},${c}`
    done ? newSet.delete(key) : newSet.add(key)
  })
  const newProgress = { ...colorProgress.value }
  if (newProgress[currentColor.value]) {
    newProgress[currentColor.value] = {
      ...newProgress[currentColor.value],
      completed: Array.from(newSet).filter(k => {
        const [r, c] = k.split(',').map(Number)
        return mappedPixelData.value![r]?.[c]?.color === currentColor.value
      }).length,
    }
  }
  completedCells.value = newSet
  selectedCell.value = { row, col }
  colorProgress.value = newProgress
  availableColors.value = availableColors.value.map(c =>
    c.color === currentColor.value ? { ...c, completed: newProgress[currentColor.value]?.completed || 0 } : c
  )
  if (newProgress[currentColor.value]?.completed >= newProgress[currentColor.value]?.total) {
    switchToNextIncompleteColor()
  }
}

function switchToNextIncompleteColor() {
  const idx = availableColors.value.findIndex(c => c.color === currentColor.value)
  if (idx === -1) return
  for (let i = 1; i <= availableColors.value.length; i++) {
    const next = availableColors.value[(idx + i) % availableColors.value.length]
    if (next.completed < next.total) {
      currentColor.value = next.color
      return
    }
  }
}

function handleFocusColorChange(color: string) {
  currentColor.value = color
  showColorPanel.value = false
}

function handleLocateRecommended() {
  if (!recommendedCell.value || !gridDimensions.value) return
  const { row, col } = recommendedCell.value
  const cellSize = Math.max(15, Math.min(40, 300 / Math.max(gridDimensions.value.N, gridDimensions.value.M)))
  const cx = (col + 0.5) * cellSize
  const cy = (row + 0.5) * cellSize
  canvasOffset.value = { x: gridDimensions.value.N * cellSize / 2 - cx, y: gridDimensions.value.M * cellSize / 2 - cy }
}

// ========== 模式切换 ==========
function switchMode(mode: AppMode) {
  if (activeMode.value === 'edit') exitManualMode()
  if (activeMode.value === 'focus') stopTimer()
  activeMode.value = mode
  if (mode === 'focus') initFocusMode()
}

onUnmounted(() => { stopTimer() })

// ========== 颜色排除 ==========
const showExcludedColors = ref(false)

function toggleExcludeColor(hex) {
  const newSet = new Set(excludedColorKeys.value)
  if (newSet.has(hex)) {
    newSet.delete(hex)
  } else {
    newSet.add(hex)
  }
  excludedColorKeys.value = newSet
}

function restoreAllExcludedColors() {
  const count = excludedColorKeys.value.size
  excludedColorKeys.value = new Set()
  showExcludedColors.value = false
  if (count > 0) showToast(`已恢复 ${count} 种颜色`)
}

// ========== 保存色板到 localStorage ==========
watch(customPaletteSelections, (val) => {
  savePaletteSelections(val)
}, { deep: true })

// ========== Canvas 缩放和拖动控制 ==========
function handleCanvasWheel(e: WheelEvent) {
  e.preventDefault()
  
  const canvas = previewCanvas.value
  if (!canvas) return
  
  const rect = canvas.getBoundingClientRect()
  const mouseX = e.clientX - rect.left
  const mouseY = e.clientY - rect.top
  
  const oldZoom = canvasZoom.value
  const delta = e.deltaY > 0 ? -0.1 : 0.1
  const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, oldZoom + delta))
  
  // 以鼠标位置为基准进行缩放
  const scale = newZoom / oldZoom
  canvasTranslate.value = {
    x: mouseX - (mouseX - canvasTranslate.value.x) * scale,
    y: mouseY - (mouseY - canvasTranslate.value.y) * scale
  }
  
  canvasZoom.value = newZoom
}

function handleCanvasDragStart(e: MouseEvent) {
  // 编辑模式下需要按住 Shift 键才能拖动
  if (activeMode.value === 'edit' && !e.shiftKey) return
  if (activeMode.value === 'focus') return
  
  isDragging.value = true
  dragStart.value = { 
    x: e.clientX - canvasTranslate.value.x, 
    y: e.clientY - canvasTranslate.value.y 
  }
}

function handleCanvasDragMove(e: MouseEvent) {
  if (!isDragging.value) return
  canvasTranslate.value = {
    x: e.clientX - dragStart.value.x,
    y: e.clientY - dragStart.value.y
  }
}

function handleCanvasDragEnd() {
  isDragging.value = false
}

function resetCanvasView() {
  canvasZoom.value = 1
  canvasTranslate.value = { x: 0, y: 0 }
}

// ========== 画布渲染 ==========
function renderCanvas() {
  const canvas = previewCanvas.value
  if (!canvas || !mappedPixelData.value || !gridDimensions.value) return

  const { N, M } = gridDimensions.value
  const cellSize = 8
  canvas.width = N * cellSize
  canvas.height = M * cellSize
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false

  // 背景
  ctx.fillStyle = '#E5E7EB'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  let extCount = 0
  let colorCount = 0
  let sampleColors = []

  for (let j = 0; j < M; j++) {
    for (let i = 0; i < N; i++) {
      const cell = mappedPixelData.value[j]?.[i]
      if (!cell) continue

      const x = i * cellSize
      const y = j * cellSize

      if (cell.isExternal) {
        ctx.fillStyle = (i + j) % 2 === 0 ? '#F3F4F6' : '#E5E7EB'
        extCount++
      } else {
        ctx.fillStyle = cell.color
        colorCount++
        if (sampleColors.length < 3) sampleColors.push(cell.color)
      }
      ctx.fillRect(x, y, cellSize, cellSize)

      // 网格线
      ctx.strokeStyle = 'rgba(0,0,0,0.08)'
      ctx.lineWidth = 0.5
      ctx.strokeRect(x, y, cellSize, cellSize)
    }
  }

  // 高亮当前颜色
  if (highlightColorKey.value) {
    ctx.fillStyle = 'rgba(255, 255, 0, 0.3)'
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < N; i++) {
        const cell = mappedPixelData.value[j]?.[i]
        if (cell && !cell.isExternal && cell.color.toUpperCase() === highlightColorKey.value.toUpperCase()) {
          ctx.fillRect(i * cellSize, j * cellSize, cellSize, cellSize)
        }
      }
    }
  }
}

watch([mappedPixelData, highlightColorKey], () => {
  renderCanvas()
}, { flush: 'post' })

watch(isProcessing, () => {
  if (!isProcessing.value) {
    // 处理完成后，canvas 元素才挂载到 DOM，需要重新渲染
    renderCanvas()
  }
})

watch(originalImageSrc, () => {
  if (!originalImageSrc.value) renderCanvas()
})

// ========== 下载 ==========
function handleDownloadGrid() {
  downloadGridImage({
    mappedPixelData: mappedPixelData.value,
    gridDimensions: gridDimensions.value,
    colorCounts: colorCounts.value,
    totalBeadCount: totalBeadCount.value,
    selectedColorSystem: selectedColorSystem.value,
    options: downloadOptions.value,
  })

  // 同时导出 .pbds
  if (downloadOptions.value.exportPbds) {
    handleExportPbds()
  }
}

// DownloadSettingsModal 触发下载
function handleDownloadGridWithOptions(options) {
  downloadOptions.value = options
  handleDownloadGrid()
}

function handleDownloadImage() {
  showExportMenu.value = false
  showDownloadModal.value = true
}

function handleDownloadStats() {
  showExportMenu.value = false
  downloadStatsImage({
    colorCounts: colorCounts.value,
    totalBeadCount: totalBeadCount.value,
    selectedColorSystem: selectedColorSystem.value,
  })
}

async function handleExportPbds() {
  showExportMenu.value = false
  await exportPbds({
    mappedPixelData: mappedPixelData.value,
    gridDimensions: gridDimensions.value,
    colorCounts: colorCounts.value,
    totalBeadCount: totalBeadCount.value,
    selectedColorSystem: selectedColorSystem.value,
  })
  showToast('导出成功')
}
</script>

<template>
  <!-- 裁剪工具 -->
  <ImageCropper
    v-if="showCropper && originalImageSrc"
    :image-src="originalImageSrc"
    @confirm="handleCropConfirm"
    @skip="handleCropSkip"
  />

  <!-- 主布局 -->
  <div class="h-screen flex flex-col bg-white overflow-hidden font-sans">
    <!-- Header -->
    <header class="h-12 bg-white border-b border-black/10 sticky top-0 z-40">
      <div class="mx-auto w-full h-full px-2 sm:px-4 flex items-center gap-2 sm:gap-3">
        <!-- Logo -->
        <div class="flex items-center gap-2 flex-shrink-0">
          <div class="grid grid-cols-2 gap-0.5 p-1.5 rounded-md bg-black/[0.04] border border-black/[0.06]">
            <span class="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
            <span class="w-1.5 h-1.5 rounded-full bg-pink-400"></span>
            <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
          </div>
          <span class="hidden md:inline text-sm font-semibold text-black">PIXBEADS</span>
        </div>

        <!-- Mode tabs -->
        <div class="flex-1 min-w-0 flex justify-center">
          <div class="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-black/[0.04] border border-black/[0.08]">
            <button
              @click="switchMode('optimize')"
              :class="['px-2 sm:px-3 h-8 text-xs rounded-full font-medium transition-colors min-w-[44px]',
                activeMode === 'optimize' ? 'bg-black text-white shadow-none' : 'text-black/45 hover:text-black']"
            >优化</button>
            <button
              @click="switchMode('edit')"
              :disabled="!mappedPixelData"
              :title="!mappedPixelData ? '请先导入文件' : ''"
              :class="['px-2 sm:px-3 h-8 text-xs rounded-full font-medium transition-colors min-w-[44px]',
                activeMode === 'edit' ? 'bg-black text-white shadow-none' : 'text-black/45 hover:text-black',
                !mappedPixelData && 'opacity-40 cursor-not-allowed']"
            >编辑</button>
            <button
              @click="switchMode('preview')"
              :disabled="!mappedPixelData"
              :title="!mappedPixelData ? '请先导入文件' : ''"
              :class="['px-2 sm:px-3 h-8 text-xs rounded-full font-medium transition-colors min-w-[44px]',
                activeMode === 'preview' ? 'bg-black text-white shadow-none' : 'text-black/45 hover:text-black',
                !mappedPixelData && 'opacity-40 cursor-not-allowed']"
            >预览</button>
            <button
              @click="switchMode('focus')"
              :disabled="!mappedPixelData"
              :title="!mappedPixelData ? '请先导入文件' : ''"
              :class="['px-2 sm:px-3 h-8 text-xs rounded-full font-medium transition-colors min-w-[44px]',
                activeMode === 'focus' ? 'bg-black text-white shadow-none' : 'text-black/45 hover:text-black',
                !mappedPixelData && 'opacity-40 cursor-not-allowed']"
            >专心</button>
          </div>
        </div>

        <!-- Right actions -->
        <div class="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
          <!-- Palette info -->
          <div class="hidden md:flex items-center gap-1.5 ml-1">
            <button
              @click="showPaletteEditor = true"
              class="min-h-[44px] flex flex-col items-start leading-tight px-2 py-1 rounded-lg border border-black/10 bg-white text-black hover:bg-black/[0.04] transition-colors"
              title="色板设置"
            >
              <span class="text-[10px] text-black/45">{{ selectedColorSystem }}</span>
              <span class="text-[11px] font-semibold">{{ Object.keys(customPaletteSelections).filter(k => customPaletteSelections[k]).length }}</span>
            </button>
          </div>
          <!-- Import button -->
          <div class="relative">
            <button
              @click="showImportMenu = !showImportMenu"
              class="min-h-[44px] px-3 text-xs rounded-full border border-black/10 bg-black/[0.04] text-black/60 hover:bg-black/10 transition-colors"
            >导入</button>
            <!-- Import dropdown menu -->
            <div
              v-if="showImportMenu"
              class="absolute right-0 mt-1 w-36 bg-white rounded-lg shadow-lg border border-black/10 py-1 z-50"
            >
              <button
                @click="triggerFileInput"
                class="w-full px-3 py-2 text-left text-xs text-black/80 hover:bg-black/[0.04] transition-colors"
              >
                从图片导入
              </button>
              <button
                @click="triggerPbdsInput"
                class="w-full px-3 py-2 text-left text-xs text-black/80 hover:bg-black/[0.04] transition-colors"
              >
                从文件导入
              </button>
            </div>
          </div>
          <!-- Export dropdown -->
          <div class="relative">
            <button
              v-if="mappedPixelData"
              @click="showExportMenu = !showExportMenu"
              class="min-h-[44px] px-3 text-xs rounded-full border border-black/10 bg-black/[0.04] text-black/60 hover:bg-black/10 transition-colors"
            >导出</button>
            <!-- Export dropdown menu -->
            <div
              v-if="showExportMenu"
              class="absolute right-0 mt-1 w-44 bg-white rounded-lg shadow-lg border border-black/10 py-1 z-50"
            >
              <button
                @click="handleExportPbds"
                class="w-full px-3 py-2 text-left text-xs text-black/80 hover:bg-black/[0.04] transition-colors"
              >
                导出图纸文件 (.pbds)
              </button>
              <button
                @click="handleDownloadImage"
                class="w-full px-3 py-2 text-left text-xs text-black/80 hover:bg-black/[0.04] transition-colors"
              >
                下载图纸图片 (.png)
              </button>
              <button
                @click="handleDownloadStats"
                class="w-full px-3 py-2 text-left text-xs text-black/80 hover:bg-black/[0.04] transition-colors"
              >
                下载颜色统计 (.png)
              </button>
            </div>
          </div>
          <!-- Settings button -->
          <button
            v-if="mappedPixelData"
            @click="showSettingsPanel = true"
            class="min-h-[44px] min-w-[44px] flex items-center justify-center text-black/45 hover:text-black hover:bg-black/[0.04] rounded-lg transition-colors"
            title="高级设置"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <!-- Mobile import -->
          <div class="md:hidden relative">
            <button
              @click="triggerFileInput"
              class="min-h-[44px] min-w-[44px] flex items-center justify-center text-black/60 rounded-lg hover:bg-black/[0.04] transition-colors"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v12m6-6H6" /></svg>
            </button>
          </div>
        </div>
      </div>
    </header>

    <!-- Hidden file inputs -->
    <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="handleFileChange" />
    <input ref="pbdsFileInput" type="file" accept=".pbds" class="hidden" @change="handlePbdsFileChange" />

    <!-- Main content area -->
    <div class="relative flex-1 min-h-0 flex">
      <div class="mx-auto w-full flex-1 min-h-0 flex">
        <!-- Canvas area -->
        <div
          class="flex-1 min-h-0 px-2 sm:px-4 py-3 transition-[padding] duration-200 ease-out flex"
          :style="{ paddingRight: mappedPixelData ? '320px' : undefined }"
        >
          <main class="relative flex flex-col flex-1 min-h-0 min-w-0">
            <!-- Welcome screen -->
            <div
              v-if="!originalImageSrc"
              @click="triggerFileInput"
              @dragover.prevent
              @drop="handleFileDrop"
              class="flex-1 flex flex-col items-center justify-center cursor-pointer border-2 border-dashed border-black/10 rounded-xl hover:border-black/25 hover:bg-black/[0.03]/30 transition-colors"
            >
              <div class="grid grid-cols-2 gap-1 p-3 rounded-xl bg-black/[0.04] border border-black/[0.06] mb-6">
                <span class="w-6 h-6 rounded-full bg-blue-400"></span>
                <span class="w-6 h-6 rounded-full bg-pink-400"></span>
                <span class="w-6 h-6 rounded-full bg-amber-400"></span>
                <span class="w-6 h-6 rounded-full bg-emerald-400"></span>
              </div>
              <p class="text-black/35 text-lg mb-1">拖放或点击上传图片</p>
              <p class="text-black/25 text-sm">支持 JPG / PNG / PBDS 格式</p>
              <p class="text-black/25 text-xs mt-3">建议将图片主体边缘对齐画布边界，减少后期去背景工作量</p>
            </div>

            <!-- Processing -->
            <div v-else-if="isProcessing" class="flex-1 flex items-center justify-center">
              <div class="text-center">
                <div class="w-12 h-12 border-4 border-black/10 border-t-black rounded-full animate-spin mx-auto mb-4"></div>
                <p class="text-black/45">处理中...</p>
              </div>
            </div>

            <!-- Canvas preview (optimize/edit/preview modes) -->
            <div v-else-if="activeMode !== 'focus'" class="flex-1 relative overflow-hidden">
              <!-- Large grid hint -->
              <div
                v-if="gridDimensions && gridDimensions.N > 100"
                class="px-4 py-2 bg-[#007be5]/[0.06] border-b border-black/10 text-xs text-black text-center rounded-t-xl"
              >
                高精度网格 ({{ gridDimensions.N }}×{{ gridDimensions.M }}) — 画布已自动放大，可滚动查看完整图像
              </div>
              <canvas
                ref="previewCanvas"
                class="block"
                :style="{ 
                  imageRendering: 'pixelated', 
                  transform: `translate(${canvasTranslate.x}px, ${canvasTranslate.y}px) scale(${canvasZoom})`, 
                  transformOrigin: '0 0', 
                  cursor: isDragging ? 'grabbing' : (isManualColoringMode ? (isFloodFillEraseMode ? 'cell' : colorReplaceState.isActive ? 'copy' : isEraseMode ? 'crosshair' : 'crosshair') : (activeMode === 'edit' ? 'crosshair' : 'grab'))
                }"
                @wheel.prevent="handleCanvasWheel"
                @mousedown="handleCanvasDragStart"
                @mousemove="handleCanvasDragMove"
                @mouseup="handleCanvasDragEnd"
                @mouseleave="handleCanvasDragEnd"
                @click="handleCanvasClick"
              ></canvas>
              <!-- Zoom controls -->
              <div class="absolute bottom-4 right-4 flex items-center gap-2 bg-white/90 backdrop-blur-sm rounded-lg px-3 py-1.5 shadow-sm border border-black/10">
                <button
                  @click="canvasZoom = Math.max(MIN_ZOOM, canvasZoom - 0.1)"
                  class="w-6 h-6 flex items-center justify-center text-black/60 hover:text-black transition-colors"
                >−</button>
                <span class="text-xs text-black/80 min-w-[40px] text-center">{{ Math.round(canvasZoom * 100) }}%</span>
                <button
                  @click="canvasZoom = Math.min(MAX_ZOOM, canvasZoom + 0.1)"
                  class="w-6 h-6 flex items-center justify-center text-black/60 hover:text-black transition-colors"
                >+</button>
                <button
                  @click="resetCanvasView"
                  class="text-xs text-black/45 hover:text-black transition-colors ml-1"
                >重置</button>
              </div>
              <!-- Tooltip -->
              <div
                v-if="tooltipData"
                class="absolute pointer-events-none bg-black text-white text-xs rounded-lg px-3 py-2 shadow-lg z-10"
                :style="{ left: tooltipData.x + 'px', top: tooltipData.y + 'px' }"
              >
                <div class="flex items-center gap-2">
                  <div class="w-4 h-4 rounded border border-white/30" :style="{ backgroundColor: tooltipData.color }"></div>
                  <span class="font-mono">{{ tooltipData.key }}</span>
                </div>
                <div class="text-black/35 mt-1">行 {{ tooltipData.row }} · 列 {{ tooltipData.col }}</div>
              </div>
            </div>

            <!-- Focus mode canvas -->
            <div v-else class="flex-1 relative overflow-hidden">
              <FocusCanvas
                :mapped-pixel-data="mappedPixelData"
                :grid-dimensions="gridDimensions"
                :current-color="currentColor"
                :completed-cells="completedCells"
                :recommended-cell="recommendedCell"
                :recommended-region="recommendedRegion"
                :canvas-scale="canvasScale"
                :canvas-offset="canvasOffset"
                :grid-section-interval="gridSectionInterval"
                :show-section-lines="showSectionLines"
                :section-line-color="sectionLineColor"
                @cell-click="handleCellClick"
                @scale-change="(s) => (canvasScale = s)"
                @offset-change="(o) => (canvasOffset = o)"
              />
            </div>
          </main>
        </div>

        <!-- Right sidebar (320px, only when image loaded) -->
        <div
          v-if="mappedPixelData"
          class="absolute top-0 bottom-0 right-0 z-30 flex flex-col bg-white border-l border-black/10"
          style="width: 320px;"
        >
          <div class="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3">
            <!-- Optimize mode sidebar -->
            <template v-if="activeMode === 'optimize'">
              <!-- Upload card -->
              <div class="bg-white rounded-xl border border-black/10 p-4">
                <h3 class="text-sm font-medium text-black mb-3">图片上传</h3>
                <div
                  @click="triggerFileInput"
                  @dragover.prevent
                  @drop="handleFileDrop"
                  class="border-2 border-dashed border-black/10 rounded-lg p-4 text-center cursor-pointer hover:border-black/25 hover:bg-black/[0.03] transition-colors"
                >
                  <img v-if="originalImageSrc" :src="originalImageSrc" class="max-h-24 mx-auto rounded mb-2" alt="预览" />
                  <div v-else class="space-y-1">
                    <svg class="w-8 h-8 mx-auto text-black/35" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 6v12m6-6H6" />
                    </svg>
                    <p class="text-xs text-black/45">点击或拖放图片</p>
                  </div>
                </div>
              </div>

              <!-- Parameter controls card -->
              <div class="bg-white rounded-xl border border-black/10 p-4 space-y-4">
                <h3 class="text-sm font-medium text-black">参数设置</h3>

                <!-- Width -->
                <div>
                  <label class="text-xs text-black/45 mb-1 block">宽度 (横向格子数)</label>
                  <div class="flex items-center gap-2">
                    <input
                      v-model.number="granularity"
                      type="range" min="10" max="300" step="1"
                      class="flex-1 h-1.5 bg-black/10 rounded-lg appearance-none cursor-pointer accent-black"
                    />
                    <input
                      v-model="granularityInput"
                      @blur="granularity = Math.max(10, Math.min(300, parseInt(granularityInput) || 50))"
                      @keyup.enter="granularity = Math.max(10, Math.min(300, parseInt(granularityInput) || 50))"
                      type="text"
                      class="w-14 px-1.5 py-0.5 text-xs font-mono text-center border border-black/10 rounded focus:outline-none focus:ring-1 focus:ring-black"
                    />
                  </div>
                </div>

                <!-- Lock aspect ratio -->
                <div class="flex justify-center">
                  <button
                    @click="lockAspectRatio = !lockAspectRatio"
                    :class="[
                      'flex items-center gap-1 px-3 py-1 text-xs rounded-full border transition-colors',
                      lockAspectRatio
                        ? 'bg-black/[0.03] border-black/20 text-black'
                        : 'bg-white border-black/10 text-black/45 hover:border-black/10'
                    ]"
                    :title="lockAspectRatio ? '解锁长宽比' : '锁定长宽比'"
                  >
                    <svg v-if="lockAspectRatio" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    <svg v-else class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                    </svg>
                    {{ lockAspectRatio ? '已锁定' : '锁定比例' }}
                  </button>
                </div>

                <!-- Height -->
                <div>
                  <label class="text-xs text-black/45 mb-1 block">
                    高度 (纵向格子数)
                    <span v-if="!croppedImageCanvas && !lockAspectRatio" class="text-black/35 font-normal ml-1">裁剪后可调</span>
                  </label>
                  <div class="flex items-center gap-2">
                    <input
                      v-model.number="granularityY"
                      type="range" min="10" max="300" step="1"
                      :disabled="!croppedImageCanvas || lockAspectRatio"
                      class="flex-1 h-1.5 bg-black/10 rounded-lg appearance-none cursor-pointer accent-black disabled:opacity-40"
                    />
                    <input
                      v-model="granularityYInput"
                      :disabled="!croppedImageCanvas || lockAspectRatio"
                      @blur="granularityY = Math.max(10, Math.min(300, parseInt(granularityYInput) || 0))"
                      @keyup.enter="granularityY = Math.max(10, Math.min(300, parseInt(granularityYInput) || 0))"
                      type="text"
                      :placeholder="granularityY > 0 ? granularityY.toString() : '自动'"
                      class="w-14 px-1.5 py-0.5 text-xs font-mono text-center border border-black/10 rounded focus:outline-none focus:ring-1 focus:ring-black disabled:opacity-40"
                    />
                  </div>
                </div>

                <!-- Similarity threshold -->
                <div>
                  <label class="text-xs text-black/45 mb-1 block">
                    颜色合并阈值
                    <span class="float-right font-mono text-black">{{ similarityThreshold }}</span>
                  </label>
                  <input
                    v-model.number="similarityThreshold"
                    type="range" min="0" max="100" step="1"
                    class="w-full h-1.5 bg-black/10 rounded-lg appearance-none cursor-pointer accent-black"
                  />
                </div>

                <!-- Pixelation mode -->
                <div>
                  <label class="text-xs text-black/45 mb-1 block">像素化模式</label>
                  <div class="flex gap-2">
                    <button
                      @click="pixelationMode = 'dominant'"
                      :class="[
                        'flex-1 px-3 py-1.5 text-xs rounded-lg border transition-colors',
                        pixelationMode === 'dominant'
                          ? 'bg-black/[0.03]0 text-white border-black'
                          : 'bg-white text-black/60 border-black/10 hover:border-black/20'
                      ]"
                    >卡通(主色)</button>
                    <button
                      @click="pixelationMode = 'average'"
                      :class="[
                        'flex-1 px-3 py-1.5 text-xs rounded-lg border transition-colors',
                        pixelationMode === 'average'
                          ? 'bg-black/[0.03]0 text-white border-black'
                          : 'bg-white text-black/60 border-black/10 hover:border-black/20'
                      ]"
                    >真实(均色)</button>
                  </div>
                </div>

                <!-- Background removal -->
                <div class="flex gap-2">
                  <button
                    @click="handleAutoRemoveBackground"
                    :disabled="!mappedPixelData"
                    class="flex-1 px-3 py-1.5 text-xs rounded-full border border-black/10 bg-[#007be5]/[0.06] text-black hover:bg-black/[0.06] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >一键去背景</button>
                  <button
                    @click="handleUndoBgRemoval"
                    :disabled="!bgRemovalSnapshot"
                    class="flex-1 px-3 py-1.5 text-xs rounded-full border border-black/10 bg-white text-black/60 hover:bg-black/[0.04] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >回撤上一步</button>
                </div>
              </div>

              <!-- Color system card -->
              <div class="bg-white rounded-xl border border-black/10 p-4">
                <h3 class="text-sm font-medium text-black mb-3">色号系统</h3>
                <div class="flex flex-wrap gap-1.5">
                  <button
                    v-for="sys in colorSystemOptions"
                    :key="sys.key"
                    @click="selectedColorSystem = sys.key"
                    :class="[
                      'px-2.5 py-1 text-xs rounded-lg border transition-all duration-150',
                      selectedColorSystem === sys.key
                        ? 'bg-black/[0.03]0 text-white border-black shadow-sm'
                        : 'bg-white text-black/60 border-black/10 hover:border-black/20'
                    ]"
                  >{{ sys.name }}</button>
                </div>
              </div>
            </template>

            <!-- Edit mode sidebar -->
            <template v-if="activeMode === 'edit'">
              <!-- Edit tools card -->
              <div class="bg-white rounded-xl border border-black/10 p-4 space-y-3">
                <h3 class="text-sm font-medium text-black">编辑工具</h3>
                <div class="flex gap-2">
                  <button
                    @click="isManualColoringMode && toggleMagnifier()"
                    :class="[
                      'flex-1 px-3 py-1.5 text-xs rounded-lg border transition-colors',
                      isMagnifierActive
                        ? 'bg-cyan-500 text-white border-cyan-500'
                        : 'bg-white text-black/60 border-black/10 hover:border-cyan-300'
                    ]"
                    :disabled="!isManualColoringMode"
                  >🔍 放大镜</button>
                </div>
                <div class="flex gap-2 flex-wrap">
                  <button
                    @click="isManualColoringMode ? exitManualMode() : enterManualMode()"
                    :class="[
                      'flex-1 px-3 py-1.5 text-xs rounded-lg border transition-colors',
                      isManualColoringMode
                        ? 'bg-black text-white border-black'
                        : 'bg-white text-black/60 border-black/10 hover:border-black/20'
                    ]"
                  >{{ isManualColoringMode ? '退出编辑' : '手动编辑' }}</button>
                </div>

                <ColorPalette
                  v-if="isManualColoringMode && currentGridColors.length > 0"
                  :colors="currentGridColors"
                  :selected-color="selectedEditColor"
                  :transparent-key="TRANSPARENT_KEY"
                  :selected-color-system="selectedColorSystem"
                  :is-erase-mode="isEraseMode"
                  :full-palette-colors="activeBeadPalette"
                  :show-full-palette="showFullPalette"
                  :color-replace-state="colorReplaceState"
                  @color-select="handlePaletteColorSelect"
                  @erase-toggle="toggleEraseMode"
                  @highlight-color="setHighlight"
                  @toggle-full-palette="showFullPalette = !showFullPalette"
                  @color-replace-toggle="toggleColorReplaceMode"
                  @color-replace="handlePaletteColorReplace"
                />

                <p v-if="isManualColoringMode && currentGridColors.length === 0" class="text-xs text-black/35">
                  当前图纸无可用颜色。
                </p>
              </div>

              <!-- Color palette card -->
              <div class="bg-white rounded-xl border border-black/10 p-4">
                <h3 class="text-sm font-medium text-black mb-3">
                  调色盘
                  <span class="text-xs text-black/35 font-normal ml-1">{{ currentGridColors.length }} 种</span>
                </h3>
                <div v-if="currentGridColors.length === 0" class="text-xs text-black/35 text-center py-2">暂无颜色</div>
                <div v-else class="grid grid-cols-8 gap-1">
                  <button
                    v-for="color in currentGridColors"
                    :key="color.color"
                    @click="selectEditColor(color)"
                    class="w-7 h-7 rounded border border-black/10 hover:scale-125 transition-transform relative group"
                    :style="{ backgroundColor: color.color }"
                    :title="color.key"
                    :class="{ 'ring-2 ring-black ring-offset-1': selectedEditColor?.color === color.color }"
                  >
                    <span class="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] text-black/45 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none bg-white px-1 rounded shadow">
                      {{ color.key }}
                    </span>
                  </button>
                </div>
              </div>

              <!-- Color stats/exclude card -->
              <div v-if="colorCounts" class="bg-white rounded-xl border border-black/10 p-4">
                <h3 class="text-sm font-medium text-black mb-2">
                  颜色统计
                  <span class="text-xs text-black/35 font-normal ml-1">
                    {{ Object.keys(colorCounts).length }} 种 / {{ totalBeadCount }} 粒
                  </span>
                </h3>
                <div class="max-h-60 overflow-y-auto space-y-1">
                  <div
                    v-for="item in currentGridColors"
                    :key="item.color"
                    class="flex items-center gap-2 py-1 px-2 rounded hover:bg-white cursor-pointer group"
                    :class="excludedColorKeys.has(item.color.toUpperCase()) ? 'bg-[#f4422f]/[0.06] opacity-60' : ''"
                    @click="selectEditColor(item)"
                  >
                    <div
                      class="w-5 h-5 rounded-md border border-black/10 flex-shrink-0"
                      :style="{ backgroundColor: item.color }"
                    ></div>
                    <span
                      class="text-xs font-mono flex-1"
                      :class="excludedColorKeys.has(item.color.toUpperCase()) ? 'text-[#f4422f] line-through' : 'text-black'"
                    >{{ item.key }}</span>
                    <span class="text-xs text-black/35">
                      {{ colorCounts[item.color.toUpperCase()]?.count || 0 }}
                    </span>
                    <button
                      @click.stop="toggleExcludeColor(item.color.toUpperCase())"
                      class="text-xs text-[#f4422f]/60 hover:text-[#f4422f]"
                      :class="excludedColorKeys.has(item.color.toUpperCase()) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
                    >
                      {{ excludedColorKeys.has(item.color.toUpperCase()) ? '恢复' : '✕' }}
                    </button>
                  </div>
                </div>

                <!-- Excluded colors panel -->
                <div v-if="excludedColorKeys.size > 0" class="mt-3 pt-3 border-t border-black/[0.06]">
                  <button
                    @click="showExcludedColors = !showExcludedColors"
                    class="flex items-center gap-1 text-xs text-[#f4422f] hover:text-[#f4422f] w-full"
                  >
                    <span>{{ showExcludedColors ? '▼' : '▶' }}</span>
                    <span>已排除 {{ excludedColorKeys.size }} 种颜色</span>
                  </button>
                  <div v-if="showExcludedColors" class="mt-2 space-y-1 max-h-40 overflow-y-auto">
                    <div
                      v-for="hex in Array.from(excludedColorKeys)"
                      :key="hex"
                      class="flex items-center gap-2 py-1 px-2 rounded bg-[#f4422f]/[0.06]"
                    >
                      <div class="w-4 h-4 rounded-md border border-black/10 flex-shrink-0" :style="{ backgroundColor: hex }"></div>
                      <span class="text-xs font-mono text-[#f4422f] flex-1">{{ getColorKeyByHex(hex, selectedColorSystem) }}</span>
                      <button @click="toggleExcludeColor(hex)" class="text-xs text-[#007be5] hover:text-[#007be5]/80">恢复</button>
                    </div>
                  </div>
                  <button
                    @click="restoreAllExcludedColors"
                    class="mt-2 w-full px-3 py-1.5 text-xs rounded-full border border-black/10 bg-[#007be5]/[0.06] text-black hover:bg-black/[0.06] transition-colors"
                  >一键恢复所有颜色</button>
                </div>
              </div>

              <!-- Edit palette button -->
              <button
                @click="showPaletteEditor = true"
                class="w-full px-4 py-2 bg-white border border-black/10 rounded-xl text-sm text-black hover:bg-white transition-colors flex items-center justify-center gap-2"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
                编辑色板 ({{ fullBeadPalette.length }} 色)
              </button>

              <!-- Empty palette warning -->
              <div
                v-if="activeBeadPalette.length === 0 && excludedColorKeys.size > 0"
                class="bg-[#ffbe2e]/[0.08] border border-[#ffbe2e]/20 rounded-xl p-4"
              >
                <p class="text-xs text-black/70 mb-2">所有颜色已被排除，请恢复部分颜色后重试。</p>
                <button
                  @click="restoreAllExcludedColors"
                  class="w-full px-3 py-1.5 text-xs rounded-lg border border-[#ffbe2e]/30 bg-[#ffbe2e]/10 text-black hover:bg-[#ffbe2e]/20 transition-colors"
                >查看已排除颜色</button>
              </div>
            </template>

            <!-- Preview mode sidebar -->
            <template v-if="activeMode === 'preview'">
              <!-- Color stats card -->
              <div v-if="colorCounts" class="bg-white rounded-xl border border-black/10 p-4">
                <h3 class="text-sm font-medium text-black mb-2">
                  颜色统计
                  <span class="text-xs text-black/35 font-normal ml-1">
                    {{ Object.keys(colorCounts).length }} 种 / {{ totalBeadCount }} 粒
                  </span>
                </h3>
                <div class="max-h-80 overflow-y-auto space-y-1">
                  <div
                    v-for="item in currentGridColors"
                    :key="item.color"
                    class="flex items-center gap-2 py-1 px-2 rounded hover:bg-white"
                  >
                    <div
                      class="w-5 h-5 rounded-md border border-black/10 flex-shrink-0"
                      :style="{ backgroundColor: item.color }"
                    ></div>
                    <span class="text-xs font-mono flex-1 text-black">{{ item.key }}</span>
                    <span class="text-xs text-black/35">
                      {{ colorCounts[item.color.toUpperCase()]?.count || 0 }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- Edit palette button -->
              <button
                @click="showPaletteEditor = true"
                class="w-full px-4 py-2 bg-white border border-black/10 rounded-xl text-sm text-black hover:bg-white transition-colors flex items-center justify-center gap-2"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
                编辑色板 ({{ fullBeadPalette.length }} 色)
              </button>

              <!-- Download stats button -->
              <button
                @click="handleDownloadStats"
                class="w-full px-4 py-2 bg-white border border-black/10 rounded-xl text-sm text-black hover:bg-white transition-colors flex items-center justify-center gap-2"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                下载颜色统计表
              </button>
            </template>

            <!-- Focus mode sidebar -->
            <template v-if="activeMode === 'focus'">
              <!-- Current color info -->
              <div v-if="currentColorInfo" class="bg-white rounded-xl border border-black/10 p-4">
                <div class="flex items-center gap-3 mb-3">
                  <div class="w-10 h-10 rounded-full border-2 border-black/10" :style="{ backgroundColor: currentColor }"></div>
                  <div>
                    <div class="text-sm font-medium text-black font-mono">{{ currentColorInfo.name }}</div>
                    <div class="text-xs text-black/45">{{ currentColorInfo.completed }}/{{ currentColorInfo.total }} · {{ progressPercentage }}%</div>
                  </div>
                </div>
                <div class="flex items-center gap-2 text-xs text-black/45">
                  <span>{{ elapsedTime }}</span>
                  <span class="text-black/25">|</span>
                  <button @click="cycleGuidanceMode" class="px-2 py-0.5 bg-black/[0.04] hover:bg-black/10 rounded-full text-black/60 transition-colors">
                    {{ guidanceModeLabel }}
                  </button>
                </div>
              </div>

              <!-- Progress bar -->
              <ProgressBar
                :progress-percentage="progressPercentage"
                :recommended-cell="recommendedCell"
                :color-info="currentColorInfo"
              />

              <!-- Focus color panel -->
              <FocusColorPanel
                mode="sidebar"
                :colors="availableColors"
                :current-color="currentColor"
                @color-select="handleFocusColorChange"
                @close="showColorPanel = false"
              />
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <footer class="border-t border-black/10/60 bg-white/70">
      <div class="mx-auto w-full px-4 py-2 flex items-center justify-between text-xs text-black/45">
        <span>PIXBEADS — 拼豆图纸生成工具</span>
      </div>
    </footer>
  </div>

  <!-- Floating palette (edit mode only) -->
  <Teleport to="body">
    <div
      v-if="mappedPixelData && activeMode === 'edit'"
      class="fixed z-40 select-none"
      :style="{ left: floatingPalette.x + 'px', top: floatingPalette.y + 'px' }"
    >
      <div class="bg-white rounded-xl shadow-lg border border-black/10 overflow-hidden" :class="{ 'w-12': floatingPalette.collapsed, 'w-64': !floatingPalette.collapsed }">
        <!-- Drag handle -->
        <div
          class="bg-gradient-to-r from-black to-black/80 px-3 py-2 flex items-center justify-between cursor-move"
          @mousedown="onPaletteHeaderMouseDown"
        >
          <span class="text-white text-xs font-medium" v-if="!floatingPalette.collapsed">调色盘</span>
          <button
            @click.stop="togglePaletteCollapse"
            class="text-white/80 hover:text-white text-xs ml-1"
            :title="floatingPalette.collapsed ? '展开' : '收起'"
          >{{ floatingPalette.collapsed ? '◀' : '▶' }}</button>
        </div>

        <!-- Tool buttons -->
        <div v-if="!floatingPalette.collapsed" class="p-2 border-b border-black/[0.06]">
          <div class="flex gap-1 flex-wrap">
            <button
              @click="undoEdit"
              :disabled="editHistoryIndex < 0"
              class="px-2 py-1 text-xs rounded bg-black/[0.04] text-black/60 hover:bg-black/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="撤销 (Ctrl+Z)"
            >↩ 撤销</button>
            <button
              @click="redoEdit"
              :disabled="editHistoryIndex >= editHistory.length - 1"
              class="px-2 py-1 text-xs rounded bg-black/[0.04] text-black/60 hover:bg-black/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="重做 (Ctrl+Shift+Z)"
            >↪ 重做</button>
            <button
              @click="toggleEraseMode()"
              :class="[
                'px-2 py-1 text-xs rounded transition-colors',
                isEraseMode ? 'bg-[#f4422f]/[0.06]0 text-white' : 'bg-black/[0.04] text-black/60 hover:bg-black/10'
              ]"
              title="橡皮擦"
            >🧹 橡皮</button>
            <button
              @click="isFloodFillEraseMode ? exitFloodFillEraseMode() : enterFloodFillEraseMode()"
              :class="[
                'px-2 py-1 text-xs rounded transition-colors',
                isFloodFillEraseMode ? 'bg-orange-500 text-white' : 'bg-black/[0.04] text-black/60 hover:bg-black/10'
              ]"
              title="洪水填充擦除"
            >🪣 区域</button>
            <button
              @click="colorReplaceState.isActive ? exitColorReplaceMode() : enterColorReplaceMode()"
              :class="[
                'px-2 py-1 text-xs rounded transition-colors',
                colorReplaceState.isActive ? 'bg-purple-500 text-white' : 'bg-black/[0.04] text-black/60 hover:bg-black/10'
              ]"
              title="颜色批量替换"
            >🔄 替换</button>
          </div>
        </div>

        <!-- Color grid -->
        <div v-if="!floatingPalette.collapsed" class="p-2 max-h-48 overflow-y-auto">
          <div v-if="currentGridColors.length === 0" class="text-xs text-black/35 text-center py-2">暂无颜色</div>
          <div class="grid grid-cols-8 gap-1">
            <button
              v-for="color in currentGridColors"
              :key="color.color"
              @click="selectEditColor(color)"
              class="w-6 h-6 rounded border border-black/10 hover:scale-125 transition-transform relative group"
              :style="{ backgroundColor: color.color }"
              :title="color.key"
              :class="{ 'ring-2 ring-black ring-offset-1': selectedEditColor?.color === color.color }"
            >
              <span class="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] text-black/45 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none bg-white px-1 rounded shadow">
                {{ color.key }}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Magnifier tool -->
  <Teleport to="body">
    <MagnifierTool
      v-if="isMagnifierActive && mappedPixelData && gridDimensions"
      :pixel-data="mappedPixelData"
      :grid-dimensions="gridDimensions"
      :selected-color="selectedEditColor"
      :is-erase-mode="isEraseMode"
      @selection="handleMagnifierSelection"
      @pixel-edit="handleMagnifierPixelEdit"
      @close="exitMagnifierMode"
    />
  </Teleport>

  <!-- Download modal -->
  <DownloadSettingsModal
    :is-open="showDownloadModal"
    :options="downloadOptions"
    @update:options="downloadOptions = $event"
    @download-grid="handleDownloadGridWithOptions"
    @close="showDownloadModal = false"
  />

  <!-- Import convert dialog -->
  <ImportConvertDialog
    :is-open="showImportDialog"
    :import-data="pendingPbdsData"
    :current-color-system="selectedColorSystem"
    :full-palette="fullBeadPalette"
    @confirm="handleImportConfirm"
    @close="handleImportCancel"
  />

  <!-- Custom palette editor -->
  <CustomPaletteEditor
    v-if="showPaletteEditor"
    :all-colors="fullBeadPalette"
    :current-selections="customPaletteSelections"
    :selected-color-system="selectedColorSystem"
    @save="handlePaletteEditorSave"
    @close="handlePaletteEditorClose"
  />

  <!-- Settings panel -->
  <Teleport to="body">
    <SettingsPanel
      v-if="showSettingsPanel"
      :download-options="downloadOptions"
      :granularity="granularity"
      :similarity-threshold="similarityThreshold"
      :pixelation-mode="pixelationMode"
      @update:downloadOptions="downloadOptions = $event"
      @update:granularity="granularity = $event"
      @update:similarityThreshold="similarityThreshold = $event"
      @update:pixelationMode="pixelationMode = $event"
      @close="showSettingsPanel = false"
    />
  </Teleport>

  <!-- Donation modal -->
  <Teleport to="body">
    <DonationModal
      v-if="showDonationModal"
      @close="showDonationModal = false"
    />
  </Teleport>

  <!-- PWA install prompt -->
  <InstallPWA />

  <!-- Toast -->
  <Transition name="toast">
    <div
      v-if="toastMessage"
      class="fixed bottom-20 left-1/2 -translate-x-1/2 px-4 py-2 bg-black text-white text-sm rounded-lg shadow-lg z-50 pointer-events-none"
    >
      {{ toastMessage }}
    </div>
  </Transition>
</template>

<style>
/* 全局滚动条美化 */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #D1D5DB; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #9CA3AF; }

/* Toast 过渡动画 */
.toast-enter-active { transition: all 0.3s ease-out; }
.toast-leave-active { transition: all 0.3s ease-in; }
.toast-enter-from { opacity: 0; transform: translate(-50%, 10px); }
.toast-leave-to { opacity: 0; transform: translate(-50%, 10px); }

/* 悬浮调色盘拖拽时禁止选中 */
.palette-dragging * {
  user-select: none;
  -webkit-user-select: none;
}
</style>
