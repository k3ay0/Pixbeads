<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import type { MappedPixel, GridDimensions } from '../types'

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
})

const emit = defineEmits(['cellClick', 'scaleChange', 'offsetChange'])

const canvasRef = ref<HTMLCanvasElement | null>(null)
const isDragging = ref(false)
const lastPanPoint = ref<{ x: number; y: number } | null>(null)
const lastPinchDistance = ref<number | null>(null)
const hasDragged = ref(false)

// 计算互补色
function getComplementaryColor(hex: string): string {
 const r = parseInt(hex.slice(1, 3), 16)
 const g = parseInt(hex.slice(3, 5), 16)
 const b = parseInt(hex.slice(5, 7), 16)
 
 // 计算互补色（色轮上对面的颜色）
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
 
 // 计算互补色
 const compR = 255 - r
 const compG = 255 - g
 const compB = 255 - b
 
 // 将互补色变浅（混合白色 60%）
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
 
 // 计算互补色
 const compR = 255 - r
 const compG = 255 - g
 const compB = 255 - b
 
 // 将互补色变深（混合黑色 30%）
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

// 预计算推荐区域的 Set，用于快速查找

// ========== 渲染画布 ==========
function renderCanvas() {
 const canvas = canvasRef.value
 if (!canvas || !props.mappedPixelData || !props.gridDimensions) return

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

 // 如果是当前颜色的格子
 if (pixel.color === props.currentColor) {
 if (props.completedCells.has(cellKey)) {
 // 已完成的格子，使用浅色互补色覆盖
 ctx.fillStyle = getLightComplementaryColor(props.currentColor)
 ctx.fillRect(x, y, cs, cs)
 } else if (regionSet.has(cellKey)) {
 // 推荐区域内未完成的格子，使用深色互补色覆盖
 ctx.fillStyle = getDarkComplementaryColor(props.currentColor)
 ctx.fillRect(x, y, cs, cs)
 }
 }
 }
 }

 // 绘制推荐区域的虚线轮廓（精确框住引导区域）
 if (props.recommendedRegion && props.recommendedRegion.length > 0) {
 // 使用当前颜色的互补色
 ctx.strokeStyle = getComplementaryColor(props.currentColor)
 ctx.lineWidth = 2
 ctx.setLineDash([6, 4])
 ctx.beginPath()
 
 // 遍历推荐区域的每个格子，绘制轮廓边
 props.recommendedRegion.forEach(({ row, col }) => {
 const x = col * cs
 const y = row * cs
 
 // 上边：如果上方格子不在推荐区域内
 if (!regionSet.has(`${row - 1},${col}`)) {
 ctx.moveTo(x, y)
 ctx.lineTo(x + cs, y)
 }
 
 // 下边：如果下方格子不在推荐区域内
 if (!regionSet.has(`${row + 1},${col}`)) {
 ctx.moveTo(x, y + cs)
 ctx.lineTo(x + cs, y + cs)
 }
 
 // 左边：如果左方格子不在推荐区域内
 if (!regionSet.has(`${row},${col - 1}`)) {
 ctx.moveTo(x, y)
 ctx.lineTo(x, y + cs)
 }
 
 // 右边：如果右方格子不在推荐区域内
 if (!regionSet.has(`${row},${col + 1}`)) {
 ctx.moveTo(x + cs, y)
 ctx.lineTo(x + cs, y + cs)
 }
 })
 
 ctx.stroke()
 ctx.setLineDash([])
 }

 // 绘制每一格的浅灰色分隔线
 ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)'
 ctx.lineWidth = 0.5
 
 // 垂直线
 for (let col = 1; col < N; col++) {
 const x = col * cs
 ctx.beginPath()
 ctx.moveTo(x, 0)
 ctx.lineTo(x, canvasHeight)
 ctx.stroke()
 }
 
 // 水平线
 for (let row = 1; row < M; row++) {
 const y = row * cs
 ctx.beginPath()
 ctx.moveTo(0, y)
 ctx.lineTo(canvasWidth, y)
 ctx.stroke()
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

 return {
 x: (clientX - rect.left) / props.canvasScale,
 y: (clientY - rect.top) / props.canvasScale,
 }
}

function getGridPosition(x: number, y: number) {
 if (!props.gridDimensions) return null
 const cs = cellSize.value
 const col = Math.floor(x / cs)
 const row = Math.floor(y / cs)

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
 const delta = event.deltaY > 0 ? 0.9 : 1.1
 const newScale = Math.max(0.3, Math.min(3, props.canvasScale * delta))
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

function handleTouchEnd(event: TouchEvent) {
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

function handleMouseUp(event: MouseEvent) {
 isDragging.value = false
 lastPanPoint.value = null
}

// 阻止触摸默认行为
</script>

<template>
 <div
 ref="containerRef"
 class="w-full h-full flex items-center justify-center overflow-hidden bg-black/[0.04]"
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
 class="cursor-crosshair border border-black/10"
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