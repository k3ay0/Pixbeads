<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import type { MappedPixel, GridDimensions } from '../types'
import { getDisplayKey } from '../utils/colorSystemUtils'
import { getContrastColor } from '../utils/colorUtils'

const props = withDefaults(defineProps<{
  mappedPixelData: MappedPixel[][] | null
  gridDimensions: GridDimensions | null
  currentColor?: string
  completedCells?: Set<string>
  recommendedCell?: { row: number; col: number } | null
  recommendedRegion?: Array<{ row: number; col: number }> | null
  canvasScale?: number
  canvasOffset?: { x: number; y: number }
  gridSectionInterval?: number
  showSectionLines?: boolean
  sectionLineColor?: string
  showCoordinates?: boolean
  coordinateInterval?: number
  showColorCodes?: boolean
}>(), {
  currentColor: '',
  completedCells: () => new Set(),
  recommendedCell: null,
  recommendedRegion: null,
  canvasScale: 1,
  canvasOffset: () => ({ x: 0, y: 0 }),
  gridSectionInterval: 10,
  showSectionLines: true,
  sectionLineColor: '#007acc',
  showCoordinates: true,
  coordinateInterval: 1,
  showColorCodes: true,
})

const emit = defineEmits(['cellClick', 'scaleChange', 'offsetChange'])

const canvasRef = ref<HTMLCanvasElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const isDragging = ref(false)
const lastPanPoint = ref<{ x: number; y: number } | null>(null)
const lastPinchDistance = ref<number | null>(null)
const hasDragged = ref(false)
const dashAnimOffset = ref(0)
const animFrameId = ref<number | null>(null)

// 计算互补色
function getComplementaryColor(hex: string): string {
 const r = parseInt(hex.slice(1, 3), 16)
 const g = parseInt(hex.slice(3, 5), 16)
 const b = parseInt(hex.slice(5, 7), 16)
 
 const compR = 255 - r
 const compG = 255 - g
 const compB = 255 - b
 
 return `rgb(${compR}, ${compG}, ${compB})`
}

// 计算浅色版本的互补色（用于已完成区域）
function getLightComplementaryColor(hex: string): string {
 const r = parseInt(hex.slice(1, 3), 16)
 const g = parseInt(hex.slice(3, 5), 16)
 const b = parseInt(hex.slice(5, 7), 16)
 
 const compR = 255 - r
 const compG = 255 - g
 const compB = 255 - b
 
 const lightR = Math.round(compR + (255 - compR) * 0.6)
 const lightG = Math.round(compG + (255 - compG) * 0.6)
 const lightB = Math.round(compB + (255 - compB) * 0.6)
 
 return `rgb(${lightR}, ${lightG}, ${lightB})`
}

// 计算深色版本的互补色（用于未完成的推荐区域）
function getDarkComplementaryColor(hex: string): string {
 const r = parseInt(hex.slice(1, 3), 16)
 const g = parseInt(hex.slice(3, 5), 16)
 const b = parseInt(hex.slice(5, 7), 16)
 
 const compR = 255 - r
 const compG = 255 - g
 const compB = 255 - b
 
 const darkR = Math.round(compR * 0.7)
 const darkG = Math.round(compG * 0.7)
 const darkB = Math.round(compB * 0.7)
 
 return `rgba(${darkR}, ${darkG}, ${darkB}, 0.5)`
}

// 计算格子大小
const cellSize = computed(() => {
 if (!props.gridDimensions) return 15
 return Math.max(15, Math.min(40, 300 / Math.max(props.gridDimensions.N, props.gridDimensions.M)))
})

// 坐标标签字体大小
const coordinateFontSize = computed(() => {
 if (!props.showCoordinates) return 12
 return Math.max(9, Math.min(12, Math.floor(cellSize.value * 0.7)))
})

// 坐标标签区域大小
const axisLabelSize = computed(() => {
 if (!props.showCoordinates || !props.gridDimensions) return 0
 const cs = cellSize.value
 const fs = coordinateFontSize.value
 const maxNum = Math.max(props.gridDimensions.N, props.gridDimensions.M)
 const digits = maxNum.toString().length
 const textWidth = digits * fs * 0.6 + 4
 return Math.max(Math.ceil(textWidth), Math.ceil(fs + 4), Math.floor(cs * 0.7))
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

// ========== 虚线流动动画 ==========
function startDashAnimation() {
  if (animFrameId.value !== null) return

  let lastTime = performance.now()
  const speed = 10

  function animate(now: number) {
    const delta = (now - lastTime) / 1000
    lastTime = now
    dashAnimOffset.value += speed * delta
    renderCanvas()
    animFrameId.value = requestAnimationFrame(animate)
  }

  animFrameId.value = requestAnimationFrame(animate)
}

function stopDashAnimation() {
  if (animFrameId.value !== null) {
    cancelAnimationFrame(animFrameId.value)
    animFrameId.value = null
  }
}

// ========== 渲染画布 ==========
function renderCanvas() {
 const canvas = canvasRef.value
 if (!canvas || !props.mappedPixelData || !props.gridDimensions) return

 const ctx = canvas.getContext('2d')
 if (!ctx) return

 const { N, M } = props.gridDimensions
 const cs = cellSize.value
 const al = axisLabelSize.value

 // 网格逻辑尺寸（含坐标标签）
 const gridWidth = N * cs
 const gridHeight = M * cs
 const totalWidth = al + gridWidth + al
 const totalHeight = al + gridHeight + al

 // 获取父容器尺寸，canvas 填满容器
 const container = containerRef.value
 const containerW = container ? container.clientWidth : totalWidth
 const containerH = container ? container.clientHeight : totalHeight

 const dpr = Math.min(window.devicePixelRatio || 1, 2)
 canvas.width = containerW * dpr
 canvas.height = containerH * dpr
 canvas.style.width = `${containerW}px`
 canvas.style.height = `${containerH}px`

 // 适配缩放：将网格居中放入容器
 const fitScale = Math.min(containerW / totalWidth, containerH / totalHeight)

 // 原生缩放 = DPR × 适配缩放 × 用户缩放
  const totalScale = dpr * fitScale * props.canvasScale
  ctx.scale(totalScale, totalScale)
  // canvasOffset 单位与逻辑坐标一致，直接作为 translate 偏移
  ctx.translate(props.canvasOffset.x, props.canvasOffset.y)
  ctx.clearRect(
   -props.canvasOffset.x - 10,
   -props.canvasOffset.y - 10,
   totalWidth + 20,
   totalHeight + 20
  )

 // 网格实际绘制区域（考虑坐标标签边距）
 const gridOffsetX = al
 const gridOffsetY = al

 // 绘制坐标标签
 if (props.showCoordinates) {
  ctx.fillStyle = '#F5F5F5'
  ctx.fillRect(al, 0, gridWidth, al)
  ctx.fillRect(al, al + gridHeight, gridWidth, al)
  ctx.fillRect(0, al, al, gridHeight)
  ctx.fillRect(al + gridWidth, al, al, gridHeight)

  ctx.fillStyle = '#333333'
  ctx.font = `${coordinateFontSize.value}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const n = props.coordinateInterval

  // 间隔逻辑：n=1 连续显示，n>1 时第一格(index0)始终显示，之后每隔n格显示
  let ci = 0
  while (ci < N) {
   const x = al + ci * cs + cs / 2
   ctx.fillText((ci + 1).toString(), x, al / 2)
   ctx.fillText((ci + 1).toString(), x, al + gridHeight + al / 2)
   ci = n <= 1 ? ci + 1 : (ci === 0 ? n - 1 : ci + n)
  }

  // 行号
  let cj = 0
  while (cj < M) {
   const y = al + cj * cs + cs / 2
   ctx.textAlign = 'center'
   ctx.fillText((cj + 1).toString(), al / 2, y)
   ctx.fillText((cj + 1).toString(), al + gridWidth + al / 2, y)
   cj = n <= 1 ? cj + 1 : (cj === 0 ? n - 1 : cj + n)
  }
 }

 // 预计算推荐区域的 Set
 const regionSet = new Set()
 if (props.recommendedRegion) {
  props.recommendedRegion.forEach(({ row, col }) => {
   regionSet.add(`${row},${col}`)
  })
 }

 // 渲染每个格子
 for (let row = 0; row < M; row++) {
  for (let col = 0; col < N; col++) {
   const pixel = props.mappedPixelData[row]?.[col]
   if (!pixel) continue

   const x = gridOffsetX + col * cs
   const y = gridOffsetY + row * cs
   const cellKey = `${row},${col}`

   let fillColor = pixel.color

   if (pixel.color !== props.currentColor) {
    const hex = pixel.color.replace('#', '')
    const r = parseInt(hex.substring(0, 2), 16)
    const g = parseInt(hex.substring(2, 4), 16)
    const b = parseInt(hex.substring(4, 6), 16)
    const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
    fillColor = `rgb(${gray}, ${gray}, ${gray})`
   }

   ctx.fillStyle = fillColor
   ctx.fillRect(x, y, cs, cs)

   if (pixel.color === props.currentColor) {
    if (props.completedCells.has(cellKey)) {
     ctx.fillStyle = getLightComplementaryColor(props.currentColor)
     ctx.fillRect(x, y, cs, cs)
    } else if (regionSet.has(cellKey)) {
     ctx.fillStyle = getDarkComplementaryColor(props.currentColor)
     ctx.fillRect(x, y, cs, cs)
    }
   }

   // 色号文字
   if (props.showColorCodes) {
    const displayKey = getDisplayKey(pixel, 'MARD')
    if (displayKey && displayKey !== '?') {
     const fontSize = Math.max(6, Math.floor(cs * 0.5))
     ctx.fillStyle = getContrastColor(pixel.color)
     ctx.font = `${fontSize}px sans-serif`
     ctx.textAlign = 'center'
     ctx.textBaseline = 'middle'
     ctx.fillText(displayKey, x + cs / 2, y + cs / 2)
    }
   }
  }
 }

 // 绘制每一格的浅灰色分隔线
 ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)'
 ctx.lineWidth = 0.5
 
 for (let col = 1; col < N; col++) {
  const x = gridOffsetX + col * cs
  ctx.beginPath()
  ctx.moveTo(x, gridOffsetY)
  ctx.lineTo(x, gridOffsetY + gridHeight)
  ctx.stroke()
 }
 
 for (let row = 1; row < M; row++) {
  const y = gridOffsetY + row * cs
  ctx.beginPath()
  ctx.moveTo(gridOffsetX, y)
  ctx.lineTo(gridOffsetX + gridWidth, y)
  ctx.stroke()
 }

 // 绘制分区线
 if (props.showSectionLines) {
  ctx.strokeStyle = props.sectionLineColor
  ctx.lineWidth = 2

  for (let col = props.gridSectionInterval; col < N; col += props.gridSectionInterval) {
   const x = gridOffsetX + col * cs
   ctx.beginPath()
   ctx.moveTo(x, gridOffsetY)
   ctx.lineTo(x, gridOffsetY + gridHeight)
   ctx.stroke()
  }

  for (let row = props.gridSectionInterval; row < M; row += props.gridSectionInterval) {
   const y = gridOffsetY + row * cs
   ctx.beginPath()
   ctx.moveTo(gridOffsetX, y)
   ctx.lineTo(gridOffsetX + gridWidth, y)
   ctx.stroke()
  }
 }

 // 绘制推荐区域的虚线轮廓
 if (props.recommendedRegion && props.recommendedRegion.length > 0) {
  ctx.strokeStyle = getComplementaryColor(props.currentColor)
  ctx.lineWidth = 1.2
  ctx.setLineDash([6, 4])
  ctx.lineDashOffset = dashAnimOffset.value
  ctx.beginPath()
  
  props.recommendedRegion.forEach(({ row, col }) => {
   const x = gridOffsetX + col * cs
   const y = gridOffsetY + row * cs
   
   if (!regionSet.has(`${row - 1},${col}`)) {
    ctx.moveTo(x + cs, y)
    ctx.lineTo(x, y)
   }
   if (!regionSet.has(`${row + 1},${col}`)) {
    ctx.moveTo(x, y + cs)
    ctx.lineTo(x + cs, y + cs)
   }
   if (!regionSet.has(`${row},${col - 1}`)) {
    ctx.moveTo(x, y)
    ctx.lineTo(x, y + cs)
   }
   if (!regionSet.has(`${row},${col + 1}`)) {
    ctx.moveTo(x + cs, y + cs)
    ctx.lineTo(x + cs, y)
   }
  })
  
  ctx.stroke()
  ctx.setLineDash([])
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
  () => props.showCoordinates,
  () => props.coordinateInterval,
  () => props.showColorCodes,
  () => props.canvasScale,
  () => props.canvasOffset,
 ],
 () => {
  renderCanvas()
  if (props.recommendedRegion && props.recommendedRegion.length > 0) {
   startDashAnimation()
  } else {
   stopDashAnimation()
  }
 },
 { deep: true }
)

onMounted(() => {
 renderCanvas()
 if (props.recommendedRegion && props.recommendedRegion.length > 0) {
  startDashAnimation()
 }
})

onUnmounted(() => {
 stopDashAnimation()
})

// ========== 事件处理 ==========
// 计算 fit-to-container 缩放
function getFitScale(): number {
 if (!containerRef.value || !props.gridDimensions) return 1
 const { N, M } = props.gridDimensions
 const cs = cellSize.value
 const al = axisLabelSize.value
 const totalW = al + N * cs + al
 const totalH = al + M * cs + al
 return Math.min(containerRef.value.clientWidth / totalW, containerRef.value.clientHeight / totalH)
}

// 使用 canvas 原生参数计算居中偏移，将指定格子置于容器中心
function centerOnCell(row: number, col: number): { x: number; y: number } | null {
 if (!containerRef.value || !props.gridDimensions) return null
 const { N, M } = props.gridDimensions
 const cs = cellSize.value
 const al = axisLabelSize.value
 const containerW = containerRef.value.clientWidth
 const containerH = containerRef.value.clientHeight
 const fitScale = Math.min(containerW / (al + N * cs + al), containerH / (al + M * cs + al))
 const effectiveScale = fitScale * props.canvasScale
 // 目标格子中心的逻辑坐标
 const targetX = al + col * cs + cs / 2
 const targetY = al + row * cs + cs / 2
 // 居中偏移：使目标逻辑坐标映射到容器中心
 return {
  x: containerW / (2 * effectiveScale) - targetX,
  y: containerH / (2 * effectiveScale) - targetY,
 }
}

defineExpose({ centerOnCell })

// 将屏幕坐标转换为画布逻辑坐标（考虑 fitScale、缩放和平移）
function getEventPosition(event: MouseEvent | TouchEvent) {
 const canvas = canvasRef.value
 if (!canvas) return null

 const rect = canvas.getBoundingClientRect()
 let clientX: number, clientY: number

 if ('touches' in event && event.touches.length > 0) {
  clientX = event.touches[0].clientX
  clientY = event.touches[0].clientY
 } else if ('changedTouches' in event && event.changedTouches.length > 0) {
  clientX = event.changedTouches[0].clientX
  clientY = event.changedTouches[0].clientY
 } else {
  const me = event as MouseEvent
  clientX = me.clientX
  clientY = me.clientY
 }

 const fitScale = getFitScale()
 const effectiveScale = fitScale * props.canvasScale
 // 屏幕坐标 → 画布逻辑坐标
 const canvasX = (clientX - rect.left) / effectiveScale - props.canvasOffset.x
 const canvasY = (clientY - rect.top) / effectiveScale - props.canvasOffset.y

 return { x: canvasX, y: canvasY }
}

function getGridPosition(x: number, y: number) {
 if (!props.gridDimensions) return null
 const cs = cellSize.value
 const al = axisLabelSize.value
 const gridX = x - al
 const gridY = y - al
 const col = Math.floor(gridX / cs)
 const row = Math.floor(gridY / cs)

 if (row >= 0 && row < props.gridDimensions.M && col >= 0 && col < props.gridDimensions.N) {
  return { row, col }
 }
 return null
}

function handleClick(event: MouseEvent | TouchEvent) {
 if (hasDragged.value) return

 const pos = getEventPosition(event)
 if (!pos) return

 const gridPos = getGridPosition(pos.x, pos.y)
 if (gridPos) {
  emit('cellClick', gridPos.row, gridPos.col)
 }
}

function handleWheel(event: WheelEvent) {
 event.preventDefault()
 const fitScale = getFitScale()
 const delta = event.deltaY > 0 ? 0.9 : 1.1
 const newScale = Math.max(0.3, Math.min(3, props.canvasScale * delta))

 // 以鼠标位置为中心缩放
 const canvas = canvasRef.value
 if (canvas) {
  const rect = canvas.getBoundingClientRect()
  const mouseX = event.clientX - rect.left
  const mouseY = event.clientY - rect.top
  const effectiveScale = fitScale * props.canvasScale
  const newEffectiveScale = fitScale * newScale
  const canvasX = mouseX / effectiveScale - props.canvasOffset.x
  const canvasY = mouseY / effectiveScale - props.canvasOffset.y
  emit('offsetChange', {
   x: mouseX / newEffectiveScale - canvasX,
   y: mouseY / newEffectiveScale - canvasY,
  })
 }
 emit('scaleChange', newScale)
}

function getTouchDistance(touches: TouchList) {
 if (touches.length < 2) return 0
 const dx = touches[0].clientX - touches[1].clientX
 const dy = touches[0].clientY - touches[1].clientY
 return Math.sqrt(dx * dx + dy * dy)
}

function handleTouchStart(event: TouchEvent) {
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

function handleTouchMove(event: TouchEvent) {
 event.preventDefault()

 if (event.touches.length === 1 && isDragging.value && lastPanPoint.value) {
  hasDragged.value = true
  const deltaX = event.touches[0].clientX - lastPanPoint.value.x
  const deltaY = event.touches[0].clientY - lastPanPoint.value.y

  if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
   hasDragged.value = true
  }

  // 屏幕像素差 ÷ (fitScale × 缩放) = 画布逻辑偏移
  const fitScale = getFitScale()
  emit('offsetChange', {
   x: props.canvasOffset.x + deltaX / (fitScale * props.canvasScale),
   y: props.canvasOffset.y + deltaY / (fitScale * props.canvasScale),
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

function handleTouchEnd(event: TouchEvent) {
 if (event.touches.length === 0) {
  isDragging.value = false
  lastPanPoint.value = null
  lastPinchDistance.value = null

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
function handleMouseDown(event: MouseEvent) {
 isDragging.value = true
 hasDragged.value = false
 lastPanPoint.value = {
  x: event.clientX,
  y: event.clientY,
 }
}

function handleMouseMove(event: MouseEvent) {
 if (isDragging.value && lastPanPoint.value) {
  const deltaX = event.clientX - lastPanPoint.value.x
  const deltaY = event.clientY - lastPanPoint.value.y

  if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
   hasDragged.value = true
  }

  // 屏幕像素差 ÷ (fitScale × 缩放) = 画布逻辑偏移
  const fitScale = getFitScale()
  emit('offsetChange', {
   x: props.canvasOffset.x + deltaX / (fitScale * props.canvasScale),
   y: props.canvasOffset.y + deltaY / (fitScale * props.canvasScale),
  })

  lastPanPoint.value = {
   x: event.clientX,
   y: event.clientY,
  }
 }
}

function handleMouseUp(event: MouseEvent) {
 isDragging.value = false
 lastPanPoint.value = null
}
</script>

<template>
 <div
 ref="containerRef"
 class="w-full h-full flex items-center justify-center overflow-hidden bg-black/[0.04]"
 style="touch-action: none"
 >
 <canvas
 ref="canvasRef"
 class="cursor-crosshair border border-black/10"
 style="image-rendering: pixelated; image-rendering: crisp-edges;"
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
</template>
