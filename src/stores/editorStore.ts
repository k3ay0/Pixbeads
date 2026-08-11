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
  const selectedEditColor = ref<MappedPixel | null>(null)
  const isEraseMode = ref(false)
  const colorReplaceState = ref<ColorReplaceState>({
    isActive: false,
    step: 'select-source',
  })
  const highlightColorKey = ref<string | null>(null)
  const showFullPalette = ref(false)

  // ========== 工具系统 ==========
  const manualTool = ref<ManualTool>('drag')
  const lastDrawTool = ref<ManualTool>('brush') // 进入橡皮擦前使用的工具，选色时恢复
  const manualBrushSize = ref(1)
  const manualMirrorX = ref(false)
  const manualMirrorY = ref(false)
  const manualShapeFill = ref(false)
  const selectionStart = ref<GridPoint | null>(null)
  const selectionEnd = ref<GridPoint | null>(null)
  const selectMode = ref<'rect' | 'single'>('rect') // 选区模式：矩形选区 / 单格选区
  const selectedCells = ref<Set<string>>(new Set()) // 选中的格子集合，key 为 "row,col"
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
    // 基于选中格子集合计算选区边界（支持多区域/非矩形选区）
    if (selectedCells.value.size === 0) return null
    let sr = Infinity, er = -Infinity, sc = Infinity, ec = -Infinity
    for (const key of selectedCells.value) {
      const [r, c] = key.split(',').map(Number)
      if (r < sr) sr = r
      if (r > er) er = r
      if (c < sc) sc = c
      if (c > ec) ec = c
    }
    return { startRow: sr, startCol: sc, endRow: er, endCol: ec, width: ec - sc + 1, height: er - sr + 1 }
  })

  // ========== 洪水填充擦除 ==========
  const isFloodFillEraseMode = ref(false)

  // ========== 撤销/重做 ==========
  const editHistory = ref<MappedPixel[][][]>([])
  const editHistoryTools = ref<string[]>([]) // 每条历史快照对应的操作工具名
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
    if (tool === 'eraser' && manualTool.value !== 'eraser') {
      // 记住进入橡皮擦前的绘制工具，选色时自动恢复
      lastDrawTool.value = manualTool.value
    }
    manualTool.value = tool
    if (tool !== 'eraser') { isEraseMode.value = false; isFloodFillEraseMode.value = false }
    if (tool !== 'fill') { resetColorReplaceState(); highlightColorKey.value = null }
    if (tool !== 'select' && tool !== 'move') { selectionStart.value = null; selectionEnd.value = null; selectedCells.value.clear() }
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

  function selectEditColor(color: MappedPixel | null) {
    if (!color) return
    if (color.key === TRANSPARENT_KEY && colorReplaceState.value.isActive) {
      resetColorReplaceState()
      highlightColorKey.value = null
    }
    if (isEraseMode.value || manualTool.value === 'eraser') {
      isEraseMode.value = false
      isFloodFillEraseMode.value = false
      if (manualTool.value === 'eraser') {
        // 橡皮擦下点击色号 → 自动恢复到上一个绘制工具
        setManualTool(lastDrawTool.value)
      }
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
  function saveSnapshot(data: MappedPixel[][], tool?: string) {
    if (editHistoryIndex.value < editHistory.value.length - 1) {
      editHistory.value = editHistory.value.slice(0, editHistoryIndex.value + 1)
      editHistoryTools.value = editHistoryTools.value.slice(0, editHistoryIndex.value + 1)
    }
    const snapshot = data.map(r => r.map(c => ({ ...c })))
    editHistory.value.push(snapshot)
    // 未指定工具名时根据当前工具推断
    editHistoryTools.value.push(tool || inferToolName())
    if (editHistory.value.length > MAX_HISTORY) {
      editHistory.value.shift()
      editHistoryTools.value.shift()
    }
    editHistoryIndex.value = editHistory.value.length - 1
  }

  // 根据当前工具状态推断历史记录的工具名
  function inferToolName(): string {
    if (isFloodFillEraseMode.value) return '区域擦除'
    if (isEraseMode.value || manualTool.value === 'eraser') return '橡皮擦'
    if (colorReplaceState.value.isActive) return '颜色替换'
    const toolNames: Record<string, string> = {
      drag: '拖拽', brush: '画笔', eraser: '橡皮擦', picker: '取色',
      fill: '填充', line: '直线', rect: '矩形', select: '选区', move: '移动',
    }
    return toolNames[manualTool.value] || '编辑'
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

  const canUndo = computed(() => editHistoryIndex.value >= 0)
  const canRedo = computed(() => editHistoryIndex.value < editHistory.value.length - 1)

  // 跳转到历史中的任意位置（index 为快照索引）
  function jumpToHistory(index: number): MappedPixel[][] | null {
    if (index < 0 || index >= editHistory.value.length) return null
    if (index === editHistoryIndex.value) return null
    editHistoryIndex.value = index
    const snapshot = editHistory.value[index]
    return snapshot.map(r => r.map(c => ({ ...c })))
  }

  function clearHistory() {
    editHistory.value = []
    editHistoryTools.value = []
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
    if (manualTool.value !== 'eraser') {
      lastDrawTool.value = manualTool.value
    }
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
    selectedCells.value.clear()
  }

  // 设置选区模式：'rect' 矩形选区 / 'single' 单格选区
  function setSelectMode(mode: 'rect' | 'single') {
    selectMode.value = mode
  }

  // 判断某格是否在选区内
  function isCellSelected(row: number, col: number): boolean {
    return selectedCells.value.has(`${row},${col}`)
  }

  // 矩形选区提交：将矩形区域并入（subtract=false）或移出（subtract=true）选区
  function commitSelectionRect(sr: number, sc: number, er: number, ec: number, subtract: boolean) {
    const r0 = Math.min(sr, er), r1 = Math.max(sr, er)
    const c0 = Math.min(sc, ec), c1 = Math.max(sc, ec)
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const key = `${r},${c}`
        if (subtract) selectedCells.value.delete(key)
        else selectedCells.value.add(key)
      }
    }
  }

  // 单格选区：点击并入（subtract=false）或移出（subtract=true）该格
  function toggleCellSelection(row: number, col: number, subtract: boolean) {
    const key = `${row},${col}`
    if (subtract) selectedCells.value.delete(key)
    else selectedCells.value.add(key)
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
        // 平移整个选区集合（含 selectionStart/End 预览点）
        translateSelection(dr, dc)
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

  // 平移整个选区格子集合（移动选区/选区框后更新选中位置）
  function translateSelection(dr: number, dc: number) {
    if (dr === 0 && dc === 0) return
    const newSet = new Set<string>()
    for (const key of selectedCells.value) {
      const [r, c] = key.split(',').map(Number)
      newSet.add(`${r + dr},${c + dc}`)
    }
    selectedCells.value = newSet
    if (selectionStart.value) selectionStart.value = { row: selectionStart.value.row + dr, col: selectionStart.value.col + dc }
    if (selectionEnd.value) selectionEnd.value = { row: selectionEnd.value.row + dr, col: selectionEnd.value.col + dc }
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
    editHistoryTools,
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
    selectMode,
    selectedCells,
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
    canUndo,
    canRedo,
    jumpToHistory,
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
    setSelectMode,
    isCellSelected,
    commitSelectionRect,
    toggleCellSelection,
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
    translateSelection,
    endSelectionDrag,
    toggleMoveToolMode,
    resetColorReplaceState,
    setHighlight,
    toggleColorReplaceMode,
  }
})
