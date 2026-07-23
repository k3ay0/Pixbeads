<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useVoxelStore, type VoxelData, type VoxelMap } from '@/stores/voxelStore'
import { usePaletteStore } from '@/stores/paletteStore'
import { useVoxelHistory, type VoxelAction } from '@/composables/useVoxelHistory'
import { useVoxelGeometry } from '@/composables/useVoxelGeometry'
import { getColorKeyByHex, sortColorsByHue } from '@/utils/colorSystemUtils'
import { hexToRgb, findClosestPaletteColor, isLightColor } from '@/utils/colorUtils'

const voxelStore = useVoxelStore()
const paletteStore = usePaletteStore()
const { activeBeadPalette, selectedColorSystem } = storeToRefs(paletteStore)
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
// HSV Color Picker
// ============================================================

const colorPanelCollapsed = ref(false)
const hueSortEnabled = ref(false)
const showAllColors = ref(false)
const showFullPalette = ref(false)
const selectedCategory = ref('all')

const pickerHue = ref(0)
const pickerSat = ref(100)
const pickerVal = ref(100)
const pickerHexInput = ref('#FF0000')
const pickerR = ref(255)
const pickerG = ref(0)
const pickerB = ref(0)
const pickerH = ref(0)
const pickerS = ref(100)
const pickerL = ref(50)
const pickerSource = ref<'hsv' | 'hex' | 'rgb' | 'hsl'>('hsv')

const satPanelRef = ref<HTMLElement | null>(null)
const hueBarRef = ref<HTMLElement | null>(null)
const isDraggingSat = ref(false)
const isDraggingHue = ref(false)

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  s /= 100; v /= 100
  const c = v * s
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else { r = c; b = x }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  }
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 }
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0, s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
    else if (max === g) h = ((b - r) / d + 2) * 60
    else h = ((r - g) / d + 4) * 60
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  s /= 100; l /= 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else { r = c; b = x }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase()
}

const pickerHex = computed(() => {
  const rgb = hsvToRgb(pickerHue.value, pickerSat.value, pickerVal.value)
  return rgbToHex(rgb.r, rgb.g, rgb.b)
})

const closestBeadColor = computed(() => {
  const rgb = hexToRgb(pickerHex.value)
  if (!rgb || !activeBeadPalette.value.length) return null
  const palette = activeBeadPalette.value.map((c: any) => ({
    key: c.key,
    hex: c.hex,
    rgb: hexToRgb(c.hex) || { r: 0, g: 0, b: 0 }
  }))
  const closest = findClosestPaletteColor(rgb, palette)
  return {
    ...closest,
    displayKey: getColorKeyByHex(closest.hex, selectedColorSystem.value)
  }
})

// 从体素数据中统计当前使用的颜色
const currentVoxelColors = computed(() => {
  const colorMap = new Map<string, number>()
  for (const voxel of voxelStore.voxels.values()) {
    const hex = voxel.color.toUpperCase()
    colorMap.set(hex, (colorMap.get(hex) || 0) + 1)
  }
  return Array.from(colorMap.entries()).map(([hex, count]) => ({
    key: getColorKeyByHex(hex, selectedColorSystem.value),
    color: hex,
    count
  }))
})

// 从颜色标签中提取分类字母（如 A01 -> A, B02 -> B）
function getCategoryFromKey(key: string): string {
  const match = key.match(/^([A-Za-z]+)/)
  return match ? match[1].toUpperCase() : '#'
}

// 获取所有颜色分类
const colorCategories = computed(() => {
  const categories = new Set<string>()
  if (showAllColors.value) {
    for (const c of activeBeadPalette.value) {
      const key = getColorKeyByHex(c.hex, selectedColorSystem.value)
      categories.add(getCategoryFromKey(key))
    }
  } else {
    for (const c of currentVoxelColors.value) {
      categories.add(getCategoryFromKey(c.key))
    }
  }
  return ['all', ...Array.from(categories).sort()]
})

// 按分类筛选后的颜色
const filteredColors = computed(() => {
  const colors = showAllColors.value
    ? activeBeadPalette.value.map((c: any) => ({ key: getColorKeyByHex(c.hex, selectedColorSystem.value), color: c.hex }))
    : currentVoxelColors.value

  if (selectedCategory.value === 'all') return colors
  return colors.filter(c => getCategoryFromKey(c.key) === selectedCategory.value)
})

const displayColors = computed(() => {
  const colors = filteredColors.value
  if (hueSortEnabled.value) return sortColorsByHue(colors)
  return colors
})

watch([pickerHue, pickerSat, pickerVal], () => {
  if (pickerSource.value !== 'hsv') return
  const rgb = hsvToRgb(pickerHue.value, pickerSat.value, pickerVal.value)
  pickerR.value = rgb.r; pickerG.value = rgb.g; pickerB.value = rgb.b
  pickerHexInput.value = rgbToHex(rgb.r, rgb.g, rgb.b)
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b)
  pickerH.value = hsl.h; pickerS.value = hsl.s; pickerL.value = hsl.l
}, { immediate: true })

// 切换显示模式时重置分类选择
watch(showAllColors, () => {
  selectedCategory.value = 'all'
})

// Sync picker when voxelStore.selectedColor changes externally (palette grid clicks, etc.)
watch(() => voxelStore.selectedColor, (hex) => {
  if (!hex) return
  const rgb = hexToRgb(hex)
  if (!rgb) return
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b)
  pickerHue.value = hsv.h
  pickerSat.value = hsv.s
  pickerVal.value = hsv.v
  pickerHexInput.value = hex.toUpperCase()
  pickerR.value = rgb.r
  pickerG.value = rgb.g
  pickerB.value = rgb.b
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b)
  pickerH.value = hsl.h
  pickerS.value = hsl.s
  pickerL.value = hsl.l
})

function updateFromHex() {
  const hex = pickerHexInput.value.trim()
  const rgb = hexToRgb(hex)
  if (!rgb) return
  pickerSource.value = 'hex'
  pickerR.value = rgb.r; pickerG.value = rgb.g; pickerB.value = rgb.b
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b)
  pickerHue.value = hsv.h; pickerSat.value = hsv.s; pickerVal.value = hsv.v
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b)
  pickerH.value = hsl.h; pickerS.value = hsl.s; pickerL.value = hsl.l
  nextTick(() => { pickerSource.value = 'hsv' })
}

function updateFromRgb() {
  pickerSource.value = 'rgb'
  const r = Math.max(0, Math.min(255, pickerR.value))
  const g = Math.max(0, Math.min(255, pickerG.value))
  const b = Math.max(0, Math.min(255, pickerB.value))
  pickerR.value = r; pickerG.value = g; pickerB.value = b
  pickerHexInput.value = rgbToHex(r, g, b)
  const hsv = rgbToHsv(r, g, b)
  pickerHue.value = hsv.h; pickerSat.value = hsv.s; pickerVal.value = hsv.v
  const hsl = rgbToHsl(r, g, b)
  pickerH.value = hsl.h; pickerS.value = hsl.s; pickerL.value = hsl.l
  nextTick(() => { pickerSource.value = 'hsv' })
}

function updateFromHsl() {
  pickerSource.value = 'hsl'
  const h = Math.max(0, Math.min(360, pickerH.value))
  const s = Math.max(0, Math.min(100, pickerS.value))
  const l = Math.max(0, Math.min(100, pickerL.value))
  pickerH.value = h; pickerS.value = s; pickerL.value = l
  const rgb = hslToRgb(h, s, l)
  pickerR.value = rgb.r; pickerG.value = rgb.g; pickerB.value = rgb.b
  pickerHexInput.value = rgbToHex(rgb.r, rgb.g, rgb.b)
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b)
  pickerHue.value = hsv.h; pickerSat.value = hsv.s; pickerVal.value = hsv.v
  nextTick(() => { pickerSource.value = 'hsv' })
}

function startSatDrag(e: MouseEvent | TouchEvent) {
  isDraggingSat.value = true
  updateSatFromEvent(e)
}
function updateSatFromEvent(e: MouseEvent | TouchEvent) {
  const panel = satPanelRef.value
  if (!panel) return
  const rect = panel.getBoundingClientRect()
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
  pickerSat.value = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100))
  pickerVal.value = Math.max(0, Math.min(100, 100 - ((clientY - rect.top) / rect.height) * 100))
}

function startHueDrag(e: MouseEvent | TouchEvent) {
  isDraggingHue.value = true
  updateHueFromEvent(e)
}
function updateHueFromEvent(e: MouseEvent | TouchEvent) {
  const bar = hueBarRef.value
  if (!bar) return
  const rect = bar.getBoundingClientRect()
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
  pickerHue.value = Math.max(0, Math.min(360, ((clientX - rect.left) / rect.width) * 360))
}

function onPickerMove(e: MouseEvent | TouchEvent) {
  if (isDraggingSat.value) updateSatFromEvent(e)
  if (isDraggingHue.value) updateHueFromEvent(e)
}
function onPickerEnd() {
  isDraggingSat.value = false
  isDraggingHue.value = false
}

function usePickerColor() {
  if (closestBeadColor.value) {
    voxelStore.selectedColor = closestBeadColor.value.hex
  }
}

onMounted(() => {
  window.addEventListener('mousemove', onPickerMove)
  window.addEventListener('mouseup', onPickerEnd)
  window.addEventListener('touchmove', onPickerMove)
  window.addEventListener('touchend', onPickerEnd)
})
onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onPickerMove)
  window.removeEventListener('mouseup', onPickerEnd)
  window.removeEventListener('touchmove', onPickerMove)
  window.removeEventListener('touchend', onPickerEnd)
})

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

    <!-- HSV Color Picker -->
    <div class="bg-white rounded-xl border border-black/10 shadow-sm px-4 py-3 space-y-2">
      <h3 class="text-sm font-bold text-gray-700">颜色选择器</h3>

      <div class="flex gap-1.5 mb-3">
        <div class="flex bg-gray-100 rounded-lg p-0.5">
          <button
            class="text-xs py-1 px-2.5 rounded-md transition-colors"
            :class="!showFullPalette ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 active:text-gray-700'"
            @click="showFullPalette = false"
          >色块</button>
          <button
            class="text-xs py-1 px-2.5 rounded-md transition-colors"
            :class="showFullPalette ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 active:text-gray-700'"
            @click="showFullPalette = true"
          >色盘</button>
        </div>
        <template v-if="!showFullPalette">
          <button
            class="flex-1 text-xs py-1.5 px-2 bg-gray-100 text-gray-600 rounded-lg active:bg-gray-200 transition-colors"
            @click="showAllColors = !showAllColors"
          >{{ showAllColors ? '全部' : '当前' }} ({{ displayColors.length }})</button>
          <button
            class="text-xs py-1.5 px-2.5 bg-gray-100 text-gray-600 rounded-lg active:bg-gray-200 transition-colors whitespace-nowrap"
            :class="hueSortEnabled ? 'ring-1 ring-gray-400' : ''"
            @click="hueSortEnabled = !hueSortEnabled"
          >色相排序</button>
        </template>
      </div>

      <!-- 色块模式：颜色网格 -->
      <template v-if="!showFullPalette">
        <div v-if="displayColors.length === 0" class="text-xs text-gray-400 text-center py-2">暂无颜色</div>
        <div v-else class="flex gap-2" style="height: 240px;">
          <!-- 左侧分类标签 -->
          <div class="flex flex-col gap-0.5 overflow-y-auto scrollbar-hide w-10 flex-shrink-0">
            <button
              v-for="cat in colorCategories"
              :key="cat"
              @click="selectedCategory = cat"
              class="text-[10px] py-1 px-1 rounded transition-colors whitespace-nowrap"
              :class="selectedCategory === cat
                ? 'bg-gray-900 text-white font-medium'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
            >{{ cat === 'all' ? '全部' : cat }}</button>
          </div>
          <!-- 右侧颜色网格 -->
          <div class="flex-1 overflow-y-auto scrollbar-hide">
            <div class="grid grid-cols-5 gap-1.5">
              <button
                v-for="color in displayColors"
                :key="color.color"
                @click="voxelStore.selectedColor = color.color"
                class="relative rounded-lg border-2 transition-all duration-150 active:scale-95 flex items-center justify-center"
                :style="{ backgroundColor: color.color, aspectRatio: '1 / 1' }"
                :title="`${color.key} (${color.color})`"
                :class="[
                  voxelStore.selectedColor?.toUpperCase() === color.color.toUpperCase()
                    ? 'border-gray-900 ring-2 ring-gray-900/20'
                    : 'border-gray-200 active:border-gray-400'
                ]"
              >
                <span
                  class="text-[9px] font-bold leading-none select-none"
                  :class="isLightColor(color.color) ? 'text-gray-900/70' : 'text-white/80'"
                >{{ color.key }}</span>
              </button>
            </div>
          </div>
        </div>
      </template>

      <!-- 色盘模式：HSV 颜色选择器 -->
      <template v-else>
        <div class="space-y-3">
          <!-- 饱和度/明度面板 -->
          <div
            ref="satPanelRef"
            class="relative rounded-lg cursor-crosshair touch-none select-none overflow-hidden"
            style="aspect-ratio: 224 / 144;"
            @mousedown="startSatDrag"
            @touchstart.prevent="startSatDrag"
          >
            <div class="absolute inset-0" :style="{ backgroundColor: `hsl(${pickerHue}, 100%, 50%)` }"></div>
            <div class="absolute inset-0" style="background: linear-gradient(to right, rgb(255, 255, 255), transparent);"></div>
            <div class="absolute inset-0" style="background: linear-gradient(transparent, rgb(0, 0, 0));"></div>
            <div
              class="absolute w-3.5 h-3.5 rounded-full border-2 border-white shadow-md pointer-events-none"
              :style="{
                left: pickerSat + '%',
                top: (100 - pickerVal) + '%',
                transform: 'translate(-50%, -50%)',
                backgroundColor: pickerHex
              }"
            ></div>
          </div>

          <!-- 色相滑块 -->
          <div
            ref="hueBarRef"
            class="relative rounded-full cursor-crosshair touch-none select-none"
            style="height: 14px; background: linear-gradient(to right, rgb(255, 0, 0) 0%, rgb(255, 255, 0) 17%, rgb(0, 255, 0) 33%, rgb(0, 255, 255) 50%, rgb(0, 0, 255) 67%, rgb(255, 0, 255) 83%, rgb(255, 0, 0) 100%);"
            @mousedown="startHueDrag"
            @touchstart.prevent="startHueDrag"
          >
            <div
              class="absolute top-1/2 w-3 h-3 rounded-full border-2 border-white shadow pointer-events-none"
              :style="{
                left: (pickerHue / 360 * 100) + '%',
                transform: 'translate(-50%, -50%)',
                backgroundColor: `hsl(${pickerHue}, 100%, 50%)`
              }"
            ></div>
          </div>

          <!-- 输入框 -->
          <div class="space-y-1.5">
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-gray-500 w-7 flex-shrink-0">HEX</span>
              <input
                v-model="pickerHexInput"
                @change="updateFromHex"
                @blur="updateFromHex"
                class="w-full px-1 py-1.5 rounded border border-gray-200 bg-white text-gray-700 text-center outline-none focus:border-gray-400 text-[11px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none flex-1"
              />
            </div>
            <div class="flex items-center gap-1.5">
              <span class="text-[11px] text-gray-500 w-7 flex-shrink-0">RGB</span>
              <input
                v-model.number="pickerR" type="number" min="0" max="255" placeholder="R"
                @change="updateFromRgb" @blur="updateFromRgb"
                class="w-full px-1 py-1.5 rounded border border-gray-200 bg-white text-gray-700 text-center outline-none focus:border-gray-400 text-[11px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none flex-1"
              />
              <input
                v-model.number="pickerG" type="number" min="0" max="255" placeholder="G"
                @change="updateFromRgb" @blur="updateFromRgb"
                class="w-full px-1 py-1.5 rounded border border-gray-200 bg-white text-gray-700 text-center outline-none focus:border-gray-400 text-[11px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none flex-1"
              />
              <input
                v-model.number="pickerB" type="number" min="0" max="255" placeholder="B"
                @change="updateFromRgb" @blur="updateFromRgb"
                class="w-full px-1 py-1.5 rounded border border-gray-200 bg-white text-gray-700 text-center outline-none focus:border-gray-400 text-[11px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none flex-1"
              />
            </div>
            <div class="flex items-center gap-1.5">
              <span class="text-[11px] text-gray-500 w-7 flex-shrink-0">HSL</span>
              <input
                v-model.number="pickerH" type="number" min="0" max="360" placeholder="H"
                @change="updateFromHsl" @blur="updateFromHsl"
                class="w-full px-1 py-1.5 rounded border border-gray-200 bg-white text-gray-700 text-center outline-none focus:border-gray-400 text-[11px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none flex-1"
              />
              <input
                v-model.number="pickerS" type="number" min="0" max="100" placeholder="S"
                @change="updateFromHsl" @blur="updateFromHsl"
                class="w-full px-1 py-1.5 rounded border border-gray-200 bg-white text-gray-700 text-center outline-none focus:border-gray-400 text-[11px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none flex-1"
              />
              <input
                v-model.number="pickerL" type="number" min="0" max="100" placeholder="L"
                @change="updateFromHsl" @blur="updateFromHsl"
                class="w-full px-1 py-1.5 rounded border border-gray-200 bg-white text-gray-700 text-center outline-none focus:border-gray-400 text-[11px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none flex-1"
              />
            </div>
          </div>

          <!-- 最近拼豆色匹配 -->
          <div v-if="closestBeadColor" class="p-2.5 bg-gray-100 rounded-lg space-y-2">
            <div class="flex items-center gap-2">
              <div class="w-6 h-6 rounded border border-gray-300 flex-shrink-0" :style="{ backgroundColor: pickerHex }"></div>
              <svg class="w-3 h-3 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"></path>
              </svg>
              <div class="w-6 h-6 rounded border border-gray-300 flex-shrink-0" :style="{ backgroundColor: closestBeadColor.hex }"></div>
              <div class="text-xs text-gray-600 min-w-0">
                <span class="font-semibold">{{ closestBeadColor.displayKey }}</span>
                <span class="text-gray-500 ml-1">{{ closestBeadColor.hex }}</span>
              </div>
            </div>
            <button
              @click="usePickerColor"
              class="w-full text-xs py-1.5 rounded-lg bg-blue-500 text-white font-medium active:bg-blue-600 transition-colors"
            >使用此颜色</button>
          </div>
        </div>
      </template>
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
