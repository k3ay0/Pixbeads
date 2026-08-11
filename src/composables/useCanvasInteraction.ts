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
import { getColorKeyByHex, getDisplayKey } from '@/utils/colorSystemUtils'
import { floodFill } from '@/utils/pixelation'
import { floodFillArea } from '@/utils/gridOperations'
import {
  getLinePoints,
  getRectPoints,
  applyColorToPoints as applyColorToPointsUtil,
} from '@/utils/drawingAlgorithms'
import { TRANSPARENT_KEY, type MappedPixel } from '@/types'

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
  const { previewCanvas, isDragging, canvasZoom, canvasTranslate } = storeToRefs(canvasStore)
  const {
    selectedEditColor, isEraseMode, manualTool, manualBrushSize,
    manualMirrorX, manualMirrorY, isFloodFillEraseMode,
    selectionStart, selectionEnd, lineStart, clipboard,
    lineDrawing, rectDrawing, selectDrawing,
    selectionBoxDragging, selectionBoxDragStart, selectionBoxDragOffset,
    selectionDragging, selectionDragStart, selectionDragOffset, isCopyingSelection, moveToolMode,
    selectMode, selectedCells,
    currentDrawEnd,
  } = storeToRefs(editorStore)
  const { activeMode } = storeToRefs(uiStore)
  const { selectedColorSystem } = storeToRefs(paletteStore)

  // 标记是否刚完成拖拽操作，防止mouseup后触发click
  let justFinishedDrag = false

  // 单格选区连续选择状态（长按拖动连续选中格子，类似画笔）
  const isCellSelecting = ref(false)
  const lastCellSelectCell = ref<{ row: number; col: number } | null>(null)
  const cellSelectSubtract = ref(false) // 本次拖动是否为减除模式（Ctrl）

  // ========== 辅助函数 ==========

  /** 绘画核心函数：在指定格子应用笔刷 */
  function paintAtCell(row: number, col: number) {
    if (!mappedPixelData.value || !gridDimensions.value) return
    const { N, M } = gridDimensions.value
    const size = manualBrushSize.value
    // 计算笔刷范围：奇数大小以中心对称，偶数大小偏右下
    const halfBefore = Math.floor((size - 1) / 2)
    const halfAfter = Math.ceil((size - 1) / 2)
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

    for (let dr = -halfBefore; dr <= halfAfter; dr++) {
      for (let dc = -halfBefore; dc <= halfAfter; dc++) {
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
    const coords = clientToGridCoords(e.clientX, e.clientY, canvas, gridDimensions.value, canvasZoom.value, canvasTranslate.value)
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
              editorStore.saveSnapshot(mappedPixelData.value, '颜色替换')
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
          editorStore.saveSnapshot(mappedPixelData.value, '填充')
          const newPixelData = floodFill(mappedPixelData.value, gridDimensions.value!, row, col, { key: selectedEditColor.value.key, color: selectedEditColor.value.color })
          beadStore.mappedPixelData = newPixelData
          scheduleRender()
        }
        return
      }
      case 'select':
      case 'move':
      case 'drag':
      case 'line':
      case 'rect': {
        // 这些工具不处理点击事件，只处理 mousedown/mousemove/mouseup
        return
      }
      case 'eraser': {
        // 橡皮工具 — 区域擦除或单格擦除
        const cell = mappedPixelData.value[row]?.[col]
        if (!cell || cell.isExternal) return
        if (isFloodFillEraseMode.value) {
          // 洪水填充擦除
          const targetColor = cell.color.toUpperCase()
          editorStore.saveSnapshot(mappedPixelData.value, '区域擦除')
          const newData = floodFillArea(
            mappedPixelData.value,
            gridDimensions.value!,
            row, col,
            (c) => c.color.toUpperCase() === targetColor && !c.isExternal,
            () => ({ key: TRANSPARENT_KEY, color: '#FFFFFF', isExternal: true })
          )
          beadStore.mappedPixelData = newData
          scheduleRender()
        } else {
          // 单格擦除
          paintAtCell(row, col)
        }
        return
      }
      default: {
        // brush — 单击也触发一次绘画
        const cell = mappedPixelData.value[row]?.[col]
        if (!cell) return
        if (editorStore.colorReplaceState.isActive) {
          // 色替换点击
          const sourceColor = { key: cell.key, color: cell.color }
          const targetColor = selectedEditColor.value
          if (targetColor) {
            editorStore.saveSnapshot(mappedPixelData.value, '颜色替换')
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
        if (!selectedEditColor.value) {
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
    const coords = clientToGridCoords(e.clientX, e.clientY, canvas, gridDimensions.value, canvasZoom.value, canvasTranslate.value)
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
        canvasStore.setTooltip({ x: e.clientX - rect.left + 15, y: e.clientY - rect.top - 10, key: getDisplayKey(cell, selectedColorSystem.value), color: cell.color, row: row + 1, col: col + 1 })
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
      // 单格选区连续选择（长按拖动连续选中/减除格子）
      if (isCellSelecting.value && manualTool.value === 'select' && selectMode.value === 'single') {
        const last = lastCellSelectCell.value
        if (!last || last.row !== row || last.col !== col) {
          editorStore.toggleCellSelection(row, col, cellSelectSubtract.value)
          lastCellSelectCell.value = { row, col }
          renderPreviewOverlay()
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
    if (!gridDimensions.value) return
    const coords = clientToGridCoords(e.clientX, e.clientY, canvas, gridDimensions.value, canvasZoom.value, canvasTranslate.value)
    if (!coords) return
    const { i: col, j: row } = coords

    // 工具分发
    switch (manualTool.value) {
      case 'brush': {
        isPainting.value = true
        lastPaintCell.value = null
        paintAtCell(row, col)
        lastPaintCell.value = { row, col }
        return
      }
      case 'eraser': {
        // 区域擦除模式不启动连续绘画
        if (isFloodFillEraseMode.value) return
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
        // 单格选区模式：点击格子并入选区，Ctrl 点击移出选区；支持长按拖动连续选择
        if (selectMode.value === 'single') {
          const subtract = e.ctrlKey || e.metaKey
          isCellSelecting.value = true
          cellSelectSubtract.value = subtract
          lastCellSelectCell.value = null
          editorStore.toggleCellSelection(row, col, subtract)
          lastCellSelectCell.value = { row, col }
          scheduleRender()
          return
        }
        // Ctrl：始终开始减除绘制（从选区中挖除矩形）
        if (e.ctrlKey || e.metaKey) {
          editorStore.startSelectDrawing({ row, col })
          return
        }
        // 矩形选区模式：点击已选中的格子 → 拖拽选区框（移动选区位置）
        if (editorStore.isCellSelected(row, col)) {
          editorStore.startSelectionBoxDrag({ row, col })
          return
        }
        // 否则开始新选区（松开时并入现有选区）
        editorStore.startSelectDrawing({ row, col })
        return
      }
      case 'move': {
        // 如果点击的是选中的格子 → 开始拖拽
        if (editorStore.isCellSelected(row, col)) {
          // Ctrl 临时反转模式：复制模式下按Ctrl为剪贴，剪贴模式下按Ctrl为复制
          const baseIsCopy = moveToolMode.value === 'copy'
          const isCopy = e.ctrlKey || e.metaKey ? !baseIsCopy : baseIsCopy
          editorStore.startSelectionDrag({ row, col }, isCopy)
          return
        }
        return
      }
      case 'drag':
      case 'picker': {
        // 拖拽工具和取色器不处理 mousedown 绘制
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

    // 单格选区连续选择 - 松开鼠标停止
    if (isCellSelecting.value) {
      isCellSelecting.value = false
      lastCellSelectCell.value = null
      cellSelectSubtract.value = false
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

    // 选区绘制结束 - 只在真正的 mouseup 时确认选区（默认并入，Ctrl 减除）
    if (selectDrawing.value && selectionStart.value && e) {
      const s = selectionStart.value
      const en = selectionEnd.value
      if (s && en) {
        const subtract = e.ctrlKey || e.metaKey
        editorStore.commitSelectionRect(s.row, s.col, en.row, en.col, subtract)
        scheduleRender()
      }
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
        if (info && mappedPixelData.value && gridDimensions.value && selectedCells.value.size > 0) {
          const { N, M } = gridDimensions.value
          const isCopy = isCopyingSelection.value
          // 移动和复制都要进入修改历史
          editorStore.saveSnapshot(mappedPixelData.value, isCopy ? '复制选区' : '移动选区')

          // 读取选区内容（以边界左上角为原点，未选中格子为 null）
          const cells: (MappedPixel | null)[][] = []
          for (let r = info.startRow; r <= info.endRow; r++) {
            const rowCells: (MappedPixel | null)[] = []
            for (let c = info.startCol; c <= info.endCol; c++) {
              if (selectedCells.value.has(`${r},${c}`)) {
                rowCells.push(mappedPixelData.value[r]?.[c] ? { ...mappedPixelData.value[r][c] } : null)
              } else {
                rowCells.push(null)
              }
            }
            cells.push(rowCells)
          }

          // 如果是移动（非复制），先清空原位置（仅清选中的格子）
          if (!isCopy) {
            for (const key of selectedCells.value) {
              const [r, c] = key.split(',').map(Number)
              if (mappedPixelData.value[r]?.[c] && !mappedPixelData.value[r][c].isExternal) {
                mappedPixelData.value[r][c] = { key: TRANSPARENT_KEY, color: '#FFFFFF', isExternal: true }
              }
            }
          }

          // 写入目标位置（从备份的 cells 中读取，避免原位置已被清空）
          for (let r = 0; r < cells.length; r++) {
            for (let c = 0; c < cells[r].length; c++) {
              const cell = cells[r][c]
              if (!cell) continue
              const tr = info.startRow + r + dr
              const tc = info.startCol + c + dc
              if (tr >= 0 && tr < M && tc >= 0 && tc < N) {
                mappedPixelData.value[tr][tc] = { ...cell }
              }
            }
          }

          // 更新选区位置（平移整个选区集合）
          editorStore.translateSelection(dr, dc)
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

    const coords = clientToGridCoords(e.clientX, e.clientY, canvas, gridDimensions.value, canvasZoom.value, canvasTranslate.value)
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

    const coords = clientToGridCoords(e.clientX, e.clientY, canvas, gridDimensions.value, canvasZoom.value, canvasTranslate.value)
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
