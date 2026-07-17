import { defineStore } from 'pinia'
import { ref } from 'vue'
import { MIN_ZOOM, MAX_ZOOM, AXIS_WIDTH, AXIS_HEIGHT, CELL_SIZE } from '@/constants/canvasConstants'
import { calculateCenterOffset } from '@/utils/canvasUtils'
import { useBeadStore } from './beadStore'

export interface TooltipData {
  x: number
  y: number
  key: string
  color: string
  row: number
  col: number
}

export const useCanvasStore = defineStore('canvas', () => {
  // ========== 状态 ==========
  const canvasZoom = ref(1)
  const canvasTranslate = ref({ x: 0, y: 0 })
  const isDragging = ref(false)
  const dragStart = ref({ x: 0, y: 0 })
  const tooltipData = ref<TooltipData | null>(null)

  // ========== DOM 引用 ==========
  const previewCanvas = ref<HTMLCanvasElement | null>(null)
  const canvasContainer = ref<HTMLDivElement | null>(null)

  // ========== Actions ==========

  function setZoom(zoom: number) {
    canvasZoom.value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
  }

  function setTranslate(x: number, y: number) {
    canvasTranslate.value = { x, y }
  }

  function startDrag(clientX: number, clientY: number) {
    if (!canvasContainer.value) return

    const containerRect = canvasContainer.value.getBoundingClientRect()
    dragStart.value = {
      x: clientX - containerRect.left - AXIS_WIDTH - canvasTranslate.value.x,
      y: clientY - containerRect.top - AXIS_HEIGHT - canvasTranslate.value.y
    }
    isDragging.value = true
  }

  function onDrag(clientX: number, clientY: number) {
    if (!isDragging.value || !canvasContainer.value) return

    const containerRect = canvasContainer.value.getBoundingClientRect()
    const mouseX = clientX - containerRect.left - AXIS_WIDTH
    const mouseY = clientY - containerRect.top - AXIS_HEIGHT

    canvasTranslate.value = {
      x: mouseX - dragStart.value.x,
      y: mouseY - dragStart.value.y
    }
  }

  function endDrag() {
    isDragging.value = false
  }

  function setTooltip(data: TooltipData | null) {
    tooltipData.value = data
  }

  function clearTooltip() {
    tooltipData.value = null
  }

  function resetView() {
    canvasZoom.value = 1
    const container = canvasContainer.value
    const beadStore = useBeadStore()
    const gd = beadStore.gridDimensions
    if (container && gd) {
      const gridW = gd.N * CELL_SIZE
      const gridH = gd.M * CELL_SIZE
      const containerW = container.clientWidth
      const containerH = container.clientHeight
      const fitScale = Math.min(containerW / gridW, containerH / gridH)
      // 居中偏移：使缩放后的网格在容器中居中
      canvasTranslate.value = {
        x: (containerW - gridW * fitScale) / 2,
        y: (containerH - gridH * fitScale) / 2
      }
    } else {
      canvasTranslate.value = { x: 0, y: 0 }
    }
  }

  function resetViewToCenter() {
    const container = canvasContainer.value
    const beadStore = useBeadStore()
    const gd = beadStore.gridDimensions
    if (container && gd) {
      const gridW = gd.N * CELL_SIZE
      const gridH = gd.M * CELL_SIZE
      const containerW = container.clientWidth
      const containerH = container.clientHeight
      const fitScale = Math.min(containerW / gridW, containerH / gridH)
      canvasTranslate.value = {
        x: (containerW - gridW * fitScale) / 2,
        y: (containerH - gridH * fitScale) / 2
      }
    }
  }

  return {
    // State
    canvasZoom,
    canvasTranslate,
    isDragging,
    dragStart,
    tooltipData,
    // DOM Refs
    previewCanvas,
    canvasContainer,
    // Actions
    setZoom,
    setTranslate,
    startDrag,
    onDrag,
    endDrag,
    setTooltip,
    clearTooltip,
    resetView,
    resetViewToCenter,
  }
})
