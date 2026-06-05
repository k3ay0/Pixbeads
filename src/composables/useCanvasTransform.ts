import { useCanvasStore } from '@/stores/canvasStore'
import { useEditorStore } from '@/stores/editorStore'
import { AXIS_WIDTH, AXIS_HEIGHT } from '@/constants/canvasConstants'

export function useCanvasTransform() {
  const canvasStore = useCanvasStore()
  const editorStore = useEditorStore()

  function handleCanvasWheel(e: WheelEvent) {
    e.preventDefault()

    const container = canvasStore.canvasContainer
    if (!container) return

    const containerRect = container.getBoundingClientRect()

    const mouseInCanvasAreaX = e.clientX - containerRect.left - AXIS_WIDTH
    const mouseInCanvasAreaY = e.clientY - containerRect.top - AXIS_HEIGHT

    const canvasPointX = (mouseInCanvasAreaX - canvasStore.canvasTranslate.x) / canvasStore.canvasZoom
    const canvasPointY = (mouseInCanvasAreaY - canvasStore.canvasTranslate.y) / canvasStore.canvasZoom

    const oldZoom = canvasStore.canvasZoom
    const delta = e.deltaY > 0 ? -0.1 : 0.1
    const newZoom = Math.min(5, Math.max(0.1, oldZoom + delta))

    canvasStore.setTranslate(
      mouseInCanvasAreaX - canvasPointX * newZoom,
      mouseInCanvasAreaY - canvasPointY * newZoom
    )
    canvasStore.setZoom(newZoom)
  }

  function handleCanvasDragStart(e: MouseEvent, activeMode: string) {
    if (activeMode === 'edit' && !e.shiftKey) return
    if (activeMode === 'focus') return
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
