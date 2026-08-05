import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type VoxelDirection = 'x' | 'y' | 'z'

export interface VoxelData {
  color: string    // hex color e.g. "#ff3070"
  alpha?: number   // 0-255, default 255 = fully opaque
  direction?: VoxelDirection  // voxel orientation: 'x' | 'y' | 'z', default 'y'
}

export type VoxelKey = string  // "x,y,z"
export type VoxelMap = Map<VoxelKey, VoxelData>
export type VoxelTool = 'pen' | 'line' | 'rect' | 'frect' | 'circle' | 'fcircle' | 'ellipse' | 'fellipse' | 'fill' | 'fillSlice' | 'eyedropper' | 'spray' | 'scatter' | 'noisePen' | 'sel' | 'paste'
export type EditMode = 'draw' | 'del' | 'recolor'
export type Point3D = { x: number; y: number; z: number }

export const useVoxelStore = defineStore('voxel', () => {
  // ===== STATE =====
  const voxels = ref<VoxelMap>(new Map())
  const dimW = ref(16)
  const dimH = ref(16)
  const dimD = ref(16)
  const currentTool = ref<VoxelTool>('pen')
  const brushSize = ref(1)       // range 1-8
  const selectedColor = ref('#ff3070')  // active draw color
  const mirrorX = ref(false)
  const mirrorY = ref(false)
  const mirrorZ = ref(false)
  const mirrorPoint = ref(false)  // 180° rotation around cylinder axis
  const mirrorCenterX = ref(8)
  const mirrorCenterY = ref(8)
  const mirrorCenterZ = ref(8)
  const editMode = ref<EditMode>('draw')
  const snapMode = ref<'cell' | 'edge'>('cell')
  const currentDirection = ref<VoxelDirection>('y')  // default direction for new voxels

  // ===== COMPUTED =====
  const voxelCount = computed(() => voxels.value.size)

  // ===== HELPERS =====
  function vk(x: number, y: number, z: number): VoxelKey {
    return `${x},${y},${z}`
  }
  function pv(k: VoxelKey): [number, number, number] {
    return k.split(',').map(Number) as [number, number, number]
  }

  // ===== CRUD =====
  function getVoxel(x: number, y: number, z: number): VoxelData | undefined {
    return voxels.value.get(vk(x, y, z))
  }

  /** Returns null if out of bounds or no change. Returns prev+next for undo. */
  function setVoxel(x: number, y: number, z: number, color: string, alpha = 255, direction?: VoxelDirection): { prev: VoxelData | null; next: VoxelData } | null {
    if (x < 0 || y < 0 || z < 0 || x >= dimW.value || y >= dimH.value || z >= dimD.value) return null
    const key = vk(x, y, z)
    const existing = voxels.value.get(key)
    const nextDirection = direction ?? existing?.direction ?? 'y'
    // Check if anything changed (color, alpha, or direction)
    if (existing && existing.color === color && (existing.alpha ?? 255) === alpha && existing.direction === nextDirection) return null // no change
    const prev = existing ? { ...existing } : null
    const next = { color, alpha, direction: nextDirection }
    voxels.value.set(key, next)
    return { prev, next }
  }

  /** Returns null if no voxel existed. */
  function deleteVoxel(x: number, y: number, z: number): VoxelData | null {
    const key = vk(x, y, z)
    const existing = voxels.value.get(key)
    if (!existing) return null
    voxels.value.delete(key)
    return { ...existing }
  }

  /** Recolor existing voxel without delete+recreate. Also updates direction. */
  function recolorVoxel(x: number, y: number, z: number, color: string, alpha = 255, direction?: VoxelDirection): { prev: VoxelData; next: VoxelData } | null {
    const key = vk(x, y, z)
    const existing = voxels.value.get(key)
    if (!existing) return null
    const nextDirection = direction ?? existing.direction ?? 'y'
    // Check if anything changed (color, alpha, or direction)
    if (existing.color === color && (existing.alpha ?? 255) === alpha && existing.direction === nextDirection) return null
    const prev = { ...existing }
    const next = { color, alpha, direction: nextDirection }
    voxels.value.set(key, next)
    return { prev, next }
  }

  /** Apply draw/delete based on mode (for later tool dispatch). */
  function doVoxel(x: number, y: number, z: number, color: string, mode: 'draw' | 'del' | 'recolor', direction?: VoxelDirection): { prev: VoxelData | null; next: VoxelData | null } | null {
    if (mode === 'del') {
      const prev = deleteVoxel(x, y, z)
      return prev ? { prev, next: null } : null
    }
    if (mode === 'recolor') return recolorVoxel(x, y, z, color, 255, direction)
    return setVoxel(x, y, z, color, 255, direction)
  }

  // ===== SYMMETRY =====
  /** Returns all mirror positions including the original. Point symmetry = 180° rotation around cylinder axis. */
  function getMirrorPoints(x: number, y: number, z: number): Point3D[] {
    const pts: Point3D[] = [{ x, y, z }]

    if (mirrorX.value) {
      const cx = mirrorCenterX.value
      pts.forEach(p => pts.push({ x: Math.round(2 * cx - p.x - 1), y: p.y, z: p.z }))
    }
    if (mirrorY.value) {
      const cy = mirrorCenterY.value
      pts.forEach(p => pts.push({ x: p.x, y: Math.round(2 * cy - p.y - 1), z: p.z }))
    }
    if (mirrorZ.value) {
      const cz = mirrorCenterZ.value
      pts.forEach(p => pts.push({ x: p.x, y: p.y, z: Math.round(2 * cz - p.z - 1) }))
    }
    if (mirrorPoint.value) {
      // 180° rotation around the cylinder central axis (cx, cy, cz)
      const cx = mirrorCenterX.value, cy = mirrorCenterY.value, cz = mirrorCenterZ.value
      pts.forEach(p => pts.push({
        x: Math.round(2 * cx - p.x - 1),
        y: Math.round(2 * cy - p.y - 1),
        z: Math.round(2 * cz - p.z - 1)
      }))
    }

    // Deduplicate by voxel key
    const seen = new Set<string>()
    return pts.filter(p => {
      const k = vk(p.x, p.y, p.z)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }

  // ===== LAYER MANAGEMENT =====
  const currentZ = ref(0)
  const currentAxis = ref<'y' | 'z' | 'x'>('y')
  /** Currently selected layer in the layer panel (axis-aware) */
  const currentLayer = ref<number>(0)
  /** Which axis the layer panel is showing */
  const layerAxis = ref<'x' | 'y' | 'z'>('z')
  const layerVisibility = ref<Map<string, boolean>>(new Map())
  /** Custom layer names: key = "axis:value" e.g. "z:5" */
  const layerNames = ref<Map<string, string>>(new Map())

  function getUniqueZValues(): number[] {
    const zSet = new Set<number>()
    voxels.value.forEach((_, key) => {
      zSet.add(pv(key)[2])
    })
    return [...zSet].sort((a, b) => a - b)
  }

  /** Get all layer values for any axis (x, y, or z) — includes empty layers */
  function getUniqueLayers(axis: 'x' | 'y' | 'z'): number[] {
    const max = axis === 'x' ? dimW.value : axis === 'y' ? dimH.value : dimD.value
    return Array.from({ length: max }, (_, i) => i)
  }

  /** Get only layer values that have voxel data */
  function getNonEmptyLayers(axis: 'x' | 'y' | 'z'): number[] {
    const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
    const valSet = new Set<number>()
    voxels.value.forEach((_, key) => {
      valSet.add(pv(key)[axisIdx])
    })
    return [...valSet].sort((a, b) => a - b)
  }

  /** Layer visibility key: "axis:value" e.g. "z:5" */
  function layerKey(axis: 'x' | 'y' | 'z', value: number): string {
    return `${axis}:${value}`
  }

  function isLayerVisible(z: number): boolean {
    return layerVisibility.value.get(layerKey(layerAxis.value, z)) ?? true
  }

  function isLayerVisibleAxis(axis: 'x' | 'y' | 'z', value: number): boolean {
    return layerVisibility.value.get(layerKey(axis, value)) ?? true
  }

  function toggleLayerVisibility(z: number): void {
    const key = layerKey(layerAxis.value, z)
    const current = layerVisibility.value.get(key) ?? true
    layerVisibility.value.set(key, !current)
  }

  function toggleLayerVisibilityAxis(axis: 'x' | 'y' | 'z', value: number): void {
    const key = layerKey(axis, value)
    const current = layerVisibility.value.get(key) ?? true
    layerVisibility.value.set(key, !current)
  }

  /** Get custom layer name (returns default "X=5" etc if no custom name) */
  function getLayerName(axis: 'x' | 'y' | 'z', value: number): string {
    const key = layerKey(axis, value)
    return layerNames.value.get(key) ?? `${axis.toUpperCase()}${value + 1}`
  }

  /** Set custom layer name */
  function setLayerName(axis: 'x' | 'y' | 'z', value: number, name: string): void {
    const key = layerKey(axis, value)
    if (name.trim()) {
      layerNames.value.set(key, name.trim())
    } else {
      layerNames.value.delete(key)
    }
  }

  /** Swap two layers' positions, voxel data, and names on the given axis. */
  function moveLayer(axis: 'x' | 'y' | 'z', sourceVal: number, targetVal: number): boolean {
    if (sourceVal === targetVal) return false
    const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2

    // Build mapping: sourceVal → targetVal, targetVal → sourceVal
    const coordMap = new Map<number, number>()
    coordMap.set(sourceVal, targetVal)
    coordMap.set(targetVal, sourceVal)

    // Pin default names so they travel with the layer content
    for (const v of [sourceVal, targetVal]) {
      const key = layerKey(axis, v)
      if (!layerNames.value.has(key)) {
        layerNames.value.set(key, `${axis.toUpperCase()}${v + 1}`)
      }
    }

    // Collect ALL voxels on both layers
    const allVoxels: { oldCoords: [number, number, number]; data: VoxelData }[] = []
    voxels.value.forEach((data, key) => {
      const coords = pv(key)
      const val = coords[axisIdx]
      if (val === sourceVal || val === targetVal) {
        allVoxels.push({ oldCoords: [...coords] as [number, number, number], data: { ...data } })
      }
    })

    if (allVoxels.length === 0) return false

    // Delete all affected voxels
    allVoxels.forEach(({ oldCoords }) => {
      voxels.value.delete(vk(oldCoords[0], oldCoords[1], oldCoords[2]))
    })

    // Place them back with remapped coordinates
    allVoxels.forEach(({ oldCoords, data }) => {
      const newVal = coordMap.get(oldCoords[axisIdx])!
      const newCoords = [...oldCoords] as [number, number, number]
      newCoords[axisIdx] = newVal
      voxels.value.set(vk(newCoords[0], newCoords[1], newCoords[2]), { ...data })
    })

    // Move names with the layers — rebuild the entire Map correctly
    const newNames = new Map<string, string>()
    const srcKey = layerKey(axis, sourceVal)
    const tgtKey = layerKey(axis, targetVal)
    const srcName = layerNames.value.get(srcKey)
    const tgtName = layerNames.value.get(tgtKey)
    layerNames.value.forEach((n, k) => {
      // Skip source and target keys; handle them explicitly below
      if (k === srcKey || k === tgtKey) return
      newNames.set(k, n)
    })
    // Put source's name at target's position, target's name at source's position
    if (srcName) newNames.set(tgtKey, srcName)
    if (tgtName) newNames.set(srcKey, tgtName)
    layerNames.value = newNames

    // Move visibility with the layers — rebuild the entire Map correctly
    const newVis = new Map<string, boolean>()
    const srcVis = layerVisibility.value.get(srcKey)
    const tgtVis = layerVisibility.value.get(tgtKey)
    layerVisibility.value.forEach((v, k) => {
      if (k === srcKey || k === tgtKey) return
      newVis.set(k, v)
    })
    if (srcVis !== undefined) newVis.set(tgtKey, srcVis)
    if (tgtVis !== undefined) newVis.set(srcKey, tgtVis)
    layerVisibility.value = newVis

    return true
  }

  /**
   * Move a layer to a new position in the sorted list (insert-between mode).
   * Removes sourceVal from its original position, inserts it at insertIdx,
   * shifts all other layers accordingly. Names and visibility move with the layer.
   */
  function insertLayer(axis: 'x' | 'y' | 'z', sourceVal: number, insertIdx: number): boolean {
    const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2

    // Get sorted list of existing layer values
    const sortedVals = getUniqueLayers(axis)
    if (!sortedVals.includes(sourceVal)) return false

    // Pin default names so they travel with the layer content
    for (const v of sortedVals) {
      const key = layerKey(axis, v)
      if (!layerNames.value.has(key)) {
        layerNames.value.set(key, `${axis.toUpperCase()}${v + 1}`)
      }
    }

    // Remove source from list, then insert at target index
    const withoutSource = sortedVals.filter(v => v !== sourceVal)
    const newOrder = [...withoutSource]
    newOrder.splice(insertIdx, 0, sourceVal)

    // Build mapping: each layer's NEW coordinate = old sorted position value
    const coordMap = new Map<number, number>()
    for (let i = 0; i < sortedVals.length; i++) {
      coordMap.set(newOrder[i], sortedVals[i])
    }

    // Collect ALL voxels on affected layers
    const allVoxels: { oldCoords: [number, number, number]; data: VoxelData }[] = []
    voxels.value.forEach((data, key) => {
      const coords = pv(key)
      const val = coords[axisIdx]
      if (coordMap.has(val)) {
        allVoxels.push({ oldCoords: [...coords] as [number, number, number], data: { ...data } })
      }
    })

    if (allVoxels.length === 0) return false

    // Delete all affected voxels
    allVoxels.forEach(({ oldCoords }) => {
      voxels.value.delete(vk(oldCoords[0], oldCoords[1], oldCoords[2]))
    })

    // Place them back with remapped coordinates
    allVoxels.forEach(({ oldCoords, data }) => {
      const newVal = coordMap.get(oldCoords[axisIdx])!
      const newCoords = [...oldCoords] as [number, number, number]
      newCoords[axisIdx] = newVal
      voxels.value.set(vk(newCoords[0], newCoords[1], newCoords[2]), { ...data })
    })

    // Move names with their layers (replace entire Map to trigger reactivity)
    const oldNames = new Map<string, string>()
    sortedVals.forEach(v => {
      const name = layerNames.value.get(layerKey(axis, v))
      if (name) oldNames.set(v, name)
    })
    const newNames = new Map<string, string>()
    layerNames.value.forEach((n, k) => {
      if (!k.startsWith(axis + ':')) newNames.set(k, n)
    })
    oldNames.forEach((name, oldVal) => {
      const newVal = coordMap.get(oldVal)
      if (newVal !== undefined) newNames.set(layerKey(axis, newVal), name)
    })
    layerNames.value = newNames

    // Move visibility with their layers (replace entire Map to trigger reactivity)
    const oldVis = new Map<string, boolean>()
    sortedVals.forEach(v => {
      const vis = layerVisibility.value.get(layerKey(axis, v))
      if (vis !== undefined) oldVis.set(v, vis)
    })
    const newVis = new Map<string, boolean>()
    layerVisibility.value.forEach((v, k) => {
      if (!k.startsWith(axis + ':')) newVis.set(k, v)
    })
    oldVis.forEach((vis, oldVal) => {
      const newVal = coordMap.get(oldVal)
      if (newVal !== undefined) newVis.set(layerKey(axis, newVal), vis)
    })
    layerVisibility.value = newVis

    return true
  }

  /** Insert a new empty layer after the given value (or at the end if null).
   *  Increases the dimension and shifts existing voxels to make room. */
  function insertEmptyLayer(axis: 'x' | 'y' | 'z', afterVal: number | null): void {
    const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
    const dimRef = axis === 'x' ? dimW : axis === 'y' ? dimH : dimD
    const maxVal = dimRef.value

    // New coordinate to insert
    const newCoord = afterVal !== null ? afterVal + 1 : maxVal

    // Shift voxels: any voxel with coordinate >= newCoord gets +1
    const toShift: { key: string; oldCoords: [number, number, number]; data: VoxelData }[] = []
    voxels.value.forEach((data, key) => {
      const coords = pv(key)
      if (coords[axisIdx] >= newCoord) {
        toShift.push({ key, oldCoords: [...coords] as [number, number, number], data: { ...data } })
      }
    })
    toShift.forEach(({ key }) => voxels.value.delete(key))
    toShift.forEach(({ oldCoords, data }) => {
      const newCoords = [...oldCoords] as [number, number, number]
      newCoords[axisIdx]++
      voxels.value.set(vk(newCoords[0], newCoords[1], newCoords[2]), { ...data })
    })

    // Shift names
    const shiftedNames = new Map<string, string>()
    layerNames.value.forEach((name, k) => {
      const parts = k.split(':')
      if (parts.length === 2 && parts[0] === axis) {
        const v = parseInt(parts[1])
        if (v >= newCoord) {
          shiftedNames.set(layerKey(axis, v + 1), name)
        } else {
          shiftedNames.set(k, name)
        }
      } else {
        shiftedNames.set(k, name)
      }
    })
    layerNames.value = shiftedNames

    // Shift visibility
    const shiftedVis = new Map<string, boolean>()
    layerVisibility.value.forEach((vis, k) => {
      const parts = k.split(':')
      if (parts.length === 2 && parts[0] === axis) {
        const v = parseInt(parts[1])
        if (v >= newCoord) {
          shiftedVis.set(layerKey(axis, v + 1), vis)
        } else {
          shiftedVis.set(k, vis)
        }
      } else {
        shiftedVis.set(k, vis)
      }
    })
    layerVisibility.value = shiftedVis

    // Increase dimension
    dimRef.value++
  }

  /** Remove a layer entirely: delete its voxels, shift everything after it down, shrink dimension. */
  function removeLayer(axis: 'x' | 'y' | 'z', removeVal: number): void {
    const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
    const dimRef = axis === 'x' ? dimW : axis === 'y' ? dimH : dimD

    // 1. Delete all voxels on this layer
    const toDelete: string[] = []
    voxels.value.forEach((_, key) => {
      const coords = pv(key)
      if (coords[axisIdx] === removeVal) {
        toDelete.push(key)
      }
    })
    toDelete.forEach(k => voxels.value.delete(k))

    // 2. Shift voxels with coordinate > removeVal down by 1
    const toShift: { key: string; oldCoords: [number, number, number]; data: VoxelData }[] = []
    voxels.value.forEach((data, key) => {
      const coords = pv(key)
      if (coords[axisIdx] > removeVal) {
        toShift.push({ key, oldCoords: [...coords] as [number, number, number], data: { ...data } })
      }
    })
    toShift.forEach(({ key }) => voxels.value.delete(key))
    toShift.forEach(({ oldCoords, data }) => {
      const newCoords = [...oldCoords] as [number, number, number]
      newCoords[axisIdx]--
      voxels.value.set(vk(newCoords[0], newCoords[1], newCoords[2]), { ...data })
    })

    // 3. Shift names
    const newNames = new Map<string, string>()
    layerNames.value.forEach((name, k) => {
      const parts = k.split(':')
      if (parts.length === 2 && parts[0] === axis) {
        const v = parseInt(parts[1])
        if (v === removeVal) return // skip removed layer
        if (v > removeVal) {
          newNames.set(layerKey(axis, v - 1), name)
        } else {
          newNames.set(k, name)
        }
      } else {
        newNames.set(k, name)
      }
    })
    layerNames.value = newNames

    // 4. Shift visibility
    const newVis = new Map<string, boolean>()
    layerVisibility.value.forEach((vis, k) => {
      const parts = k.split(':')
      if (parts.length === 2 && parts[0] === axis) {
        const v = parseInt(parts[1])
        if (v === removeVal) return
        if (v > removeVal) {
          newVis.set(layerKey(axis, v - 1), vis)
        } else {
          newVis.set(k, vis)
        }
      } else {
        newVis.set(k, vis)
      }
    })
    layerVisibility.value = newVis

    // 5. Decrease dimension
    dimRef.value--
  }

  // ===== CANVAS RESET =====
  function resetAll(): void {
    voxels.value = new Map()
    currentZ.value = 0
    currentAxis.value = 'y'
    currentDirection.value = 'y'
    layerVisibility.value = new Map()
  }

  function setDimensions(w: number, h: number, d: number): void {
    dimW.value = w
    dimH.value = h
    dimD.value = d
  }

  return {
    // State
    voxels, dimW, dimH, dimD,
    currentTool, brushSize, selectedColor,
    mirrorX, mirrorY, mirrorZ, mirrorPoint,
    mirrorCenterX, mirrorCenterY, mirrorCenterZ,
    editMode, snapMode, currentDirection,
    currentZ, currentAxis, currentLayer, layerAxis, layerVisibility, layerNames,
    // Computed
    voxelCount,
    // CRUD
    vk, pv, getVoxel, setVoxel, deleteVoxel, recolorVoxel, doVoxel,
    // Symmetry
    getMirrorPoints,
    // Layers
    getUniqueZValues, getUniqueLayers, getNonEmptyLayers,
    isLayerVisible, isLayerVisibleAxis,
    toggleLayerVisibility, toggleLayerVisibilityAxis,
    getLayerName, setLayerName, moveLayer, insertLayer, insertEmptyLayer, removeLayer,
    layerKey,
    // Actions
    resetAll, setDimensions,
  }
})
