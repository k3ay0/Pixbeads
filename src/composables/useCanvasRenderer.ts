/**
 * 画布渲染 composable
 * 提供主画布和预览覆盖层的渲染逻辑
 */

import { ref, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useBeadStore } from '@/stores/beadStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { useEditorStore } from '@/stores/editorStore'
import { useUiStore } from '@/stores/uiStore'
import { useFocusStore } from '@/stores/focusStore'
import { usePaletteStore } from '@/stores/paletteStore'
import { CELL_SIZE } from '@/constants/canvasConstants'
import { getLinePoints, getRectPoints } from '@/utils/drawingAlgorithms'
import { getColorKeyByHex, getDisplayKey } from '@/utils/colorSystemUtils'
import { getContrastColor } from '@/utils/colorUtils'

export function useCanvasRenderer(
  canvasAreaRef: Ref<any>,
  previewOverlayCanvas: Ref<HTMLCanvasElement | null>,
  hoverCell: Ref<{ row: number; col: number } | null>,
  marchingAntsOffset: Ref<number>
) {
  const beadStore = useBeadStore()
  const canvasStore = useCanvasStore()
  const editorStore = useEditorStore()
  const uiStore = useUiStore()
  const focusStore = useFocusStore()
  const paletteStore = usePaletteStore()

  const { mappedPixelData, gridDimensions } = storeToRefs(beadStore)
  const { previewCanvas, canvasZoom, canvasTranslate } = storeToRefs(canvasStore)
  const {
    selectedEditColor, isEraseMode, manualTool, manualBrushSize,
    manualMirrorX, manualMirrorY, highlightColorKey,
    lineDrawing, rectDrawing, selectDrawing,
    selectionBoxDragging, selectionBoxDragOffset,
    selectionDragging, selectionDragOffset, isCopyingSelection,
    lineStart, selectionStart, currentDrawEnd,
  } = storeToRefs(editorStore)
  const { activeMode } = storeToRefs(uiStore)
  const { showCoordinates, coordinateInterval, showColorCodes } = storeToRefs(focusStore)
  const { selectedColorSystem } = storeToRefs(paletteStore)

  let renderScheduled = false

  /** requestAnimationFrame 合并渲染，避免同一帧内重复绘制 */
  function scheduleRender() {
    if (renderScheduled) return
    renderScheduled = true
    requestAnimationFrame(() => {
      renderScheduled = false
      renderCanvas()
    })
  }

  /** 主画布渲染 — 使用 canvas 原生 scale/translate 实现缩放和拖拽 */
  function renderCanvas() {
    const canvas = previewCanvas.value
    if (!canvas || !mappedPixelData.value || !gridDimensions.value) {
      return
    }
    const { N, M } = gridDimensions.value
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    // 获取容器尺寸，canvas 填满容器
    const container = canvasStore.canvasContainer
    const containerW = container ? container.clientWidth : N * CELL_SIZE
    const containerH = container ? container.clientHeight : M * CELL_SIZE

    canvas.width = containerW * dpr
    canvas.height = containerH * dpr
    canvas.style.width = `${containerW}px`
    canvas.style.height = `${containerH}px`

    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = false

    // 网格逻辑尺寸
    const gridW = N * CELL_SIZE
    const gridH = M * CELL_SIZE

    // 初始缩放：将网格适配到容器（fit-to-container）
    const fitScale = Math.min(containerW / gridW, containerH / gridH)

    // 原生缩放 = DPR × 适配缩放 × 用户缩放
    const totalScale = dpr * fitScale * canvasZoom.value
    ctx.scale(totalScale, totalScale)
    // 平移：先除以 fitScale 转换到网格坐标系，再加用户偏移
    ctx.translate(canvasTranslate.value.x / (fitScale * canvasZoom.value), canvasTranslate.value.y / (fitScale * canvasZoom.value))

    ctx.clearRect(
      -canvasTranslate.value.x / (fitScale * canvasZoom.value) - 10,
      -canvasTranslate.value.y / (fitScale * canvasZoom.value) - 10,
      gridW + 20,
      gridH + 20
    )


    let drawn = 0, skipped = 0
    for (let j = 0; j < M; j++) for (let i = 0; i < N; i++) {
      const cell = mappedPixelData.value[j]?.[i]; if (!cell) { skipped++; continue }
      const x = i * CELL_SIZE, y = j * CELL_SIZE
      if (cell.isExternal) { ctx.clearRect(x, y, CELL_SIZE, CELL_SIZE); continue }
      ctx.fillStyle = cell.color; ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE)
      ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 0.5; ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE)

      // 色号文字
      if (showColorCodes.value) {
        const displayKey = getDisplayKey(cell, selectedColorSystem.value)
        if (displayKey && displayKey !== '?') {
          const fontSize = Math.max(6, Math.floor(CELL_SIZE * 0.5))
          ctx.fillStyle = getContrastColor(cell.color)
          ctx.font = `${fontSize}px sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(displayKey, x + CELL_SIZE / 2, y + CELL_SIZE / 2)
        }
      }

      drawn++
    }

    // 绘制坐标标签（四周显示）
    if (showCoordinates.value) {
      const fontSize = Math.max(9, Math.min(12, Math.floor(CELL_SIZE * 0.7)))
      const maxNum = Math.max(N, M)
      const digits = maxNum.toString().length
      const al = Math.max(fontSize + 4, Math.floor(digits * fontSize * 0.6 + 4))
      ctx.fillStyle = '#F5F5F5'
      // 上方列号背景
      ctx.fillRect(0, -al, gridW, al)
      // 下方列号背景
      ctx.fillRect(0, gridH, gridW, al)
      // 左侧行号背景
      ctx.fillRect(-al, 0, al, gridH)
      // 右侧行号背景
      ctx.fillRect(gridW, 0, al, gridH)

      ctx.fillStyle = '#333333'
      ctx.font = `${fontSize}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      // 使用用户设定的间隔
      const interval = Math.max(1, coordinateInterval.value)

      // 列号（上方和下方）
      for (let i = 0; i < N; i += interval) {
        const x = i * CELL_SIZE + CELL_SIZE / 2
        ctx.fillText((i + 1).toString(), x, -al / 2)
        ctx.fillText((i + 1).toString(), x, gridH + al / 2)
      }

      // 行号（左侧和右侧）
      for (let j = 0; j < M; j += interval) {
        const y = j * CELL_SIZE + CELL_SIZE / 2
        ctx.textAlign = 'center'
        ctx.fillText((j + 1).toString(), -al / 2, y)
        ctx.fillText((j + 1).toString(), gridW + al / 2, y)
      }
    }

    if (highlightColorKey.value) {
      ctx!.fillStyle = 'rgba(255, 255, 0, 0.3)'
      for (let j = 0; j < M; j++) for (let i = 0; i < N; i++) {
        const cell = mappedPixelData.value[j]?.[i]
        if (cell && !cell.isExternal && cell.color.toUpperCase() === highlightColorKey.value.toUpperCase())
          ctx!.fillRect(i * CELL_SIZE, j * CELL_SIZE, CELL_SIZE, CELL_SIZE)
      }
    }
    // 选区高亮
    const selInfo = editorStore.selectionInfo
    if (selInfo) {
      ctx!.strokeStyle = 'rgba(59, 130, 246, 0.8)'
      ctx!.lineWidth = 2
      ctx!.setLineDash([4, 4])
      ctx!.strokeRect(
        selInfo.startCol * CELL_SIZE,
        selInfo.startRow * CELL_SIZE,
        selInfo.width * CELL_SIZE,
        selInfo.height * CELL_SIZE
      )
      ctx!.setLineDash([])
      ctx!.fillStyle = 'rgba(59, 130, 246, 0.1)'
      ctx!.fillRect(
        selInfo.startCol * CELL_SIZE,
        selInfo.startRow * CELL_SIZE,
        selInfo.width * CELL_SIZE,
        selInfo.height * CELL_SIZE
      )
    }
  }

  /** 笔刷预览 overlay（独立 canvas，使用原生缩放与主 canvas 同步） */
  function renderPreviewOverlay() {
    const overlay = canvasAreaRef.value?.previewOverlayCanvas || previewOverlayCanvas.value
    const mainCanvas = previewCanvas.value
    if (!overlay || !mainCanvas) return
    overlay.width = mainCanvas.width
    overlay.height = mainCanvas.height
    overlay.style.width = mainCanvas.style.width
    overlay.style.height = mainCanvas.style.height
    const ctx = overlay.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, overlay.width, overlay.height)
    // 与主 canvas 一致的缩放参数
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const gd = gridDimensions.value
    const container = canvasStore.canvasContainer
    const gridW = gd ? gd.N * CELL_SIZE : mainCanvas.width
    const gridH = gd ? gd.M * CELL_SIZE : mainCanvas.height
    const containerW = container ? container.clientWidth : gridW
    const containerH = container ? container.clientHeight : gridH
    const fitScale = Math.min(containerW / gridW, containerH / gridH)
    const totalScale = dpr * fitScale * canvasZoom.value
    ctx.scale(totalScale, totalScale)
    ctx.translate(canvasTranslate.value.x / (fitScale * canvasZoom.value), canvasTranslate.value.y / (fitScale * canvasZoom.value))
    const hc = hoverCell.value
    if (!gd || activeMode.value !== 'edit') return

    const { N, M } = gd

    function drawCell(r: number, c: number, fill: string, stroke: string) {
      if (r < 0 || r >= M || c < 0 || c >= N) return
      ctx.fillStyle = fill
      ctx.fillRect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE)
      ctx.strokeStyle = stroke
      ctx.lineWidth = 1
      ctx.strokeRect(c * CELL_SIZE + 0.5, r * CELL_SIZE + 0.5, CELL_SIZE - 1, CELL_SIZE - 1)
    }

    // 画笔/橡皮预览
    if ((manualTool.value === 'brush' || manualTool.value === 'eraser') && hc) {
      const size = manualBrushSize.value
      // 计算笔刷范围：奇数大小以中心对称，偶数大小偏右下
      const halfBefore = Math.floor((size - 1) / 2)
      const halfAfter = Math.ceil((size - 1) / 2)
      const isErase = isEraseMode.value || manualTool.value === 'eraser'
      const fill = isErase ? 'rgba(239,68,68,0.3)' : 'rgba(59,130,246,0.3)'
      const stroke = isErase ? 'rgba(239,68,68,0.6)' : 'rgba(59,130,246,0.6)'
      for (let dr = -halfBefore; dr <= halfAfter; dr++) {
        for (let dc = -halfBefore; dc <= halfAfter; dc++) {
          drawCell(hc.row + dr, hc.col + dc, fill, stroke)
          if (manualMirrorX.value) drawCell(hc.row + dr, N - 1 - hc.col - dc, fill, stroke)
          if (manualMirrorY.value) drawCell(M - 1 - hc.row - dr, hc.col + dc, fill, stroke)
          if (manualMirrorX.value && manualMirrorY.value) drawCell(M - 1 - hc.row - dr, N - 1 - hc.col - dc, fill, stroke)
        }
      }
    }

    // 画线预览
    if (manualTool.value === 'line' && lineDrawing.value && lineStart.value && currentDrawEnd.value) {
      const points = getLinePoints(lineStart.value.row, lineStart.value.col, currentDrawEnd.value.row, currentDrawEnd.value.col)
      for (const p of points) drawCell(p.row, p.col, 'rgba(59,130,246,0.3)', 'rgba(59,130,246,0.6)')
    }

    // 画矩形预览
    if (manualTool.value === 'rect' && rectDrawing.value && selectionStart.value && currentDrawEnd.value) {
      const points = getRectPoints(selectionStart.value.row, selectionStart.value.col, currentDrawEnd.value.row, currentDrawEnd.value.col)
      for (const p of points) drawCell(p.row, p.col, 'rgba(59,130,246,0.3)', 'rgba(59,130,246,0.6)')
    }

    // 选区高亮（marching ants 效果）
    const selInfo = editorStore.selectionInfo
    if (selInfo && (manualTool.value === 'select' || manualTool.value === 'move')) {
      // 根据拖拽类型选择偏移
      let offsetR = 0, offsetC = 0
      if (selectionBoxDragging.value) {
        offsetR = selectionBoxDragOffset.value.dr
        offsetC = selectionBoxDragOffset.value.dc
      } else if (selectionDragging.value) {
        offsetR = selectionDragOffset.value.dr
        offsetC = selectionDragOffset.value.dc
      }
      const x1 = (selInfo.startCol + offsetC) * CELL_SIZE
      const y1 = (selInfo.startRow + offsetR) * CELL_SIZE
      const w = selInfo.width * CELL_SIZE
      const h = selInfo.height * CELL_SIZE

      // 拖拽时显示半透明覆盖
      if (selectionDragging.value) {
        ctx.fillStyle = 'rgba(59, 130, 246, 0.15)'
        ctx.fillRect(x1, y1, w, h)
      }

      // Marching ants 边框
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 4])
      ctx.lineDashOffset = -marchingAntsOffset.value
      ctx.strokeRect(x1, y1, w, h)
      // 反色内边框（增强可见性）
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'
      ctx.lineDashOffset = -(marchingAntsOffset.value + 5)
      ctx.strokeRect(x1, y1, w, h)
      ctx.setLineDash([])

      // 复制模式标识
      if (isCopyingSelection.value && selectionDragging.value) {
        ctx.fillStyle = 'rgba(34, 197, 94, 0.6)'
        ctx.font = 'bold 12px sans-serif'
        ctx.fillText('复制', x1 + 4, y1 + 14)
      }
    }

    // select 工具鼠标悬停提示（无选区时）
    if (manualTool.value === 'select' && hc && !selectionStart.value) {
      drawCell(hc.row, hc.col, 'rgba(59,130,246,0.15)', 'rgba(59,130,246,0.4)')
    }
  }

  function clearPreviewOverlay() {
    const overlay = canvasAreaRef.value?.previewOverlayCanvas || previewOverlayCanvas.value
    if (!overlay) return
    const ctx = overlay.getContext('2d')
    if (ctx) ctx.clearRect(0, 0, overlay.width, overlay.height)
  }

  return {
    scheduleRender,
    renderCanvas,
    renderPreviewOverlay,
    clearPreviewOverlay,
  }
}
