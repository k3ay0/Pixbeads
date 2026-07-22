<script setup lang="ts">
import { computed, onMounted, ref, watch, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useVoxelStore, type VoxelData, type VoxelMap } from '@/stores/voxelStore'
import { usePaletteStore } from '@/stores/paletteStore'
import { useVoxelHistory, type VoxelAction } from '@/composables/useVoxelHistory'
import { useVoxelGeometry } from '@/composables/useVoxelGeometry'

const voxelStore = useVoxelStore()
const paletteStore = usePaletteStore()
const { activeBeadPalette } = storeToRefs(paletteStore)
const { pushUndo } = useVoxelHistory()
const { rebuildAllMeshes } = useVoxelGeometry()

// ============================================================
// Tools, brush, symmetry — existing
// ============================================================

const tools = [
  { id: 'pen' as const, label: '画笔', icon: '✏' },
  { id: 'line' as const, label: '直线', icon: '╱' },
  { id: 'rect' as const, label: '矩形', icon: '▢' },
  { id: 'frect' as const, label: '填充矩形', icon: '▣' },
  { id: 'eraser' as const, label: '橡皮擦', icon: '✕' },
]

const paletteColors = computed(() => activeBeadPalette.value.slice(0, 36))

// Initialize selectedColor from palette on mount
onMounted(() => {
  if (paletteColors.value.length > 0) {
    voxelStore.selectedColor = paletteColors.value[0].hex
  }
})

// --- Layer management (axis-aware) ---
const layerAxis = ref<'x' | 'y' | 'z'>('z')
const layerAxes = ['x', 'y', 'z'] as const
const layerEditMode = ref(false)

const currentLayerList = computed(() => {
  if (layerEditMode.value) {
    // Edit mode: show all layers including empty ones
    return voxelStore.getUniqueLayers(layerAxis.value)
  }
  // Normal mode: only show layers with voxel data
  return voxelStore.getNonEmptyLayers(layerAxis.value)
})

/** The current layer value to highlight (axis-aware) */
const activeLayerVal = computed(() => {
  if (voxelStore.layerAxis !== layerAxis.value) return -1
  return voxelStore.currentLayer
})

// --- Drag and drop state ---
const dragFrom = ref<number | null>(null)
const dragOver = ref<number | null>(null)
/** 'before' = insert before the hovered layer, 'after' = insert after, 'swap' = drop on the layer */
const dropMode = ref<'before' | 'after' | 'swap'>('swap')

// --- Inline rename state ---
const editingLayerVal = ref<number | null>(null)
const editingName = ref('')

function setLayerAxis(ax: 'x' | 'y' | 'z') {
  layerAxis.value = ax
  voxelStore.layerAxis = ax
}

function addLayer() {
  const ax = layerAxis.value
  const currentVal = activeLayerVal.value
  // Insert new layer after the currently selected layer (or at the end)
  const insertAfter = currentVal >= 0 ? currentVal : null
  voxelStore.insertEmptyLayer(ax, insertAfter)
  // Select the newly created layer
  const newVal = insertAfter !== null ? insertAfter + 1 : 0
  voxelStore.currentLayer = newVal
  voxelStore.currentAxis = ax
  voxelStore.currentZ = newVal
  voxelStore.layerAxis = ax
  rebuildAllMeshes()
}

function deleteLayer(val: number) {
  const store = voxelStore
  const ax = layerAxis.value
  const isEdit = layerEditMode.value

  if (isEdit) {
    // Edit mode: remove the entire layer (shift + shrink dimension)
    store.removeLayer(ax, val)
    rebuildAllMeshes()
    // Select a nearby layer
    const list = store.getNonEmptyLayers(ax)
    const newVal = list.length > 0 ? list[Math.min(list.indexOf(val), list.length - 1)] : 0
    store.currentLayer = newVal
    store.currentAxis = ax
    store.currentZ = newVal
    store.layerAxis = ax
  } else {
    // Normal mode: just clear voxels on this layer
    const actions: VoxelAction[] = []
    store.voxels.forEach((_, key) => {
      const [x, y, z] = store.pv(key)
      const match = (ax === 'x' && x === val) || (ax === 'y' && y === val) || (ax === 'z' && z === val)
      if (match) {
        const prev = store.deleteVoxel(x, y, z)
        if (prev) actions.push({ x, y, z, prev, next: null })
      }
    })
    if (actions.length > 0) pushUndo(actions, 'delete-layer')
  }
}

function copyLayer(sourceVal: number) {
  const store = voxelStore
  const ax = layerAxis.value
  const targetVal = sourceVal + 1
  const actions: VoxelAction[] = []
  store.voxels.forEach((voxel, key) => {
    const [x, y, z] = store.pv(key)
    const match = (ax === 'x' && x === sourceVal) || (ax === 'y' && y === sourceVal) || (ax === 'z' && z === sourceVal)
    if (match) {
      const nx = ax === 'x' ? targetVal : x
      const ny = ax === 'y' ? targetVal : y
      const nz = ax === 'z' ? targetVal : z
      const result = store.setVoxel(nx, ny, nz, voxel.color, voxel.alpha ?? 255)
      if (result) actions.push({ x: nx, y: ny, z: nz, prev: result.prev, next: result.next })
    }
  })
  if (actions.length > 0) pushUndo(actions, 'copy-layer')
}

/** Click a layer → switch 2D to show that layer */
function selectLayer(val: number) {
  voxelStore.currentLayer = val
  voxelStore.layerAxis = layerAxis.value
  voxelStore.currentAxis = layerAxis.value
  voxelStore.currentZ = val
}

function toggleLayerVis(val: number) {
  voxelStore.toggleLayerVisibilityAxis(layerAxis.value, val)
  const { setLayerMeshVisibility } = useVoxelGeometry()
  if (layerAxis.value === 'z') {
    setLayerMeshVisibility(val, voxelStore.isLayerVisibleAxis('z', val))
  }
}

// --- Drag handlers ---
function onDragStart(val: number, e: DragEvent) {
  dragFrom.value = val
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(val))
  }
}

function onDragOver(val: number, e: DragEvent) {
  e.preventDefault()
  // Ignore if dragging over self
  if (dragFrom.value === val) { dragOver.value = null; return }
  dragOver.value = val

  // Determine drop zone: top 25% = before, bottom 25% = after, middle 50% = swap
  const target = e.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const relY = (e.clientY - rect.top) / rect.height
  if (relY < 0.25) dropMode.value = 'before'
  else if (relY > 0.75) dropMode.value = 'after'
  else dropMode.value = 'swap'
}

function onDragLeave() {
  dragOver.value = null
  dropMode.value = 'swap'
}

function onDrop(targetVal: number) {
  const sourceVal = dragFrom.value
  const mode = dropMode.value
  dragFrom.value = null
  dragOver.value = null
  dropMode.value = 'swap'
  if (sourceVal === null || sourceVal === targetVal) return

  const ax = layerAxis.value
  const list = voxelStore.getUniqueLayers(ax)
  let moved = false

  if (mode === 'swap') {
    // Swap: exchange two layers' positions, voxel data, and names
    moved = voxelStore.moveLayer(ax, sourceVal, targetVal)
  } else {
    // Insert-between: move source layer to the target position, shift others
    const targetIdx = list.indexOf(targetVal)
    if (targetIdx < 0) return
    const insertIdx = mode === 'before' ? targetIdx : targetIdx + 1
    moved = voxelStore.insertLayer(ax, sourceVal, insertIdx)
  }

  if (moved) {
    rebuildAllMeshes()
    // After move, the source layer has a new coordinate — find it
    const newList = voxelStore.getUniqueLayers(ax)
    // Determine which coordinate the source layer now has
    const oldList = list
    const srcIdxOld = oldList.indexOf(sourceVal)
    const newCoord = newList[srcIdxOld] ?? sourceVal
    voxelStore.currentLayer = newCoord
    voxelStore.currentAxis = ax
    voxelStore.currentZ = newCoord
  }
}

function onDragEnd() {
  dragFrom.value = null
  dragOver.value = null
  dropMode.value = 'swap'
}

// --- Inline rename handlers ---
function startRename(val: number) {
  editingLayerVal.value = val
  editingName.value = voxelStore.getLayerName(layerAxis.value, val)
  nextTick(() => {
    const input = document.querySelector<HTMLInputElement>('.layer-rename-input')
    input?.focus()
    input?.select()
  })
}

function confirmRename() {
  if (editingLayerVal.value !== null) {
    voxelStore.setLayerName(layerAxis.value, editingLayerVal.value, editingName.value)
  }
  editingLayerVal.value = null
  editingName.value = ''
}

function cancelRename() {
  editingLayerVal.value = null
  editingName.value = ''
}

// ============================================================
// HSL Color Picker
// ============================================================

const hslCanvasRef = ref<HTMLCanvasElement | null>(null)
const hueBarRef = ref<HTMLCanvasElement | null>(null)
const pickerHue = ref(0)
const pickerSat = ref(100)
const pickerLum = ref(50)
const pickerAlpha = ref(255)
const hexInput = ref(voxelStore.selectedColor)

const miniPalette = [
  '#ff0000', '#ff4400', '#ff8800', '#ffcc00', '#ffff00',
  '#ccff00', '#88ff00', '#44ff00', '#00ff00', '#00ff44',
  '#00ff88', '#00ffcc', '#00ffff', '#00ccff', '#0088ff',
  '#0044ff', '#0000ff', '#4400ff', '#8800ff', '#cc00ff',
  '#ff00ff', '#ff00cc', '#ff0088', '#ff0044', '#ffffff',
  '#cccccc', '#999999', '#666666', '#333333', '#000000',
]

// --- HSL <-> RGB conversion helpers ---

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(c => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('')
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255, gg = g / 255, bb = b / 255
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb)
  let h = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6
    else if (max === gg) h = ((bb - rr) / d + 2) / 6
    else h = ((rr - gg) / d + 4) / 6
  }
  return [h * 360, s * 100, l * 100]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = h / 360, ss = s / 100, ll = l / 100
  if (ss === 0) {
    const v = Math.round(ll * 255)
    return [v, v, v]
  }
  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss
  const p = 2 * ll - q
  return [
    Math.round(hue2rgb(p, q, hh + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, hh) * 255),
    Math.round(hue2rgb(p, q, hh - 1 / 3) * 255),
  ]
}

// --- Canvas drawing ---

function drawHslCanvas(): void {
  const cvs = hslCanvasRef.value
  if (!cvs) return
  const ctx = cvs.getContext('2d')!
  const w = cvs.width, h = cvs.height
  const img = ctx.createImageData(w, h)
  const hue = pickerHue.value
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (x / w) * 100
      const l = 100 - (y / h) * 100
      const [r, g, b] = hslToRgb(hue, s, l)
      const idx = (y * w + x) * 4
      img.data[idx] = r
      img.data[idx + 1] = g
      img.data[idx + 2] = b
      img.data[idx + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)

  // Crosshair at current S/L
  const cx = (pickerSat.value / 100) * w
  const cy = (1 - pickerLum.value / 100) * h
  ctx.strokeStyle = pickerLum.value > 50 ? '#000' : '#fff'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(cx, cy, 4, 0, Math.PI * 2)
  ctx.stroke()
}

function drawHueBar(): void {
  const cvs = hueBarRef.value
  if (!cvs) return
  const ctx = cvs.getContext('2d')!
  const w = cvs.width, h = cvs.height
  const img = ctx.createImageData(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hue = (x / w) * 360
      const [r, g, b] = hslToRgb(hue, 100, 50)
      const idx = (y * w + x) * 4
      img.data[idx] = r
      img.data[idx + 1] = g
      img.data[idx + 2] = b
      img.data[idx + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)

  // Indicator
  const ix = (pickerHue.value / 360) * w
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(ix, 0)
  ctx.lineTo(ix, h)
  ctx.stroke()
}

// --- HSL picker event handlers ---

function onHslCanvasClick(e: MouseEvent): void {
  const cvs = hslCanvasRef.value
  if (!cvs) return
  const rect = cvs.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  pickerSat.value = Math.max(0, Math.min(100, (x / cvs.width) * 100))
  pickerLum.value = Math.max(0, Math.min(100, 100 - (y / cvs.height) * 100))
  applyPickerColor()
}

function onHueBarClick(e: MouseEvent): void {
  const cvs = hueBarRef.value
  if (!cvs) return
  const rect = cvs.getBoundingClientRect()
  const x = e.clientX - rect.left
  pickerHue.value = Math.max(0, Math.min(360, (x / cvs.width) * 360))
  applyPickerColor()
}

function applyPickerColor(): void {
  const [r, g, b] = hslToRgb(pickerHue.value, pickerSat.value, pickerLum.value)
  voxelStore.selectedColor = rgbToHex(r, g, b)
}

function onHexChange(): void {
  const val = hexInput.value
  if (/^#[0-9a-fA-F]{6}$/.test(val)) {
    voxelStore.selectedColor = val.toLowerCase()
  }
}

// Sync picker state when store.selectedColor changes externally (palette click, etc.)
watch(() => voxelStore.selectedColor, (hex) => {
  if (!hex) return
  hexInput.value = hex
  const [r, g, b] = hexToRgb(hex)
  const [h, s, l] = rgbToHsl(r, g, b)
  pickerHue.value = h
  pickerSat.value = s
  pickerLum.value = l
  nextTick(() => {
    drawHslCanvas()
    drawHueBar()
  })
})

watch([pickerHue, pickerSat, pickerLum], () => {
  nextTick(() => {
    drawHslCanvas()
    if (pickerHue.value !== undefined) drawHueBar()
  })
})

// --- Mini palette handler ---
function selectMiniPaletteColor(hex: string): void {
  voxelStore.selectedColor = hex
}

// ============================================================
// Copy / Paste
// ============================================================

const clipboard = ref<VoxelMap>(new Map())
const pasteActive = ref(false)
const pasteOffX = ref(0)
const pasteOffY = ref(0)
const pasteOffZ = ref(0)
// Range selection
const selMinX = ref(0)
const selMinY = ref(0)
const selMinZ = ref(0)
const selMaxX = ref(0)
const selMaxY = ref(0)
const selMaxZ = ref(0)
const rangeSelected = ref(false)
const clusterX = ref(0)
const clusterY = ref(0)
const clusterZ = ref(0)

function selectRange(): void {
  const store = voxelStore
  selMinX.value = 0
  selMinY.value = 0
  selMinZ.value = 0
  selMaxX.value = store.dimW - 1
  selMaxY.value = store.dimH - 1
  selMaxZ.value = store.dimD - 1
  rangeSelected.value = true
}

function copyRange(): void {
  const store = voxelStore
  const minX = Math.min(selMinX.value, selMaxX.value)
  const maxX = Math.max(selMinX.value, selMaxX.value)
  const minY = Math.min(selMinY.value, selMaxY.value)
  const maxY = Math.max(selMinY.value, selMaxY.value)
  const minZ = Math.min(selMinZ.value, selMaxZ.value)
  const maxZ = Math.max(selMinZ.value, selMaxZ.value)

  const result = new Map<string, VoxelData>()
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        const v = store.getVoxel(x, y, z)
        if (v) result.set(`${x},${y},${z}`, { ...v })
      }
    }
  }
  clipboard.value = result
  rangeSelected.value = false
}

function copyCluster(): void {
  const store = voxelStore
  const sx = clusterX.value, sy = clusterY.value, sz = clusterZ.value
  const startKey = `${sx},${sy},${sz}`
  if (!store.getVoxel(sx, sy, sz)) return

  const visited = new Set<string>()
  const queue: [number, number, number][] = [[sx, sy, sz]]
  const result = new Map<string, VoxelData>()

  while (queue.length > 0) {
    const [x, y, z] = queue.shift()!
    const key = `${x},${y},${z}`
    if (visited.has(key)) continue
    visited.add(key)
    const v = store.getVoxel(x, y, z)
    if (!v) continue
    result.set(key, { ...v })
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      queue.push([x + dx, y + dy, z + dz])
    }
  }

  clipboard.value = result
}

function togglePaste(): void {
  pasteActive.value = !pasteActive.value
  pasteOffX.value = 0
  pasteOffY.value = 0
  pasteOffZ.value = 0
}

function applyPaste(): void {
  if (clipboard.value.size === 0) return
  const store = voxelStore
  const ox = pasteOffX.value, oy = pasteOffY.value, oz = pasteOffZ.value

  // Check for overlaps
  let overlapCount = 0
  clipboard.value.forEach((_data, key) => {
    const [cx, cy, cz] = store.pv(key)
    const tx = cx + ox, ty = cy + oy, tz = cz + oz
    if (store.getVoxel(tx, ty, tz)) overlapCount++
  })

  if (overlapCount > 0) {
    const ok = window.confirm(`${overlapCount} voxels would be overwritten. Continue?`)
    if (!ok) return
  }

  const actions: VoxelAction[] = []
  clipboard.value.forEach((data, key) => {
    const [cx, cy, cz] = store.pv(key)
    const tx = cx + ox, ty = cy + oy, tz = cz + oz
    if (tx < 0 || ty < 0 || tz < 0 || tx >= store.dimW || ty >= store.dimH || tz >= store.dimD) return
    const result = store.setVoxel(tx, ty, tz, data.color, data.alpha ?? 255, data.direction)
    if (result) actions.push({ x: tx, y: ty, z: tz, prev: result.prev, next: result.next })
  })

  if (actions.length > 0) pushUndo(actions, 'paste')
  rebuildAllMeshes()
  pasteActive.value = false
}

// ============================================================
// Actions (16 operations)
// ============================================================

const actionButtons = [
  { id: 'rotY', label: 'Y轴旋转', icon: '↻Y' },
  { id: 'rotX', label: 'X轴旋转', icon: '↻X' },
  { id: 'rotZ', label: 'Z轴旋转', icon: '↻Z' },
  { id: 'flipX', label: 'X翻转', icon: '↔X' },
  { id: 'flipY', label: 'Y翻转', icon: '↕Y' },
  { id: 'flipZ', label: 'Z翻转', icon: '↕Z' },
  { id: 'shiftUp', label: '上移', icon: '↑' },
  { id: 'shiftDown', label: '下移', icon: '↓' },
  { id: 'hollow', label: '中空化', icon: '○' },
  { id: 'outline', label: '轮廓', icon: '□' },
  { id: 'dilate', label: '膨胀', icon: '⊕' },
  { id: 'erode', label: '侵蚀', icon: '⊖' },
]

function hasNeighbor6(voxels: VoxelMap, x: number, y: number, z: number): number {
  let count = 0
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    if (voxels.has(`${x + dx},${y + dy},${z + dz}`)) count++
  }
  return count
}

function doAction(id: string): void {
  const store = voxelStore
  const oldVoxels = new Map(store.voxels)
  const W = store.dimW, H = store.dimH, D = store.dimD
  let newW = W, newH = H, newD = D

  store.voxels = new Map()
  const actions: VoxelAction[] = []

  // --- Morphological operations (need oldVoxels as reference) ---
  if (id === 'hollow' || id === 'outline') {
    // Keep only surface voxels (those missing at least 1 neighbor)
    oldVoxels.forEach((data, key) => {
      const [x, y, z] = store.pv(key)
      if (hasNeighbor6(oldVoxels, x, y, z) < 6) {
        const result = store.setVoxel(x, y, z, data.color, data.alpha ?? 255, data.direction)
        if (result) actions.push({ x, y, z, prev: result.prev, next: result.next })
      }
    })
    if (actions.length > 0) pushUndo(actions, id)
    rebuildAllMeshes()
    return
  }

  if (id === 'dilate') {
    oldVoxels.forEach((data, key) => {
      const [x, y, z] = store.pv(key)
      // Keep original
      const r1 = store.setVoxel(x, y, z, data.color, data.alpha ?? 255, data.direction)
      if (r1) actions.push({ x, y, z, prev: r1.prev, next: r1.next })
      // Add 6 neighbors
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const nx = x + dx, ny = y + dy, nz = z + dz
        if (nx < 0 || ny < 0 || nz < 0 || nx >= W || ny >= H || nz >= D) continue
        if (oldVoxels.has(`${nx},${ny},${nz}`)) continue
        const r2 = store.setVoxel(nx, ny, nz, data.color, data.alpha ?? 255, data.direction)
        if (r2) actions.push({ x: nx, y: ny, z: nz, prev: r2.prev, next: r2.next })
      }
    })
    if (actions.length > 0) pushUndo(actions, id)
    rebuildAllMeshes()
    return
  }

  if (id === 'erode') {
    oldVoxels.forEach((data, key) => {
      const [x, y, z] = store.pv(key)
      const exposed = 6 - hasNeighbor6(oldVoxels, x, y, z)
      if (exposed < 3) {
        // Keep it
        const r = store.setVoxel(x, y, z, data.color, data.alpha ?? 255, data.direction)
        if (r) actions.push({ x, y, z, prev: r.prev, next: r.next })
      }
    })
    if (actions.length > 0) pushUndo(actions, id)
    rebuildAllMeshes()
    return
  }

  // --- Shift operations ---
  if (id === 'shiftUp' || id === 'shiftDown' || id === 'shiftLeft' || id === 'shiftRight') {
    let dx = 0, dy = 0, dz = 0
    if (id === 'shiftUp') dy = 1
    else if (id === 'shiftDown') dy = -1
    else if (id === 'shiftRight') dx = 1
    else if (id === 'shiftLeft') dx = -1

    oldVoxels.forEach((data, key) => {
      const [x, y, z] = store.pv(key)
      const nx = x + dx, ny = y + dy, nz = z + dz
      if (nx < 0 || ny < 0 || nz < 0 || nx >= W || ny >= H || nz >= D) return
      const r = store.setVoxel(nx, ny, nz, data.color, data.alpha ?? 255, data.direction)
      if (r) actions.push({ x: nx, y: ny, z: nz, prev: r.prev, next: r.next })
    })
    if (actions.length > 0) pushUndo(actions, id)
    rebuildAllMeshes()
    return
  }

  // --- Rotation transformations ---
  if (id === 'rotY') {
    newW = D; newD = W
    oldVoxels.forEach((data, key) => {
      const [x, y, z] = store.pv(key)
      const nx = D - 1 - z, ny = y, nz = x
      const r = store.setVoxel(nx, ny, nz, data.color, data.alpha ?? 255, data.direction)
      if (r) actions.push({ x: nx, y: ny, z: nz, prev: r.prev, next: r.next })
    })
  } else if (id === 'rotX') {
    newH = D; newD = H
    oldVoxels.forEach((data, key) => {
      const [x, y, z] = store.pv(key)
      const nx = x, ny = D - 1 - z, nz = y
      const r = store.setVoxel(nx, ny, nz, data.color, data.alpha ?? 255, data.direction)
      if (r) actions.push({ x: nx, y: ny, z: nz, prev: r.prev, next: r.next })
    })
  } else if (id === 'rotZ') {
    newW = H; newH = W
    oldVoxels.forEach((data, key) => {
      const [x, y, z] = store.pv(key)
      const nx = H - 1 - y, ny = x, nz = z
      const r = store.setVoxel(nx, ny, nz, data.color, data.alpha ?? 255, data.direction)
      if (r) actions.push({ x: nx, y: ny, z: nz, prev: r.prev, next: r.next })
    })
  } else if (id === 'flipX') {
    oldVoxels.forEach((data, key) => {
      const [x, y, z] = store.pv(key)
      const nx = W - 1 - x, ny = y, nz = z
      const r = store.setVoxel(nx, ny, nz, data.color, data.alpha ?? 255, data.direction)
      if (r) actions.push({ x: nx, y: ny, z: nz, prev: r.prev, next: r.next })
    })
  } else if (id === 'flipY') {
    oldVoxels.forEach((data, key) => {
      const [x, y, z] = store.pv(key)
      const nx = x, ny = H - 1 - y, nz = z
      const r = store.setVoxel(nx, ny, nz, data.color, data.alpha ?? 255, data.direction)
      if (r) actions.push({ x: nx, y: ny, z: nz, prev: r.prev, next: r.next })
    })
  } else if (id === 'flipZ') {
    oldVoxels.forEach((data, key) => {
      const [x, y, z] = store.pv(key)
      const nx = x, ny = y, nz = D - 1 - z
      const r = store.setVoxel(nx, ny, nz, data.color, data.alpha ?? 255, data.direction)
      if (r) actions.push({ x: nx, y: ny, z: nz, prev: r.prev, next: r.next })
    })
  }

  // Apply dimension changes if rotation occurred
  if (newW !== W || newH !== H || newD !== D) {
    store.setDimensions(newW, newH, newD)
  }

  if (actions.length > 0) pushUndo(actions, id)
  rebuildAllMeshes()
}

// ============================================================
// Canvas size
// ============================================================

const editW = computed<number>({
  get: () => voxelStore.dimW,
  set: (v) => { editWLocal.value = v }
})
const editH = computed<number>({
  get: () => voxelStore.dimH,
  set: (v) => { editHLocal.value = v }
})
const editD = computed<number>({
  get: () => voxelStore.dimD,
  set: (v) => { editDLocal.value = v }
})
const editWLocal = ref(voxelStore.dimW)
const editHLocal = ref(voxelStore.dimH)
const editDLocal = ref(voxelStore.dimD)

function applyDimensions(): void {
  const w = Math.max(1, Math.min(128, editW.value))
  const h = Math.max(1, Math.min(128, editH.value))
  const d = Math.max(1, Math.min(128, editD.value))

  // Check if any existing voxels would be out of bounds when shrinking
  if (w < voxelStore.dimW || h < voxelStore.dimH || d < voxelStore.dimD) {
    let outOfBounds = 0
    voxelStore.voxels.forEach((_v, key) => {
      const [vx, vy, vz] = voxelStore.pv(key)
      if (vx >= w || vy >= h || vz >= d) outOfBounds++
    })
    if (outOfBounds > 0) {
      alert(`无法缩小：有 ${outOfBounds} 个体素超出新尺寸范围，请先删除这些体素。`)
      return
    }
  }

  voxelStore.setDimensions(w, h, d)
  rebuildAllMeshes()
}

// ============================================================
// Project save / load
// ============================================================

const STORAGE_KEY = 'voxoB_projects'
const projectNames = ref<string[]>([])
const selectedProject = ref('')

function refreshProjectList(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const data = raw ? JSON.parse(raw) : {}
    projectNames.value = Object.keys(data)
  } catch {
    projectNames.value = []
  }
}

function saveProject(): void {
  const store = voxelStore
  const name = window.prompt('Project name:')
  if (!name) return

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const data = raw ? JSON.parse(raw) : {}
    const voxelArray: [string, VoxelData][] = []
    store.voxels.forEach((v, k) => voxelArray.push([k, { color: v.color, alpha: v.alpha ?? 255 }]))
    data[name] = { W: store.dimW, H: store.dimH, D: store.dimD, voxels: voxelArray }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    refreshProjectList()
    selectedProject.value = name
  } catch (e) {
    console.error('Save failed:', e)
  }
}

function loadProject(): void {
  if (!selectedProject.value) return
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const data = JSON.parse(raw)
    const proj = data[selectedProject.value]
    if (!proj) return

    voxelStore.setDimensions(proj.W, proj.H, proj.D)
    voxelStore.voxels = new Map(proj.voxels)
    editW.value = proj.W
    editH.value = proj.H
    editD.value = proj.D
    rebuildAllMeshes()
  } catch (e) {
    console.error('Load failed:', e)
  }
}

function deleteProject(): void {
  if (!selectedProject.value) return
  if (!window.confirm(`Delete project "${selectedProject.value}"?`)) return
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const data = JSON.parse(raw)
    delete data[selectedProject.value]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    selectedProject.value = ''
    refreshProjectList()
  } catch (e) {
    console.error('Delete failed:', e)
  }
}

// Refresh on mount
onMounted(() => {
  refreshProjectList()
})
</script>

<template>
  <div class="flex-1 overflow-y-auto scrollbar-hide px-3 py-3 flex flex-col gap-3">
    <!-- Canvas Size -->
    <div class="bg-white rounded-xl border border-black/10 shadow-sm px-4 py-3 space-y-2">
      <h3 class="text-sm font-bold text-gray-700">画布尺寸</h3>
      <div class="text-[10px] text-gray-400 font-mono tabular-nums">
        {{ voxelStore.dimW }}&times;{{ voxelStore.dimH }}&times;{{ voxelStore.dimD }}
        &nbsp;|&nbsp; {{ voxelStore.voxelCount }} 体素
      </div>
    </div>

    <!-- HSL Color Picker -->
    <div class="bg-white rounded-xl border border-black/10 shadow-sm px-4 py-3 space-y-2">
      <h3 class="text-sm font-bold text-gray-700">HSL 颜色选择器</h3>

      <!-- Current color swatch -->
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-md border border-gray-200 shadow-inner flex-shrink-0"
          :style="{ backgroundColor: voxelStore.selectedColor }" />
        <span class="text-xs font-mono text-gray-600">{{ voxelStore.selectedColor }}</span>
      </div>

      <!-- HSL canvas 184x52 -->
      <canvas ref="hslCanvasRef" width="184" height="52"
        class="w-full rounded-md cursor-crosshair border border-gray-200" @click="onHslCanvasClick" />

      <!-- Hue bar -->
      <canvas ref="hueBarRef" width="184" height="10" class="w-full rounded-sm cursor-pointer border border-gray-200"
        @click="onHueBarClick" />

      <!-- Alpha slider + Hex input -->
      <div class="flex items-center gap-2">
        <label class="text-[10px] text-gray-500 w-10">透明度</label>
        <input v-model.number="pickerAlpha" type="range" min="0" max="255" class="flex-1 accent-gray-900 h-2" />
        <span class="text-[10px] font-mono text-gray-400 w-6 text-right">{{ pickerAlpha }}</span>
      </div>

      <div class="flex items-center gap-2">
        <label class="text-[10px] text-gray-500 w-10">Hex</label>
        <input v-model="hexInput" @change="onHexChange"
          class="flex-1 text-xs font-mono border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-gray-400" />
      </div>

      <!-- Mini palette (30 preset colors, show in grid) -->
      <div class="grid grid-cols-10 gap-1 pt-1">
        <button v-for="c in miniPalette" :key="c" @click="selectMiniPaletteColor(c)" :title="c"
          class="w-full rounded-sm border transition-all duration-100 hover:scale-110 active:scale-95"
          :style="{ backgroundColor: c, aspectRatio: '1 / 1' }"
          :class="voxelStore.selectedColor === c ? 'border-gray-900 ring-1 ring-gray-900/30' : 'border-gray-200'" />
      </div>
    </div>

    <!-- Palette Colors -->
    <div class="bg-white rounded-xl border border-black/10 shadow-sm px-4 py-3 space-y-2">
      <h3 class="text-sm font-bold text-gray-700">
        色板
        <span class="font-normal text-gray-400 ml-1">({{ activeBeadPalette.length }})</span>
      </h3>
      <div v-if="paletteColors.length === 0" class="text-xs text-gray-400 py-2 text-center">
        无色板数据
      </div>
      <div v-else class="grid grid-cols-6 gap-1.5">
        <button v-for="color in paletteColors" :key="color.hex" @click="voxelStore.selectedColor = color.hex"
          :title="color.hex"
          class="relative rounded-md border-2 transition-all duration-150 active:scale-95 flex items-center justify-center"
          :style="{ backgroundColor: color.hex, aspectRatio: '1 / 1' }" :class="[
            voxelStore.selectedColor === color.hex
              ? 'border-gray-900 ring-2 ring-gray-900/20'
              : 'border-gray-200 hover:border-gray-400',
          ]" />
      </div>
    </div>

    <!-- 图层管理 -->
    <div class="bg-white rounded-xl border border-black/10 shadow-sm px-4 py-3 space-y-2">
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-sm font-bold text-gray-700">图层</h3>
        <div class="flex gap-1">
          <button @click="layerEditMode = !layerEditMode" :class="[
            'text-xs px-2 py-0.5 rounded transition-colors',
            layerEditMode ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200'
          ]" title="编辑图层（拖动排序、显示空图层）">✎</button>
          <button @click="addLayer" class="text-xs px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200">+</button>
        </div>
      </div>
      <!-- X / Y / Z axis tabs -->
      <div class="flex rounded overflow-hidden mb-1" style="border: 1px solid var(--bd)">
        <button v-for="ax in layerAxes" :key="ax" @click="setLayerAxis(ax)"
          :class="[
            'flex-1 py-1 text-[10px] font-bold text-center transition-colors',
            layerAxis === ax ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200',
          ]">
          {{ ax.toUpperCase() }}
        </button>
      </div>
      <div class="space-y-0.5 max-h-32 overflow-y-auto">
        <template v-for="(val, idx) in currentLayerList" :key="val">
          <!-- Drop indicator BEFORE this layer -->
          <div v-if="dragOver === val && dropMode === 'before' && dragFrom !== val"
            class="h-0.5 bg-blue-500 rounded-full mx-2 my-[-2px] relative z-10"></div>
          <div
            :draggable="layerEditMode"
            @click="selectLayer(val)"
            @dragstart="onDragStart(val, $event)"
            @dragover="onDragOver(val, $event)"
            @dragleave="onDragLeave()"
            @drop="onDrop(val)"
            @dragend="onDragEnd()"
            :class="[
              'w-full text-left text-xs px-2 py-1 rounded transition-colors flex items-center justify-between',
              dragFrom === val ? 'opacity-40' : (layerEditMode ? 'cursor-grab' : 'cursor-default'),
              activeLayerVal === val
                ? (dragOver === val && dropMode === 'swap' ? 'bg-blue-800 text-white ring-2 ring-blue-400' : 'bg-gray-900 text-white')
                : (dragOver === val && dropMode === 'swap' ? 'bg-blue-100 ring-2 ring-blue-400' : 'hover:bg-gray-100 text-gray-600'),
            ]">
            <div class="flex items-center gap-1 min-w-0 flex-1">
              <span v-if="layerEditMode" class="text-[10px] opacity-40 select-none">⣿⣿</span>
              <span class="text-[9px] text-gray-400 font-mono tabular-nums w-4 text-center flex-shrink-0">
                #{{ val + 1 }}
              </span>
              <!-- Editable layer name -->
              <input v-if="editingLayerVal === val"
                v-model="editingName"
                class="layer-rename-input flex-1 min-w-0 bg-white text-gray-900 text-xs px-1 rounded border border-blue-400 outline-none"
                @blur="confirmRename()"
                @keydown.enter="confirmRename()"
                @keydown.escape="cancelRename()"
                @click.stop
              />
              <span v-else class="truncate cursor-text" @click.stop="startRename(val)">
                {{ voxelStore.getLayerName(layerAxis, val) }}
              </span>
            </div>
            <div class="flex gap-0.5 flex-shrink-0">
              <span @click.stop="toggleLayerVis(val)" class="cursor-pointer text-[10px]">
                {{ voxelStore.isLayerVisibleAxis(layerAxis, val) ? '👁' : '—' }}
              </span>
              <span @click.stop="copyLayer(val)" class="cursor-pointer text-[10px]">📋</span>
              <span @click.stop="deleteLayer(val)" class="cursor-pointer text-[10px]">🗑</span>
            </div>
          </div>
          <!-- Drop indicator AFTER this layer (for 'after' mode) -->
          <div v-if="dragOver === val && dropMode === 'after' && dragFrom !== val"
            class="h-0.5 bg-blue-500 rounded-full mx-2 my-[-2px] relative z-10"></div>
        </template>
        <div v-if="currentLayerList.length === 0" class="text-[10px] text-gray-400 py-1">暂无图层</div>
      </div>
    </div>

    <!-- Copy / Paste -->
    <div class="bg-white rounded-xl border border-black/10 shadow-sm px-4 py-3 space-y-2">
      <h3 class="text-sm font-bold text-gray-700">复制 / 粘贴</h3>

      <!-- Select Range -->
      <div class="space-y-1">
        <button @click="selectRange"
          class="w-full text-xs py-1.5 rounded bg-gray-100 hover:bg-gray-200 font-medium text-gray-700">
          📐 选择范围
        </button>
        <div v-if="rangeSelected" class="grid grid-cols-6 gap-1">
          <input v-model.number="selMinX" type="number"
            class="text-[10px] border border-gray-200 rounded px-1 py-0.5 w-full" title="Min X" />
          <input v-model.number="selMaxX" type="number"
            class="text-[10px] border border-gray-200 rounded px-1 py-0.5 w-full" title="Max X" />
          <input v-model.number="selMinY" type="number"
            class="text-[10px] border border-gray-200 rounded px-1 py-0.5 w-full" title="Min Y" />
          <input v-model.number="selMaxY" type="number"
            class="text-[10px] border border-gray-200 rounded px-1 py-0.5 w-full" title="Max Y" />
          <input v-model.number="selMinZ" type="number"
            class="text-[10px] border border-gray-200 rounded px-1 py-0.5 w-full" title="Min Z" />
          <input v-model.number="selMaxZ" type="number"
            class="text-[10px] border border-gray-200 rounded px-1 py-0.5 w-full" title="Max Z" />
        </div>
      </div>

      <button @click="copyRange" :disabled="!rangeSelected"
        class="w-full text-xs py-1.5 rounded font-medium transition-colors"
        :class="rangeSelected ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-gray-100 text-gray-400 cursor-not-allowed'">
        📋 复制范围
      </button>

      <!-- Paste -->
      <button @click="togglePaste" class="w-full text-xs py-1.5 rounded font-medium transition-colors"
        :class="pasteActive ? 'bg-orange-500 text-white hover:bg-orange-600' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'">
        {{ pasteActive ? '📌 粘贴模式（激活）' : '📌 粘贴' }}
      </button>
      <div v-if="pasteActive" class="space-y-1">
        <div class="flex gap-1">
          <div class="flex-1">
            <label class="text-[9px] text-gray-400 block">偏移 X</label>
            <input v-model.number="pasteOffX" type="number"
              class="text-[10px] border border-gray-200 rounded px-1 py-0.5 w-full" />
          </div>
          <div class="flex-1">
            <label class="text-[9px] text-gray-400 block">偏移 Y</label>
            <input v-model.number="pasteOffY" type="number"
              class="text-[10px] border border-gray-200 rounded px-1 py-0.5 w-full" />
          </div>
          <div class="flex-1">
            <label class="text-[9px] text-gray-400 block">偏移 Z</label>
            <input v-model.number="pasteOffZ" type="number"
              class="text-[10px] border border-gray-200 rounded px-1 py-0.5 w-full" />
          </div>
        </div>
        <button @click="applyPaste"
          class="w-full text-xs py-1.5 rounded bg-green-500 text-white hover:bg-green-600 font-medium">
          ✅ 应用粘贴（{{ clipboard.size }} 个体素）
        </button>
      </div>
    </div>

    <!-- Actions Grid (2 columns) -->
    <div class="bg-white rounded-xl border border-black/10 shadow-sm px-4 py-3 space-y-2">
      <h3 class="text-sm font-bold text-gray-700">操作</h3>
      <div class="grid grid-cols-2 gap-1">
        <button v-for="btn in actionButtons" :key="btn.id" @click="doAction(btn.id)" :title="btn.label"
          class="text-[11px] py-1.5 rounded font-medium transition-colors bg-gray-100 hover:bg-gray-200 text-gray-700">
          {{ btn.icon }} {{ btn.label }}
        </button>
      </div>
    </div>

    <!-- Project Save / Load -->
    <div class="bg-white rounded-xl border border-black/10 shadow-sm px-4 py-3 space-y-2">
      <h3 class="text-sm font-bold text-gray-700">项目</h3>
      <button @click="saveProject"
        class="w-full text-xs py-1.5 rounded bg-green-500 text-white hover:bg-green-600 font-medium">
        💾 保存项目
      </button>
      <div v-if="projectNames.length > 0" class="space-y-1">
        <select v-model="selectedProject" class="w-full text-xs border border-gray-200 rounded px-2 py-1 bg-white">
          <option value="" disabled>选择项目...</option>
          <option v-for="name in projectNames" :key="name" :value="name">{{ name }}</option>
        </select>
        <div class="flex gap-1">
          <button @click="loadProject" :disabled="!selectedProject"
            class="flex-1 text-xs py-1.5 rounded font-medium transition-colors"
            :class="selectedProject ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-gray-100 text-gray-400 cursor-not-allowed'">
            📂 加载
          </button>
          <button @click="deleteProject" :disabled="!selectedProject"
            class="flex-1 text-xs py-1.5 rounded font-medium transition-colors"
            :class="selectedProject ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-gray-100 text-gray-400 cursor-not-allowed'">
            🗑 删除
          </button>
        </div>
      </div>
      <div v-else class="text-[10px] text-gray-400 py-1 text-center">
        暂无保存的项目
      </div>
    </div>

  </div>
</template>
