<script setup>
import { ref, computed, watch, onMounted, onUnmounted, defineAsyncComponent } from 'vue'
import { useRouter } from 'vue-router'
import {
  hexToRgb,
  calculatePixelGrid,
  mergeSimilarRegions,
  recalculateColorStats,
  TRANSPARENT_KEY,
  PixelationMode,
} from './utils/pixelation'
import {
  getMardToHexMapping,
  getColorKeyByHex,
  colorSystemOptions,
  sortColorsByHue,
} from './utils/colorSystemUtils'
import { downloadGridImage, downloadStatsImage, exportCsv } from './utils/downloader'
import { useManualEditingState } from './composables/useManualEditingState.js'
import { usePixelEditingOperations } from './composables/usePixelEditingOperations.js'
import { clientToGridCoords } from './utils/canvasUtils.js'
import { loadPaletteSelections, savePaletteSelections, presetToSelections } from './utils/localStorageUtils.js'
import DownloadSettingsModal from './components/DownloadSettingsModal.vue'
import ColorPalette from './components/ColorPalette.vue'
import InstallPWA from './components/InstallPWA.vue'

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
const FocusModePreDownloadModal = defineAsyncComponent(() =>
  import('./components/FocusModePreDownloadModal.vue').catch(() => ({ render: () => null }))
)

const router = useRouter()

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

const previewCanvas = ref(null)

// ========== 撤销/重做 ==========
const editHistory = ref([])
const editHistoryIndex = ref(-1)
const MAX_HISTORY = 50

// ========== 一键去背景 ==========
const bgRemovalSnapshot = ref(null)

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

// ========== 专心模式预下载提醒 ==========
const showPreDownloadModal = ref(false)

// 下载选项
const downloadOptions = ref({
  showGrid: true,
  gridInterval: 10,
  showCoordinates: true,
  showCellNumbers: true,
  gridLineColor: '#CCCCCC',
  includeStats: true,
  exportCsv: false,
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
    bgRemovalSnapshot.value = null
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
      const M = Math.max(1, Math.round(N * aspectRatio))

      // 创建临时 canvas
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)

      // 像素化 — 传入原始 MARD 调色板（hex key），不进行色号系统转换
      // 回退颜色：T1 key → 任意白色 hex → 第一个调色板颜色
      const fallbackColor = activeBeadPalette.value.find(p => p.key === 'T1')
        || activeBeadPalette.value.find(p => p.hex.toUpperCase() === '#FFFFFF')
        || activeBeadPalette.value[0]
        || { key: '?', hex: '#000000', rgb: { r: 0, g: 0, b: 0 } }
      let result = calculatePixelGrid(ctx, img.width, img.height, N, M, activeBeadPalette.value, pixelationMode.value, fallbackColor)

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
watch([granularity, similarityThreshold, pixelationMode, activeBeadPalette], () => {
  bgRemovalSnapshot.value = null
  if (originalImage.value) processImage()
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
}

function redoEdit() {
  if (editHistoryIndex.value >= editHistory.value.length - 1) return
  editHistoryIndex.value++
  const snapshot = editHistory.value[editHistoryIndex.value]
  mappedPixelData.value = snapshot.map(r => r.map(c => ({ ...c })))
  const stats = recalculateColorStats(mappedPixelData.value)
  colorCounts.value = stats.colorCounts
  totalBeadCount.value = stats.totalCount
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

// ========== 专心模式 ==========
function enterFocusMode() {
  if (!mappedPixelData.value) return
  showPreDownloadModal.value = true
}

function handlePreDownloadConfirm() {
  showPreDownloadModal.value = false
  saveAndJumpToFocus()
}

function handlePreDownloadSkip() {
  showPreDownloadModal.value = false
  saveAndJumpToFocus()
}

function saveAndJumpToFocus() {
  localStorage.setItem('focusMode_pixelData', JSON.stringify(mappedPixelData.value))
  localStorage.setItem('focusMode_gridDimensions', JSON.stringify(gridDimensions.value))
  localStorage.setItem('focusMode_colorCounts', JSON.stringify(colorCounts.value))
  localStorage.setItem('focusMode_selectedColorSystem', selectedColorSystem.value)
  router.push('/focus')
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
  savePaletteSelections(val)
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

// DownloadSettingsModal 触发下载
function handleDownloadGridWithOptions(options) {
  downloadOptions.value = options
  handleDownloadGrid()
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
          <!-- 专心模式按钮 -->
          <button
            v-if="mappedPixelData"
            @click="enterFocusMode"
            class="px-4 py-1.5 bg-emerald-500 text-white text-sm rounded-lg hover:bg-emerald-600 transition-colors"
            title="保存当前图纸并进入专心模式"
          >
            专心模式
          </button>
          <!-- 下载按钮 -->
          <button
            v-if="mappedPixelData"
            @click="showDownloadModal = !showDownloadModal"
            class="px-4 py-1.5 bg-indigo-500 text-white text-sm rounded-lg hover:bg-indigo-600 transition-colors"
          >
            下载
          </button>
          <!-- 打赏按钮 -->
          <button
            @click="showDonationModal = true"
            class="px-4 py-1.5 bg-yellow-500 text-white text-sm rounded-lg hover:bg-yellow-600 transition-colors"
            title="请作者喝杯咖啡"
          >
            ☕ 打赏
          </button>
          <!-- 设置按钮 -->
          <button
            v-if="mappedPixelData"
            @click="showSettingsPanel = true"
            class="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="高级设置"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
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

          <!-- 一键去背景 -->
          <div class="flex gap-2">
            <button
              @click="handleAutoRemoveBackground"
              :disabled="!mappedPixelData"
              class="flex-1 px-3 py-1.5 text-xs rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              一键去背景
            </button>
            <button
              @click="handleUndoBgRemoval"
              :disabled="!bgRemovalSnapshot"
              class="flex-1 px-3 py-1.5 text-xs rounded-lg border border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              回撤上一步
            </button>
          </div>
        </div>

        <!-- 编辑工具 -->
        <div v-if="mappedPixelData" class="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <h3 class="text-sm font-medium text-gray-700">编辑工具</h3>
          <!-- 放大镜按钮（与手动编辑同级） -->
          <div class="flex gap-2">
            <button
              @click="isManualColoringMode && toggleMagnifier()"
              :class="[
                'flex-1 px-3 py-1.5 text-xs rounded-lg border transition-colors',
                isMagnifierActive
                  ? 'bg-cyan-500 text-white border-cyan-500'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-cyan-300'
              ]"
              :disabled="!isManualColoringMode"
            >
              🔍 放大镜
            </button>
          </div>
          <div class="flex gap-2 flex-wrap">
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
          </div>

          <!-- 使用 ColorPalette 组件替代内联颜色列表和模式按钮 -->
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

          <!-- 无颜色时提示 -->
          <p v-if="isManualColoringMode && currentGridColors.length === 0" class="text-xs text-gray-400">
            当前图纸无可用颜色。
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

        <!-- 编辑色板按钮 -->
        <button
          v-if="mappedPixelData"
          @click="showPaletteEditor = true"
          class="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
          编辑色板 ({{ fullBeadPalette.length }} 色)
        </button>
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
            :style="{ imageRendering: 'pixelated', cursor: isManualColoringMode ? (isFloodFillEraseMode ? 'cell' : colorReplaceState.isActive ? 'copy' : isEraseMode ? 'crosshair' : 'crosshair') : 'default' }"
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

    <!-- 悬浮调色盘 -->
    <Teleport to="body">
      <div
        v-if="mappedPixelData"
        class="fixed z-40 select-none"
        :style="{ left: floatingPalette.x + 'px', top: floatingPalette.y + 'px' }"
      >
        <div class="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden" :class="{ 'w-12': floatingPalette.collapsed, 'w-64': !floatingPalette.collapsed }">
          <!-- 拖拽头 -->
          <div
            class="bg-gradient-to-r from-indigo-500 to-purple-500 px-3 py-2 flex items-center justify-between cursor-move"
            @mousedown="onPaletteHeaderMouseDown"
          >
            <span class="text-white text-xs font-medium" v-if="!floatingPalette.collapsed">调色盘</span>
            <button
              @click.stop="togglePaletteCollapse"
              class="text-white/80 hover:text-white text-xs ml-1"
              :title="floatingPalette.collapsed ? '展开' : '收起'"
            >
              {{ floatingPalette.collapsed ? '◀' : '▶' }}
            </button>
          </div>

          <!-- 工具按钮 -->
          <div v-if="!floatingPalette.collapsed" class="p-2 border-b border-gray-100">
            <div class="flex gap-1 flex-wrap">
              <!-- 撤销 -->
              <button
                @click="undoEdit"
                :disabled="editHistoryIndex < 0"
                class="px-2 py-1 text-xs rounded bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="撤销 (Ctrl+Z)"
              >↩ 撤销</button>
              <!-- 重做 -->
              <button
                @click="redoEdit"
                :disabled="editHistoryIndex >= editHistory.length - 1"
                class="px-2 py-1 text-xs rounded bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="重做 (Ctrl+Shift+Z)"
              >↪ 重做</button>
              <!-- 橡皮擦 -->
              <button
                @click="isManualColoringMode && toggleEraseMode()"
                :class="[
                  'px-2 py-1 text-xs rounded transition-colors',
                  isEraseMode ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                ]"
                title="橡皮擦"
              >🧹 橡皮</button>
              <!-- 区域擦除 -->
              <button
                @click="isManualColoringMode && (isFloodFillEraseMode ? exitFloodFillEraseMode() : enterFloodFillEraseMode())"
                :class="[
                  'px-2 py-1 text-xs rounded transition-colors',
                  isFloodFillEraseMode ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                ]"
                title="洪水填充擦除"
              >🪣 区域</button>
              <!-- 批量替换 -->
              <button
                @click="isManualColoringMode && (colorReplaceState.isActive ? exitColorReplaceMode() : enterColorReplaceMode())"
                :class="[
                  'px-2 py-1 text-xs rounded transition-colors',
                  colorReplaceState.isActive ? 'bg-purple-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                ]"
                title="颜色批量替换"
              >🔄 替换</button>
            </div>
          </div>

          <!-- 颜色网格 -->
          <div v-if="!floatingPalette.collapsed" class="p-2 max-h-48 overflow-y-auto">
            <div v-if="currentGridColors.length === 0" class="text-xs text-gray-400 text-center py-2">暂无颜色</div>
            <div class="grid grid-cols-8 gap-1">
              <button
                v-for="color in currentGridColors"
                :key="color.color"
                @click="isManualColoringMode && selectEditColor(color)"
                class="w-6 h-6 rounded border border-gray-200 hover:scale-125 transition-transform relative group"
                :style="{ backgroundColor: color.color }"
                :title="color.key"
                :class="{ 'ring-2 ring-indigo-500 ring-offset-1': selectedEditColor?.color === color.color }"
              >
                <span class="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none bg-white px-1 rounded shadow">
                  {{ color.key }}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 放大镜工具（覆盖在主画布上方） -->
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

    <!-- 下载弹窗（使用组件） -->
    <DownloadSettingsModal
      :is-open="showDownloadModal"
      :options="downloadOptions"
      @update:options="downloadOptions = $event"
      @download-grid="handleDownloadGridWithOptions"
      @close="showDownloadModal = false"
    />

    <!-- 自定义色板编辑器弹窗 -->
    <Teleport to="body">
      <CustomPaletteEditor
        v-if="showPaletteEditor"
        :all-colors="fullBeadPalette"
        :current-selections="customPaletteSelections"
        @save="handlePaletteEditorSave"
        @close="handlePaletteEditorClose"
      />
    </Teleport>

    <!-- 设置面板弹窗 -->
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

    <!-- 打赏弹窗 -->
    <Teleport to="body">
      <DonationModal
        v-if="showDonationModal"
        @close="showDonationModal = false"
      />
    </Teleport>

    <!-- 专心模式预下载提醒弹窗 -->
    <Teleport to="body">
      <FocusModePreDownloadModal
        v-if="showPreDownloadModal"
        @confirm="handlePreDownloadConfirm"
        @skip="handlePreDownloadSkip"
        @close="showPreDownloadModal = false"
      />
    </Teleport>

    <!-- PWA 安装提示 -->
    <InstallPWA />
  </div>
</template>

<style>
/* 全局滚动条美化 */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #D1D5DB; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #9CA3AF; }

/* 悬浮调色盘拖拽时禁止选中 */
.palette-dragging * {
  user-select: none;
  -webkit-user-select: none;
}
</style>
