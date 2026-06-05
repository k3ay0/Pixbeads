import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { MappedPixel, ColorCounts, ColorReplaceState } from '@/types'
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
    resetColorReplaceState()
    highlightColorKey.value = null
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
    // Actions
    enterManualMode,
    exitManualMode,
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
  }
})
