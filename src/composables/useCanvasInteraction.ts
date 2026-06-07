/**
 * 画布交互 composable
 * 处理画布上的鼠标事件（点击、悬停、按下、抬起）和工具分发
 */

import { ref, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useBeadStore } from '@/stores/beadStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { useEditorStore } from '@/stores/editorStore'
import { useUiStore } from '@/stores/uiStore'
import { usePaletteStore } from '@/stores/paletteStore'
import { clientToGridCoords } from '@/utils/canvasUtils'
import { getColorKeyByHex } from '@/utils/colorSystemUtils'
import { floodFill } from '@/utils/pixelation'
import {
  getLinePoints,
  getRectPoints,
  applyColorToPoints as applyColorToPointsUtil,
  isPointInSelection,
} from '@/utils/drawingAlgorithms'
import type { AppMode } from '@/constants/modeConstants'
import { TRANSPARENT_KEY } from '@/types'

export function useCanvasInteraction(
  hoverCell: Ref<{ row: number; col: number } | null>,
  isPainting: Ref<boolean>,
  lastPaintCell: Ref<{ row: number; col: number } | null>,
  renderPreviewOverlay: () => void,
  clearPreviewOverlay: () => void,
  scheduleRender: () => void
) {
  const beadStore = useBeadStore()
  const canvasStore = useCanvasStore()
  const editorStore = useEditorStore()
  const uiStore = useUiStore()
  const paletteStore = usePaletteStore()

  const { mappedPixelData, gridDimensions } = storeToRefs(beadStore)
  const { previewCanvas, isDragging } = storeToRefs(canvasStore)
  const {
    selectedEditColor, isEraseMode, manualTool, manualBrushSize,
    manualMirrorX, manualMirrorY, isFloodFillEraseMode,
    selectionStart, selectionEnd, lineStart, clipboard,
    lineDrawing, rectDrawing, selectDrawing,
    selectionBoxDragging, selectionBoxDragStart, selectionBoxDragOffset,
    selectionDragging, selectionDragStart, selectionDragOffset, isCopyingSelection, moveToolMode,
    currentDrawEnd,
  } = storeToRefs(editorStore)
  const { activeMode } = storeToRefs(uiStore)
  const { selectedColorSystem } = storeToRefs(paletteStore)

  // 标记是否刚完成拖拽操作，防止mouseup后触发click
  let justFinishedDrag = false

  // ========== 辅助函数 ==========

  /** 绘画核心函数：在指定格子应用笔刷 */
  function paintAtCell(row: number, col: number) {
    if (!mappedPixelData.value || !gridDimensions.value) return
    const { N, M } = gridDimensions.value
    const size = manualBrushSize.value
    const half = Math.floor(size / 2)
    const isErasing = isEraseMode.value || manualTool.value === 'eraser'
    const color = isErasing ? null : selectedEditColor.value
    if (!isErasing && !color) return

    // 保存快照（仅首次）
    if (!lastPaintCell.value) {
      editorStore.saveSnapshot(mappedPixelData.value)
    }

    function applyCell(r: number, c: number) {
      if (r < 0 || r >= M || c < 0 || c >= N) return
      const cell = mappedPixelData.value![r]?.[c]
      if (!cell) return
      if (isErasing) {
        if (!cell.isExternal) mappedPixelData.value![r][c] = { key: TRANSPARENT_KEY, color: '#FFFFFF', isExternal: true }
      } else {
        // 允许在透明格子上绘画
        mappedPixelData.value![r][c] = { key: color!.key, color: color!.color, isExternal: false }
      }
    }

    for (let dr = -half; dr <= half; dr++) {
      for (let dc = -half; dc <= half; dc++) {
        applyCell(row + dr, col + dc)
        if (manualMirrorX.value) applyCell(row + dr, N - 1 - col - dc)
        if (manualMirrorY.value) applyCell(M - 1 - row - dr, col + dc)
        if (manualMirrorX.value && manualMirrorY.value) applyCell(M - 1 - row - dr, N - 1 - col - dc)
      }
    }
    scheduleRender()
  }

  /** 批量应用颜色到格子列表（包装器） */
  function applyColorToPointsWrapper(points: { row: number; col: number }[]) {
    if (!mappedPixelData.value || !gridDimensions.value) return
    const isErasing = isEraseMode.value || manualTool.value === 'eraser'
    const color = isErasing ? null : selectedEditColor.value
    if (!isErasing && !color) return
    editorStore.saveSnapshot(mappedPixelData.value)
    applyColorToPointsUtil(mappedPixelData.value, gridDimensions.value, points, color, isErasing)
    scheduleRender()
  }

  // ========== 事件处理 ==========

  function handleCanvasClick(e: MouseEvent) {
    // 如果刚完成拖拽操作，忽略这次click
    if (justFinishedDrag) {
      justFinishedDrag = false
      return
    }
    if (!mappedPixelData.value || !gridDimensions.value || activeMode.value !== 'edit' || isDragging.value) return
    const canvas = e.target as HTMLCanvasElement
    const coords = clientToGridCoords(e.clientX, e.clientY, canvas, gridDimensions.value)
    if (!coords) return
    const { i: col, j: row } = coords

    // 工具分发
    switch (manualTool.value) {
      case 'picker': {
        const cell = mappedPixelData.value[row]?.[col]
        if (cell && !cell.isExternal) {
          const hex = cell.color.toUpperCase()
          const key = getColorKeyByHex(hex, selectedColorSystem.value)
          editorStore.selectEditColor({ key, color: hex })
        }
        return
      }
      case 'fill': {
        if (editorStore.colorReplaceState.isActive) {
          // 色替换点击
          const cell = mappedPixelData.value[row]?.[col]
          if (cell && !cell.isExternal) {
            const sourceColor = { key: cell.key, color: cell.color }
            const targetColor = selectedEditColor.value
            if (targetColor) {
              editorStore.saveSnapshot(mappedPixelData.value)
              for (let r = 0; r < mappedPixelData.value.length; r++) {
                for (let c = 0; c < mappedPixelData.value[r].length; c++) {
                  const currentCell = mappedPixelData.value[r][c]
                  if (currentCell && !currentCell.isExternal && currentCell.color.toUpperCase() === sourceColor.color.toUpperCase()) {
                    mappedPixelData.value[r][c] = { key: targetColor.key, color: targetColor.color, isExternal: false }
                  }
                }
              }
              editorStore.resetColorReplaceState()
              scheduleRender()
            }
          }
        } else if (selectedEditColor.value) {
          // 洪水填充
          editorStore.saveSnapshot(mappedPixelData.value)
          const newPixelData = floodFill(mappedPixelData.value, gridDimensions.value!, row, col, { key: selectedEditColor.value.key, color: selectedEditColor.value.color })
          beadStore.mappedPixelData = newPixelData
          scheduleRender()
        }
        return
      }
      case 'select':
      case 'move':
      case 'line':
      case 'rect': {
        // 这些工具不处理点击事件，只处理 mousedown/mousemove/mouseup
        return
      }
      default: {
        // brush / eraser — 单击也触发一次绘画
        const cell = mappedPixelData.value[row]?.[col]
        if (!cell) return
        if (isFloodFillEraseMode.value) {
          // 洪水填充擦除
          const targetKey = cell.color.toUpperCase()
          editorStore.saveSnapshot(mappedPixelData.value)
          const stack = [{ row, col }]
          while (stack.length > 0) {
            const { row: r, col: c } = stack.pop()!
            const currentCell = mappedPixelData.value[r]?.[c]
            if (!currentCell || currentCell.isExternal || currentCell.color.toUpperCase() !== targetKey) continue
            mappedPixelData.value[r][c] = { key: TRANSPARENT_KEY, color: '#FFFFFF', isExternal: true }
            if (r > 0) stack.push({ row: r - 1, col: c })
            if (r < gridDimensions.value!.M - 1) stack.push({ row: r + 1, col: c })
            if (c > 0) stack.push({ row: r, col: c - 1 })
            if (c < gridDimensions.value!.N - 1) stack.push({ row: r, col: c + 1 })
          }
          scheduleRender()
          return
        }
        if (editorStore.colorReplaceState.isActive) {
          // 色替换点击
          const sourceColor = { key: cell.key, color: cell.color }
          const targetColor = selectedEditColor.value
          if (targetColor) {
            editorStore.saveSnapshot(mappedPixelData.value)
            for (let r = 0; r < mappedPixelData.value.length; r++) {
              for (let c = 0; c < mappedPixelData.value[r].length; c++) {
                const currentCell = mappedPixelData.value[r][c]
                if (currentCell && !currentCell.isExternal && currentCell.color.toUpperCase() === sourceColor.color.toUpperCase()) {
                  mappedPixelData.value[r][c] = { key: targetColor.key, color: targetColor.color, isExternal: false }
                }
              }
            }
            editorStore.resetColorReplaceState()
            scheduleRender()
          }
          return
        }
        if (!isEraseMode.value && manualTool.value !== 'eraser' && !selectedEditColor.value) {
          const hex = cell.color.toUpperCase()
          editorStore.selectEditColor({ key: getColorKeyByHex(hex, selectedColorSystem.value), color: cell.color })
          return
        }
        paintAtCell(row, col)
      }
    }
  }

  function handleCanvasHover(e: MouseEvent) {
    if (!mappedPixelData.value || !gridDimensions.value) return
    const canvas = e.target as HTMLCanvasElement
    const coords = clientToGridCoords(e.clientX, e.clientY, canvas, gridDimensions.value)
    if (coords) {
      const { i: col, j: row } = coords
      hoverCell.value = { row, col }

      // 画线/画矩形绘制中 → 持续更新终点
      if (lineDrawing.value || rectDrawing.value) {
        editorStore.updateDrawEnd({ row, col })
        renderPreviewOverlay()
        return
      }
      // 选区拖拽中 → 持续更新偏移
      if (selectionDragging.value && selectionDragStart.value) {
        const dr = row - selectionDragStart.value.row
        const dc = col - selectionDragStart.value.col
        editorStore.updateSelectionDragOffset(dr, dc)
        // Ctrl 临时反转模式
        const baseIsCopy = moveToolMode.value === 'copy'
        editorStore.isCopyingSelection = e.ctrlKey || e.metaKey ? !baseIsCopy : baseIsCopy
        renderPreviewOverlay()
        return
      }
      // select 工具绘制选区中（mousedown 状态）→ 持续更新终点
      if (manualTool.value === 'select' && selectDrawing.value) {
        editorStore.setSelectionEnd({ row, col })
        renderPreviewOverlay()
        return
      }
      // select 工具拖拽选区框中 → 持续更新偏移
      if (manualTool.value === 'select' && selectionBoxDragging.value && selectionBoxDragStart.value) {
        const dr = row - selectionBoxDragStart.value.row
        const dc = col - selectionBoxDragStart.value.col
        editorStore.updateSelectionBoxDragOffset(dr, dc)
        renderPreviewOverlay()
        return
      }

      // 画布拖拽中，不处理其他交互
      if (isDragging.value) return

      // 仅在取色模式下显示颜色信息，透明区域不显示
      const cell = mappedPixelData.value[row][col]
      if (manualTool.value === 'picker' && cell && !cell.isExternal) {
        const rect = canvas.getBoundingClientRect()
        canvasStore.setTooltip({ x: e.clientX - rect.left + 15, y: e.clientY - rect.top - 10, key: getColorKeyByHex(cell.color, selectedColorSystem.value), color: cell.color, row: row + 1, col: col + 1 })
      } else {
        canvasStore.clearTooltip()
      }
      // 长按绘画（画笔/橡皮）
      if (isPainting.value && (manualTool.value === 'brush' || manualTool.value === 'eraser')) {
        const last = lastPaintCell.value
        if (!last || last.row !== row || last.col !== col) {
          paintAtCell(row, col)
          lastPaintCell.value = { row, col }
        }
      }
      renderPreviewOverlay()
      return
    }
    hoverCell.value = null
    canvasStore.clearTooltip()
    clearPreviewOverlay()
  }

  function handleCanvasMouseDown(e: MouseEvent) {
    if (activeMode.value !== 'edit' || isDragging.value) return
    const canvas = e.target as HTMLCanvasElement
    const coords = clientToGridCoords(e.clientX, e.clientY, canvas, gridDimensions.value)
    if (!coords) return
    const { i: col, j: row } = coords

    // 工具分发
    switch (manualTool.value) {
      case 'brush':
      case 'eraser': {
        isPainting.value = true
        lastPaintCell.value = null
        paintAtCell(row, col)
        lastPaintCell.value = { row, col }
        return
      }
      case 'line': {
        editorStore.startLineDrawing({ row, col })
        return
      }
      case 'rect': {
        editorStore.startRectDrawing({ row, col })
        return
      }
      case 'select': {
        // 如果已有选区且点击在选区内 → 拖拽选区框
        if (selectionStart.value && selectionEnd.value && isPointInSelection(row, col, editorStore.selectionInfo)) {
          editorStore.startSelectionBoxDrag({ row, col })
          return
        }
        // 否则开始新选区
        editorStore.startSelectDrawing({ row, col })
        return
      }
      case 'move': {
        // 如果已有选区且点击在选区内 → 开始拖拽
        if (selectionStart.value && selectionEnd.value && isPointInSelection(row, col, editorStore.selectionInfo)) {
          // Ctrl 临时反转模式：复制模式下按Ctrl为剪贴，剪贴模式下按Ctrl为复制
          const baseIsCopy = moveToolMode.value === 'copy'
          const isCopy = e.ctrlKey || e.metaKey ? !baseIsCopy : baseIsCopy
          editorStore.startSelectionDrag({ row, col }, isCopy)
          return
        }
        return
      }
    }
  }

  function handleCanvasMouseUp(e?: MouseEvent) {
    // 画笔/橡皮 - 松开鼠标或离开画布都停止
    if (isPainting.value) {
      isPainting.value = false
      lastPaintCell.value = null
      return
    }

    // 画线 - 只在真正的 mouseup 时提交（不响应 mouseleave）
    if (lineDrawing.value && lineStart.value && currentDrawEnd.value && e) {
      const points = getLinePoints(lineStart.value.row, lineStart.value.col, currentDrawEnd.value.row, currentDrawEnd.value.col)
      applyColorToPointsWrapper(points)
      editorStore.endLineDrawing()
      return
    }

    // 画矩形 - 只在真正的 mouseup 时提交
    if (rectDrawing.value && selectionStart.value && currentDrawEnd.value && e) {
      const points = getRectPoints(selectionStart.value.row, selectionStart.value.col, currentDrawEnd.value.row, currentDrawEnd.value.col)
      applyColorToPointsWrapper(points)
      editorStore.endRectDrawing()
      return
    }

    // 选区绘制结束 - 只在真正的 mouseup 时确认选区
    if (selectDrawing.value && selectionStart.value && e) {
      editorStore.endSelectDrawing()
      return
    }

    // 选区框拖拽结束 - 只在真正的 mouseup 时应用偏移
    if (selectionBoxDragging.value && e) {
      editorStore.endSelectionBoxDrag()
      justFinishedDrag = true
      scheduleRender()
      return
    }

    // 选区拖拽结束 - 只在真正的 mouseup 时提交
    if (selectionDragging.value && selectionDragStart.value && selectionEnd.value && e) {
      const { dr, dc } = selectionDragOffset.value
      if (dr !== 0 || dc !== 0) {
        const info = editorStore.selectionInfo
        if (info && mappedPixelData.value && gridDimensions.value) {
          const { N, M } = gridDimensions.value
          const isCopy = isCopyingSelection.value
          if (!isCopy) editorStore.saveSnapshot(mappedPixelData.value)

          // 读取选区内容
          const cells: (typeof mappedPixelData.value[0][0])[][] = []
          for (let r = info.startRow; r <= info.endRow; r++) {
            const rowCells: typeof mappedPixelData.value[0][0][] = []
            for (let c = info.startCol; c <= info.endCol; c++) {
              rowCells.push(mappedPixelData.value[r]?.[c] ? { ...mappedPixelData.value[r][c] } : null)
            }
            cells.push(rowCells)
          }

          // 如果是移动（非复制），先清空原位置
          if (!isCopy) {
            for (let r = info.startRow; r <= info.endRow; r++) {
              for (let c = info.startCol; c <= info.endCol; c++) {
                if (mappedPixelData.value[r]?.[c] && !mappedPixelData.value[r][c].isExternal) {
                  mappedPixelData.value[r][c] = { key: TRANSPARENT_KEY, color: '#FFFFFF', isExternal: true }
                }
              }
            }
          }

          // 写入目标位置
          for (let r = 0; r < cells.length; r++) {
            for (let c = 0; c < cells[r].length; c++) {
              const tr = info.startRow + r + dr
              const tc = info.startCol + c + dc
              if (tr >= 0 && tr < M && tc >= 0 && tc < N && cells[r][c]) {
                mappedPixelData.value[tr][tc] = { ...cells[r][c]! }
              }
            }
          }

          // 更新选区位置
          editorStore.setSelectionStart({ row: info.startRow + dr, col: info.startCol + dc })
          editorStore.setSelectionEnd({ row: info.endRow + dr, col: info.endCol + dc })
          scheduleRender()
        }
      }
      editorStore.endSelectionDrag()
      justFinishedDrag = true
      return
    }
  }

  // ========== Document 级别事件处理（支持鼠标移出画布） ==========

  function handleDocumentMouseMove(e: MouseEvent) {
    // 只在绘制/拖拽状态下处理
    if (!lineDrawing.value && !rectDrawing.value && !selectionDragging.value && !selectionBoxDragging.value) return
    if (!mappedPixelData.value || !gridDimensions.value) return

    const canvas = previewCanvas.value
    if (!canvas) return

    const coords = clientToGridCoords(e.clientX, e.clientY, canvas, gridDimensions.value)
    if (!coords) return
    const { i: col, j: row } = coords

    if (lineDrawing.value || rectDrawing.value) {
      editorStore.updateDrawEnd({ row, col })
      renderPreviewOverlay()
    }
    if (selectionDragging.value && selectionDragStart.value) {
      const dr = row - selectionDragStart.value.row
      const dc = col - selectionDragStart.value.col
      editorStore.updateSelectionDragOffset(dr, dc)
      // Ctrl 临时反转模式
      const baseIsCopy = moveToolMode.value === 'copy'
      editorStore.isCopyingSelection = e.ctrlKey || e.metaKey ? !baseIsCopy : baseIsCopy
      renderPreviewOverlay()
    }
    if (selectionBoxDragging.value && selectionBoxDragStart.value) {
      const dr = row - selectionBoxDragStart.value.row
      const dc = col - selectionBoxDragStart.value.col
      editorStore.updateSelectionBoxDragOffset(dr, dc)
      renderPreviewOverlay()
    }
  }

  function handleDocumentSelectMouseMove(e: MouseEvent) {
    // select 工具绘制选区时跟踪鼠标（仅在 mousedown 状态下）
    if (manualTool.value !== 'select' || !selectDrawing.value) return
    if (!mappedPixelData.value || !gridDimensions.value) return

    const canvas = previewCanvas.value
    if (!canvas) return

    const coords = clientToGridCoords(e.clientX, e.clientY, canvas, gridDimensions.value)
    if (!coords) return
    const { i: col, j: row } = coords

    editorStore.setSelectionEnd({ row, col })
    renderPreviewOverlay()
  }

  return {
    handleCanvasClick,
    handleCanvasHover,
    handleCanvasMouseDown,
    handleCanvasMouseUp,
    handleDocumentMouseMove,
    handleDocumentSelectMouseMove,
  }
}
