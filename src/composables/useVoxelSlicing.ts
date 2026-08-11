import { useVoxelStore, type VoxelDirection } from '@/stores/voxelStore'

/**
 * A single 2D slice at a given axis position.
 * grid[sy][sx] = color string or null (empty).
 */
export interface Slice2D {
  axis: 'x' | 'y' | 'z'
  index: number
  width: number   // columns
  height: number  // rows
  grid: (string | null)[][]  // [row][col] → color
}

/**
 * All slices grouped by axis.
 */
export interface SlicingResult {
  x: Slice2D[]   // slices along X axis (YZ planes)
  y: Slice2D[]   // slices along Y axis (XZ planes)
  z: Slice2D[]   // slices along Z axis (XY planes)
}

/**
 * Composable that computes 2D cross-section slices of the voxel grid.
 * For each axis, only voxels whose direction is perpendicular to the
 * slicing face are included (direction === axis).
 */
export function useVoxelSlicing() {
  const store = useVoxelStore()

  /**
   * Compute a single 2D slice at the given axis and index.
   * Only includes voxels whose direction is perpendicular to the slice face.
   *
   * axis='x' → YZ plane at x=index, width=dimD (Z), height=dimH (Y)
   * axis='y' → XZ plane at y=index, width=dimW (X), height=dimD (Z)
   * axis='z' → XY plane at z=index, width=dimW (X), height=dimH (Y)
   */
  function computeSlice(axis: 'x' | 'y' | 'z', index: number): Slice2D {
    const { dimW, dimH, dimD, voxels, vk } = store

    let width: number
    let height: number

    if (axis === 'x') {
      width = dimD   // Z axis → columns
      height = dimH  // Y axis → rows
    } else if (axis === 'y') {
      width = dimW   // X axis → columns
      height = dimD  // Z axis → rows
    } else {
      width = dimW   // X axis → columns
      height = dimH  // Y axis → rows
    }

    // Initialize empty grid
    const grid: (string | null)[][] = []
    for (let r = 0; r < height; r++) {
      grid.push(new Array(width).fill(null))
    }

    // Iterate voxels and filter
    voxels.forEach((data, key) => {
      const [vx, vy, vz] = key.split(',').map(Number)

      // Check if voxel is on this slice
      const pos = axis === 'x' ? vx : axis === 'y' ? vy : vz
      if (pos !== index) return

      // Only include voxels perpendicular to the slice face
      const voxelDir: VoxelDirection = data.direction ?? 'y'
      if (voxelDir !== axis) return

      // Map 3D position to 2D grid coordinates
      let col: number
      let row: number

      if (axis === 'x') {
        // YZ plane: col = Z, row = Y (flipped so Y=0 is at top)
        col = vz
        row = vy
      } else if (axis === 'y') {
        // XZ plane: col = X, row = Z (flipped so Z=0 is at bottom → top)
        col = vx
        row = dimD - 1 - vz
      } else {
        // XY plane: col = X, row = Y (flipped so Y=0 is at top)
        col = vx
        row = dimH - 1 - vy
      }

      if (col >= 0 && col < width && row >= 0 && row < height) {
        grid[row][col] = data.color
      }
    })

    return { axis, index, width, height, grid }
  }

  /**
   * Compute all slices for all three axes.
   * Only returns slices that have at least one voxel.
   */
  function computeAllSlices(): SlicingResult {
    const result: SlicingResult = { x: [], y: [], z: [] }

    // X axis slices (YZ planes)
    for (let i = 0; i < store.dimW; i++) {
      const slice = computeSlice('x', i)
      if (hasAnyVoxel(slice)) result.x.push(slice)
    }

    // Y axis slices (XZ planes)
    for (let i = 0; i < store.dimH; i++) {
      const slice = computeSlice('y', i)
      if (hasAnyVoxel(slice)) result.y.push(slice)
    }

    // Z axis slices (XY planes)
    for (let i = 0; i < store.dimD; i++) {
      const slice = computeSlice('z', i)
      if (hasAnyVoxel(slice)) result.z.push(slice)
    }

    return result
  }

  /**
   * Check if a slice has any non-empty voxel.
   */
  function hasAnyVoxel(slice: Slice2D): boolean {
    for (let r = 0; r < slice.height; r++) {
      for (let c = 0; c < slice.width; c++) {
        if (slice.grid[r][c] !== null) return true
      }
    }
    return false
  }

  return {
    computeSlice,
    computeAllSlices,
    hasAnyVoxel,
  }
}
