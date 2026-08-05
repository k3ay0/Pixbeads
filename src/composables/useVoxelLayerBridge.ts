/**
 * useVoxelLayerBridge — bridges the 2D bead editor (MappedPixel[][]) and
 * the 3D voxel editor (useVoxelStore).
 *
 * Provides:
 *  - export2DLayer(z) → MappedPixel[][]  (voxels at Z → 2D grid)
 *  - import2DLayer(data, z) → VoxelAction[]  (2D grid → voxel CRUD actions)
 */
import { useVoxelStore } from '@/stores/voxelStore'
import type { VoxelAction } from '@/composables/useVoxelHistory'
import type { MappedPixel } from '@/types'
import { TRANSPARENT_KEY } from '@/types'
import { transparentColorData } from '@/types'

export function useVoxelLayerBridge() {
  const store = useVoxelStore()

  /**
   * Export a Z-layer as MappedPixel[][] (2D grid).
   *
   * Grid dimensions: N = dimW (columns), M = dimH (rows).
   * Each cell maps:
   *   voxel exists & visible → MappedPixel with key='?', color, isExternal=false
   *   no voxel / alpha=0    → transparent MappedPixel (key=ERASE, isExternal=true)
   */
  function export2DLayer(z: number): MappedPixel[][] {
    const N = store.dimW // columns
    const M = store.dimH // rows
    const grid: MappedPixel[][] = []

    for (let row = 0; row < M; row++) {
      const rowData: MappedPixel[] = []
      for (let col = 0; col < N; col++) {
        // Voxel coordinates: x=col, y=row, z=z
        const voxel = store.getVoxel(col, row, z)
        if (voxel && (voxel.alpha ?? 255) > 0) {
          rowData.push({
            key: '?', // Unknown bead key in 2D system — caller resolves via color
            color: voxel.color,
            isExternal: false,
          })
        } else {
          rowData.push({
            ...transparentColorData,
          })
        }
      }
      grid.push(rowData)
    }

    return grid
  }

  /**
   * Import a MappedPixel[][] as a Z-layer.
   * Returns VoxelAction[] suitable for undo recording.
   *
   * Mapping:
   *   isExternal / transparent → delete any existing voxel
   *   non-external             → set voxel with cell color
   */
  function import2DLayer(data: MappedPixel[][], z: number): VoxelAction[] {
    const actions: VoxelAction[] = []

    for (let row = 0; row < data.length; row++) {
      const rowData = data[row]
      for (let col = 0; col < rowData.length; col++) {
        const cell = rowData[col]
        const x = col
        const y = row

        if (cell.isExternal || cell.key === TRANSPARENT_KEY) {
          // Remove any existing voxel at this position
          const prev = store.deleteVoxel(x, y, z)
          if (prev) {
            actions.push({ x, y, z, prev, next: null })
          }
        } else {
          // Set voxel with cell color
          const result = store.setVoxel(x, y, z, cell.color)
          if (result) {
            actions.push({ x, y, z, prev: result.prev, next: result.next })
          }
        }
      }
    }

    return actions
  }

  return {
    export2DLayer,
    import2DLayer,
  }
}
