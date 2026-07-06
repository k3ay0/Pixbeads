<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, defineAsyncComponent, toRaw } from 'vue'
import { storeToRefs } from 'pinia'

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

// Utils
import { getColorKeyByHex, sortColorsByHue } from './utils/colorSystemUtils'
import { recalculateColorStats, findClosestPaletteColor, hexToRgb } from './utils/pixelation'
import { MODES } from './constants/modeConstants'
import type { AppMode } from './constants/modeConstants'
import type { PbdsImportResult } from './utils/downloader'
import type { IroningPreviewConfig } from './utils/ironingPreview'
import { DEFAULT_IRONING_CONFIG } from './utils/ironingPreview'
import type { MappedPixel } from './types'

// Components
import DownloadSettingsModal from './components/DownloadSettingsModal.vue'
import ImportConvertDialog from './components/ImportConvertDialog.vue'
import InstallPWA from './components/InstallPWA.vue'
import ImageCropper from './components/ImageCropper.vue'
import AppHeader from './components/AppHeader.vue'
import CanvasArea from './components/CanvasArea.vue'
import OptimizeSidebar from './components/OptimizeSidebar.vue'
import EditSidebar from './components/EditSidebar.vue'
import EditToolbar from './components/EditToolbar.vue'
import PreviewSidebar from './components/PreviewSidebar.vue'
import IroningPreview from './components/IroningPreview.vue'
import FocusSidebar from './components/FocusSidebar.vue'

// Async components
const MagnifierTool = defineAsyncComponent(() =>
  import('./components/MagnifierTool.vue').catch(() => ({ render: () => null } as any))
)
const DonationModal = defineAsyncComponent(() =>
  import('./components/DonationModal.vue').catch(() => ({ render: () => null } as any))
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
const canvasTransform = useCanvasTransform()
const focusLogic = useFocusModeLogic()
const { marchingAntsOffset, startMarchingAnts, stopMarchingAnts } = useMarchingAnts()
const { restoreState, clearState: clearPersistedState } = useStatePersistence()

// ========== 从 Store 映射状态 ==========
const {
  originalImageSrc, showCropper, mappedPixelData, gridDimensions,
  colorCounts, totalBeadCount, granularity, granularityInput,
  granularityY, granularityYInput, lockAspectRatio,
  similarityThreshold, similarityThresholdInput, pixelationMode,
  isProcessing, processingProgress, croppedImageCanvas,
} = storeToRefs(beadStore)

const {
  selectedColorSystem, customPaletteSelections, excludedColorKeys,
  activeBeadPalette, pixelationPalette, showExcludedColors, fullBeadPalette,
} = storeToRefs(paletteStore)

const {
  canvasZoom, canvasTranslate, isDragging, tooltipData,
  previewCanvas,
} = storeToRefs(canvasStore)

const {
  isManualColoringMode, selectedEditColor, isEraseMode,
  colorReplaceState, highlightColorKey,
  isFloodFillEraseMode, isMagnifierActive,
  manualTool, manualBrushSize, manualMirrorX, manualMirrorY, manualShapeFill,
  selectionStart, selectionEnd, manualPasteActive, lineStart, clipboard,
  lineDrawing, rectDrawing, dragDrawing, currentDrawEnd, selectDrawing,
  selectionBoxDragging, selectionBoxDragStart, selectionBoxDragOffset,
  selectionDragging, selectionDragOffset, isCopyingSelection, moveToolMode,
} = storeToRefs(editorStore)

const {
  activeMode, showDownloadModal,
  showDonationModal, showImportDialog,
  toastMessage, downloadOptions, showPaletteEditor
} = storeToRefs(uiStore)

const {
  currentColor, canvasScale, canvasOffset,
  completedCells, recommendedRegion, recommendedCell,
  showColorPanel, availableColors, gridSectionInterval, showSectionLines, sectionLineColor,
  progressPercentage, currentColorInfo,
} = storeToRefs(focusStore)

// ========== 本地状态 ==========
const modes = MODES
const pendingPbdsData = ref<PbdsImportResult | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const pbdsFileInput = ref<HTMLInputElement | null>(null)
const isPainting = ref(false)
const lastPaintCell = ref<{ row: number; col: number } | null>(null)
const hoverCell = ref<{ row: number; col: number } | null>(null)
const previewOverlayCanvas = ref<HTMLCanvasElement | null>(null)

// CanvasArea ref for accessing overlay canvas
const canvasAreaRef = ref<any>(null)

// 熨烫预览
const ironingPreviewRef = ref<InstanceType<typeof IroningPreview> | null>(null)
const ironingConfig = ref<IroningPreviewConfig>(DEFAULT_IRONING_CONFIG)

// ========== 初始化 Composables ==========
const { scheduleRender, renderCanvas, renderPreviewOverlay, clearPreviewOverlay } = useCanvasRenderer(
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

function handleFileDrop(e: DragEvent) {
  e.preventDefault()
  const file = e.dataTransfer?.files?.[0]
  if (!file) return
  if (file.name.toLowerCase().endsWith('.pbds')) loadPbds(file)
  else if (file.type.startsWith('image/')) fileIO.loadImage(file)
}

function handleFileChange(e: Event) {
  const file = (e.target as HTMLInputElement)?.files?.[0]
  if (file) fileIO.loadImage(file)
}

async function handlePbdsFileChange(e: Event) {
  const file = (e.target as HTMLInputElement)?.files?.[0]
  if (!file) return
  const result = await fileIO.loadPbds(file)
  if (result) { pendingPbdsData.value = result; uiStore.showImportDialog = true }
}

function handleImportConfirmFromDialog(data: any) { fileIO.handleImportConfirm(data); pendingPbdsData.value = null }
function handleImportCancel() { uiStore.showImportDialog = false; pendingPbdsData.value = null }
function handleCropConfirm(canvas: HTMLCanvasElement) { fileIO.handleCropConfirm(canvas); processImage() }
function handleCropSkip() { fileIO.handleCropSkip(); processImage() }
function handleGridConfirm(data: { canvas: HTMLCanvasElement, cols: number, rows: number, pixelColors: string[][] }) {
  // 设置裁剪后的画布
  beadStore.setCroppedCanvas(data.canvas)
  beadStore.showCropper = false

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

  // Oklab 色彩匹配 - 将每个 RGB 颜色映射到最近的拼豆颜色
  const mappedPixelData: MappedPixel[][] = data.pixelColors.map(row =>
    row.map(color => {
      const rgb = parseRgb(color)
      const closest = findClosestPaletteColor(rgb, palette)
      return { key: closest.key, color: closest.hex }
    })
  )

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
function handlePaletteEditorSave(s: Record<string, boolean>) { paletteStore.updateSelections(s); uiStore.showPaletteEditor = false }
function handlePaletteEditorClose() { uiStore.showPaletteEditor = false }
function handlePaletteColorSelect(c: any) { pixelEditing.selectEditColor(c) }
function handlePaletteColorReplace(s: any, t: any) { editorStore.saveSnapshot(beadStore.mappedPixelData || []); pixelEditing.performColorReplace(s, t); editorStore.resetColorReplaceState() }
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
const currentGridColors = computed(() => {
  if (!mappedPixelData.value) return []
  const map = new Map()
  mappedPixelData.value.flat().forEach(cell => {
    if (cell && cell.color && !cell.isExternal) {
      const hex = cell.color.toUpperCase()
      if (!map.has(hex)) map.set(hex, { key: cell.key, color: cell.color })
    }
  })
  return sortColorsByHue(Array.from(map.values()).map(c => ({ key: getColorKeyByHex(c.color, selectedColorSystem.value), color: c.color })))
})

// Watch
watch([mappedPixelData, highlightColorKey, () => editorStore.selectionInfo], () => scheduleRender(), { flush: 'post' })
watch(isProcessing, () => { if (!isProcessing.value) scheduleRender() })
watch(originalImageSrc, () => { if (!originalImageSrc.value) scheduleRender() })
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
watch([granularity, granularityY, similarityThreshold, pixelationMode, pixelationPalette], () => { editorStore.clearBgRemovalSnapshot(); if (beadStore.originalImage || croppedImageCanvas.value) processImage() })
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
})
onUnmounted(() => {
  document.removeEventListener('click', handleGlobalClick)
  document.removeEventListener('mouseup', handleCanvasMouseUp)
  document.removeEventListener('mousemove', handleDocumentMouseMove)
  document.removeEventListener('mousemove', handleDocumentSelectMouseMove)
  focusStore.stopTimer()
  stopMarchingAnts()
})

// 其他函数
function handleDownloadGridWithOptions(o: any) { uiStore.updateDownloadOptions(o); fileIO.handleDownloadGrid() }
function handleMagnifierSelection(a: any) { editorStore.magnifierSelectionArea = a }
function handleMagnifierPixelEdit(d: any) { pixelEditing.handleMagnifierPixelEdit(d) }
</script>

<template>
  <!-- 裁剪工具 -->
  <ImageCropper v-if="showCropper && originalImageSrc" :image-src="originalImageSrc" @confirm="handleCropConfirm"
    @grid-confirm="handleGridConfirm" @skip="handleCropSkip" />

  <!-- 主布局 -->
  <div class="h-screen flex flex-col bg-white overflow-hidden font-sans">
    <!-- Header -->
    <AppHeader @switch-mode="switchMode" @trigger-file-input="triggerFileInput" @trigger-pbds-input="triggerPbdsInput"
      @open-palette-editor="showPaletteEditor = true" @export-pbds="handleExportPbds"
      @download-image="handleDownloadImage" @download-stats="handleDownloadStats" />

    <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="handleFileChange" />
    <input ref="pbdsFileInput" type="file" accept=".pbds" class="hidden" @change="handlePbdsFileChange" />

    <!-- Main content area -->
    <div class="relative flex-1 min-h-0 flex">
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

        <!-- Right sidebar -->
        <div v-if="mappedPixelData"
          class="absolute top-0 bottom-0 right-0 z-30 flex flex-col bg-white border-l border-black/10"
          style="width: 320px;">
          <OptimizeSidebar v-if="activeMode === 'optimize'" @trigger-file-input="triggerFileInput"
            @auto-remove-background="handleAutoRemoveBackground" @undo-bg-removal="handleUndoBgRemoval" />
          <EditSidebar v-if="activeMode === 'edit'" @color-select="handlePaletteColorSelect"
            @color-replace="handlePaletteColorReplace" />
          <PreviewSidebar v-if="activeMode === 'preview'" :config="ironingConfig"
            @download-preview="handleDownloadPreview" @update:config="ironingConfig = $event" />
          <FocusSidebar v-if="activeMode === 'focus'" @color-change="handleFocusColorChange" />
        </div>
      </div>
    </div>

    <!-- Footer -->
    <footer class="border-t border-black/[0.06] bg-white/70">
      <div class="mx-auto w-full px-4 py-2 flex items-center justify-between text-xs text-black/45">
        <span>PIXBEADS — 拼豆图纸生成工具</span>
      </div>
    </footer>
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
    @close="handleImportCancel" />

  <!-- Custom palette editor -->
  <CustomPaletteEditor v-if="showPaletteEditor" :all-colors="fullBeadPalette"
    :current-selections="customPaletteSelections" :selected-color-system="selectedColorSystem"
    @save="handlePaletteEditorSave" @close="handlePaletteEditorClose"
    @update:color-system="paletteStore.selectedColorSystem = $event" />

  <!-- Donation modal -->
  <Teleport to="body">
    <DonationModal v-if="showDonationModal" @close="showDonationModal = false" />
  </Teleport>

  <!-- Toast -->
  <Teleport to="body">
    <div v-if="toastMessage"
      class="fixed bottom-4 left-1/2 -translate-x-1/2 bg-black text-white text-sm px-4 py-2 rounded-lg shadow-lg z-50">
      {{ toastMessage }}
    </div>
  </Teleport>

  <!-- Install PWA -->
  <InstallPWA />
</template>
