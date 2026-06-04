<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import {
  hexToRgb,
  calculatePixelGrid,
  mergeSimilarRegions,
  removeBackground,
  recalculateColorStats,
  TRANSPARENT_KEY,
  PixelationMode,
} from './utils/pixelation'
import {
  getMardToHexMapping,
  convertPaletteToColorSystem,
  getColorKeyByHex,
  colorSystemOptions,
  sortColorsByHue,
} from './utils/colorSystemUtils'
import { downloadGridImage, downloadStatsImage, exportCsv } from './utils/downloader'

// ========== 调色板初始化 ==========
const mardToHexMapping = getMardToHexMapping()
const fullBeadPalette = Object.entries(mardToHexMapping)
  .map(([mardKey, hex]) => {
    const rgb = hexToRgb(hex)
    if (!rgb) return null
    return { key: hex, hex, rgb }
  })
  .filter(Boolean)

// ========== 响应式状态 ==========
const originalImageSrc = ref(null)
const originalImage = ref(null)

// 控制参数
const granularity = ref(50)
const granularityInput = ref('50')
const similarityThreshold = ref(30)
const similarityThresholdInput = ref('30')
const pixelationMode = ref(PixelationMode.Dominant)
const selectedColorSystem = ref('MARD')

// 像素数据
const mappedPixelData = ref(null)
const gridDimensions = ref(null)
const colorCounts = ref(null)
const totalBeadCount = ref(0)

// 色板选择
const customPaletteSelections = ref({})
const excludedColorKeys = ref(new Set())

// UI 状态
const activeBeadPalette = ref([])
const isProcessing = ref(false)
const showDownloadModal = ref(false)
const tooltipData = ref(null)
const highlightColorKey = ref(null)
const previewCanvas = ref(null)

// 下载选项
const downloadOptions = ref({
  showGrid: true,
  gridInterval: 10,
  showCoordinates: true,
  showCellNumbers: true,
  gridLineColor: '#CCCCCC',
  includeStats: true,
})

// ========== 初始化色板选择 ==========
onMounted(() => {
  const allHexValues = fullBeadPalette.map(c => c.hex.toUpperCase())
  const saved = localStorage.getItem('pixbeads_palette')
  if (saved) {
    try {
      const parsed = JSON.parse(saved)
      // 验证
      const valid = {}
      let hasValid = false
      Object.entries(parsed).forEach(([key, value]) => {
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
    } catch {
      initDefaultPalette(allHexValues)
    }
  } else {
    initDefaultPalette(allHexValues)
  }
})

function initDefaultPalette(allHexValues) {
  const selections = {}
  allHexValues.forEach(hex => { selections[hex.toUpperCase()] = true })
  customPaletteSelections.value = selections
}

// ========== 活跃调色板 ==========
watch([customPaletteSelections, excludedColorKeys], () => {
  const palette = fullBeadPalette.filter(color => {
    const hex = color.hex.toUpperCase()
    return customPaletteSelections[hex] && !excludedColorKeys.value.has(hex)
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
watch(granularity, v => { granularityInput.value = v.toString() })
watch(similarityThreshold, v => { similarityThresholdInput.value = v.toString() })

// ========== 图片上传 ==========
const fileInput = ref(null)

function triggerFileInput() {
  fileInput.value?.click()
}

function handleFileDrop(e) {
  e.preventDefault()
  const file = e.dataTransfer?.files?.[0]
  if (file && file.type.startsWith('image/')) loadImage(file)
}

function handleFileChange(e) {
  const file = e.target?.files?.[0]
  if (file) loadImage(file)
}

function loadImage(file) {
  const reader = new FileReader()
  reader.onload = (e) => {
    originalImageSrc.value = e.target.result
    const img = new Image()
    img.onload = () => {
      originalImage.value = img
      processImage()
    }
    img.src = e.target.result
  }
  reader.readAsDataURL(file)
}

// ========== 核心处理 ==========
function processImage() {
  if (!originalImage.value) return
  isProcessing.value = true

  // 使用 setTimeout 让 UI 更新
  setTimeout(() => {
    try {
      const img = originalImage.value
      const N = granularity.value
      const aspectRatio = img.height / img.width
      const M = Math.round(N * aspectRatio)

      // 创建临时 canvas
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)

      // 像素化
      const palette = convertPaletteToColorSystem(activeBeadPalette.value, selectedColorSystem.value)
      const fallbackColor = palette[0] || { key: '?', hex: '#000000', rgb: { r: 0, g: 0, b: 0 } }
      let result = calculatePixelGrid(ctx, img.width, img.height, N, M, palette, pixelationMode.value, fallbackColor)

      // 区域合并
      if (similarityThreshold.value > 0) {
        result = mergeSimilarRegions(result, similarityThreshold.value)
      }

      // 背景移除
      const bgKeys = [
        hexToRgb('#FFFFFF'),
        hexToRgb('#FAFAFA'),
        hexToRgb('#F5F5F5'),
      ].filter(Boolean).map(() => '#FFFFFF')

      result = removeBackground(result, [''])

      // 更新状态
      mappedPixelData.value = result
      gridDimensions.value = { N, M }

      // 统计
      const stats = recalculateColorStats(result)
      colorCounts.value = stats.colorCounts
      totalBeadCount.value = stats.totalCount
    } catch (err) {
      console.error('处理失败:', err)
    } finally {
      isProcessing.value = false
    }
  }, 50)
}

// 重新处理
watch([granularity, similarityThreshold, pixelationMode, activeBeadPalette], () => {
  if (originalImage.value) processImage()
})

// ========== 手动编辑 ==========
const selectedEditColor = ref(null)
const isEraseMode = ref(false)
const isManualColoringMode = ref(false)

function enterManualMode() {
  isManualColoringMode.value = true
  selectedEditColor.value = null
  isEraseMode.value = false
}

function exitManualMode() {
  isManualColoringMode.value = false
  selectedEditColor.value = null
  isEraseMode.value = false
}

function toggleEraseMode() {
  if (isEraseMode.value) {
    isEraseMode.value = false
  } else {
    isEraseMode.value = true
    selectedEditColor.value = null
  }
}

function selectEditColor(color) {
  isEraseMode.value = false
  selectedEditColor.value = color
}

function handleCanvasClick(e) {
  if (!mappedPixelData.value || !gridDimensions.value) return
  if (!isManualColoringMode.value) return

  const canvas = e.target
  const rect = canvas.getBoundingClientRect()
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height
  const canvasX = (e.clientX - rect.left) * scaleX
  const canvasY = (e.clientY - rect.top) * scaleY

  const { N, M } = gridDimensions.value
  const cellW = canvas.width / N
  const cellH = canvas.height / M
  const col = Math.floor(canvasX / cellW)
  const row = Math.floor(canvasY / cellH)

  if (row < 0 || row >= M || col < 0 || col >= N) return
  const cell = mappedPixelData.value[row][col]
  if (!cell || cell.isExternal) return

  if (isEraseMode.value) {
    const newData = mappedPixelData.value.map(r => r.map(c => ({ ...c })))
    newData[row][col] = { key: TRANSPARENT_KEY, color: '#FFFFFF', isExternal: true }
    mappedPixelData.value = newData
    const stats = recalculateColorStats(newData)
    colorCounts.value = stats.colorCounts
    totalBeadCount.value = stats.totalCount
  } else if (selectedEditColor.value) {
    const newData = mappedPixelData.value.map(r => r.map(c => ({ ...c })))
    newData[row][col] = {
      key: selectedEditColor.value.key,
      color: selectedEditColor.value.color,
      isExternal: false,
    }
    mappedPixelData.value = newData
    const stats = recalculateColorStats(newData)
    colorCounts.value = stats.colorCounts
    totalBeadCount.value = stats.totalCount
  } else {
    // 吸管: 选中当前颜色
    const hex = cell.color.toUpperCase()
    selectedEditColor.value = { key: getColorKeyByHex(hex, selectedColorSystem.value), color: cell.color }
  }
}

function handleCanvasHover(e) {
  if (!mappedPixelData.value || !gridDimensions.value) return
  const canvas = e.target
  const rect = canvas.getBoundingClientRect()
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height
  const canvasX = (e.clientX - rect.left) * scaleX
  const canvasY = (e.clientY - rect.top) * scaleY

  const { N, M } = gridDimensions.value
  const cellW = canvas.width / N
  const cellH = canvas.height / M
  const col = Math.floor(canvasX / cellW)
  const row = Math.floor(canvasY / cellH)

  if (row >= 0 && row < M && col >= 0 && col < N) {
    const cell = mappedPixelData.value[row][col]
    if (cell && !cell.isExternal) {
      const displayKey = getColorKeyByHex(cell.color, selectedColorSystem.value)
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

// ========== 色号系统切换 ==========
watch(selectedColorSystem, () => {
  if (originalImage.value) processImage()
})

// ========== 颜色排除 ==========
function toggleExcludeColor(hex) {
  const newSet = new Set(excludedColorKeys.value)
  if (newSet.has(hex)) {
    newSet.delete(hex)
  } else {
    newSet.add(hex)
  }
  excludedColorKeys.value = newSet
}

// ========== 保存色板到 localStorage ==========
watch(customPaletteSelections, (val) => {
  localStorage.setItem('pixbeads_palette', JSON.stringify(val))
}, { deep: true })

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

  for (let j = 0; j < M; j++) {
    for (let i = 0; i < N; i++) {
      const cell = mappedPixelData.value[j]?.[i]
      if (!cell) continue

      const x = i * cellSize
      const y = j * cellSize

      if (cell.isExternal) {
        // 外部区域用浅灰棋盘格
        ctx.fillStyle = (i + j) % 2 === 0 ? '#F3F4F6' : '#E5E7EB'
      } else {
        ctx.fillStyle = cell.color
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
}

function handleDownloadStats() {
  downloadStatsImage({
    colorCounts: colorCounts.value,
    totalBeadCount: totalBeadCount.value,
    selectedColorSystem: selectedColorSystem.value,
  })
}

function handleExportCsv() {
  exportCsv({
    mappedPixelData: mappedPixelData.value,
    gridDimensions: gridDimensions.value,
    selectedColorSystem: selectedColorSystem.value,
  })
}
</script>

<template>
  <div class="min-h-screen bg-gray-50 text-gray-900">
    <!-- 顶部导航 -->
    <header class="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-50">
      <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center">
            <span class="text-white text-sm font-bold">P</span>
          </div>
          <div>
            <h1 class="text-lg font-semibold">PIXBEADS</h1>
            <p class="text-xs text-gray-500">拼豆图纸生成工具</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <!-- 色号系统选择 -->
          <select
            v-model="selectedColorSystem"
            class="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
          >
            <option v-for="sys in colorSystemOptions" :key="sys.key" :value="sys.key">
              {{ sys.name }}
            </option>
          </select>
          <!-- 下载按钮 -->
          <button
            v-if="mappedPixelData"
            @click="showDownloadModal = !showDownloadModal"
            class="px-4 py-1.5 bg-indigo-500 text-white text-sm rounded-lg hover:bg-indigo-600 transition-colors"
          >
            下载
          </button>
        </div>
      </div>
    </header>

    <div class="max-w-7xl mx-auto px-4 py-6 flex gap-6">
      <!-- 左侧控制面板 -->
      <aside class="w-72 flex-shrink-0 space-y-4">
        <!-- 图片上传 -->
        <div class="bg-white rounded-xl border border-gray-200 p-4">
          <h3 class="text-sm font-medium text-gray-700 mb-3">图片上传</h3>
          <div
            @click="triggerFileInput"
            @dragover.prevent
            @drop="handleFileDrop"
            class="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
          >
            <div v-if="!originalImageSrc" class="space-y-2">
              <svg class="w-10 h-10 mx-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 6v12m6-6H6" />
              </svg>
              <p class="text-sm text-gray-500">点击或拖放图片</p>
              <p class="text-xs text-gray-400">支持 JPG / PNG</p>
            </div>
            <img v-else :src="originalImageSrc" class="max-h-32 mx-auto rounded" alt="预览" />
          </div>
          <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="handleFileChange" />
        </div>

        <!-- 参数控制 -->
        <div class="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
          <h3 class="text-sm font-medium text-gray-700">参数设置</h3>

          <!-- 粒度 -->
          <div>
            <label class="text-xs text-gray-500 mb-1 block">
              粒度 (横向格子数)
              <span class="float-right font-mono text-gray-700">{{ granularity }}</span>
            </label>
            <input
              v-model.number="granularity"
              type="range" min="10" max="200" step="1"
              class="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
          </div>

          <!-- 相似度阈值 -->
          <div>
            <label class="text-xs text-gray-500 mb-1 block">
              颜色合并阈值
              <span class="float-right font-mono text-gray-700">{{ similarityThreshold }}</span>
            </label>
            <input
              v-model.number="similarityThreshold"
              type="range" min="0" max="100" step="1"
              class="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
          </div>

          <!-- 像素化模式 -->
          <div>
            <label class="text-xs text-gray-500 mb-1 block">像素化模式</label>
            <div class="flex gap-2">
              <button
                @click="pixelationMode = 'dominant'"
                :class="[
                  'flex-1 px-3 py-1.5 text-xs rounded-lg border transition-colors',
                  pixelationMode === 'dominant'
                    ? 'bg-indigo-500 text-white border-indigo-500'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-300'
                ]"
              >
                卡通(主色)
              </button>
              <button
                @click="pixelationMode = 'average'"
                :class="[
                  'flex-1 px-3 py-1.5 text-xs rounded-lg border transition-colors',
                  pixelationMode === 'average'
                    ? 'bg-indigo-500 text-white border-indigo-500'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-300'
                ]"
              >
                真实(均色)
              </button>
            </div>
          </div>
        </div>

        <!-- 编辑工具 -->
        <div v-if="mappedPixelData" class="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <h3 class="text-sm font-medium text-gray-700">编辑工具</h3>
          <div class="flex gap-2">
            <button
              @click="isManualColoringMode ? exitManualMode() : enterManualMode()"
              :class="[
                'flex-1 px-3 py-1.5 text-xs rounded-lg border transition-colors',
                isManualColoringMode
                  ? 'bg-green-500 text-white border-green-500'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-green-300'
              ]"
            >
              {{ isManualColoringMode ? '退出编辑' : '手动编辑' }}
            </button>
            <button
              v-if="isManualColoringMode"
              @click="toggleEraseMode"
              :class="[
                'px-3 py-1.5 text-xs rounded-lg border transition-colors',
                isEraseMode
                  ? 'bg-red-500 text-white border-red-500'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-red-300'
              ]"
            >
              橡皮擦
            </button>
          </div>
          <p v-if="isManualColoringMode && !selectedEditColor && !isEraseMode" class="text-xs text-gray-400">
            点击画布吸取颜色，或从下方色板选择
          </p>
        </div>

        <!-- 颜色统计 -->
        <div v-if="colorCounts" class="bg-white rounded-xl border border-gray-200 p-4">
          <h3 class="text-sm font-medium text-gray-700 mb-2">
            颜色统计
            <span class="text-xs text-gray-400 font-normal ml-1">
              {{ Object.keys(colorCounts).length }} 种 / {{ totalBeadCount }} 粒
            </span>
          </h3>
          <div class="max-h-64 overflow-y-auto space-y-1">
            <div
              v-for="item in currentGridColors"
              :key="item.color"
              class="flex items-center gap-2 py-1 px-2 rounded hover:bg-gray-50 cursor-pointer group"
              @click="isManualColoringMode && selectEditColor(item)"
            >
              <div
                class="w-5 h-5 rounded border border-gray-200 flex-shrink-0"
                :style="{ backgroundColor: item.color }"
              ></div>
              <span class="text-xs font-mono text-gray-700 flex-1">{{ item.key }}</span>
              <span class="text-xs text-gray-400">
                {{ colorCounts[item.color.toUpperCase()]?.count || 0 }}
              </span>
              <button
                v-if="isManualColoringMode"
                @click.stop="toggleExcludeColor(item.color.toUpperCase())"
                class="opacity-0 group-hover:opacity-100 text-xs text-red-400 hover:text-red-600"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      </aside>

      <!-- 主画布区域 -->
      <main class="flex-1 min-w-0">
        <!-- 无图片时显示上传引导 -->
        <div
          v-if="!originalImageSrc"
          @click="triggerFileInput"
          @dragover.prevent
          @drop="handleFileDrop"
          class="bg-white rounded-xl border-2 border-dashed border-gray-300 h-[600px] flex flex-col items-center justify-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors"
        >
          <svg class="w-20 h-20 text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p class="text-gray-400 text-lg mb-1">拖放或点击上传图片</p>
          <p class="text-gray-300 text-sm">支持 JPG / PNG 格式</p>
        </div>

        <!-- 处理中 -->
        <div v-else-if="isProcessing" class="bg-white rounded-xl border border-gray-200 h-[600px] flex items-center justify-center">
          <div class="text-center">
            <div class="w-12 h-12 border-4 border-indigo-200 border-t-indigo-500 rounded-full animate-spin mx-auto mb-4"></div>
            <p class="text-gray-500">处理中...</p>
          </div>
        </div>

        <!-- 像素预览画布 -->
        <div v-else class="bg-white rounded-xl border border-gray-200 overflow-hidden relative">
          <canvas
            ref="previewCanvas"
            width="800"
            height="600"
            class="w-full h-auto block"
            :style="{ imageRendering: 'pixelated', cursor: isManualColoringMode ? 'crosshair' : 'default' }"
            @click="handleCanvasClick"
            @mousemove="handleCanvasHover"
            @mouseleave="handleCanvasLeave"
          ></canvas>

          <!-- Tooltip -->
          <div
            v-if="tooltipData"
            class="absolute pointer-events-none bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg z-10"
            :style="{ left: tooltipData.x + 'px', top: tooltipData.y + 'px' }"
          >
            <div class="flex items-center gap-2">
              <div class="w-4 h-4 rounded border border-white/30" :style="{ backgroundColor: tooltipData.color }"></div>
              <span class="font-mono">{{ tooltipData.key }}</span>
            </div>
            <div class="text-gray-400 mt-1">行 {{ tooltipData.row }} · 列 {{ tooltipData.col }}</div>
          </div>
        </div>
      </main>
    </div>

    <!-- 下载弹窗 -->
    <Teleport to="body">
      <div
        v-if="showDownloadModal"
        class="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
        @click.self="showDownloadModal = false"
      >
        <div class="bg-white rounded-2xl shadow-xl w-96 p-6 space-y-4">
          <h3 class="text-lg font-semibold">下载设置</h3>

          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" v-model="downloadOptions.showGrid" class="rounded accent-indigo-500" />
            显示网格线
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" v-model="downloadOptions.showCoordinates" class="rounded accent-indigo-500" />
            显示坐标
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" v-model="downloadOptions.includeStats" class="rounded accent-indigo-500" />
            包含颜色统计
          </label>
          <div>
            <label class="text-xs text-gray-500">网格间隔</label>
            <input
              v-model.number="downloadOptions.gridInterval"
              type="number" min="1" max="50"
              class="w-full mt-1 text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>

          <div class="flex gap-2 pt-2">
            <button
              @click="handleDownloadGrid"
              class="flex-1 px-4 py-2 bg-indigo-500 text-white text-sm rounded-lg hover:bg-indigo-600 transition-colors"
            >
              下载图纸
            </button>
            <button
              @click="handleDownloadStats"
              class="flex-1 px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 transition-colors"
            >
              下载统计
            </button>
          </div>
          <button
            @click="handleExportCsv"
            class="w-full px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 transition-colors"
          >
            导出 CSV
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style>
/* 全局滚动条美化 */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #D1D5DB; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #9CA3AF; }
</style>
