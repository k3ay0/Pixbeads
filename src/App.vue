<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, defineAsyncComponent, toRaw } from 'vue'
import { storeToRefs } from 'pinia'
import * as THREE from 'three'

// Stores
import { useBeadStore } from './stores/beadStore'
import { usePaletteStore } from './stores/paletteStore'
import { useCanvasStore } from './stores/canvasStore'
import { useEditorStore } from './stores/editorStore'
import { useUiStore } from './stores/uiStore'
import { useFocusStore } from './stores/focusStore'

// Composables
import { useImageProcessing } from './composables/useImageProcessing'
import { useFileIO } from './composables/useFileIO'
import { usePixelEditing } from './composables/usePixelEditing'
import { useBackgroundRemoval } from './composables/useBackgroundRemoval'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts'
import { useCanvasTransform } from './composables/useCanvasTransform'
import { useFocusModeLogic } from './composables/useFocusModeLogic'
import { useMarchingAnts } from './composables/useMarchingAnts'
import { useCanvasRenderer } from './composables/useCanvasRenderer'
import { useCanvasInteraction } from './composables/useCanvasInteraction'
import { useStatePersistence } from './composables/useStatePersistence'
import { useOcrRecognition } from './composables/useOcrRecognition'

// Utils
import { getColorKeyByHex, sortColorsByHue } from './utils/colorSystemUtils'
import { recalculateColorStats, hexToRgb, replaceAllColor } from './utils/pixelation'
import { findClosestPaletteColor } from './utils/colorUtils'
import { MODES } from './constants/modeConstants'
import type { AppMode } from './constants/modeConstants'
import type { PbdsImportResult } from './utils/downloader'
import type { IroningPreviewConfig } from './utils/ironingPreview'
import { DEFAULT_IRONING_CONFIG } from './utils/ironingPreview'
import type { MappedPixel } from './types'
import { TRANSPARENT_KEY, transparentColorData } from './types'

// Components
import DownloadSettingsModal from './components/DownloadSettingsModal.vue'
import ImportConvertDialog from './components/ImportConvertDialog.vue'
import ImportFlowDialog from './components/ImportFlowDialog.vue'
import InstallPWA from './components/InstallPWA.vue'
import AppHeader from './components/AppHeader.vue'
import CanvasArea from './components/CanvasArea.vue'
import OptimizeSidebar from './components/OptimizeSidebar.vue'
import EditSidebar from './components/EditSidebar.vue'
import EditToolbar from './components/EditToolbar.vue'
import EditHistoryPanel from './components/EditHistoryPanel.vue'
import PreviewSidebar from './components/PreviewSidebar.vue'
import IroningPreview from './components/IroningPreview.vue'
import FocusSidebar from './components/FocusSidebar.vue'

// Voxel Components
import VoxelEditor3D from './components/VoxelEditor3D.vue'
import VoxelHeader from './components/VoxelHeader.vue'
import VoxelLeftPanel from './components/VoxelLeftPanel.vue'
import VoxelEditor2D from './components/VoxelEditor2D.vue'
import VoxelToolbar from './components/VoxelToolbar.vue'
import VoxelExportModal from './components/VoxelExportModal.vue'
import VoxelBgModal from './components/VoxelBgModal.vue'
import VoxelSliceGridModal from './components/VoxelSliceGridModal.vue'
import { useVoxelStore, type VoxelTool } from './stores/voxelStore'
import { useVoxelHistory } from './composables/useVoxelHistory'
import { useVoxelGeometry } from './composables/useVoxelGeometry'

// Async components
const MagnifierTool = defineAsyncComponent(() =>
  import('./components/MagnifierTool.vue').catch(() => ({ render: () => null } as any))
)

const CustomPaletteEditor = defineAsyncComponent(() =>
  import('./components/CustomPaletteEditor.vue').catch(() => ({ render: () => null } as any))
)

// ========== Stores ==========
const beadStore = useBeadStore()
const paletteStore = usePaletteStore()
const canvasStore = useCanvasStore()
const editorStore = useEditorStore()
const uiStore = useUiStore()
const focusStore = useFocusStore()

// ========== Composables ==========
const { processImage } = useImageProcessing()
const fileIO = useFileIO()
const pixelEditing = usePixelEditing()
const bgRemoval = useBackgroundRemoval()
useKeyboardShortcuts()
const focusLogic = useFocusModeLogic()
const { marchingAntsOffset, startMarchingAnts, stopMarchingAnts } = useMarchingAnts()
const { restoreState } = useStatePersistence()
const ocrRecognition = useOcrRecognition()

// ========== 从 Store 映射状态 ==========
const {
  originalImageSrc, mappedPixelData, gridDimensions,
  colorCounts, granularity,
  granularityY, lockAspectRatio,
  similarityThreshold, pixelationMode,
  isProcessing, croppedImageCanvas,
} = storeToRefs(beadStore)

const {
  selectedColorSystem, customPaletteSelections,
  pixelationPalette, fullBeadPalette,
} = storeToRefs(paletteStore)

storeToRefs(canvasStore)

const {
  selectedEditColor, isEraseMode,
  highlightColorKey,
  isMagnifierActive,
  manualTool



  ,
} = storeToRefs(editorStore)

const {
  activeMode, showDownloadModal,
  showImportDialog,
  toastMessage, downloadOptions, showPaletteEditor
} = storeToRefs(uiStore)

storeToRefs(focusStore)

// Voxel stores
const voxelStore = useVoxelStore()
const { undo: voxelUndo, redo: voxelRedo } = useVoxelHistory()
const { clearGhost } = useVoxelGeometry()

// ========== 本地状态 ==========
const pendingPbdsData = ref<PbdsImportResult | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const pbdsFileInput = ref<HTMLInputElement | null>(null)
const isPainting = ref(false)
const lastPaintCell = ref<{ row: number; col: number } | null>(null)
const hoverCell = ref<{ row: number; col: number } | null>(null)
const previewOverlayCanvas = ref<HTMLCanvasElement | null>(null)
const showImportFlow = ref(false)
const showImportConfirm = ref(false)
const showEditHistory = ref(false)

// 色板保存二次确认：待替换颜色预览
const paletteReplacePreview = ref<{
  selections: Record<string, boolean>
  changes: Array<{ sourceHex: string; sourceKey: string; count: number; targetHex: string; targetKey: string }>
} | null>(null)
const isGridImport = ref(false)
const pendingImportFile = ref<File | null>(null)

// CanvasArea ref for accessing overlay canvas
const canvasAreaRef = ref<any>(null)

// 熨烫预览
const ironingPreviewRef = ref<InstanceType<typeof IroningPreview> | null>(null)
const ironingConfig = ref<IroningPreviewConfig>(DEFAULT_IRONING_CONFIG)

// OCR 状态
const ocrProgress = ref<{ phase: string; phaseLabel: string; percent?: number } | null>(null)
const ocrError = ref<string | null>(null)

// Voxel refs
const voxelEditorRef = ref<InstanceType<typeof VoxelEditor3D> | null>(null)
const voxelEditor2DRef = ref<InstanceType<typeof VoxelEditor2D> | null>(null)
const voxelCount = computed(() => voxelStore.voxelCount)
const cursorPos = ref('—')
const showVoxel2D = ref(true)
const showExportModal = ref(false)
const showBgModal = ref(false)
const showAboutModal = ref(false)
const showDimsModal = ref(false)
const showSliceGridModal = ref(false)
const editDimW = ref(16)
const editDimH = ref(16)
const editDimD = ref(16)
const currentVoxelGroup = ref<THREE.Group | null>(null)
const currentRendererDomElement = ref<HTMLCanvasElement | null>(null)

// Panel width state for resizable panels
const leftPanelWidth = ref(180)
const rightPanelWidth = ref(200)
const editor2DWidth = ref(40) // percentage
const isDragging = ref(false)
const dragTarget = ref<'left' | 'right' | 'editor2d' | null>(null)
const dragStartX = ref(0)
const dragStartWidth = ref(0)

// Panel resize handlers
function startPanelResize(e: MouseEvent, target: 'left' | 'right' | 'editor2d') {
  e.preventDefault()
  isDragging.value = true
  dragTarget.value = target
  dragStartX.value = e.clientX
  if (target === 'left') {
    dragStartWidth.value = leftPanelWidth.value
  } else if (target === 'right') {
    dragStartWidth.value = rightPanelWidth.value
  } else {
    dragStartWidth.value = editor2DWidth.value
  }
  document.addEventListener('mousemove', handlePanelResize)
  document.addEventListener('mouseup', stopPanelResize)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function handlePanelResize(e: MouseEvent) {
  if (!isDragging.value || !dragTarget.value) return
  const dx = e.clientX - dragStartX.value
  if (dragTarget.value === 'left') {
    leftPanelWidth.value = Math.max(120, Math.min(400, dragStartWidth.value + dx))
  } else if (dragTarget.value === 'right') {
    rightPanelWidth.value = Math.max(150, Math.min(500, dragStartWidth.value - dx))
  } else if (dragTarget.value === 'editor2d') {
    // Get the container width for percentage calculation
    const container = document.querySelector('.voxoB-layout .flex.flex-1')
    if (container) {
      const containerWidth = container.clientWidth
      const percentageChange = (dx / containerWidth) * 100
      editor2DWidth.value = Math.max(20, Math.min(70, dragStartWidth.value + percentageChange))
    }
  }
}

function stopPanelResize() {
  isDragging.value = false
  dragTarget.value = null
  document.removeEventListener('mousemove', handlePanelResize)
  document.removeEventListener('mouseup', stopPanelResize)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

// ========== 初始化 Composables ==========
const { scheduleRender, renderPreviewOverlay, clearPreviewOverlay } = useCanvasRenderer(
  canvasAreaRef,
  previewOverlayCanvas,
  hoverCell,
  marchingAntsOffset
)

const {
  handleCanvasClick,
  handleCanvasHover,
  handleCanvasMouseDown,
  handleCanvasMouseUp,
  handleDocumentMouseMove,
  handleDocumentSelectMouseMove,
} = useCanvasInteraction(
  hoverCell,
  isPainting,
  lastPaintCell,
  renderPreviewOverlay,
  clearPreviewOverlay,
  scheduleRender
)

// ========== 函数定义 ==========
function triggerFileInput() { uiStore.closeAllMenus(); fileInput.value?.click() }
function triggerPbdsInput() { uiStore.closeAllMenus(); pbdsFileInput.value?.click() }

function handleOpenImportFlow() {
  uiStore.closeAllMenus()
  // 如果画布中有内容，显示确认弹窗
  if (mappedPixelData.value) {
    showImportConfirm.value = true
  } else {
    showImportFlow.value = true
  }
}

// 图片文件统一走新版导入流程（直接进入裁剪步骤）
function openImportFlowWithFile(file: File) {
  pendingImportFile.value = file
  uiStore.closeAllMenus()
  if (mappedPixelData.value) {
    showImportConfirm.value = true
  } else {
    showImportFlow.value = true
  }
}

function handleImportConfirm() {
  showImportConfirm.value = false
  showImportFlow.value = true
}

function handleImportCancel() {
  showImportConfirm.value = false
  pendingImportFile.value = null
}

function handleCloseImportFlow() {
  showImportFlow.value = false
}

function handleCropConfirmFromFlow(canvas: HTMLCanvasElement) {
  showImportFlow.value = false
  isGridImport.value = false
  fileIO.handleCropConfirm(canvas)
  processImage()
}

async function handleGridConfirmFromFlow(data: { canvas: HTMLCanvasElement, cols: number, rows: number, pixelColors: string[][]; ocrEnabled: boolean }) {
  showImportFlow.value = false
  isGridImport.value = true
  await handleGridConfirm(data)
}

function handleFileDrop(e: DragEvent) {
  e.preventDefault()
  const file = e.dataTransfer?.files?.[0]
  if (!file) return
  if (file.name.toLowerCase().endsWith('.pbds')) loadPbds(file)
  else if (file.type.startsWith('image/')) openImportFlowWithFile(file)
}

function handleFileChange(e: Event) {
  const file = (e.target as HTMLInputElement)?.files?.[0]
  if (file) openImportFlowWithFile(file)
}

async function handlePbdsFileChange(e: Event) {
  const file = (e.target as HTMLInputElement)?.files?.[0]
  if (!file) return
  const result = await fileIO.loadPbds(file)
  if (result) { pendingPbdsData.value = result; uiStore.showImportDialog = true }
}

async function handlePbdsDropFromFlow(file: File) {
  const result = await fileIO.loadPbds(file)
  if (result) { pendingPbdsData.value = result; uiStore.showImportDialog = true }
}

function handleImportConfirmFromDialog(data: any) { fileIO.handleImportConfirm(data); pendingPbdsData.value = null }
function handlePbdsImportCancel() { uiStore.showImportDialog = false; pendingPbdsData.value = null }
async function handleGridConfirm(data: { canvas: HTMLCanvasElement, cols: number, rows: number, pixelColors: string[][]; ocrEnabled: boolean }) {
  // 设置裁剪后的画布
  beadStore.setCroppedCanvas(data.canvas)

  // 设置网格维度
  beadStore.updateGranularity(data.cols)
  beadStore.updateGranularityY(data.rows)

  // 将 RGB 字符串解析为 RgbColor 对象
  const parseRgb = (rgbStr: string): { r: number, g: number, b: number } => {
    const match = rgbStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
    if (match) {
      return { r: parseInt(match[1]), g: parseInt(match[2]), b: parseInt(match[3]) }
    }
    return { r: 0, g: 0, b: 0 }
  }

  // 获取当前色板
  const palette = toRaw(paletteStore.activeBeadPalette).map(c => ({
    key: c.key,
    hex: c.hex,
    rgb: { r: c.rgb.r, g: c.rgb.g, b: c.rgb.b }
  }))

  // OCR 模式下跳过 Oklab 色彩匹配，直接使用已在 EmbeddedCropper 中匹配好的色号
  let mappedPixelData: MappedPixel[][]
  if (data.ocrEnabled) {
    mappedPixelData = data.pixelColors.map(row =>
      row.map(hex => {
        // 无 OCR 色号的空格子 → TRANSPARENT_KEY
        if (hex === TRANSPARENT_KEY) {
          return { ...transparentColorData }
        }
        const hexLower = hex.replace('#', '').toUpperCase()
        const match = palette.find(c => c.hex.replace('#', '').toUpperCase() === hexLower)
        return match ? { key: match.key, color: match.hex } : { key: '?', color: hex }
      })
    )
  } else {
    // Oklab 色彩匹配 - 将每个 RGB 颜色映射到最近的拼豆颜色
    mappedPixelData = data.pixelColors.map(row =>
      row.map(color => {
        const rgb = parseRgb(color)
        const closest = findClosestPaletteColor(rgb, palette)
        return { key: closest.key, color: closest.hex }
      })
    )
  }

  // 设置像素数据
  beadStore.setPixelData(mappedPixelData, { N: data.cols, M: data.rows })

  // 更新颜色统计
  const stats = recalculateColorStats(mappedPixelData)
  beadStore.updateColorStats(stats)

  // 清除编辑历史并保存快照
  editorStore.clearHistory()
  editorStore.saveSnapshot(mappedPixelData)
}
function handleGlobalClick(e: MouseEvent) { if (!(e.target as HTMLElement).closest('.relative')) uiStore.closeAllMenus() }
function handlePaletteEditorSave(s: Record<string, boolean>) {
  // 计算现有图纸中不在新色板里的颜色，找最近色替代
  const changes = computePaletteReplacementChanges(s)
  if (changes.length === 0) {
    // 无需替换，直接保存并关闭
    paletteStore.updateSelections(s)
    uiStore.showPaletteEditor = false
    return
  }
  // 有需要替换的颜色，保留编辑器并弹出二次确认框
  paletteReplacePreview.value = { selections: s, changes }
}

// 计算图纸中不在新色板里的颜色及其最近色替代
function computePaletteReplacementChanges(s: Record<string, boolean>) {
  if (!mappedPixelData.value) return []
  const newPalette = paletteStore.fullBeadPalette.filter(c => s[c.hex.toUpperCase()])
  if (newPalette.length === 0) return []
  const newHexSet = new Set(newPalette.map(c => c.hex.toUpperCase()))

  // 统计图纸中每种不在新色板里的颜色出现次数
  const countMap = new Map<string, number>()
  for (const row of mappedPixelData.value) {
    for (const cell of row) {
      if (!cell || cell.isExternal) continue
      const hex = cell.color.toUpperCase()
      if (!newHexSet.has(hex)) {
        countMap.set(hex, (countMap.get(hex) || 0) + 1)
      }
    }
  }

  const changes: { sourceHex: string; sourceKey: string; count: number; targetHex: string; targetKey: string }[] = []
  for (const [sourceHex, count] of countMap) {
    const rgb = hexToRgb(sourceHex)
    if (!rgb) continue
    const closest = findClosestPaletteColor(rgb, newPalette)
    const targetHex = closest.hex.toUpperCase()
    const sourceKey = getColorKeyByHex(sourceHex, selectedColorSystem.value)
    changes.push({
      sourceHex,
      sourceKey: sourceKey !== '?' ? sourceKey : sourceHex,
      count,
      targetHex,
      targetKey: getColorKeyByHex(targetHex, selectedColorSystem.value),
    })
  }
  return changes.sort((a, b) => b.count - a.count)
}

// 确认替换：应用色板选择 + 对现有图纸执行最近色替换
function handlePaletteReplaceConfirm() {
  const preview = paletteReplacePreview.value
  if (!preview) return
  paletteReplacePreview.value = null
  paletteStore.updateSelections(preview.selections)

  if (beadStore.mappedPixelData && preview.changes.length > 0) {
    editorStore.saveSnapshot(beadStore.mappedPixelData, '颜色替换')
    let result = beadStore.mappedPixelData
    let replacedCount = 0
    for (const c of preview.changes) {
      const { result: r, count } = replaceAllColor(result, c.sourceHex, c.targetKey, c.targetHex)
      result = r
      replacedCount += count
    }
    beadStore.setPixelData(result)
    const stats = recalculateColorStats(result)
    beadStore.updateColorStats(stats)
  }
  uiStore.showPaletteEditor = false
  uiStore.showToast(`已替换 ${preview.changes.length} 种颜色`)
}

// 取消替换：不应用选择，编辑器保持打开
function handlePaletteReplaceCancel() {
  paletteReplacePreview.value = null
}
function handlePaletteEditorClose() { uiStore.showPaletteEditor = false }
function handlePaletteColorSelect(c: any) { pixelEditing.selectEditColor(c) }
function handlePaletteColorReplace(s: any, t: any) { editorStore.saveSnapshot(beadStore.mappedPixelData || [], '颜色替换'); pixelEditing.performColorReplace(s, t); editorStore.resetColorReplaceState() }
function handleMirrorHorizontal() { pixelEditing.performMirrorHorizontal() }
function handleExportPbds() { fileIO.handleExportPbds() }
function handleDownloadImage() { fileIO.handleDownloadImage() }
function handleDownloadStats() { fileIO.handleDownloadStats() }
function handleDownloadPreview() { ironingPreviewRef.value?.download() }
function loadPbds(file: File) { fileIO.loadPbds(file).then(result => { if (result) { pendingPbdsData.value = result; uiStore.showImportDialog = true } }) }
function handleAutoRemoveBackground() { bgRemoval.handleAutoRemoveBackground() }
function handleUndoBgRemoval() { bgRemoval.handleUndoBgRemoval() }
function handleFocusColorChange(color: string) { focusLogic.handleFocusColorChange(color) }

function switchMode(mode: AppMode) {
  if (activeMode.value === 'edit') editorStore.exitManualMode()
  if (activeMode.value === 'focus') focusStore.stopTimer()
  // 离开色彩优化界面时，清空排除颜色状态（保留像素数据中的替换结果）
  if (activeMode.value === 'optimize') paletteStore.clearExcludedState()
  // Leave voxel mode — dispose Three.js resources
  if (activeMode.value === 'voxel' && mode !== 'voxel') {
    voxelEditorRef.value?.dispose()
  }
  // Voxel mode entry — skip all 2D handlers
  if (mode === 'voxel') {
    uiStore.switchMode(mode)
    return
  }
  uiStore.switchMode(mode)
  if (mode === 'edit') editorStore.enterManualMode()
  if (mode === 'focus') focusLogic.initFocusMode()
  // 进入色彩优化界面时，重新计算颜色计数
  if (mode === 'optimize' && mappedPixelData.value) {
    const stats = recalculateColorStats(mappedPixelData.value)
    beadStore.updateColorStats(stats)
  }
}

// 计算属性

// Watch
watch([mappedPixelData, highlightColorKey, () => editorStore.selectionInfo], () => scheduleRender(), { flush: 'post' })
watch(isProcessing, () => { if (!isProcessing.value) scheduleRender() })
watch(originalImageSrc, () => { if (!originalImageSrc.value) scheduleRender() })
// canvas 原生缩放/平移变化时重绘
watch([() => canvasStore.canvasZoom, () => canvasStore.canvasTranslate], () => {
  scheduleRender()
})
// 从预览/专心模式返回时重新渲染canvas
watch(activeMode, (newMode, oldMode) => {
  if (oldMode === 'preview' || oldMode === 'focus') {
    // 延迟一帧确保DOM已更新
    requestAnimationFrame(() => scheduleRender())
  }
})
watch(granularity, v => { beadStore.granularityInput = v.toString(); if (lockAspectRatio.value) { const src = croppedImageCanvas.value || beadStore.originalImage; if (src) { const r = ('height' in src ? src.height : (src as HTMLCanvasElement).height) / ('width' in src ? src.width : (src as HTMLCanvasElement).width); beadStore.updateGranularityY(Math.max(1, Math.round(v * r))) } } })
watch(granularityY, v => { beadStore.granularityYInput = v.toString() })
watch(similarityThreshold, v => { beadStore.similarityThresholdInput = v.toString() })
watch([granularity, granularityY, similarityThreshold, pixelationMode], () => { editorStore.clearBgRemovalSnapshot(); if (beadStore.originalImage || croppedImageCanvas.value) processImage() })
// 切换色号系统时，更新像素数据中的色号，不重新处理图像
watch(selectedColorSystem, (newSystem) => {
  if (!mappedPixelData.value || !colorCounts.value) return

  const fullPalette = paletteStore.fullBeadPalette
  const result = mappedPixelData.value.map(row => row.map(cell => {
    if (!cell || cell.isExternal) return cell
    const hex = cell.color.toUpperCase()
    const key = getColorKeyByHex(hex, newSystem)
    // 如果色号有效，只更新 key
    if (key !== '?') return { ...cell, key }
    // 如果颜色不在新色板中，找相近颜色替换
    const rgb = hexToRgb(hex)
    if (!rgb) return cell
    const closest = findClosestPaletteColor(rgb, fullPalette)
    return { key: closest.key, color: closest.hex, isExternal: false }
  }))

  beadStore.setPixelData(result)
  const stats = recalculateColorStats(result)
  beadStore.updateColorStats(stats)
})
watch(customPaletteSelections, () => paletteStore.saveSelections(), { deep: true })

// Marching ants 动画控制
watch(() => editorStore.selectionInfo, (info) => {
  if (info && (manualTool.value === 'select' || manualTool.value === 'move')) {
    startMarchingAnts(renderPreviewOverlay)
  } else {
    stopMarchingAnts()
  }
}, { flush: 'post' })

watch(manualTool, (tool) => {
  if (tool !== 'select' && tool !== 'move') {
    stopMarchingAnts()
  } else if (editorStore.selectionInfo) {
    startMarchingAnts(renderPreviewOverlay)
  }
})

// Lifecycle
function handleVoxelKeydown(e: KeyboardEvent) {
  if (activeMode.value !== 'voxel') return

  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); voxelUndo(); return }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); voxelRedo(); return }
  if (e.key === 'Escape') { e.preventDefault(); voxelEditorRef.value?.cancelAnchor?.(); clearGhost(); return }
  if (e.ctrlKey || e.metaKey) return

  const toolMap: Record<string, VoxelTool> = { b: 'pen', l: 'line', r: 'rect', c: 'circle', q: 'ellipse', g: 'fill', f: 'fillSlice', i: 'eyedropper' }
  if (toolMap[e.key]) { e.preventDefault(); voxelStore.currentTool = toolMap[e.key]; return }
  if (e.key === 'e') { e.preventDefault(); voxelStore.editMode = voxelStore.editMode === 'draw' ? 'del' : 'draw'; return }
}

onMounted(() => {
  paletteStore.initPalette()

  // 恢复持久化状态
  const restored = restoreState()
  if (restored) {
    // 如果恢复了状态，触发重新渲染
    requestAnimationFrame(() => scheduleRender())
  }

  document.addEventListener('click', handleGlobalClick)
  document.addEventListener('mouseup', handleCanvasMouseUp)
  document.addEventListener('mousemove', handleDocumentMouseMove)
  document.addEventListener('mousemove', handleDocumentSelectMouseMove)
  document.addEventListener('keydown', handleVoxelKeydown)
})
onUnmounted(() => {
  document.removeEventListener('click', handleGlobalClick)
  document.removeEventListener('mouseup', handleCanvasMouseUp)
  document.removeEventListener('mousemove', handleDocumentMouseMove)
  document.removeEventListener('mousemove', handleDocumentSelectMouseMove)
  document.removeEventListener('keydown', handleVoxelKeydown)
  focusStore.stopTimer()
  stopMarchingAnts()
})

// 其他函数
function handleDownloadGridWithOptions(o: any) { uiStore.updateDownloadOptions(o); fileIO.handleDownloadGrid() }
function handleMagnifierSelection(a: any) { editorStore.magnifierSelectionArea = a }
function handleMagnifierPixelEdit(d: any) { pixelEditing.handleMagnifierPixelEdit(d) }

function handleNew2DCanvas() {
  if (beadStore.mappedPixelData && Object.keys(beadStore.colorCounts || {}).length > 0) {
    if (!confirm('当前 2D 画布数据将被清空，是否继续？')) return
  }
  beadStore.reset()
  editorStore.clearHistory()
  uiStore.switchMode('optimize')
}

function handleNew3DCanvas() {
  if (voxelStore.voxelCount > 0) {
    if (!confirm('当前 3D 画布数据将被清空，是否继续？')) return
  }
  voxelStore.resetAll()
  uiStore.switchMode('voxel')
}

function handleOpenDims() {
  editDimW.value = voxelStore.dimW
  editDimH.value = voxelStore.dimH
  editDimD.value = voxelStore.dimD
  showDimsModal.value = true
}

function applyDims() {
  const w = Math.max(1, Math.min(128, editDimW.value))
  const h = Math.max(1, Math.min(128, editDimH.value))
  const d = Math.max(1, Math.min(128, editDimD.value))

  if (w < voxelStore.dimW || h < voxelStore.dimH || d < voxelStore.dimD) {
    let outOfBounds = 0
    voxelStore.voxels.forEach((_v, key) => {
      const [vx, vy, vz] = voxelStore.pv(key)
      if (vx >= w || vy >= h || vz >= d) outOfBounds++
    })
    if (outOfBounds > 0) {
      alert(`无法缩小：有 ${outOfBounds} 个体素超出新尺寸范围，请先删除这些体素。`)
      return
    }
  }

  voxelStore.setDimensions(w, h, d)
  voxelEditorRef.value?.rebuildAllMeshes?.()
  showDimsModal.value = false
}

function handleOpenExportModal() {
  currentVoxelGroup.value = voxelEditorRef.value?.getVoxelGroup?.() ?? null
  currentRendererDomElement.value = voxelEditorRef.value?.getRendererDomElement?.() ?? null
  showExportModal.value = true
}

function handleSliceExported() {
  showSliceGridModal.value = false
  switchMode('optimize')
}

function handleBgUpdate(bg: any) {
  if (bg.target === '2d') {
    // Update 2D editor background
    if (voxelEditor2DRef.value?.setBackground2D) {
      voxelEditor2DRef.value.setBackground2D(bg)
    }
  } else {
    // Update 3D renderer background
    if (voxelEditorRef.value?.setBackground) {
      voxelEditorRef.value.setBackground(bg)
    }
  }
}
</script>

<template>
  <!-- 主布局 -->
  <div class="h-screen flex flex-col bg-white overflow-hidden font-sans">
    <!-- Header -->
    <AppHeader @switch-mode="switchMode" @trigger-file-input="triggerFileInput" @trigger-pbds-input="triggerPbdsInput"
      @open-palette-editor="showPaletteEditor = true" @export-pbds="handleExportPbds"
      @download-image="handleDownloadImage" @download-stats="handleDownloadStats" @new-2d-canvas="handleNew2DCanvas"
      @new-3d-canvas="handleNew3DCanvas" />

    <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="handleFileChange" />
    <input ref="pbdsFileInput" type="file" accept=".pbds" class="hidden" @change="handlePbdsFileChange" />

    <!-- Main content area -->
    <div v-if="activeMode !== 'voxel'" class="relative flex-1 min-h-0 flex">
      <div class="mx-auto w-full flex-1 min-h-0 flex">
        <!-- Canvas area -->
        <CanvasArea v-show="activeMode !== 'preview'" ref="canvasAreaRef" @trigger-file-input="triggerFileInput"
          @file-drop="handleFileDrop" @canvas-click="handleCanvasClick" @canvas-hover="handleCanvasHover"
          @canvas-mousedown="handleCanvasMouseDown" @canvas-mouseup="handleCanvasMouseUp" />

        <!-- Ironing preview canvas -->
        <IroningPreview v-if="activeMode === 'preview' && mappedPixelData" ref="ironingPreviewRef"
          :config="ironingConfig" />

        <!-- Edit toolbar (floating on canvas left) -->
        <EditToolbar v-if="activeMode === 'edit' && mappedPixelData" @toggle-palette="showPaletteEditor = true" />

        <!-- Edit history floating panel (top-right of canvas) -->
        <EditHistoryPanel v-if="activeMode === 'edit' && mappedPixelData && showEditHistory"
          @close="showEditHistory = false" />

        <!-- Right sidebar -->
        <div v-if="mappedPixelData"
          class="absolute top-0 bottom-0 right-0 z-30 flex flex-col bg-white border-l border-black/10"
          style="width: 320px;">
          <OptimizeSidebar v-if="activeMode === 'optimize'" :is-grid-import="isGridImport"
            @trigger-file-input="triggerFileInput" @auto-remove-background="handleAutoRemoveBackground"
            @undo-bg-removal="handleUndoBgRemoval" />
          <EditSidebar v-if="activeMode === 'edit'" @color-select="handlePaletteColorSelect"
            @color-replace="handlePaletteColorReplace" @mirror-horizontal="handleMirrorHorizontal"
            @toggle-edit-history="showEditHistory = !showEditHistory" />
          <PreviewSidebar v-if="activeMode === 'preview'" :config="ironingConfig"
            @download-preview="handleDownloadPreview" @update:config="ironingConfig = $event" />
          <FocusSidebar v-if="activeMode === 'focus'" @color-change="handleFocusColorChange" />
        </div>
      </div>
    </div>

    <!-- Footer -->
    <footer v-if="activeMode !== 'voxel'" class="border-t border-black/[0.06] bg-white/70">
      <div class="mx-auto w-full px-4 py-2 flex items-center justify-between text-xs text-black/45">
        <span>PIXBEADS — 拼豆图纸生成工具</span>
      </div>
    </footer>

    <!-- VoxoB-style 3D Editor Layout -->
    <div v-if="activeMode === 'voxel'" class="voxoB-layout flex flex-col flex-1 min-h-0 v-theme-bg0">
      <VoxelHeader @open-bg="showBgModal = true" @open-export="handleOpenExportModal" @open-dims="handleOpenDims"
        @toggle-2d="showVoxel2D = !showVoxel2D" @open-slice-grid="showSliceGridModal = true" />

      <div class="flex flex-1 min-h-0" style="gap: 0" :style="{ background: 'var(--b3)' }">
        <!-- Left Panel -->
        <div class="v-theme-bg2 flex-shrink-0 overflow-y-auto" :style="{ width: leftPanelWidth + 'px' }">
          <VoxelLeftPanel />
        </div>
        <div class="flex-shrink-0 w-[3px] cursor-col-resize hover:bg-blue-500 transition-colors"
          style="background: var(--bd)" @mousedown="startPanelResize($event, 'left')"></div>

        <!-- 2D Editor -->
        <template v-if="showVoxel2D">
          <VoxelEditor2D ref="voxelEditor2DRef" class="flex-shrink-0" :style="{ width: editor2DWidth + '%' }" />
          <div class="flex-shrink-0 w-[3px] cursor-col-resize hover:bg-blue-500 transition-colors"
            style="background: var(--bd)" @mousedown="startPanelResize($event, 'editor2d')"></div>
        </template>

        <!-- 3D View -->
        <div class="flex-1 min-w-[60px] flex flex-col overflow-hidden">
          <VoxelEditor3D ref="voxelEditorRef" />
        </div>
        <div class="flex-shrink-0 w-[3px] cursor-col-resize hover:bg-blue-500 transition-colors"
          style="background: var(--bd)" @mousedown="startPanelResize($event, 'right')"></div>

        <!-- Right Panel -->
        <div class="v-theme-bg2 flex-shrink-0 overflow-y-auto" :style="{ width: rightPanelWidth + 'px' }">
          <VoxelToolbar />
        </div>
      </div>
    </div>
  </div>



  <!-- Magnifier tool -->
  <Teleport to="body">
    <MagnifierTool v-if="isMagnifierActive && mappedPixelData && gridDimensions" :pixel-data="mappedPixelData"
      :grid-dimensions="gridDimensions" :selected-color="selectedEditColor" :is-erase-mode="isEraseMode"
      @selection="handleMagnifierSelection" @pixel-edit="handleMagnifierPixelEdit"
      @close="editorStore.exitMagnifierMode" />
  </Teleport>

  <!-- Download modal -->
  <DownloadSettingsModal :is-open="showDownloadModal" :options="downloadOptions"
    @update:options="downloadOptions = $event" @download-grid="handleDownloadGridWithOptions"
    @close="showDownloadModal = false" />

  <!-- Import convert dialog -->
  <ImportConvertDialog :is-open="showImportDialog" :import-data="pendingPbdsData"
    :current-color-system="selectedColorSystem" :full-palette="fullBeadPalette" @confirm="handleImportConfirmFromDialog"
    @close="handlePbdsImportCancel" />

  <!-- Import flow dialog -->
  <ImportFlowDialog :is-open="showImportFlow" :pending-file="pendingImportFile" @close="handleCloseImportFlow"
    @crop-confirm="handleCropConfirmFromFlow" @grid-confirm="handleGridConfirmFromFlow"
    @pbds-drop="handlePbdsDropFromFlow" @pending-file-consumed="pendingImportFile = null" />

  <!-- Import confirm dialog -->
  <Teleport to="body">
    <div v-if="showImportConfirm" class="modal-overlay bg-black/5" @click.self="handleImportCancel">
      <div class="modal max-w-sm p-6">
        <h3 class="text-base font-semibold text-black mb-2">确认导入</h3>
        <p class="text-sm text-black/60 mb-6">
          当前画布中有未保存的内容，导入新文件后将无法恢复。是否继续？
        </p>
        <div class="flex justify-end gap-3">
          <button @click="handleImportCancel" class="btn btn-secondary h-9 rounded-lg px-4">
            取消
          </button>
          <button @click="handleImportConfirm" class="btn btn-primary h-9 rounded-lg px-4">
            继续导入
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Custom palette editor -->
  <CustomPaletteEditor v-if="showPaletteEditor" :all-colors="fullBeadPalette"
    :current-selections="customPaletteSelections" :selected-color-system="selectedColorSystem"
    @save="handlePaletteEditorSave" @close="handlePaletteEditorClose"
    @update:color-system="paletteStore.selectedColorSystem = $event" />

  <!-- 色板替换二次确认弹窗 -->
  <Teleport to="body">
    <div v-if="paletteReplacePreview" class="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"
      @click.self="handlePaletteReplaceCancel">
      <div class="modal max-w-md">
        <div class="modal-header">
          <h3 class="modal-title">确认替换颜色</h3>
        </div>
        <div class="modal-body">
          <p class="text-sm text-black/60 mb-4">
            色板变更后，以下 {{ paletteReplacePreview.changes.length }} 种图纸用色不在新色板中，将替换为最近颜色：
          </p>
          <div class="space-y-2">
            <div v-for="c in paletteReplacePreview.changes" :key="c.sourceHex" class="flex items-center gap-2 text-sm">
              <span class="w-6 h-6 rounded border border-black/10 flex-shrink-0"
                :style="{ backgroundColor: c.sourceHex }"></span>
              <span class="font-medium tabular-nums">{{ c.sourceKey }}</span>
              <svg class="w-3.5 h-3.5 text-black/40 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13 5l7 7-7 7M5 12h14" />
              </svg>
              <span class="w-6 h-6 rounded border border-black/10 flex-shrink-0"
                :style="{ backgroundColor: c.targetHex }"></span>
              <span class="font-medium tabular-nums">{{ c.targetKey }}</span>
              <span class="ml-auto text-xs text-black/40 tabular-nums">{{ c.count }} 颗</span>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button @click="handlePaletteReplaceCancel" class="btn btn-secondary h-9 rounded-lg px-4">
            取消
          </button>
          <button @click="handlePaletteReplaceConfirm" class="btn btn-primary h-9 rounded-lg px-4">
            确认替换
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Toast -->
  <Teleport to="body">
    <div v-if="toastMessage"
      class="fixed bottom-4 left-1/2 -translate-x-1/2 bg-black text-white text-sm px-4 py-2 rounded-lg shadow-lg z-50">
      {{ toastMessage }}
    </div>
  </Teleport>

  <!-- OCR Loading 遮罩 -->
  <Teleport to="body">
    <div v-if="ocrProgress" class="fixed inset-0 flex items-center justify-center z-[70]">
      <div class="modal min-w-[240px] p-6">
        <div class="w-8 h-8 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
        <p class="text-black text-sm font-medium">
          {{ ocrProgress.phaseLabel }}
        </p>
        <div v-if="ocrProgress.percent != null" class="w-full bg-black/10 rounded-full h-1.5">
          <div class="bg-black h-1.5 rounded-full transition-all duration-300"
            :style="{ width: `${Math.min(100, Math.max(0, ocrProgress.percent))}%` }"></div>
        </div>
        <p v-if="ocrProgress.percent != null" class="text-black/60 text-xs">
          {{ Math.min(100, Math.max(0, Math.round(ocrProgress.percent))) }}%
        </p>
      </div>
    </div>
  </Teleport>

  <!-- OCR 错误提示 -->
  <Teleport to="body">
    <div v-if="ocrError"
      class="fixed top-4 left-1/2 -translate-x-1/2 z-[80] bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm">
      {{ ocrError }}
    </div>
  </Teleport>

  <!-- Install PWA -->
  <InstallPWA />

  <!-- Voxel Modals -->
  <VoxelExportModal :is-open="showExportModal" :voxel-group="currentVoxelGroup"
    :renderer-dom-element="currentRendererDomElement" @close="showExportModal = false" />
  <VoxelBgModal :is-open="showBgModal" @close="showBgModal = false" @update:background="handleBgUpdate" />
  <VoxelSliceGridModal :is-open="showSliceGridModal" @close="showSliceGridModal = false"
    @exported="handleSliceExported" />

  <!-- Canvas Dimension Dialog -->
  <Teleport to="body">
    <div v-if="showDimsModal" class="fixed inset-0 bg-black/60 z-[80] flex items-center justify-center"
      @click.self="showDimsModal = false">
      <div class="v-theme-bg2 border rounded-xl shadow-2xl w-[340px] max-w-[90vw] p-5 v-theme-text"
        style="border-color: var(--bd)">
        <h2 class="text-lg font-bold mb-4" style="color: var(--tx)">📐 画布尺寸</h2>
        <div class="space-y-3">
          <div>
            <label class="text-[10px] block mb-1" style="color: var(--t2)">宽 (W)</label>
            <input v-model.number="editDimW" type="number" min="1" max="128"
              class="w-full rounded px-3 py-1.5 text-sm font-mono focus:outline-none"
              :style="{ backgroundColor: 'var(--b3)', border: '1px solid var(--bd)', color: 'var(--tx)' }" />
          </div>
          <div>
            <label class="text-[10px] block mb-1" style="color: var(--t2)">高 (H)</label>
            <input v-model.number="editDimH" type="number" min="1" max="128"
              class="w-full rounded px-3 py-1.5 text-sm font-mono focus:outline-none"
              :style="{ backgroundColor: 'var(--b3)', border: '1px solid var(--bd)', color: 'var(--tx)' }" />
          </div>
          <div>
            <label class="text-[10px] block mb-1" style="color: var(--t2)">深 (D)</label>
            <input v-model.number="editDimD" type="number" min="1" max="128"
              class="w-full rounded px-3 py-1.5 text-sm font-mono focus:outline-none"
              :style="{ backgroundColor: 'var(--b3)', border: '1px solid var(--bd)', color: 'var(--tx)' }" />
          </div>
        </div>
        <div class="flex gap-2 mt-5">
          <button @click="showDimsModal = false" class="flex-1 py-2 rounded-lg text-sm transition-colors"
            :style="{ backgroundColor: 'var(--b3)', border: '1px solid var(--bd)', color: 'var(--t2)' }">
            取消
          </button>
          <button @click="applyDims" class="flex-1 py-2 rounded-lg text-sm font-medium transition-colors"
            :style="{ backgroundColor: 'var(--ac)', color: '#fff' }">
            应用
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
