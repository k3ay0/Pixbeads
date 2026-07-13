import { useCanvasStore } from '@/stores/canvasStore'
import { useEditorStore } from '@/stores/editorStore'
import { useBeadStore } from '@/stores/beadStore'
import { AXIS_WIDTH, AXIS_HEIGHT, CELL_SIZE } from '@/constants/canvasConstants'

export function useCanvasTransform() {
  const canvasStore = useCanvasStore()
  const editorStore = useEditorStore()
  const beadStore = useBeadStore()

  /** 计算 fit-to-container 缩放 */
  function getFitScale(): number {
    const container = canvasStore.canvasContainer
    const gd = beadStore.gridDimensions
    if (!container || !gd) return 1
    const gridW = gd.N * CELL_SIZE
    const gridH = gd.M * CELL_SIZE
    return Math.min(container.clientWidth / gridW, container.clientHeight / gridH)
  }

  function handleCanvasWheel(e: WheelEvent) {
    e.preventDefault()

    const container = canvasStore.canvasContainer
    if (!container) return

    const containerRect = container.getBoundingClientRect()

    const mouseInCanvasAreaX = e.clientX - containerRect.left - AXIS_WIDTH
    const mouseInCanvasAreaY = e.clientY - containerRect.top - AXIS_HEIGHT

    const fitScale = getFitScale()
    const effectiveZoom = fitScale * canvasStore.canvasZoom

    const canvasPointX = (mouseInCanvasAreaX - canvasStore.canvasTranslate.x) / effectiveZoom
    const canvasPointY = (mouseInCanvasAreaY - canvasStore.canvasTranslate.y) / effectiveZoom

    const oldZoom = canvasStore.canvasZoom
    const delta = e.deltaY > 0 ? -0.1 : 0.1
    const newZoom = Math.min(5, Math.max(0.1, oldZoom + delta))
    const newEffectiveZoom = fitScale * newZoom

    canvasStore.setTranslate(
      mouseInCanvasAreaX - canvasPointX * newEffectiveZoom,
      mouseInCanvasAreaY - canvasPointY * newEffectiveZoom
    )
    canvasStore.setZoom(newZoom)
  }

  function handleCanvasDragStart(e: MouseEvent) {
    canvasStore.startDrag(e.clientX, e.clientY)
  }

  function handleCanvasDragMove(e: MouseEvent) {
    canvasStore.onDrag(e.clientX, e.clientY)
  }

  function handleCanvasDragEnd() {
    canvasStore.endDrag()
  }

  function resetCanvasView() {
    canvasStore.resetView()
  }

  return {
    handleCanvasWheel,
    handleCanvasDragStart,
    handleCanvasDragMove,
    handleCanvasDragEnd,
    resetCanvasView,
  }
}
