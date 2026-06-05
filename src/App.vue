<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, defineAsyncComponent } from 'vue'
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

// Utils
import { getColorKeyByHex, sortColorsByHue } from './utils/colorSystemUtils'
import { clientToGridCoords } from './utils/canvasUtils'
import { CELL_SIZE } from './constants/canvasConstants'
import { MODES } from './constants/modeConstants'
import type { AppMode } from './constants/modeConstants'
import { TRANSPARENT_KEY } from './types'
import type { PbdsImportResult } from './utils/downloader'

// Components
import DownloadSettingsModal from './components/DownloadSettingsModal.vue'
import ImportConvertDialog from './components/ImportConvertDialog.vue'
import InstallPWA from './components/InstallPWA.vue'
import ImageCropper from './components/ImageCropper.vue'
import AppHeader from './components/AppHeader.vue'
import CanvasArea from './components/CanvasArea.vue'
import OptimizeSidebar from './components/OptimizeSidebar.vue'
import EditSidebar from './components/EditSidebar.vue'
import PreviewSidebar from './components/PreviewSidebar.vue'
import FocusSidebar from './components/FocusSidebar.vue'
import FloatingPalette from './components/FloatingPalette.vue'

// Async components
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
  activeBeadPalette, showPaletteEditor, showExcludedColors, fullBeadPalette,
} = storeToRefs(paletteStore)

const {
  canvasZoom, canvasTranslate, isDragging, tooltipData,
  previewCanvas,
} = storeToRefs(canvasStore)

const {
  isManualColoringMode, selectedEditColor, isEraseMode,
  colorReplaceState, highlightColorKey,
  isFloodFillEraseMode, isMagnifierActive,
} = storeToRefs(editorStore)

const {
  activeMode, showDownloadModal,
  showSettingsPanel, showDonationModal, showImportDialog,
  toastMessage, downloadOptions,
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
function handleGlobalClick(e: MouseEvent) { if (!(e.target as HTMLElement).closest('.relative')) uiStore.closeAllMenus() }
function handlePaletteEditorSave(s: Record<string, boolean>) { paletteStore.updateSelections(s); uiStore.showPaletteEditor = false }
function handlePaletteEditorClose() { uiStore.showPaletteEditor = false }
function handlePaletteColorSelect(c: any) { pixelEditing.selectEditColor(c) }
function handlePaletteColorReplace(s: any, t: any) { editorStore.saveSnapshot(beadStore.mappedPixelData || []); pixelEditing.performColorReplace(s, t); editorStore.resetColorReplaceState() }
function handleExportPbds() { fileIO.handleExportPbds() }
function handleDownloadImage() { fileIO.handleDownloadImage() }
function handleDownloadStats() { fileIO.handleDownloadStats() }
function loadPbds(file: File) { fileIO.loadPbds(file).then(result => { if (result) { pendingPbdsData.value = result; uiStore.showImportDialog = true } }) }
function handleAutoRemoveBackground() { bgRemoval.handleAutoRemoveBackground() }
function handleUndoBgRemoval() { bgRemoval.handleUndoBgRemoval() }
function handleFocusColorChange(color: string) { focusLogic.handleColorChange(color) }

function switchMode(mode: AppMode) {
  if (activeMode.value === 'edit') editorStore.exitManualMode()
  if (activeMode.value === 'focus') focusStore.stopTimer()
  uiStore.switchMode(mode)
  if (mode === 'focus') focusLogic.initFocusMode()
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

// Canvas 交互
function handleCanvasClick(e: MouseEvent) {
  if (!mappedPixelData.value || !gridDimensions.value || !isManualColoringMode.value || isDragging.value) return
  const canvas = e.target as HTMLCanvasElement
  const coords = clientToGridCoords(e.clientX, e.clientY, canvas, gridDimensions.value)
  if (!coords) return
  const { i: col, j: row } = coords
  const cell = mappedPixelData.value[row][col]
  if (!cell || cell.isExternal) return
  if (isFloodFillEraseMode.value) { pixelEditing.handleFloodFillErase(row, col); return }
  if (colorReplaceState.value.isActive) { pixelEditing.handleColorReplaceClick(row, col); return }
  if (isEraseMode.value) { editorStore.saveSnapshot(mappedPixelData.value); pixelEditing.performSinglePixelPaint(row, col, { key: TRANSPARENT_KEY, color: '#FFFFFF', isExternal: true }) }
  else if (selectedEditColor.value) { editorStore.saveSnapshot(mappedPixelData.value); pixelEditing.performSinglePixelPaint(row, col, { key: selectedEditColor.value.key, color: selectedEditColor.value.color, isExternal: false }) }
  else { const hex = cell.color.toUpperCase(); pixelEditing.selectEditColor({ key: getColorKeyByHex(hex, selectedColorSystem.value), color: cell.color }) }
}

function handleCanvasHover(e: MouseEvent) {
  if (!mappedPixelData.value || !gridDimensions.value || isDragging.value) return
  const canvas = e.target as HTMLCanvasElement
  const coords = clientToGridCoords(e.clientX, e.clientY, canvas, gridDimensions.value)
  if (coords) {
    const { i: col, j: row } = coords
    const cell = mappedPixelData.value[row][col]
    if (cell && !cell.isExternal) {
      const rect = canvas.getBoundingClientRect()
      canvasStore.setTooltip({ x: e.clientX - rect.left + 15, y: e.clientY - rect.top - 10, key: getColorKeyByHex(cell.color, selectedColorSystem.value), color: cell.color, row: row + 1, col: col + 1 })
      return
    }
  }
  canvasStore.clearTooltip()
}

// 画布渲染
function renderCanvas() {
  const canvas = previewCanvas.value
  if (!canvas || !mappedPixelData.value || !gridDimensions.value) return
  const { N, M } = gridDimensions.value
  canvas.width = N * CELL_SIZE; canvas.height = M * CELL_SIZE
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  for (let j = 0; j < M; j++) for (let i = 0; i < N; i++) {
    const cell = mappedPixelData.value[j]?.[i]; if (!cell) continue
    const x = i * CELL_SIZE, y = j * CELL_SIZE
    if (cell.isExternal) { ctx.clearRect(x, y, CELL_SIZE, CELL_SIZE); continue }
    ctx.fillStyle = cell.color; ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE)
    ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 0.5; ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE)
  }
  if (highlightColorKey.value) {
    ctx.fillStyle = 'rgba(255, 255, 0, 0.3)'
    for (let j = 0; j < M; j++) for (let i = 0; i < N; i++) {
      const cell = mappedPixelData.value[j]?.[i]
      if (cell && !cell.isExternal && cell.color.toUpperCase() === highlightColorKey.value.toUpperCase())
        ctx.fillRect(i * CELL_SIZE, j * CELL_SIZE, CELL_SIZE, CELL_SIZE)
    }
  }
}

// Watch
watch([mappedPixelData, highlightColorKey], () => renderCanvas(), { flush: 'post' })
watch(isProcessing, () => { if (!isProcessing.value) renderCanvas() })
watch(originalImageSrc, () => { if (!originalImageSrc.value) renderCanvas() })
watch(granularity, v => { beadStore.granularityInput = v.toString(); if (lockAspectRatio.value) { const src = croppedImageCanvas.value || beadStore.originalImage; if (src) { const r = ('height' in src ? src.height : (src as HTMLCanvasElement).height) / ('width' in src ? src.width : (src as HTMLCanvasElement).width); beadStore.updateGranularityY(Math.max(1, Math.round(v * r))) } } })
watch(granularityY, v => { beadStore.granularityYInput = v.toString() })
watch(similarityThreshold, v => { beadStore.similarityThresholdInput = v.toString() })
watch([granularity, granularityY, similarityThreshold, pixelationMode, activeBeadPalette], () => { editorStore.clearBgRemovalSnapshot(); if (beadStore.originalImage || croppedImageCanvas.value) processImage() })
watch(selectedColorSystem, () => { if (beadStore.originalImage) processImage() })
watch(customPaletteSelections, () => paletteStore.saveSelections(), { deep: true })

// Lifecycle
onMounted(() => { paletteStore.initPalette(); document.addEventListener('click', handleGlobalClick) })
onUnmounted(() => { document.removeEventListener('click', handleGlobalClick); focusStore.stopTimer() })

// 其他函数
function handleDownloadGridWithOptions(o: any) { uiStore.updateDownloadOptions(o); fileIO.handleDownloadGrid() }
function handleMagnifierSelection(a: any) { editorStore.magnifierSelectionArea = a }
function handleMagnifierPixelEdit(d: any) { pixelEditing.handleMagnifierPixelEdit(d) }
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
    <AppHeader
      @switch-mode="switchMode"
      @trigger-file-input="triggerFileInput"
      @trigger-pbds-input="triggerPbdsInput"
      @open-palette-editor="showPaletteEditor = true"
      @export-pbds="handleExportPbds"
      @download-image="handleDownloadImage"
      @download-stats="handleDownloadStats"
    />

    <!-- Hidden file inputs -->
    <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="handleFileChange" />
    <input ref="pbdsFileInput" type="file" accept=".pbds" class="hidden" @change="handlePbdsFileChange" />

    <!-- Main content area -->
    <div class="relative flex-1 min-h-0 flex">
      <div class="mx-auto w-full flex-1 min-h-0 flex">
        <!-- Canvas area -->
        <CanvasArea
          @trigger-file-input="triggerFileInput"
          @file-drop="handleFileDrop"
          @canvas-click="handleCanvasClick"
          @canvas-hover="handleCanvasHover"
        />

        <!-- Right sidebar -->
        <div
          v-if="mappedPixelData"
          class="absolute top-0 bottom-0 right-0 z-30 flex flex-col bg-white border-l border-black/10"
          style="width: 320px;"
        >
          <OptimizeSidebar v-if="activeMode === 'optimize'" @trigger-file-input="triggerFileInput" @auto-remove-background="handleAutoRemoveBackground" @undo-bg-removal="handleUndoBgRemoval" />
          <EditSidebar v-if="activeMode === 'edit'" @trigger-file-input="triggerFileInput" @open-palette-editor="showPaletteEditor = true" @color-select="handlePaletteColorSelect" @color-replace="handlePaletteColorReplace" />
          <PreviewSidebar v-if="activeMode === 'preview'" @open-palette-editor="showPaletteEditor = true" @download-stats="handleDownloadStats" />
          <FocusSidebar v-if="activeMode === 'focus'" @color-change="handleFocusColorChange" />
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

  <!-- Floating palette -->
  <FloatingPalette @color-select="handlePaletteColorSelect" @color-replace="handlePaletteColorReplace" />

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
    <DonationModal v-if="showDonationModal" @close="showDonationModal = false" />
  </Teleport>

  <!-- PWA install prompt -->
  <InstallPWA />

  <!-- Toast -->
  <Transition name="toast">
    <div
      v-if="toastMessage"
      class="fixed bottom-20 left-1/2 -translate-x-1/2 px-4 py-2 bg-black text-white text-sm rounded-lg shadow-lg z-50 pointer-events-none"
    >{{ toastMessage }}</div>
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
