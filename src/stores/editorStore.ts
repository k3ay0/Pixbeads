import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { MappedPixel, ColorCounts, ColorReplaceState, GridPoint } from '@/types'
import { TRANSPARENT_KEY } from '@/types'

export interface FloatingPaletteState {
  x: number
  y: number
  isDragging: boolean
  dragOffsetX: number
  dragOffsetY: number
  collapsed: boolean
}

export interface BgRemovalSnapshot {
  mappedPixelData: MappedPixel[][]
  colorCounts: ColorCounts
  totalBeadCount: number
}

export interface ColorData {
  key: string
  color: string
  isExternal?: boolean
}

export type ManualTool = 'drag' | 'brush' | 'eraser' | 'picker' | 'fill' | 'line' | 'rect' | 'select' | 'move'

export interface SelectionInfo {
  startRow: number
  startCol: number
  endRow: number
  endCol: number
  width: number
  height: number
}

export interface ClipboardData {
  cells: (MappedPixel | null)[][]
  width: number
  height: number
}

const MAX_HISTORY = 50

export const useEditorStore = defineStore('editor', () => {
  // ========== 手动编辑模式 ==========
  const isManualColoringMode = ref(false)
  const selectedEditColor = ref<ColorData | null>(null)
  const isEraseMode = ref(false)
  const colorReplaceState = ref<ColorReplaceState>({
    isActive: false,
    step: 'select-source',
  })
  const highlightColorKey = ref<string | null>(null)
  const showFullPalette = ref(false)

  // ========== 工具系统 ==========
  const manualTool = ref<ManualTool>('drag')
  const manualBrushSize = ref(1)
  const manualMirrorX = ref(false)
  const manualMirrorY = ref(false)
  const manualShapeFill = ref(false)
  const selectionStart = ref<GridPoint | null>(null)
  const selectionEnd = ref<GridPoint | null>(null)
  const clipboard = ref<ClipboardData | null>(null)
  const manualPasteActive = ref(false)
  const lineStart = ref<GridPoint | null>(null)

  // 绘制工具临时状态
  const lineDrawing = ref(false)     // 是否正在画线（mousedown → mouseup）
  const rectDrawing = ref(false)     // 是否正在画矩形
  const dragDrawing = ref(false)     // 是否正在拖拽绘制（通用）
  const currentDrawEnd = ref<GridPoint | null>(null)  // 当前绘制终点（预览用）
  const selectDrawing = ref(false)   // 是否正在绘制选区（mousedown → mouseup）
  const selectionBoxDragging = ref(false)  // 是否正在拖拽选区框（移动选区位置）
  const selectionBoxDragStart = ref<GridPoint | null>(null)  // 选区框拖拽起点
  const selectionBoxDragOffset = ref<{ dr: number; dc: number }>({ dr: 0, dc: 0 })  // 选区框拖拽偏移

  // 选区拖拽状态
  const selectionDragging = ref(false)       // 是否正在拖拽选区
  const selectionDragStart = ref<GridPoint | null>(null)  // 拖拽起点
  const selectionDragOffset = ref<{ dr: number; dc: number }>({ dr: 0, dc: 0 })  // 拖拽偏移
  const isCopyingSelection = ref(false)      // 是否为复制模式（Ctrl+拖拽）
  const moveToolMode = ref<'copy' | 'cut'>('copy')  // 移动工具模式：默认复制，可切换剪贴

  const selectionInfo = computed<SelectionInfo | null>(() => {
    if (!selectionStart.value || !selectionEnd.value) return null
    const sr = Math.min(selectionStart.value.row, selectionEnd.value.row)
    const er = Math.max(selectionStart.value.row, selectionEnd.value.row)
    const sc = Math.min(selectionStart.value.col, selectionEnd.value.col)
    const ec = Math.max(selectionStart.value.col, selectionEnd.value.col)
    return { startRow: sr, startCol: sc, endRow: er, endCol: ec, width: ec - sc + 1, height: er - sr + 1 }
  })

  // ========== 洪水填充擦除 ==========
  const isFloodFillEraseMode = ref(false)

  // ========== 撤销/重做 ==========
  const editHistory = ref<MappedPixel[][][]>([])
  const editHistoryIndex = ref(-1)

  // ========== 一键去背景 ==========
  const bgRemovalSnapshot = ref<BgRemovalSnapshot | null>(null)

  // ========== 放大镜 ==========
  const isMagnifierActive = ref(false)
  const magnifierSelectionArea = ref<any>(null)

  // ========== 悬浮调色盘 ==========
  const floatingPalette = ref<FloatingPaletteState>({
    x: 20,
    y: 200,
    isDragging: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
    collapsed: false,
  })

  // ========== Actions ==========

  // 手动编辑模式
  function enterManualMode() {
    isManualColoringMode.value = true
    selectedEditColor.value = null
    isEraseMode.value = false
    isFloodFillEraseMode.value = false
    resetColorReplaceState()
    highlightColorKey.value = null
    manualTool.value = 'drag'
  }

  function exitManualMode() {
    isManualColoringMode.value = false
    selectedEditColor.value = null
    isEraseMode.value = false
    resetColorReplaceState()
    highlightColorKey.value = null
    isFloodFillEraseMode.value = false
    isMagnifierActive.value = false
    magnifierSelectionArea.value = null
    selectionStart.value = null
    selectionEnd.value = null
    manualPasteActive.value = false
    lineStart.value = null
  }

  function setManualTool(tool: ManualTool) {
    manualTool.value = tool
    if (tool !== 'eraser') { isEraseMode.value = false; isFloodFillEraseMode.value = false }
    if (tool !== 'fill') { resetColorReplaceState(); highlightColorKey.value = null }
    if (tool !== 'select' && tool !== 'move') { selectionStart.value = null; selectionEnd.value = null }
    manualPasteActive.value = false
    lineStart.value = null
    lineDrawing.value = false
    rectDrawing.value = false
    dragDrawing.value = false
    currentDrawEnd.value = null
    selectDrawing.value = false
    selectionBoxDragging.value = false
    selectionBoxDragStart.value = null
    selectionBoxDragOffset.value = { dr: 0, dc: 0 }
    selectionDragging.value = false
    selectionDragStart.value = null
    selectionDragOffset.value = { dr: 0, dc: 0 }
    isCopyingSelection.value = false
  }

  function toggleEraseMode() {
    if (!isManualColoringMode.value) return
    if (colorReplaceState.value.isActive) {
      resetColorReplaceState()
      highlightColorKey.value = null
    }
    isEraseMode.value = !isEraseMode.value
    if (isEraseMode.value) {
      selectedEditColor.value = null
    }
  }

  function selectEditColor(color: ColorData | null) {
    if (!color) return
    if (color.key === TRANSPARENT_KEY && colorReplaceState.value.isActive) {
      resetColorReplaceState()
      highlightColorKey.value = null
    }
    if (isEraseMode.value) {
      isEraseMode.value = false
    }
    selectedEditColor.value = color
  }

  function resetColorReplaceState() {
    colorReplaceState.value = {
      isActive: false,
      step: 'select-source',
    }
  }

  /** 设置高亮颜色 */
  function setHighlight(colorHex: string) {
    highlightColorKey.value = colorHex
  }

  /** 切换颜色替换模式 */
  function toggleColorReplaceMode() {
    if (colorReplaceState.value.isActive) {
      resetColorReplaceState()
      highlightColorKey.value = null
    } else {
      isEraseMode.value = false
      selectedEditColor.value = null
      colorReplaceState.value = {
        isActive: true,
        step: 'select-source',
      }
    }
  }

  // 撤销/重做
  function saveSnapshot(data: MappedPixel[][]) {
    if (editHistoryIndex.value < editHistory.value.length - 1) {
      editHistory.value = editHistory.value.slice(0, editHistoryIndex.value + 1)
    }
    const snapshot = data.map(r => r.map(c => ({ ...c })))
    editHistory.value.push(snapshot)
    if (editHistory.value.length > MAX_HISTORY) {
      editHistory.value.shift()
    }
    editHistoryIndex.value = editHistory.value.length - 1
  }

  function undo(): MappedPixel[][] | null {
    if (editHistoryIndex.value < 0) return null
    const snapshot = editHistory.value[editHistoryIndex.value]
    editHistoryIndex.value--
    return snapshot.map(r => r.map(c => ({ ...c })))
  }

  function redo(): MappedPixel[][] | null {
    if (editHistoryIndex.value >= editHistory.value.length - 1) return null
    editHistoryIndex.value++
    const snapshot = editHistory.value[editHistoryIndex.value]
    return snapshot.map(r => r.map(c => ({ ...c })))
  }

  function clearHistory() {
    editHistory.value = []
    editHistoryIndex.value = -1
  }

  // 去背景
  function setBgRemovalSnapshot(snapshot: BgRemovalSnapshot) {
    bgRemovalSnapshot.value = snapshot
  }

  function clearBgRemovalSnapshot() {
    bgRemovalSnapshot.value = null
  }

  // 洪水填充擦除
  function enterFloodFillEraseMode() {
    manualTool.value = 'eraser'
    isFloodFillEraseMode.value = true
    isEraseMode.value = false
    selectedEditColor.value = null
    resetColorReplaceState()
  }

  function exitFloodFillEraseMode() {
    isFloodFillEraseMode.value = false
  }

  // 放大镜
  function toggleMagnifier() {
    if (isMagnifierActive.value) {
      exitMagnifierMode()
    } else {
      isMagnifierActive.value = true
      magnifierSelectionArea.value = null
      isEraseMode.value = false
      isFloodFillEraseMode.value = false
      colorReplaceState.value.isActive = false
      selectedEditColor.value = null
    }
  }

  function exitMagnifierMode() {
    isMagnifierActive.value = false
    magnifierSelectionArea.value = null
  }

  // 选区操作
  function setSelectionStart(p: GridPoint) {
    selectionStart.value = p
    selectionEnd.value = p
  }

  function setSelectionEnd(p: GridPoint) {
    selectionEnd.value = p
  }

  function clearSelection() {
    selectionStart.value = null
    selectionEnd.value = null
  }

  function setClipboard(data: ClipboardData) {
    clipboard.value = data
  }

  function clearClipboard() {
    clipboard.value = null
    manualPasteActive.value = false
  }

  function startPaste() {
    if (clipboard.value) manualPasteActive.value = true
  }

  function cancelPaste() {
    manualPasteActive.value = false
  }

  // 绘制工具状态管理
  function startLineDrawing(start: GridPoint) {
    lineDrawing.value = true
    lineStart.value = start
    currentDrawEnd.value = start
  }

  function updateDrawEnd(p: GridPoint) {
    currentDrawEnd.value = p
  }

  function endLineDrawing() {
    lineDrawing.value = false
    lineStart.value = null
    currentDrawEnd.value = null
  }

  function startRectDrawing(start: GridPoint) {
    rectDrawing.value = true
    selectionStart.value = start
    currentDrawEnd.value = start
  }

  function endRectDrawing() {
    rectDrawing.value = false
    currentDrawEnd.value = null
  }

  function startSelectDrawing(start: GridPoint) {
    selectDrawing.value = true
    selectionStart.value = start
    selectionEnd.value = start
  }

  function endSelectDrawing() {
    selectDrawing.value = false
  }

  // 选区框拖拽（移动选区位置，不移动内容）
  function startSelectionBoxDrag(start: GridPoint) {
    selectionBoxDragging.value = true
    selectionBoxDragStart.value = start
    selectionBoxDragOffset.value = { dr: 0, dc: 0 }
  }

  function updateSelectionBoxDragOffset(dr: number, dc: number) {
    selectionBoxDragOffset.value = { dr, dc }
  }

  function endSelectionBoxDrag() {
    if (selectionStart.value && selectionEnd.value) {
      const { dr, dc } = selectionBoxDragOffset.value
      if (dr !== 0 || dc !== 0) {
        // 应用偏移到选区位置
        selectionStart.value = { row: selectionStart.value.row + dr, col: selectionStart.value.col + dc }
        selectionEnd.value = { row: selectionEnd.value.row + dr, col: selectionEnd.value.col + dc }
      }
    }
    selectionBoxDragging.value = false
    selectionBoxDragStart.value = null
    selectionBoxDragOffset.value = { dr: 0, dc: 0 }
  }

  function toggleMoveToolMode() {
    moveToolMode.value = moveToolMode.value === 'copy' ? 'cut' : 'copy'
  }

  // 选区拖拽
  function startSelectionDrag(start: GridPoint, copy: boolean) {
    selectionDragging.value = true
    selectionDragStart.value = start
    isCopyingSelection.value = copy
    selectionDragOffset.value = { dr: 0, dc: 0 }
  }

  function updateSelectionDragOffset(dr: number, dc: number) {
    selectionDragOffset.value = { dr, dc }
  }

  function endSelectionDrag() {
    selectionDragging.value = false
    selectionDragStart.value = null
    selectionDragOffset.value = { dr: 0, dc: 0 }
    isCopyingSelection.value = false
  }

  return {
    // State
    isManualColoringMode,
    selectedEditColor,
    isEraseMode,
    colorReplaceState,
    highlightColorKey,
    showFullPalette,
    isFloodFillEraseMode,
    editHistory,
    editHistoryIndex,
    bgRemovalSnapshot,
    isMagnifierActive,
    magnifierSelectionArea,
    floatingPalette,
    // Tool state
    manualTool,
    manualBrushSize,
    manualMirrorX,
    manualMirrorY,
    manualShapeFill,
    selectionStart,
    selectionEnd,
    selectionInfo,
    clipboard,
    manualPasteActive,
    lineStart,
    lineDrawing,
    rectDrawing,
    dragDrawing,
    currentDrawEnd,
    selectDrawing,
    selectionBoxDragging,
    selectionBoxDragStart,
    selectionBoxDragOffset,
    selectionDragging,
    selectionDragStart,
    selectionDragOffset,
    isCopyingSelection,
    moveToolMode,
    // Actions
    enterManualMode,
    exitManualMode,
    setManualTool,
    toggleEraseMode,
    selectEditColor,
    saveSnapshot,
    undo,
    redo,
    clearHistory,
    setBgRemovalSnapshot,
    clearBgRemovalSnapshot,
    enterFloodFillEraseMode,
    exitFloodFillEraseMode,
    toggleMagnifier,
    exitMagnifierMode,
    setSelectionStart,
    setSelectionEnd,
    clearSelection,
    setClipboard,
    clearClipboard,
    startPaste,
    cancelPaste,
    startLineDrawing,
    updateDrawEnd,
    endLineDrawing,
    startRectDrawing,
    endRectDrawing,
    startSelectDrawing,
    endSelectDrawing,
    startSelectionBoxDrag,
    updateSelectionBoxDragOffset,
    endSelectionBoxDrag,
    startSelectionDrag,
    updateSelectionDragOffset,
    endSelectionDrag,
    toggleMoveToolMode,
    resetColorReplaceState,
    setHighlight,
    toggleColorReplaceMode,
  }
})
