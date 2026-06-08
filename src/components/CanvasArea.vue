<script setup lang="ts">
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useBeadStore } from '../stores/beadStore'
import { useCanvasStore } from '../stores/canvasStore'
import { useEditorStore } from '../stores/editorStore'
import { useUiStore } from '../stores/uiStore'
import { useFocusStore } from '../stores/focusStore'
import { useCanvasTransform } from '../composables/useCanvasTransform'
import { calculateVisibleColumns, calculateVisibleRows } from '../utils/canvasUtils'
import { CELL_SIZE, AXIS_WIDTH, AXIS_HEIGHT, MIN_ZOOM, MAX_ZOOM } from '../constants/canvasConstants'
import FocusCanvas from './FocusCanvas.vue'
import FocusToolBar from './FocusToolBar.vue'
import FocusColorRing from './FocusColorRing.vue'
import CelebrationAnimation from './CelebrationAnimation.vue'

const emit = defineEmits<{
  (e: 'canvas-click', ev: MouseEvent): void
  (e: 'canvas-hover', ev: MouseEvent): void
  (e: 'canvas-mousedown', ev: MouseEvent): void
  (e: 'canvas-mouseup', ev: MouseEvent): void
  (e: 'trigger-file-input'): void
  (e: 'file-drop', ev: DragEvent): void
}>()

const beadStore = useBeadStore()
const canvasStore = useCanvasStore()
const editorStore = useEditorStore()
const uiStore = useUiStore()
const focusStore = useFocusStore()
const canvasTransform = useCanvasTransform()

const { originalImageSrc, mappedPixelData, gridDimensions, isProcessing, processingProgress } = storeToRefs(beadStore)
const { canvasZoom, canvasTranslate, isDragging, tooltipData, previewCanvas, canvasContainer } = storeToRefs(canvasStore)
const { isManualColoringMode, manualTool } = storeToRefs(editorStore)
const { activeMode } = storeToRefs(uiStore)

const previewOverlayCanvas = ref<HTMLCanvasElement | null>(null)

defineExpose({ previewOverlayCanvas })
const { currentColor, completedCells, recommendedCell, recommendedRegion, canvasScale, canvasOffset, gridSectionInterval, showSectionLines, sectionLineColor, availableColors, showCelebration, celebrationData } = storeToRefs(focusStore)

const visibleColumns = computed(() => {
  if (!gridDimensions.value || !canvasContainer.value) return []
  return calculateVisibleColumns(gridDimensions.value.N, canvasContainer.value.clientWidth, canvasTranslate.value.x, canvasZoom.value)
})

const visibleRows = computed(() => {
  if (!gridDimensions.value || !canvasContainer.value) return []
  return calculateVisibleRows(gridDimensions.value.M, canvasContainer.value.clientHeight, canvasTranslate.value.y, canvasZoom.value)
})

function handleCanvasWheel(e: WheelEvent) { canvasTransform.handleCanvasWheel(e) }
function handleCanvasDragStart(e: MouseEvent) {
  // 编辑模式下，仅 drag 工具允许拖动画布
  if (activeMode.value === 'edit' && manualTool.value !== 'drag') return
  canvasTransform.handleCanvasDragStart(e)
}
function handleCanvasDragMove(e: MouseEvent) { canvasTransform.handleCanvasDragMove(e) }
function handleCanvasDragEnd() { canvasTransform.handleCanvasDragEnd() }
function handleCanvasLeave() {
  canvasStore.clearTooltip()
  canvasTransform.handleCanvasDragEnd()
  // 画笔/橡皮需要在离开画布时停止绘画
  if (manualTool.value === 'brush' || manualTool.value === 'eraser') {
    emit('canvas-mouseup', new MouseEvent('mouseup'))
  }
  // line/rect/select/move 由 document 级别事件处理，不在此终止
}
function resetCanvasView() { canvasTransform.resetCanvasView() }
function handleCellClick(row: number, col: number) { focusStore.handleCellClick(row, col, mappedPixelData.value) }
</script>

<template>
  <div class="flex-1 min-h-0 px-2 sm:px-4 py-3 transition-[padding] duration-200 ease-out flex" :style="{ paddingRight: mappedPixelData ? '320px' : undefined }">
    <main class="relative flex flex-col flex-1 min-h-0 min-w-0">
      <!-- Welcome screen -->
      <div
        v-if="!originalImageSrc"
        @click="$emit('trigger-file-input')"
        @dragover.prevent
        @drop="$emit('file-drop', $event)"
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
            <div class="bg-black h-2 rounded-full transition-all duration-150" :style="{ width: `${Math.round((processingProgress.current / processingProgress.total) * 100)}%` }"></div>
          </div>
          <p v-if="processingProgress" class="text-xs text-black/35 mt-2">{{ processingProgress.current }} / {{ processingProgress.total }}</p>
        </div>
      </div>

      <!-- Canvas preview (optimize/edit/preview modes) -->
      <div v-else-if="activeMode !== 'focus'" class="flex-1 relative overflow-hidden bg-white">
        <div
          ref="canvasContainer"
          class="absolute inset-0"
          @wheel.prevent="handleCanvasWheel"
          @mousedown="handleCanvasDragStart"
          @mousemove="handleCanvasDragMove"
          @mouseup="handleCanvasDragEnd"
          @mouseleave="handleCanvasDragEnd"
        >
          <!-- Top row axis -->
          <div class="absolute top-0 left-0 right-0 bg-white border-b border-black/10 z-10 flex" :style="{ height: AXIS_HEIGHT + 'px' }">
            <div :style="{ width: AXIS_WIDTH + 'px' }" class="flex-shrink-0"></div>
            <div class="flex-1 relative overflow-hidden">
              <div class="absolute" :style="{ transform: `translateX(${canvasTranslate.x}px)`, width: `${(gridDimensions?.N || 0) * CELL_SIZE * canvasZoom}px`, height: '100%' }">
                <div v-for="col in visibleColumns" :key="'col-' + col" class="absolute text-[10px] text-black/50" :style="{ left: (col - 1) * CELL_SIZE * canvasZoom + 'px' }">{{ col }}</div>
              </div>
            </div>
          </div>

          <!-- Left column axis -->
          <div class="absolute top-0 left-0 bottom-0 bg-white border-r border-black/10 z-10" :style="{ width: AXIS_WIDTH + 'px', top: AXIS_HEIGHT + 'px' }">
            <div class="relative overflow-hidden h-full">
              <div class="absolute" :style="{ transform: `translateY(${canvasTranslate.y}px)`, width: '100%', height: `${(gridDimensions?.M || 0) * CELL_SIZE * canvasZoom}px` }">
                <div v-for="row in visibleRows" :key="'row-' + row" class="absolute text-[10px] text-black/50 text-right pr-1" :style="{ top: (row - 1) * CELL_SIZE * canvasZoom + 'px', width: AXIS_WIDTH + 'px' }">{{ row }}</div>
              </div>
            </div>
          </div>

          <!-- Canvas -->
          <div class="absolute overflow-hidden" :style="{ top: AXIS_HEIGHT + 'px', left: AXIS_WIDTH + 'px', right: 0, bottom: 0, backgroundColor: '#F0F0F0', backgroundImage: 'linear-gradient(45deg, #FFFFFF 25%, transparent 25%), linear-gradient(-45deg, #FFFFFF 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #FFFFFF 75%), linear-gradient(-45deg, transparent 75%, #FFFFFF 75%)', backgroundSize: '16px 16px', backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px' }">
            <canvas
              ref="previewCanvas"
              class="block"
              :style="{
                imageRendering: 'pixelated',
                transform: `translate(${canvasTranslate.x}px, ${canvasTranslate.y}px) scale(${canvasZoom})`,
                transformOrigin: '0 0',
                cursor: isDragging ? 'grabbing' : (
                  activeMode === 'edit' ? (
                    manualTool === 'picker' ? 'crosshair' :
                    manualTool === 'fill' ? 'cell' :
                    manualTool === 'select' ? 'crosshair' :
                    manualTool === 'move' ? 'move' :
                    manualTool === 'drag' ? 'grab' :
                    manualTool === 'eraser' ? 'cell' :
                    manualTool === 'line' ? 'crosshair' :
                    manualTool === 'rect' ? 'crosshair' :
                    'crosshair'
                  ) : 'grab'
                )
              }"
              @click="$emit('canvas-click', $event)"
              @mousedown="$emit('canvas-mousedown', $event)"
              @mousemove="$emit('canvas-hover', $event)"
              @mouseup="$emit('canvas-mouseup', $event)"
              @mouseleave="handleCanvasLeave"
            ></canvas>
            <!-- Brush preview overlay -->
            <canvas
              ref="previewOverlayCanvas"
              class="block pointer-events-none absolute top-0 left-0"
              :style="{
                imageRendering: 'pixelated',
                transform: `translate(${canvasTranslate.x}px, ${canvasTranslate.y}px) scale(${canvasZoom})`,
                transformOrigin: '0 0',
                width: previewCanvas ? previewCanvas.width + 'px' : '0',
                height: previewCanvas ? previewCanvas.height + 'px' : '0',
              }"
            ></canvas>
          </div>
        </div>

        <!-- Zoom controls -->
        <div class="absolute bottom-4 right-4 flex items-center gap-2 bg-white/90 backdrop-blur-sm rounded-lg px-3 py-1.5 shadow-sm border border-black/10 z-20">
          <button @click="canvasZoom = Math.max(MIN_ZOOM, canvasZoom - 0.1)" class="w-6 h-6 flex items-center justify-center text-black/60 hover:text-black transition-colors">−</button>
          <span class="text-xs text-black/80 min-w-[40px] text-center">{{ Math.round(canvasZoom * 100) }}%</span>
          <button @click="canvasZoom = Math.min(MAX_ZOOM, canvasZoom + 0.1)" class="w-6 h-6 flex items-center justify-center text-black/60 hover:text-black transition-colors">+</button>
          <button @click="resetCanvasView" class="text-xs text-black/45 hover:text-black transition-colors ml-1">重置</button>
        </div>

        <!-- Tooltip -->
        <div v-if="tooltipData" class="absolute pointer-events-none bg-black text-white text-xs rounded-lg px-3 py-2 shadow-lg z-30" :style="{ left: tooltipData.x + 'px', top: tooltipData.y + 'px' }">
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

        <!-- Focus mode overlays -->
        <div class="absolute inset-0 pointer-events-none z-10">
          <!-- Top toolbar -->
          <FocusToolBar
            @locate="focusStore.handleLocateRecommended(gridDimensions)"
            @toggle-settings="focusStore.showSettings = !focusStore.showSettings"
          />

          <!-- Bottom color ring picker -->
          <FocusColorRing
            :colors="availableColors"
            :current-color="currentColor"
            @color-select="focusStore.handleFocusColorChange"
          />
        </div>

        <!-- Celebration animation -->
        <CelebrationAnimation
          v-if="showCelebration && celebrationData"
          :color-name="celebrationData.colorName"
          :color-hex="celebrationData.colorHex"
          :completed="celebrationData.completed"
          :total="celebrationData.total"
          :total-completed="availableColors.reduce((sum, c) => sum + c.completed, 0)"
          :total-all="availableColors.reduce((sum, c) => sum + c.total, 0)"
          @close="focusStore.closeCelebration()"
        />
      </div>
    </main>
  </div>
</template>
