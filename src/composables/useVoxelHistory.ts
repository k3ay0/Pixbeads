import { ref, computed } from 'vue'
import { useVoxelStore, type VoxelData } from '@/stores/voxelStore'

export interface VoxelAction {
  x: number; y: number; z: number
  prev: VoxelData | null    // voxel before mutation (null = was empty)
  next: VoxelData | null    // voxel after mutation (null = deleted)
}

export interface UndoBatch {
  actions: VoxelAction[]
  tool: string  // for debugging
}

const MAX_HISTORY = 100

// Module-level singleton state (shared across all callers)
const undoStack = ref<UndoBatch[]>([])
const redoStack = ref<UndoBatch[]>([])

export function useVoxelHistory() {
  const store = useVoxelStore()

  function pushUndo(actions: VoxelAction[], tool = 'unknown'): void {
    if (actions.length === 0) return
    undoStack.value.push({ actions, tool })
    // Cap at MAX_HISTORY
    while (undoStack.value.length > MAX_HISTORY) {
      undoStack.value.shift()
    }
    // New action clears redo stack
    redoStack.value = []
  }

  function undo(): boolean {
    const batch = undoStack.value.pop()
    if (!batch) return false

    redoStack.value.push(batch)

    // Apply in REVERSE order: for each action, restore prev value
    for (const action of [...batch.actions].reverse()) {
      if (action.prev) {
        store.setVoxel(action.x, action.y, action.z, action.prev.color, action.prev.alpha ?? 255, action.prev.direction)
      } else {
        store.deleteVoxel(action.x, action.y, action.z)
      }
    }

    return true
  }

  function redo(): boolean {
    const batch = redoStack.value.pop()
    if (!batch) return false

    undoStack.value.push(batch)

    // Apply forward: for each action, apply next value
    for (const action of batch.actions) {
      if (action.next) {
        store.setVoxel(action.x, action.y, action.z, action.next.color, action.next.alpha ?? 255, action.next.direction)
      } else {
        store.deleteVoxel(action.x, action.y, action.z)
      }
    }

    return true
  }

  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  function clearHistory(): void {
    undoStack.value = []
    redoStack.value = []
  }

  return {
    undoStack,
    redoStack,
    canUndo,
    canRedo,
    pushUndo,
    undo,
    redo,
    clearHistory,
    MAX_HISTORY,
  }
}
