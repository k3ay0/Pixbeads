<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, defineAsyncComponent, nextTick } from 'vue'
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
import { getColorKeyByHex, colorSystemOptions, sortColorsByHue } from './utils/colorSystemUtils'
import { clientToGridCoords, calculateVisibleColumns, calculateVisibleRows } from './utils/canvasUtils'
import { CELL_SIZE, AXIS_WIDTH, AXIS_HEIGHT, MIN_ZOOM, MAX_ZOOM } from './constants/canvasConstants'
import { MODES } from './constants/modeConstants'
import type { AppMode } from './constants/modeConstants'
import { TRANSPARENT_KEY } from './types'
import type { PbdsImportResult } from './utils/downloader'

// Components
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
  previewCanvas, canvasContainer,
} = storeToRefs(canvasStore)

const {
  isManualColoringMode, selectedEditColor, isEraseMode,
  colorReplaceState, highlightColorKey, showFullPalette,
  isFloodFillEraseMode, bgRemovalSnapshot, isMagnifierActive,
  magnifierSelectionArea, floatingPalette,
} = storeToRefs(editorStore)

const {
  activeMode, showImportMenu, showExportMenu, showDownloadModal,
  showSettingsPanel, showDonationModal, showImportDialog,
  toastMessage, downloadOptions,
} = storeToRefs(uiStore)

const {
  currentColor, selectedCell, canvasScale, canvasOffset,
  completedCells, colorProgress, recommendedRegion, recommendedCell,
  guidanceMode, showColorPanel, isPaused, totalElapsedTime,
  availableColors, gridSectionInterval, showSectionLines, sectionLineColor,
  elapsedTime, progressPercentage, guidanceModeLabel, currentColorInfo,
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

const visibleColumns = computed(() => {
  if (!gridDimensions.value || !canvasContainer.value) return []
  return calculateVisibleColumns(gridDimensions.value.N, canvasContainer.value.clientWidth, canvasTranslate.value.x, canvasZoom.value)
})

const visibleRows = computed(() => {
  if (!gridDimensions.value || !canvasContainer.value) return []
  return calculateVisibleRows(gridDimensions.value.M, canvasContainer.value.clientHeight, canvasTranslate.value.y, canvasZoom.value)
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
              <div class="text-center w-64">
                <div class="w-12 h-12 border-4 border-black/10 border-t-black rounded-full animate-spin mx-auto mb-4"></div>
                <p class="text-black/45 mb-3">
                  {{ processingProgress?.phase === 'pixelate' ? '像素化处理中...' : processingProgress?.phase === 'merge' ? '颜色合并中...' : '处理中...' }}
                </p>
                <div v-if="processingProgress" class="w-full bg-black/10 rounded-full h-2">
                  <div
                    class="bg-black h-2 rounded-full transition-all duration-150"
                    :style="{ width: `${Math.round((processingProgress.current / processingProgress.total) * 100)}%` }"
                  ></div>
                </div>
                <p v-if="processingProgress" class="text-xs text-black/35 mt-2">
                  {{ processingProgress.current }} / {{ processingProgress.total }}
                </p>
              </div>
            </div>

            <!-- Canvas preview (optimize/edit/preview modes) -->
            <div v-else-if="activeMode !== 'focus'" class="flex-1 relative overflow-hidden bg-white">
              <!-- 坐标轴和画布容器 -->
              <div 
                ref="canvasContainer"
                class="absolute inset-0"
                @wheel.prevent="handleCanvasWheel"
                @mousedown="handleCanvasDragStart"
                @mousemove="handleCanvasDragMove"
                @mouseup="handleCanvasDragEnd"
                @mouseleave="handleCanvasDragEnd"
              >
                <!-- 上方行号轴 -->
                <div class="absolute top-0 left-0 right-0 bg-white border-b border-black/10 z-10 flex" :style="{ height: AXIS_HEIGHT + 'px' }">
                  <div :style="{ width: AXIS_WIDTH + 'px' }" class="flex-shrink-0"></div>
                  <div class="flex-1 relative overflow-hidden">
                    <div 
                      class="absolute"
                      :style="{ 
                        transform: `translateX(${canvasTranslate.x}px)`,
                        width: `${(gridDimensions?.N || 0) * CELL_SIZE * canvasZoom}px`,
                        height: '100%'
                      }"
                    >
                      <div 
                        v-for="col in visibleColumns" 
                        :key="'col-' + col"
                        class="absolute text-[10px] text-black/50"
                        :style="{ left: (col - 1) * CELL_SIZE * canvasZoom + 'px' }"
                      >
                        {{ col }}
                      </div>
                    </div>
                  </div>
                </div>

                <!-- 左侧列号轴 -->
                <div class="absolute top-0 left-0 bottom-0 bg-white border-r border-black/10 z-10" :style="{ width: AXIS_WIDTH + 'px', top: AXIS_HEIGHT + 'px' }">
                  <div class="relative overflow-hidden h-full">
                    <div 
                      class="absolute"
                      :style="{ 
                        transform: `translateY(${canvasTranslate.y}px)`,
                        width: '100%',
                        height: `${(gridDimensions?.M || 0) * CELL_SIZE * canvasZoom}px`
                      }"
                    >
                      <div 
                        v-for="row in visibleRows" 
                        :key="'row-' + row"
                        class="absolute text-[10px] text-black/50 text-right pr-1"
                        :style="{ 
                          top: (row - 1) * CELL_SIZE * canvasZoom + 'px',
                          width: AXIS_WIDTH + 'px'
                        }"
                      >
                        {{ row }}
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Canvas 画布 -->
                <div 
                  class="absolute overflow-hidden"
                  :style="{ 
                    top: AXIS_HEIGHT + 'px', 
                    left: AXIS_WIDTH + 'px', 
                    right: 0, 
                    bottom: 0,
                    backgroundColor: '#F0F0F0',
                    backgroundImage: 'linear-gradient(45deg, #FFFFFF 25%, transparent 25%), linear-gradient(-45deg, #FFFFFF 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #FFFFFF 75%), linear-gradient(-45deg, transparent 75%, #FFFFFF 75%)',
                    backgroundSize: '16px 16px',
                    backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px'
                  }"
                >
                  <canvas
                    ref="previewCanvas"
                    class="block"
                    :style="{ 
                      imageRendering: 'pixelated', 
                      transform: `translate(${canvasTranslate.x}px, ${canvasTranslate.y}px) scale(${canvasZoom})`, 
                      transformOrigin: '0 0', 
                      cursor: isDragging ? 'grabbing' : (isManualColoringMode ? 'crosshair' : (activeMode === 'edit' ? 'crosshair' : 'grab'))
                    }"
                    @click="handleCanvasClick"
                    @mousemove="handleCanvasHover"
                    @mouseleave="handleCanvasLeave"
                  ></canvas>
                </div>
              </div>
              
              <!-- Zoom controls -->
              <div class="absolute bottom-4 right-4 flex items-center gap-2 bg-white/90 backdrop-blur-sm rounded-lg px-3 py-1.5 shadow-sm border border-black/10 z-20">
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
                class="absolute pointer-events-none bg-black text-white text-xs rounded-lg px-3 py-2 shadow-lg z-30"
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
