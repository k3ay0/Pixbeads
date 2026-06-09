<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useBeadStore } from '../stores/beadStore'
import {
  drawIroningPreview,
  downloadIroningPreview,
  DEFAULT_IRONING_CONFIG,
  type IroningPreviewConfig,
} from '../utils/ironingPreview'

const props = defineProps<{
  config: IroningPreviewConfig
}>()

const beadStore = useBeadStore()
const { mappedPixelData, gridDimensions } = storeToRefs(beadStore)

// Canvas refs
const canvasRef = ref<HTMLCanvasElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)

// Zoom and pan state
const zoom = ref(1)
const translate = ref({ x: 0, y: 0 })
const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })
const dragStartTranslate = ref({ x: 0, y: 0 })

// Canvas size (fixed, independent of grid)
const CANVAS_WIDTH = 800
const CANVAS_HEIGHT = 600

// Debounced render
let renderTimeout: ReturnType<typeof setTimeout> | null = null
const isRendering = ref(false)

/** Schedule a debounced render */
function scheduleRender() {
  if (renderTimeout) clearTimeout(renderTimeout)
  renderTimeout = setTimeout(() => {
    renderPreview()
  }, 50)
}

/** Render the ironing preview */
function renderPreview() {
  const canvas = canvasRef.value
  if (!canvas || !mappedPixelData.value || !gridDimensions.value) return

  isRendering.value = true

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    isRendering.value = false
    return
  }

  // Set canvas size with devicePixelRatio for sharp rendering
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = CANVAS_WIDTH * dpr
  canvas.height = CANVAS_HEIGHT * dpr
  ctx.scale(dpr, dpr)

  // Draw the preview
  drawIroningPreview(
    ctx,
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
    mappedPixelData.value,
    gridDimensions.value,
    props.config
  )

  isRendering.value = false
}

/** Download the preview image */
function download() {
  const canvas = canvasRef.value
  if (!canvas) return
  downloadIroningPreview(canvas)
}

/** Reset zoom and pan */
function resetView() {
  zoom.value = 1
  translate.value = { x: 0, y: 0 }
}

/** Handle mouse wheel for zoom */
function handleWheel(e: WheelEvent) {
  e.preventDefault()
  const delta = e.deltaY > 0 ? -0.1 : 0.1
  zoom.value = Math.max(0.1, Math.min(5, zoom.value + delta))
}

/** Start dragging */
function handleDragStart(e: MouseEvent) {
  if (e.button !== 0) return
  isDragging.value = true
  dragStart.value = { x: e.clientX, y: e.clientY }
  dragStartTranslate.value = { ...translate.value }
}

/** Handle drag move */
function handleDragMove(e: MouseEvent) {
  if (!isDragging.value) return
  translate.value = {
    x: dragStartTranslate.value.x + (e.clientX - dragStart.value.x),
    y: dragStartTranslate.value.y + (e.clientY - dragStart.value.y),
  }
}

/** End dragging */
function handleDragEnd() {
  isDragging.value = false
}

// Watch for config and data changes
watch(
  () => props.config,
  () => scheduleRender(),
  { deep: true }
)

watch(
  [mappedPixelData, gridDimensions],
  () => scheduleRender(),
  { flush: 'post' }
)

// Initial render
onMounted(() => {
  nextTick(() => scheduleRender())
})

// Cleanup
onUnmounted(() => {
  if (renderTimeout) clearTimeout(renderTimeout)
})

// Expose download method
defineExpose({ download })
</script>

<template>
  <div
    ref="containerRef"
    class="relative flex-1 overflow-hidden"
    style="background-color: #F0F0F0; background-image: linear-gradient(45deg, #FFFFFF 25%, transparent 25%), linear-gradient(-45deg, #FFFFFF 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #FFFFFF 75%), linear-gradient(-45deg, transparent 75%, #FFFFFF 75%); background-size: 16px 16px; background-position: 0 0, 0 8px, 8px -8px, -8px 0px;"
    @wheel.prevent="handleWheel"
    @mousedown="handleDragStart"
    @mousemove="handleDragMove"
    @mouseup="handleDragEnd"
    @mouseleave="handleDragEnd"
  >
    <!-- Canvas -->
    <canvas
      ref="canvasRef"
      class="block"
      :style="{
        imageRendering: 'pixelated',
        transform: `translate(${translate.x}px, ${translate.y}px) scale(${zoom})`,
        transformOrigin: '0 0',
        cursor: isDragging ? 'grabbing' : 'grab',
        width: CANVAS_WIDTH + 'px',
        height: CANVAS_HEIGHT + 'px',
      }"
    />

    <!-- Loading indicator -->
    <div
      v-if="isRendering"
      class="absolute inset-0 flex items-center justify-center bg-black/10"
    >
      <div class="bg-white/90 rounded-lg px-4 py-2 text-sm text-gray-600">
        渲染中...
      </div>
    </div>

    <!-- Zoom controls -->
    <div class="absolute bottom-4 right-4 flex items-center gap-2 bg-white/90 backdrop-blur-sm rounded-lg px-3 py-1.5 shadow-sm border border-black/10 z-20">
      <button
        class="w-6 h-6 flex items-center justify-center text-black/60 hover:text-black transition-colors"
        @click="zoom = Math.max(0.1, zoom - 0.1)"
      >
        −
      </button>
      <span class="text-xs text-black/80 min-w-[40px] text-center">
        {{ Math.round(zoom * 100) }}%
      </span>
      <button
        class="w-6 h-6 flex items-center justify-center text-black/60 hover:text-black transition-colors"
        @click="zoom = Math.min(5, zoom + 0.1)"
      >
        +
      </button>
      <button
        class="text-xs text-black/45 hover:text-black transition-colors ml-1"
        @click="resetView"
      >
        重置
      </button>
    </div>
  </div>
</template>
