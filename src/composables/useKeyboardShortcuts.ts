import { onMounted, onUnmounted } from 'vue'
import { useEditorStore } from '@/stores/editorStore'
import { usePixelEditing } from './usePixelEditing'

export function useKeyboardShortcuts() {
  const editorStore = useEditorStore()
  const { undoEdit, redoEdit, exitFloodFillEraseMode, exitColorReplaceMode } = usePixelEditing()

  function handleKeyDown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault()
      undoEdit()
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault()
      redoEdit()
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
