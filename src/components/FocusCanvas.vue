<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  mappedPixelData: { type: Array, required: true },
  gridDimensions: { type: Object, required: true },
  currentColor: { type: String, default: '' },
  completedCells: { type: Object, default: () => new Set() },
  recommendedCell: { type: Object, default: null },
  recommendedRegion: { type: Array, default: null },
  canvasScale: { type: Number, default: 1 },
  canvasOffset: { type: Object, default: () => ({ x: 0, y: 0 }) },
  gridSectionInterval: { type: Number, default: 10 },
  showSectionLines: { type: Boolean, default: true },
  sectionLineColor: { type: String, default: '#007acc' },
})

const emit = defineEmits(['cellClick', 'scaleChange', 'offsetChange'])

const canvasRef = ref(null)
const containerRef = ref(null)
const isDragging = ref(false)
const lastPanPoint = ref(null)
const lastPinchDistance = ref(null)
const hasDragged = ref(false)

// 计算格子大小
const cellSize = computed(() => {
  return Math.max(15, Math.min(40, 300 / Math.max(props.gridDimensions.N, props.gridDimensions.M)))
})

// 预计算推荐区域的 Set，用于快速查找
const recommendedRegionSet = computed(() => {
  const set = new Set()
  if (props.recommendedRegion) {
    props.recommendedRegion.forEach(({ row, col }) => {
      set.add(`${row},${col}`)
    })
  }
  return set
})

// ========== 渲染画布 ==========
function renderCanvas() {
  const canvas = canvasRef.value
  if (!canvas || !props.mappedPixelData) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const { N, M } = props.gridDimensions
  const cs = cellSize.value
  const canvasWidth = N * cs
  const canvasHeight = M * cs

  canvas.width = canvasWidth
  canvas.height = canvasHeight
  canvas.style.width = `${canvasWidth}px`
  canvas.style.height = `${canvasHeight}px`

  ctx.clearRect(0, 0, canvasWidth, canvasHeight)

  // 渲染每个格子
  for (let row = 0; row < M; row++) {
    for (let col = 0; col < N; col++) {
      const pixel = props.mappedPixelData[row]?.[col]
      if (!pixel) continue

      const x = col * cs
      const y = row * cs
      const cellKey = `${row},${col}`

      // 确定格子颜色
      let fillColor = pixel.color

      // 如果不是当前颜色，显示为灰度
      if (pixel.color !== props.currentColor) {
        const hex = pixel.color.replace('#', '')
        const r = parseInt(hex.substring(0, 2), 16)
        const g = parseInt(hex.substring(2, 4), 16)
        const b = parseInt(hex.substring(4, 6), 16)
        const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
        fillColor = `rgb(${gray}, ${gray}, ${gray})`
      }

      // 绘制格子背景
      ctx.fillStyle = fillColor
      ctx.fillRect(x, y, cs, cs)

      // 如果是已完成的格子且是当前颜色，添加勾选标记
      if (props.completedCells.has(cellKey) && pixel.color === props.currentColor) {
        ctx.fillStyle = 'rgba(0, 255, 0, 0.6)'
        ctx.fillRect(x, y, cs, cs)

        // 绘制勾选图标
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(x + cs * 0.2, y + cs * 0.5)
        ctx.lineTo(x + cs * 0.4, y + cs * 0.7)
        ctx.lineTo(x + cs * 0.8, y + cs * 0.3)
        ctx.stroke()
      }

      // 如果是推荐区域的一部分，添加高亮边框
      if (recommendedRegionSet.value.has(cellKey)) {
        ctx.strokeStyle = '#ff4444'
        ctx.lineWidth = 3
        ctx.setLineDash([5, 5])
        ctx.strokeRect(x + 1, y + 1, cs - 2, cs - 2)
        ctx.setLineDash([])
      }

      // 如果是推荐区域的中心点，添加特殊标记
      if (
        props.recommendedCell &&
        props.recommendedCell.row === row &&
        props.recommendedCell.col === col &&
        recommendedRegionSet.value.has(cellKey)
      ) {
        ctx.fillStyle = '#ff4444'
        ctx.beginPath()
        ctx.arc(x + cs / 2, y + cs / 2, 4, 0, 2 * Math.PI)
        ctx.fill()
      }
    }
  }

  // 绘制分区线
  if (props.showSectionLines) {
    ctx.strokeStyle = props.sectionLineColor
    ctx.lineWidth = 2

    for (let col = props.gridSectionInterval; col < N; col += props.gridSectionInterval) {
      const x = col * cs
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, canvasHeight)
      ctx.stroke()
    }

    for (let row = props.gridSectionInterval; row < M; row += props.gridSectionInterval) {
      const y = row * cs
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(canvasWidth, y)
      ctx.stroke()
    }
  }
}

// 监听数据变化并重新渲染
watch(
  [
    () => props.mappedPixelData,
    () => props.gridDimensions,
    () => props.currentColor,
    () => props.completedCells,
    () => props.recommendedCell,
    () => props.recommendedRegion,
    () => props.gridSectionInterval,
    () => props.showSectionLines,
    () => props.sectionLineColor,
  ],
  () => {
    renderCanvas()
  },
  { deep: true }
)

onMounted(() => {
  renderCanvas()
})

// ========== 事件处理 ==========
function getEventPosition(event) {
  const canvas = canvasRef.value
  if (!canvas) return null

  const rect = canvas.getBoundingClientRect()
  let clientX, clientY

  if (event.touches && event.touches.length > 0) {
    clientX = event.touches[0].clientX
    clientY = event.touches[0].clientY
  } else {
    clientX = event.clientX
    clientY = event.clientY
  }

  return {
    x: (clientX - rect.left) / props.canvasScale,
    y: (clientY - rect.top) / props.canvasScale,
  }
}

function getGridPosition(x, y) {
  const cs = cellSize.value
  const col = Math.floor(x / cs)
  const row = Math.floor(y / cs)

  if (row >= 0 && row < props.gridDimensions.M && col >= 0 && col < props.gridDimensions.N) {
    return { row, col }
  }
  return null
}

function handleClick(event) {
  if (hasDragged.value) return

  const pos = getEventPosition(event)
  if (!pos) return

  const gridPos = getGridPosition(pos.x, pos.y)
  if (gridPos) {
    emit('cellClick', gridPos.row, gridPos.col)
  }
}

function handleWheel(event) {
  event.preventDefault()
  const delta = event.deltaY > 0 ? 0.9 : 1.1
  const newScale = Math.max(0.3, Math.min(3, props.canvasScale * delta))
  emit('scaleChange', newScale)
}

function getTouchDistance(touches) {
  if (touches.length < 2) return 0
  const dx = touches[0].clientX - touches[1].clientX
  const dy = touches[0].clientY - touches[1].clientY
  return Math.sqrt(dx * dx + dy * dy)
}

function handleTouchStart(event) {
  hasDragged.value = false

  if (event.touches.length === 1) {
    isDragging.value = true
    lastPanPoint.value = {
      x: event.touches[0].clientX,
      y: event.touches[0].clientY,
    }
    lastPinchDistance.value = null
  } else if (event.touches.length === 2) {
    event.preventDefault()
    isDragging.value = false
    lastPanPoint.value = null
    lastPinchDistance.value = getTouchDistance(event.touches)
  }
}

function handleTouchMove(event) {
  event.preventDefault()

  if (event.touches.length === 1 && isDragging.value && lastPanPoint.value) {
    hasDragged.value = true
    const deltaX = event.touches[0].clientX - lastPanPoint.value.x
    const deltaY = event.touches[0].clientY - lastPanPoint.value.y

    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      hasDragged.value = true
    }

    emit('offsetChange', {
      x: props.canvasOffset.x + deltaX,
      y: props.canvasOffset.y + deltaY,
    })

    lastPanPoint.value = {
      x: event.touches[0].clientX,
      y: event.touches[0].clientY,
    }
  } else if (event.touches.length === 2 && lastPinchDistance.value !== null) {
    hasDragged.value = true
    const currentDistance = getTouchDistance(event.touches)
    const scaleRatio = currentDistance / lastPinchDistance.value

    const newScale = Math.max(0.3, Math.min(3, props.canvasScale * scaleRatio))
    emit('scaleChange', newScale)

    lastPinchDistance.value = currentDistance
  }
}

function handleTouchEnd(event) {
  if (event.touches.length === 0) {
    isDragging.value = false
    lastPanPoint.value = null
    lastPinchDistance.value = null

    // 延迟重置 hasDragged，以便 handleClick 能判断
    if (!hasDragged.value) {
      handleClick(event)
    }
    setTimeout(() => {
      hasDragged.value = false
    }, 100)
  } else if (event.touches.length === 1) {
    lastPinchDistance.value = null
    isDragging.value = true
    lastPanPoint.value = {
      x: event.touches[0].clientX,
      y: event.touches[0].clientY,
    }
  }
}

// 鼠标拖拽
function handleMouseDown(event) {
  isDragging.value = true
  hasDragged.value = false
  lastPanPoint.value = {
    x: event.clientX,
    y: event.clientY,
  }
}

function handleMouseMove(event) {
  if (isDragging.value && lastPanPoint.value) {
    const deltaX = event.clientX - lastPanPoint.value.x
    const deltaY = event.clientY - lastPanPoint.value.y

    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      hasDragged.value = true
    }

    emit('offsetChange', {
      x: props.canvasOffset.x + deltaX,
      y: props.canvasOffset.y + deltaY,
    })

    lastPanPoint.value = {
      x: event.clientX,
      y: event.clientY,
    }
  }
}

function handleMouseUp() {
  isDragging.value = false
  lastPanPoint.value = null
}

// 阻止触摸默认行为
function preventDefaultTouch(event) {
  event.preventDefault()
}
</script>

<template>
  <div
    ref="containerRef"
    class="w-full h-full flex items-center justify-center overflow-hidden bg-gray-100"
    style="touch-action: none"
  >
    <div
      :style="{
        transform: `scale(${canvasScale}) translate(${canvasOffset.x}px, ${canvasOffset.y}px)`,
        transformOrigin: 'center center',
      }"
    >
      <canvas
        ref="canvasRef"
        class="cursor-crosshair border border-gray-300"
        @click="handleClick"
        @wheel="handleWheel"
        @touchstart="handleTouchStart"
        @touchmove.prevent="handleTouchMove"
        @touchend="handleTouchEnd"
        @mousedown="handleMouseDown"
        @mousemove="handleMouseMove"
        @mouseup="handleMouseUp"
        @mouseleave="handleMouseUp"
      />
    </div>
  </div>
</template>
