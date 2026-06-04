<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps<{
  imageSrc: string
}>()

const emit = defineEmits<{
  confirm: [canvas: HTMLCanvasElement]
  skip: []
}>()

// Canvas refs
const containerRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)

// Image
const img = ref<HTMLImageElement | null>(null)
const imgLoaded = ref(false)

// Display dimensions (scaled to fit container)
const displayWidth = ref(0)
const displayHeight = ref(0)
const scale = ref(1)

// Crop rect in display coordinates
const crop = ref({ x: 0, y: 0, width: 0, height: 0 })

// Drag state
type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w' | null
const dragMode = ref<DragMode>(null)
const dragStart = ref({ x: 0, y: 0 })
const cropStart = ref({ x: 0, y: 0, width: 0, height: 0 })

const HANDLE_SIZE = 12
const MIN_CROP_SIZE = 20

// Load image
onMounted(() => {
  const image = new Image()
  image.onload = () => {
    img.value = image
    imgLoaded.value = true
    fitImageToContainer()
    initCrop()
    render()
  }
  image.src = props.imageSrc
})

onUnmounted(() => {
  // Cleanup
})

function fitImageToContainer() {
  if (!img.value || !containerRef.value) return
  const container = containerRef.value
  const maxW = container.clientWidth - 32
  const maxH = container.clientHeight - 32
  const imgW = img.value.width
  const imgH = img.value.height

  const scaleX = maxW / imgW
  const scaleY = maxH / imgH
  scale.value = Math.min(scaleX, scaleY, 1)
  displayWidth.value = Math.round(imgW * scale.value)
  displayHeight.value = Math.round(imgH * scale.value)
}

function initCrop() {
  // Default crop: 80% of image, centered
  const margin = 0.1
  crop.value = {
    x: displayWidth.value * margin,
    y: displayHeight.value * margin,
    width: displayWidth.value * (1 - 2 * margin),
    height: displayHeight.value * (1 - 2 * margin),
  }
}

// Convert display coords to image coords
function displayToImage(rect: { x: number; y: number; width: number; height: number }) {
  const s = scale.value
  return {
    x: Math.round(rect.x / s),
    y: Math.round(rect.y / s),
    width: Math.round(rect.width / s),
    height: Math.round(rect.height / s),
  }
}

// Render
function render() {
  const canvas = canvasRef.value
  if (!canvas || !img.value) return

  canvas.width = displayWidth.value
  canvas.height = displayHeight.value
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // Draw image
  ctx.drawImage(img.value, 0, 0, displayWidth.value, displayHeight.value)

  // Dark overlay outside crop
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
  // Top
  ctx.fillRect(0, 0, displayWidth.value, crop.value.y)
  // Bottom
  ctx.fillRect(0, crop.value.y + crop.value.height, displayWidth.value, displayHeight.value - crop.value.y - crop.value.height)
  // Left
  ctx.fillRect(0, crop.value.y, crop.value.x, crop.value.height)
  // Right
  ctx.fillRect(crop.value.x + crop.value.width, crop.value.y, displayWidth.value - crop.value.x - crop.value.width, crop.value.height)

  // Crop border
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.strokeRect(crop.value.x, crop.value.y, crop.value.width, crop.value.height)

  // Corner handles
  const hs = HANDLE_SIZE
  ctx.fillStyle = '#ffffff'
  // NW
  ctx.fillRect(crop.value.x - hs / 2, crop.value.y - hs / 2, hs, hs)
  // NE
  ctx.fillRect(crop.value.x + crop.value.width - hs / 2, crop.value.y - hs / 2, hs, hs)
  // SW
  ctx.fillRect(crop.value.x - hs / 2, crop.value.y + crop.value.height - hs / 2, hs, hs)
  // SE
  ctx.fillRect(crop.value.x + crop.value.width - hs / 2, crop.value.y + crop.value.height - hs / 2, hs, hs)

  // Edge handles (centered on each edge)
  const ehs = 8
  // N
  ctx.fillRect(crop.value.x + crop.value.width / 2 - ehs, crop.value.y - ehs / 2, ehs * 2, ehs)
  // S
  ctx.fillRect(crop.value.x + crop.value.width / 2 - ehs, crop.value.y + crop.value.height - ehs / 2, ehs * 2, ehs)
  // W
  ctx.fillRect(crop.value.x - ehs / 2, crop.value.y + crop.value.height / 2 - ehs, ehs, ehs * 2)
  // E
  ctx.fillRect(crop.value.x + crop.value.width - ehs / 2, crop.value.y + crop.value.height / 2 - ehs, ehs, ehs * 2)

  // Grid lines (rule of thirds)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
  ctx.lineWidth = 0.5
  const thirdW = crop.value.width / 3
  const thirdH = crop.value.height / 3
  for (let i = 1; i <= 2; i++) {
    // Vertical
    ctx.beginPath()
    ctx.moveTo(crop.value.x + thirdW * i, crop.value.y)
    ctx.lineTo(crop.value.x + thirdW * i, crop.value.y + crop.value.height)
    ctx.stroke()
    // Horizontal
    ctx.beginPath()
    ctx.moveTo(crop.value.x, crop.value.y + thirdH * i)
    ctx.lineTo(crop.value.x + crop.value.width, crop.value.y + thirdH * i)
    ctx.stroke()
  }
}

// Hit test for drag mode
function getHitMode(x: number, y: number): DragMode {
  const c = crop.value
  const hs = HANDLE_SIZE

  // Check corners first
  if (Math.abs(x - c.x) < hs && Math.abs(y - c.y) < hs) return 'nw'
  if (Math.abs(x - (c.x + c.width)) < hs && Math.abs(y - c.y) < hs) return 'ne'
  if (Math.abs(x - c.x) < hs && Math.abs(y - (c.y + c.height)) < hs) return 'sw'
  if (Math.abs(x - (c.x + c.width)) < hs && Math.abs(y - (c.y + c.height)) < hs) return 'se'

  // Check edges
  if (Math.abs(y - c.y) < hs && x > c.x && x < c.x + c.width) return 'n'
  if (Math.abs(y - (c.y + c.height)) < hs && x > c.x && x < c.x + c.width) return 's'
  if (Math.abs(x - c.x) < hs && y > c.y && y < c.y + c.height) return 'w'
  if (Math.abs(x - (c.x + c.width)) < hs && y > c.y && y < c.y + c.height) return 'e'

  // Check inside crop (move)
  if (x > c.x && x < c.x + c.width && y > c.y && y < c.y + c.height) return 'move'

  return null
}

// Get cursor for drag mode
function getCursor(mode: DragMode): string {
  switch (mode) {
    case 'nw': case 'se': return 'nwse-resize'
    case 'ne': case 'sw': return 'nesw-resize'
    case 'n': case 's': return 'ns-resize'
    case 'e': case 'w': return 'ew-resize'
    case 'move': return 'move'
    default: return 'crosshair'
  }
}

// Mouse/touch handlers
function getCanvasCoords(e: MouseEvent | Touch): { x: number; y: number } {
  const canvas = canvasRef.value!
  const rect = canvas.getBoundingClientRect()
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height),
  }
}

function onPointerDown(e: MouseEvent | TouchEvent) {
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
  const canvas = canvasRef.value!
  const rect = canvas.getBoundingClientRect()
  const x = (clientX - rect.left) * (canvas.width / rect.width)
  const y = (clientY - rect.top) * (canvas.height / rect.height)

  const mode = getHitMode(x, y)
  if (!mode) return

  dragMode.value = mode
  dragStart.value = { x: clientX, y: clientY }
  cropStart.value = { ...crop.value }

  if ('touches' in e) e.preventDefault()
}

function onPointerMove(e: MouseEvent | TouchEvent) {
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY

  // Update cursor on hover
  if (!dragMode.value) {
    const canvas = canvasRef.value!
    const rect = canvas.getBoundingClientRect()
    const x = (clientX - rect.left) * (canvas.width / rect.width)
    const y = (clientY - rect.top) * (canvas.height / rect.height)
    const mode = getHitMode(x, y)
    canvas.style.cursor = getCursor(mode)
    return
  }

  const canvas = canvasRef.value!
  const dx = (clientX - dragStart.value.x) * (canvas.width / canvas.getBoundingClientRect().width)
  const dy = (clientY - dragStart.value.y) * (canvas.height / canvas.getBoundingClientRect().height)
  const c = cropStart.value
  const maxW = displayWidth.value
  const maxH = displayHeight.value

  let newX = c.x
  let newY = c.y
  let newW = c.width
  let newH = c.height

  switch (dragMode.value) {
    case 'move':
      newX = Math.max(0, Math.min(maxW - c.width, c.x + dx))
      newY = Math.max(0, Math.min(maxH - c.height, c.y + dy))
      break
    case 'nw':
      newX = Math.max(0, Math.min(c.x + c.width - MIN_CROP_SIZE, c.x + dx))
      newY = Math.max(0, Math.min(c.y + c.height - MIN_CROP_SIZE, c.y + dy))
      newW = c.x + c.width - newX
      newH = c.y + c.height - newY
      break
    case 'ne':
      newY = Math.max(0, Math.min(c.y + c.height - MIN_CROP_SIZE, c.y + dy))
      newW = Math.max(MIN_CROP_SIZE, Math.min(maxW - c.x, c.width + dx))
      newH = c.y + c.height - newY
      break
    case 'sw':
      newX = Math.max(0, Math.min(c.x + c.width - MIN_CROP_SIZE, c.x + dx))
      newW = c.x + c.width - newX
      newH = Math.max(MIN_CROP_SIZE, Math.min(maxH - c.y, c.height + dy))
      break
    case 'se':
      newW = Math.max(MIN_CROP_SIZE, Math.min(maxW - c.x, c.width + dx))
      newH = Math.max(MIN_CROP_SIZE, Math.min(maxH - c.y, c.height + dy))
      break
    case 'n':
      newY = Math.max(0, Math.min(c.y + c.height - MIN_CROP_SIZE, c.y + dy))
      newH = c.y + c.height - newY
      break
    case 's':
      newH = Math.max(MIN_CROP_SIZE, Math.min(maxH - c.y, c.height + dy))
      break
    case 'w':
      newX = Math.max(0, Math.min(c.x + c.width - MIN_CROP_SIZE, c.x + dx))
      newW = c.x + c.width - newX
      break
    case 'e':
      newW = Math.max(MIN_CROP_SIZE, Math.min(maxW - c.x, c.width + dx))
      break
  }

  crop.value = { x: newX, y: newY, width: newW, height: newH }
  render()

  if ('touches' in e) e.preventDefault()
}

function onPointerUp() {
  dragMode.value = null
}

// Confirm crop
function handleConfirm() {
  if (!img.value) return

  const imgRect = displayToImage(crop.value)
  const resultCanvas = document.createElement('canvas')
  resultCanvas.width = imgRect.width
  resultCanvas.height = imgRect.height
  const ctx = resultCanvas.getContext('2d')!
  ctx.drawImage(
    img.value,
    imgRect.x, imgRect.y, imgRect.width, imgRect.height,
    0, 0, imgRect.width, imgRect.height
  )

  emit('confirm', resultCanvas)
}

// Skip crop (use original)
function handleSkip() {
  emit('skip')
}

// Window resize
function onResize() {
  fitImageToContainer()
  initCrop()
  render()
}

onMounted(() => {
  window.addEventListener('resize', onResize)
})
onUnmounted(() => {
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <div class="fixed inset-0 bg-gray-900 z-50 flex flex-col">
    <!-- Header -->
    <div class="bg-gray-800 px-4 py-3 flex items-center justify-between">
      <h2 class="text-white text-sm font-medium">裁剪图片</h2>
      <div class="flex items-center gap-2">
        <button
          @click="handleSkip"
          class="px-4 py-1.5 text-sm text-gray-300 hover:text-white transition-colors"
        >
          使用原图
        </button>
        <button
          @click="handleConfirm"
          class="px-4 py-1.5 text-sm bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors"
        >
          确认裁剪
        </button>
      </div>
    </div>

    <!-- Canvas area -->
    <div ref="containerRef" class="flex-1 flex items-center justify-center overflow-hidden p-4">
      <canvas
        ref="canvasRef"
        class="block"
        :style="{ cursor: 'crosshair' }"
        @mousedown="onPointerDown"
        @mousemove="onPointerMove"
        @mouseup="onPointerUp"
        @mouseleave="onPointerUp"
        @touchstart.passive="onPointerDown"
        @touchmove="onPointerMove"
        @touchend="onPointerUp"
      />
    </div>

    <!-- Info bar -->
    <div class="bg-gray-800 px-4 py-2 text-xs text-gray-400 text-center">
      拖拽裁剪框调整位置和大小 · 两侧可调整边缘 · 四角可调整大小
    </div>
  </div>
</template>
