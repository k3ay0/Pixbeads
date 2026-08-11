import { onMounted, onUnmounted } from 'vue'
import { useEditorStore } from '@/stores/editorStore'
import { usePixelEditing } from './usePixelEditing'

export function useKeyboardShortcuts() {
  const editorStore = useEditorStore()
  const { undoEdit, redoEdit, exitFloodFillEraseMode, exitColorReplaceMode, fillSelection } = usePixelEditing()

  function handleKeyDown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault()
      undoEdit()
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault()
      redoEdit()
    }
    // Ctrl+Delete：在选区工具下用当前颜色填充选区
    if ((e.ctrlKey || e.metaKey) && (e.key === 'Delete' || e.key === 'Del') && editorStore.manualTool === 'select' && editorStore.selectedCells.size > 0) {
      e.preventDefault()
      fillSelection()
    }
    if (e.key === 'Escape') {
      if (editorStore.colorReplaceState.isActive) {
        exitColorReplaceMode()
      } else if (editorStore.isFloodFillEraseMode) {
        exitFloodFillEraseMode()
      } else if (editorStore.isMagnifierActive) {
        editorStore.exitMagnifierMode()
      }
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeyDown)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeyDown)
  })
}
