<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { getColorKeyByHex } from '../utils/colorSystemUtils'

const props = defineProps({
  isActive: { type: Boolean, default: false },
  mappedPixelData: { type: Array, default: null },
  gridDimensions: { type: Object, default: null },
  selectedColor: { type: Object, default: null },
  selectedColorSystem: { type: String, default: 'MARD' },
  onPixelEdit: { type: Function, default: () => {} },
  highlightColorKey: { type: String, default: null },
  previewCanvasRef: { type: Object, default: null },
})

const emit = defineEmits(['toggle', 'selectionComplete', 'clearSelection', 'activateFloating'])

// ===== 放大镜窗口状态 =====
const getInitialPosition = () => ({
  x: Math.max(50, (window.innerWidth - 400) / 2),
  y: Math.max(50, (window.innerHeight - 400) / 2),
})

const magnifierPosition = ref(getInitialPosition())
const isDragging = ref(false)
const dragOffset = ref({ x: 0, y: 0 })
const magnifierRef = ref(null)
const canvasRef = ref(null)
const isFloatingActive = ref(false)

// ===== 选区状态 =====
const selectionArea = ref(null)
const isSelecting = ref(false)
const selectionStart = ref(null)
const selectionEnd = ref(null)
const overlayRef = ref(null)

// 滚动禁用状态
const scrollDisabled = ref(false)
const savedScrollPosition = ref(0)

// ===== 放大镜窗口拖拽 =====
function handleTitleBarMouseDown(event) {
  const target = event.target
  if (target.tagName === 'BUTTON' || target.closest('button')) return
  if (magnifierRef.value) {
    const rect = magnifierRef.value.getBoundingClientRect()
    dragOffset.value = { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  isFloatingActive.value = true
  emit('activateFloating')
  isDragging.value = true
  document.body.style.overflow = 'hidden'
  event.preventDefault()
}

function handleTitleBarTouchStart(event) {
  const target = event.target
  if (target.tagName === 'BUTTON' || target.closest('button')) return
  const touch = event.touches[0]
  if (!touch) return
  if (magnifierRef.value) {
    const rect = magnifierRef.value.getBoundingClientRect()
    dragOffset.value = { x: touch.clientX - rect.left, y: touch.clientY - rect.top }
  }
  isFloatingActive.value = true
  emit('activateFloating')
  isDragging.value = true
  document.body.style.overflow = 'hidden'
  event.preventDefault()
}

function handleMouseMove(event) {
  if (isDragging.value) {
    event.preventDefault()
    event.stopPropagation()
    magnifierPosition.value = {
      x: event.clientX - dragOffset.value.x,
      y: event.clientY - dragOffset.value.y,
    }
  }
}

function handleMouseUp() {
  isDragging.value = false
  document.body.style.overflow = ''
}

function handleTouchMove(event) {
  if (isDragging.value) {
    event.preventDefault()
    event.stopPropagation()
    const touch = event.touches[0]
    if (!touch) return
    magnifierPosition.value = {
      x: touch.clientX - dragOffset.value.x,
      y: touch.clientY - dragOffset.value.y,
    }
  }
}

function handleTouchEnd() {
  isDragging.value = false
  document.body.style.overflow = ''
}

// 拖拽事件监听
watch(isDragging, (val) => {
  if (val) {
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleTouchEnd)
  } else {
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
    document.removeEventListener('touchmove', handleTouchMove)
    document.removeEventListener('touchend', handleTouchEnd)
  }
})

// 激活时重置位置
watch(() => props.isActive, (val) => {
  if (val) {
    magnifierPosition.value = getInitialPosition()
  }
})

// ===== 选区覆盖层 - 鼠标事件 =====
function preventScrolling(e) {
  e.preventDefault()
  e.stopPropagation()
}

function disableScroll() {
  if (scrollDisabled.value) return
  savedScrollPosition.value = window.scrollY
  document.body.style.overflow = 'hidden'
  document.documentElement.style.overflow = 'hidden'
  document.addEventListener('wheel', preventScrolling, { passive: false })
  document.addEventListener('touchmove', preventScrolling, { passive: false })
  scrollDisabled.value = true
}

function enableScroll() {
  if (!scrollDisabled.value) return
  document.body.style.overflow = ''
  document.documentElement.style.overflow = ''
  document.removeEventListener('wheel', preventScrolling)
  document.removeEventListener('touchmove', preventScrolling)
  scrollDisabled.value = false
}

function getCanvasCoordinates(clientX, clientY) {
  if (!props.previewCanvasRef) return null
  const canvas = props.previewCanvasRef
  const rect = canvas.getBoundingClientRect()
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height
  const x = (clientX - rect.left) * scaleX
  const y = (clientY - rect.top) * scaleY
  return {
    x: Math.max(0, Math.min(canvas.width, x)),
    y: Math.max(0, Math.min(canvas.height, y)),
  }
}

function pixelToGrid(x, y) {
  if (!props.gridDimensions || !props.previewCanvasRef) return null
  const canvasWidth = props.previewCanvasRef.width
  const canvasHeight = props.previewCanvasRef.height
  const cellWidth = canvasWidth / props.gridDimensions.N
  const cellHeight = canvasHeight / props.gridDimensions.M
  const col = Math.floor(x / cellWidth)
  const row = Math.floor(y / cellHeight)
  return {
    row: Math.max(0, Math.min(props.gridDimensions.M - 1, row)),
    col: Math.max(0, Math.min(props.gridDimensions.N - 1, col)),
  }
}

// 选区覆盖层鼠标/触摸事件
function handleOverlayMouseDown(event) {
  if (!props.isActive || selectionArea.value) return
  const coords = getCanvasCoordinates(event.clientX, event.clientY)
  if (!coords) return
  isSelecting.value = true
  selectionStart.value = coords
  selectionEnd.value = coords
  disableScroll()
  event.preventDefault()
}

function handleOverlayMouseMove(event) {
  if (!isSelecting.value || !selectionStart.value) return
  const coords = getCanvasCoordinates(event.clientX, event.clientY)
  if (!coords) return
  selectionEnd.value = coords
}

function handleOverlayMouseUp() {
  if (!isSelecting.value || !selectionStart.value || !selectionEnd.value) {
    enableScroll()
    return
  }
  const startGrid = pixelToGrid(selectionStart.value.x, selectionStart.value.y)
  const endGrid = pixelToGrid(selectionEnd.value.x, selectionEnd.value.y)
  if (startGrid && endGrid) {
    selectionArea.value = {
      startRow: Math.min(startGrid.row, endGrid.row),
      startCol: Math.min(startGrid.col, endGrid.col),
      endRow: Math.max(startGrid.row, endGrid.row),
      endCol: Math.max(startGrid.col, endGrid.col),
    }
    emit('selectionComplete', selectionArea.value)
  }
  isSelecting.value = false
  selectionStart.value = null
  selectionEnd.value = null
  enableScroll()
}

function handleOverlayTouchStart(event) {
  if (!props.isActive || selectionArea.value) return
  event.preventDefault()
  event.stopPropagation()
  const touch = event.touches[0]
  if (!touch) return
  const coords = getCanvasCoordinates(touch.clientX, touch.clientY)
  if (!coords) return
  isSelecting.value = true
  selectionStart.value = coords
  selectionEnd.value = coords
  disableScroll()
}

function handleOverlayTouchMove(event) {
  if (!isSelecting.value || !selectionStart.value) return
  event.preventDefault()
  event.stopPropagation()
  const touch = event.touches[0]
  if (!touch) return
  const coords = getCanvasCoordinates(touch.clientX, touch.clientY)
  if (!coords) return
  selectionEnd.value = coords
}

function handleOverlayTouchEnd() {
  handleOverlayMouseUp()
}

// 选区覆盖层事件监听
watch(isSelecting, (val) => {
  if (val) {
    document.addEventListener('mousemove', handleOverlayMouseMove)
    document.addEventListener('mouseup', handleOverlayMouseUp)
    document.addEventListener('touchmove', handleOverlayTouchMove)
    document.addEventListener('touchend', handleOverlayTouchEnd)
  } else {
    document.removeEventListener('mousemove', handleOverlayMouseMove)
    document.removeEventListener('mouseup', handleOverlayMouseUp)
    document.removeEventListener('touchmove', handleOverlayTouchMove)
    document.removeEventListener('touchend', handleOverlayTouchEnd)
    enableScroll()
  }
})

// 恢复滚动
watch(() => props.isActive, (val) => {
  if (!val) {
    enableScroll()
    isSelecting.value = false
    selectionStart.value = null
    selectionEnd.value = null
  }
})

onUnmounted(() => {
  enableScroll()
})

// 选择框样式
const selectionBoxStyle = computed(() => {
  if (!selectionStart.value || !selectionEnd.value || !props.previewCanvasRef) return {}
  const canvas = props.previewCanvasRef
  const rect = canvas.getBoundingClientRect()
  const scaleX = rect.width / canvas.width
  const scaleY = rect.height / canvas.height
  const screenStartX = selectionStart.value.x * scaleX
  const screenStartY = selectionStart.value.y * scaleY
  const screenEndX = selectionEnd.value.x * scaleX
  const screenEndY = selectionEnd.value.y * scaleY
  const minX = Math.min(screenStartX, screenEndX)
  const minY = Math.min(screenStartY, screenEndY)
  const maxX = Math.max(screenStartX, screenEndX)
  const maxY = Math.max(screenStartY, screenEndY)
  return {
    left: rect.left + minX + 'px',
    top: rect.top + minY + 'px',
    width: (maxX - minX) + 'px',
    height: (maxY - minY) + 'px',
    position: 'fixed',
    border: '2px solid #10b981',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    pointerEvents: 'none',
    zIndex: 1000,
  }
})

// ===== 放大视图渲染 =====
const selectionDimensions = computed(() => {
  if (!selectionArea.value) return { width: 0, height: 0 }
  return {
    width: Math.abs(selectionArea.value.endCol - selectionArea.value.startCol) + 1,
    height: Math.abs(selectionArea.value.endRow - selectionArea.value.startRow) + 1,
  }
})

function renderMagnifiedView() {
  if (!selectionArea.value || !props.mappedPixelData || !canvasRef.value) return
  const canvas = canvasRef.value
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { width, height } = selectionDimensions.value
  const magnifiedCellSize = 20
  canvas.width = width * magnifiedCellSize
  canvas.height = height * magnifiedCellSize
  canvas.style.width = canvas.width + 'px'
  canvas.style.height = canvas.height + 'px'
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const startRow = Math.min(selectionArea.value.startRow, selectionArea.value.endRow)
  const endRow = Math.max(selectionArea.value.startRow, selectionArea.value.endRow)
  const startCol = Math.min(selectionArea.value.startCol, selectionArea.value.endCol)
  const endCol = Math.max(selectionArea.value.startCol, selectionArea.value.endCol)

  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      if (row >= 0 && row < props.mappedPixelData.length && col >= 0 && col < props.mappedPixelData[0].length) {
        const pixel = props.mappedPixelData[row][col]
        const canvasRow = row - startRow
        const canvasCol = col - startCol

        ctx.fillStyle = pixel.color
        ctx.fillRect(canvasCol * magnifiedCellSize, canvasRow * magnifiedCellSize, magnifiedCellSize, magnifiedCellSize)

        if (props.highlightColorKey && pixel.color.toUpperCase() !== props.highlightColorKey.toUpperCase()) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
          ctx.fillRect(canvasCol * magnifiedCellSize, canvasRow * magnifiedCellSize, magnifiedCellSize, magnifiedCellSize)
        }

        ctx.strokeStyle = '#e0e0e0'
        ctx.lineWidth = 1
        ctx.strokeRect(canvasCol * magnifiedCellSize, canvasRow * magnifiedCellSize, magnifiedCellSize, magnifiedCellSize)
      }
    }
  }
}

function handleMagnifiedClick(event) {
  if (!selectionArea.value || !props.mappedPixelData || !props.selectedColor || !canvasRef.value) return
  const canvas = canvasRef.value
  const rect = canvas.getBoundingClientRect()
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height
  const x = (event.clientX - rect.left) * scaleX
  const y = (event.clientY - rect.top) * scaleY
  const magnifiedCellSize = 20
  const clickedCol = Math.floor(x / magnifiedCellSize)
  const clickedRow = Math.floor(y / magnifiedCellSize)
  const startRow = Math.min(selectionArea.value.startRow, selectionArea.value.endRow)
  const startCol = Math.min(selectionArea.value.startCol, selectionArea.value.endCol)
  const actualRow = startRow + clickedRow
  const actualCol = startCol + clickedCol
  if (actualRow >= 0 && actualRow < props.mappedPixelData.length && actualCol >= 0 && actualCol < props.mappedPixelData[0].length) {
    props.onPixelEdit(actualRow, actualCol, props.selectedColor)
    renderMagnifiedView()
  }
}

function handleClearSelection() {
  selectionArea.value = null
  emit('clearSelection')
}

function handleToggle() {
  emit('toggle')
}

function handleActivateFloating() {
  isFloatingActive.value = true
  emit('activateFloating')
}

// 渲染放大视图
watch([selectionArea, () => props.mappedPixelData, () => props.highlightColorKey], () => {
  nextTick(() => renderMagnifiedView())
})
</script>

<template>
  <!-- 选区覆盖层 -->
  <div
    v-if="isActive && !selectionArea"
    ref="overlayRef"
    class="fixed inset-0 z-50"
    style="cursor: crosshair; pointer-events: auto"
    @mousedown="handleOverlayMouseDown"
    @touchstart="handleOverlayTouchStart"
    @wheel.prevent
    @touchmove.prevent
    @scroll.prevent
  />

  <!-- 选择框 -->
  <div v-if="isSelecting && selectionStart && selectionEnd" :style="selectionBoxStyle" />

  <!-- 选区提示 -->
  <div v-if="isActive && !selectionArea" class="fixed top-4 left-1/2 transform -translate-x-1/2 bg-blue-500 text-white px-4 py-2 rounded-lg shadow-lg z-[70]">
    <div class="flex items-center gap-2">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <span>在画布上拖拽选择要放大的区域</span>
    </div>
  </div>

  <!-- 放大视图窗口 -->
  <Teleport to="body">
    <div
      v-if="isActive && selectionArea"
      ref="magnifierRef"
      class="fixed bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-600 select-none"
      :class="isFloatingActive ? 'z-[60]' : 'z-[50]'"
      :style="{ left: magnifierPosition.x + 'px', top: magnifierPosition.y + 'px' }"
      @click="handleActivateFloating"
    >
      <!-- 标题栏 -->
      <div
        class="flex items-center justify-between p-3 bg-gradient-to-r from-green-500 to-teal-500 text-white rounded-t-xl cursor-move"
        @mousedown="handleTitleBarMouseDown"
        @touchstart="handleTitleBarTouchStart"
      >
        <div class="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span class="text-sm font-medium">放大镜 ({{ selectionDimensions.width }}×{{ selectionDimensions.height }})</span>
        </div>
        <div class="flex items-center gap-2">
          <button
            @click.stop="handleClearSelection"
            class="p-1 hover:bg-white/20 rounded transition-colors"
            title="重新选择区域"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button
            @click.stop="handleToggle"
            class="p-1 hover:bg-white/20 rounded transition-colors"
            title="关闭放大镜"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <!-- 放大视图内容 -->
      <div class="p-3">
        <div class="border border-gray-300 dark:border-gray-600 rounded-lg overflow-auto max-h-96">
          <canvas
            ref="canvasRef"
            class="cursor-crosshair block"
            @click="handleMagnifiedClick"
          />
        </div>

        <!-- 当前选中颜色信息 -->
        <div v-if="selectedColor" class="mt-2 p-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
          <div class="flex items-center gap-2 text-xs">
            <div
              class="w-4 h-4 rounded border border-gray-300 dark:border-gray-500"
              :style="{ backgroundColor: selectedColor.color }"
            ></div>
            <span class="text-gray-700 dark:text-gray-300">
              当前: {{ getColorKeyByHex(selectedColor.color, selectedColorSystem) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
