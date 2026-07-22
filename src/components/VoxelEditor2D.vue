<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useVoxelStore, type VoxelData } from '@/stores/voxelStore'
import { useVoxelHistory, type VoxelAction } from '@/composables/useVoxelHistory'
import { useVoxelGeometry } from '@/composables/useVoxelGeometry'

const store = useVoxelStore()
const { pushUndo } = useVoxelHistory()

// ===== REFS =====
const canvas2dRef = ref<HTMLCanvasElement | null>(null)
const ghostCanvasRef = ref<HTMLCanvasElement | null>(null)
const canvasWrap = ref<HTMLDivElement | null>(null)

// ===== STATE =====
const sAx = ref<'y' | 'z' | 'x'>('y')
const sIdx = ref(0)
const cellSize = ref(20)
const showGrid = ref(true)
const bgType = ref<'solid' | 'gradient' | 'checker'>('checker')
const bgC1 = ref('#ffffff')
const bgC2 = ref('#e0e0e0')

// Drawing state
const drawing = ref(false)
const lastCell = ref<{ sx: number; sy: number } | null>(null)
const pendingActions = ref<VoxelAction[]>([])

// Shape tool anchor + ghost preview
const toolAnchor = ref<{ sx: number; sy: number } | null>(null)
const ghostPts = ref<[number, number][]>([])

// Zoom and pan state
const zoom = ref(1)
const panX = ref(0)
const panY = ref(0)
const isPanning = ref(false)
const panStartX = ref(0)
const panStartY = ref(0)
const panStartPanX = ref(0)
const panStartPanY = ref(0)

// ===== COMPUTED =====
const sDims = computed(() => {
  if (sAx.value === 'y') return { w: store.dimW, h: store.dimD }
  if (sAx.value === 'z') return { w: store.dimW, h: store.dimH }
  return { w: store.dimD, h: store.dimH }
})

const sliceMax = computed(() => {
  if (sAx.value === 'y') return store.dimH
  if (sAx.value === 'z') return store.dimD
  return store.dimW
})

// Watch settings and re-render when changed
watch([showGrid, bgType, bgC1, bgC2], () => {
  renderCanvas()
})

// ===== COORDINATE MAPPING (VoxoB s2w) =====
function screenToVoxel(sx: number, sy: number): { x: number; y: number; z: number } {
  if (sAx.value === 'y') return { x: sx, y: sIdx.value, z: sy }
  if (sAx.value === 'z') return { x: sx, y: store.dimH - 1 - sy, z: sIdx.value }
  return { x: sIdx.value, y: store.dimH - 1 - sy, z: sx }
}

// ===== BRESENHAM LINE =====
function bresenhamLine(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const pts: [number, number][] = []
  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const stepX = x0 < x1 ? 1 : -1
  const stepY = y0 < y1 ? 1 : -1
  let err = dx - dy
  let cx = x0
  let cy = y0
  while (true) {
    pts.push([cx, cy])
    if (cx === x1 && cy === y1) break
    const e2 = 2 * err
    if (e2 > -dy) { err -= dy; cx += stepX }
    if (e2 < dx) { err += dx; cy += stepY }
  }
  return pts
}

// ===== RESIZE & RENDER =====
function resizeCanvas() {
  const wrap = canvasWrap.value
  const c2d = canvas2dRef.value
  const ghost = ghostCanvasRef.value
  if (!wrap || !c2d || !ghost) return

  const s = sDims.value
  const mw = Math.max(1, wrap.clientWidth - 6)
  const mh = Math.max(1, wrap.clientHeight - 6)
  
  // Calculate base cell size to fit the canvas
  const baseCellSize = Math.max(3, Math.min(Math.floor(mw / s.w), Math.floor(mh / s.h), 40))
  cellSize.value = baseCellSize

  // Apply zoom to canvas dimensions
  const scaledCellSize = baseCellSize * zoom.value
  const cw = Math.floor(s.w * scaledCellSize)
  const ch = Math.floor(s.h * scaledCellSize)
  c2d.width = cw
  c2d.height = ch
  ghost.width = cw
  ghost.height = ch

  // Center the canvas with pan offset
  const ox = Math.max(0, (wrap.clientWidth - cw) / 2) + panX.value
  const oy = Math.max(0, (wrap.clientHeight - ch) / 2) + panY.value;

  [c2d, ghost].forEach((c) => {
    c.style.left = ox + 'px'
    c.style.top = oy + 'px'
    c.style.width = cw + 'px'
    c.style.height = ch + 'px'
  })

  renderCanvas()
}

function renderCanvas() {
  const c2d = canvas2dRef.value
  if (!c2d) return
  const ctx = c2d.getContext('2d')
  if (!ctx) return

  const s = sDims.value
  // Apply zoom to cell size for rendering
  const cs = cellSize.value * zoom.value

  ctx.clearRect(0, 0, c2d.width, c2d.height)

  if (bgType.value === 'gradient') {
    const g = ctx.createLinearGradient(0, 0, c2d.width, c2d.height)
    g.addColorStop(0, bgC1.value)
    g.addColorStop(1, bgC2.value)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, c2d.width, c2d.height)
  } else if (bgType.value === 'checker') {
    ctx.fillStyle = bgC1.value
    ctx.fillRect(0, 0, c2d.width, c2d.height)
    ctx.fillStyle = bgC2.value
    for (let sx = 0; sx < s.w; sx++) {
      for (let sy = 0; sy < s.h; sy++) {
        if ((sx + sy) % 2) {
          ctx.fillRect(sx * cs, sy * cs, cs, cs)
        }
      }
    }
  } else {
    // Solid
    ctx.fillStyle = bgC1.value
    ctx.fillRect(0, 0, c2d.width, c2d.height)
  }

  // Draw voxels at current slice
  const voxels = store.voxels
  for (let sx = 0; sx < s.w; sx++) {
    for (let sy = 0; sy < s.h; sy++) {
      const w = screenToVoxel(sx, sy)
      const k = store.vk(w.x, w.y, w.z)
      const v = voxels.get(k)
      if (v) {
        ctx.globalAlpha = (v.alpha ?? 255) / 255
        ctx.fillStyle = v.color
        
        // Determine voxel direction relative to current viewing plane
        const voxelDir = v.direction ?? 'y'
        const isPerpendicular = voxelDir === sAx.value
        
        const x = sx * cs
        const y = sy * cs
        const centerX = x + cs / 2
        const centerY = y + cs / 2
        
        if (isPerpendicular) {
          // Draw circle (cross-section of cylinder perpendicular to viewing plane)
          const radius = (cs - 1) / 2
          ctx.beginPath()
          ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
          ctx.fill()
        } else {
          // Draw square base
          ctx.fillRect(x + 0.5, y + 0.5, cs - 1, cs - 1)
          
          // Draw direction indicator line inside the square
          ctx.strokeStyle = 'rgba(255,255,255,0.7)'
          ctx.lineWidth = Math.max(1, cs / 6)
          ctx.lineCap = 'round'
          ctx.beginPath()
          
          // Determine which parallel direction and draw appropriate indicator
          // Get the two parallel axes (not the current viewing axis)
          const axes = ['x', 'y', 'z'].filter(a => a !== sAx.value)
          const isPrimaryAxis = voxelDir === axes[0]
          
          if (isPrimaryAxis) {
            // Primary parallel axis: draw horizontal line
            ctx.moveTo(x + cs * 0.25, centerY)
            ctx.lineTo(x + cs * 0.75, centerY)
          } else {
            // Secondary parallel axis: draw vertical line
            ctx.moveTo(centerX, y + cs * 0.25)
            ctx.lineTo(centerX, y + cs * 0.75)
          }
          ctx.stroke()
        }
        
        ctx.globalAlpha = 1
      }
    }
  }

  // Grid lines
  if (showGrid.value) {
    ctx.strokeStyle = 'rgba(100,120,160,.15)'
    ctx.lineWidth = 1
    for (let x = 0; x <= s.w; x++) {
      ctx.beginPath()
      ctx.moveTo(x * cs, 0)
      ctx.lineTo(x * cs, s.h * cs)
      ctx.stroke()
    }
    for (let y = 0; y <= s.h; y++) {
      ctx.beginPath()
      ctx.moveTo(0, y * cs)
      ctx.lineTo(s.w * cs, y * cs)
      ctx.stroke()
    }
  }
}

function renderGhost() {
  const ghost = ghostCanvasRef.value
  if (!ghost) return
  const ctx = ghost.getContext('2d')
  if (!ctx) return

  ctx.clearRect(0, 0, ghost.width, ghost.height)

  if (ghostPts.value.length === 0) return

  const cs = cellSize.value
  const mode = store.editMode
  const color =
    mode === 'del' ? '#f0307044' :
      mode === 'recolor' ? '#40d08044' :
        store.selectedColor + '44'
  ctx.fillStyle = color

  for (const [sx, sy] of ghostPts.value) {
    ctx.fillRect(sx * cs, sy * cs, cs, cs)
  }
}

// ===== CELL PAINTING (accumulates undo actions) =====
function paintCell(sx: number, sy: number): VoxelAction[] {
  const actions: VoxelAction[] = []
  const mode = store.editMode
  const r = store.brushSize - 1
  const s = sDims.value

  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      const nx = sx + dx
      const ny = sy + dy
      if (nx < 0 || ny < 0 || nx >= s.w || ny >= s.h) continue

      const w = screenToVoxel(nx, ny)
      store.getMirrorPoints(w.x, w.y, w.z).forEach((p) => {
        const result = store.doVoxel(p.x, p.y, p.z, store.selectedColor, mode, store.currentDirection)
        if (result) {
          actions.push({ x: p.x, y: p.y, z: p.z, prev: result.prev, next: result.next })
        }
      })
    }
  }

  renderCanvas()
  return actions
}

// ===== SHAPE COMPUTATION =====
function computeShape(a: { sx: number; sy: number }, b: { sx: number; sy: number }): [number, number][] {
  const tool = store.currentTool
  const s = sDims.value

  if (tool === 'line') {
    return bresenhamLine(a.sx, a.sy, b.sx, b.sy)
      .filter(([x, y]) => x >= 0 && y >= 0 && x < s.w && y < s.h)
  }
  if (tool === 'rect') {
    const x0 = Math.min(a.sx, b.sx)
    const x1 = Math.max(a.sx, b.sx)
    const y0 = Math.min(a.sy, b.sy)
    const y1 = Math.max(a.sy, b.sy)
    const pts: [number, number][] = []
    for (let x = x0; x <= x1; x++) { pts.push([x, y0]); pts.push([x, y1]) }
    for (let y = y0 + 1; y < y1; y++) { pts.push([x0, y]); pts.push([x1, y]) }
    return pts.filter(([x, y]) => x >= 0 && y >= 0 && x < s.w && y < s.h)
  }
  if (tool === 'frect') {
    const x0 = Math.min(a.sx, b.sx)
    const x1 = Math.max(a.sx, b.sx)
    const y0 = Math.min(a.sy, b.sy)
    const y1 = Math.max(a.sy, b.sy)
    const pts: [number, number][] = []
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        pts.push([x, y])
      }
    }
    return pts.filter(([x, y]) => x >= 0 && y >= 0 && x < s.w && y < s.h)
  }
  if (tool === 'circle' || tool === 'fcircle') {
    const cxc = a.sx, cyc = a.sy
    const rad = Math.round(Math.sqrt((b.sx - cxc) ** 2 + (b.sy - cyc) ** 2))
    const filled = tool === 'fcircle'
    const pts: [number, number][] = []
    for (let dx = -rad - 1; dx <= rad + 1; dx++) {
      for (let dy = -rad - 1; dy <= rad + 1; dy++) {
        const d = Math.sqrt(dx ** 2 + dy ** 2)
        if (filled ? d <= rad + 0.5 : Math.abs(d - rad) < 0.8) {
          pts.push([Math.floor(cxc + dx), Math.floor(cyc + dy)])
        }
      }
    }
    return pts.filter(([x, y]) => x >= 0 && y >= 0 && x < s.w && y < s.h)
  }
  if (tool === 'ellipse' || tool === 'fellipse') {
    const cxc = a.sx, cyc = a.sy
    const rx = Math.max(1, Math.abs(b.sx - a.sx)), ry = Math.max(1, Math.abs(b.sy - a.sy))
    const filled = tool === 'fellipse'
    const pts: [number, number][] = []
    for (let dx = -rx - 1; dx <= rx + 1; dx++) {
      for (let dy = -ry - 1; dy <= ry + 1; dy++) {
        if ((dx / rx) ** 2 + (dy / ry) ** 2 <= 1.0) {
          if (filled) {
            pts.push([Math.floor(cxc + dx), Math.floor(cyc + dy)])
          } else {
            let isSurf = false
            for (const [nx, ny] of [[1,0],[-1,0],[0,1],[0,-1]]) {
              if (((dx + nx) / rx) ** 2 + ((dy + ny) / ry) ** 2 > 1.0) { isSurf = true; break }
            }
            if (isSurf) pts.push([Math.floor(cxc + dx), Math.floor(cyc + dy)])
          }
        }
      }
    }
    return pts.filter(([x, y]) => x >= 0 && y >= 0 && x < s.w && y < s.h)
  }
  return []
}

/** Apply brush thickness to shape outline — used for line/rect (not frect) */
function thickenPts(pts: [number, number][], thickness: number): [number, number][] {
  if (thickness <= 1) return pts
  const r = Math.floor(thickness / 2)
  const seen = new Set<string>()
  const result: [number, number][] = []
  for (const [x, y] of pts) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        const key = `${x + dx},${y + dy}`
        if (!seen.has(key)) {
          seen.add(key)
          result.push([x + dx, y + dy])
        }
      }
    }
  }
  return result
}

/** Execute shape result: apply mirror + doVoxel to each screen point */
function applyShapePts(pts: [number, number][]): VoxelAction[] {
  const actions: VoxelAction[] = []
  const mode = store.editMode

  for (const [sx, sy] of pts) {
    const w = screenToVoxel(sx, sy)
    store.getMirrorPoints(w.x, w.y, w.z).forEach((p) => {
      const result = store.doVoxel(p.x, p.y, p.z, store.selectedColor, mode, store.currentDirection)
      if (result) {
        actions.push({ x: p.x, y: p.y, z: p.z, prev: result.prev, next: result.next })
      }
    })
  }
  return actions
}

// ===== COLOR DISTANCE (hex string version for flood fill) =====
function hexColorDistance(a: string, b: string): number {
  const parseHex = (h: string): [number, number, number] => {
    const match = h.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
    if (!match) return [0, 0, 0]
    return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)]
  }
  const [r1, g1, b1] = parseHex(a)
  const [r2, g2, b2] = parseHex(b)
  return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2)
}

// ===== 2D FLOOD FILL =====
function floodFill2D(sx: number, sy: number): VoxelAction[] {
  const s = sDims.value
  const w0 = screenToVoxel(sx, sy)
  const seedColor = store.getVoxel(w0.x, w0.y, w0.z)?.color ?? null
  const visited = new Set<string>()
  const queue: [number, number][] = [[sx, sy]]
  const actions: VoxelAction[] = []
  const fillColor = store.selectedColor

  while (queue.length > 0) {
    const [cx, cy] = queue.shift()!
    if (cx < 0 || cy < 0 || cx >= s.w || cy >= s.h) continue
    const key = `${cx},${cy}`
    if (visited.has(key)) continue
    visited.add(key)

    const w = screenToVoxel(cx, cy)
    const voxelColor = store.getVoxel(w.x, w.y, w.z)?.color ?? null

    if (seedColor === null) { if (voxelColor !== null) continue }
    else { if (voxelColor === null || hexColorDistance(seedColor, voxelColor) > 60) continue }

    store.getMirrorPoints(w.x, w.y, w.z).forEach(p => {
      const result = store.doVoxel(p.x, p.y, p.z, fillColor, store.editMode, store.currentDirection)
      if (result) actions.push({ x: p.x, y: p.y, z: p.z, prev: result.prev, next: result.next })
    })

    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        if (dx !== 0 || dy !== 0) queue.push([cx + dx, cy + dy])
  }
  return actions
}

// ===== 2D SPRAY / SCATTER / NOISE PEN =====
function drawSpray(sx: number, sy: number): VoxelAction[] {
  const s = sDims.value
  const r = store.brushSize
  const actions: VoxelAction[] = []
  const MPAL = ['#ff3070', '#ff6040', '#ffa020', '#ffe030', '#80d040', '#30b060',
                '#20c0a0', '#2090e0', '#4060ff', '#8040f0', '#c030d0', '#ffffff',
                '#c0c0c0', '#808080', '#404040', '#000000']

  for (let i = 0; i < r * 3; i++) {
    const dx = Math.floor(Math.random() * r * 2 - r)
    const dy = Math.floor(Math.random() * r * 2 - r)
    if (Math.sqrt(dx * dx + dy * dy) > r) continue

    const nx = sx + dx, ny = sy + dy
    if (nx < 0 || ny < 0 || nx >= s.w || ny >= s.h) continue

    let c = store.selectedColor
    if (store.currentTool === 'scatter') c = MPAL[Math.floor(Math.random() * MPAL.length)]
    if (store.currentTool === 'noisePen') {
      // Simple noise filter
      const noise = Math.sin(nx * 0.3) * Math.cos(ny * 0.7) + Math.sin(nx * 1.3 + ny * 0.5)
      if ((noise + 1) / 2 < 0.4) continue
    }

    const w = screenToVoxel(nx, ny)
    store.getMirrorPoints(w.x, w.y, w.z).forEach(p => {
      const result = store.doVoxel(p.x, p.y, p.z, c, store.editMode, store.currentDirection)
      if (result) actions.push({ x: p.x, y: p.y, z: p.z, prev: result.prev, next: result.next })
    })
  }
  return actions
}

// ===== EVENT HELPERS =====
function cellFromEvent(e: MouseEvent): { sx: number; sy: number } | null {
  const c2d = canvas2dRef.value
  if (!c2d) return null
  const rect = c2d.getBoundingClientRect()
  const mouseX = e.clientX - rect.left
  const mouseY = e.clientY - rect.top
  
  // Check if click is within canvas bounds
  if (mouseX < 0 || mouseY < 0 || mouseX >= rect.width || mouseY >= rect.height) {
    return null
  }
  
  // Apply zoom factor to cell size for coordinate calculation
  const cs = cellSize.value * zoom.value
  const sx = Math.floor(mouseX / cs)
  const sy = Math.floor(mouseY / cs)
  const s = sDims.value
  if (sx < 0 || sy < 0 || sx >= s.w || sy >= s.h) return null
  return { sx, sy }
}

/** Flush pending pen actions to undo history and sync 3D */
function flushPending(): void {
  if (pendingActions.value.length === 0) return
  pushUndo(pendingActions.value, '2d-pen')
  const { rebuildAllMeshes } = useVoxelGeometry()
  rebuildAllMeshes()
  pendingActions.value = []
}

/** Cancel tool anchor (Escape key) */
function cancelAnchor(): void {
  toolAnchor.value = null
  ghostPts.value = []
  renderGhost()
}

// ===== MOUSE HANDLERS =====
function handleWheel(e: WheelEvent) {
  e.preventDefault()
  const delta = e.deltaY > 0 ? 0.9 : 1.1
  const newZoom = Math.max(0.25, Math.min(4, zoom.value * delta))
  
  // Get mouse position relative to canvas
  const rect = canvasWrap.value?.getBoundingClientRect()
  if (!rect) return
  const mouseX = e.clientX - rect.left
  const mouseY = e.clientY - rect.top
  
  // Calculate zoom center
  const oldZoom = zoom.value
  zoom.value = newZoom
  
  // Adjust pan to zoom towards mouse position
  const zoomRatio = newZoom / oldZoom
  panX.value = mouseX - (mouseX - panX.value) * zoomRatio
  panY.value = mouseY - (mouseY - panY.value) * zoomRatio
  
  resizeCanvas()
}

function handleMiddleMouseDown(e: MouseEvent) {
  if (e.button !== 1) return
  e.preventDefault()
  isPanning.value = true
  panStartX.value = e.clientX
  panStartY.value = e.clientY
  panStartPanX.value = panX.value
  panStartPanY.value = panY.value
  document.addEventListener('mousemove', handleMiddleMouseMove)
  document.addEventListener('mouseup', handleMiddleMouseUp)
  document.body.style.cursor = 'grabbing'
}

function handleMiddleMouseMove(e: MouseEvent) {
  if (!isPanning.value) return
  panX.value = panStartPanX.value + (e.clientX - panStartX.value)
  panY.value = panStartPanY.value + (e.clientY - panStartY.value)
  resizeCanvas()
}

function handleMiddleMouseUp() {
  isPanning.value = false
  document.removeEventListener('mousemove', handleMiddleMouseMove)
  document.removeEventListener('mouseup', handleMiddleMouseUp)
  document.body.style.cursor = ''
}

function handlePanMouseMove(e: MouseEvent) {
  if (!isPanning.value) return
  panX.value = panStartPanX.value + (e.clientX - panStartX.value)
  panY.value = panStartPanY.value + (e.clientY - panStartY.value)
  resizeCanvas()
}

function handlePanMouseUp() {
  isPanning.value = false
  document.removeEventListener('mousemove', handlePanMouseMove)
  document.removeEventListener('mouseup', handlePanMouseUp)
  document.body.style.cursor = ''
}

function handleMouseDown(e: MouseEvent) {
  // Handle middle mouse button for panning
  if (e.button === 1) {
    handleMiddleMouseDown(e)
    return
  }
  
  if (e.button !== 0) return
  const c = cellFromEvent(e)
  
  // If clicking outside the canvas grid, start panning
  if (!c) {
    isPanning.value = true
    panStartX.value = e.clientX
    panStartY.value = e.clientY
    panStartPanX.value = panX.value
    panStartPanY.value = panY.value
    document.addEventListener('mousemove', handlePanMouseMove)
    document.addEventListener('mouseup', handlePanMouseUp)
    document.body.style.cursor = 'grabbing'
    return
  }

  const tool = store.currentTool
  const mode = store.editMode

  // Eyedropper
  if (tool === 'eyedropper') {
    const w = screenToVoxel(c.sx, c.sy)
    const v = store.getVoxel(w.x, w.y, w.z)
    if (v) store.selectedColor = v.color
    return
  }

  // Fill — 2D flood fill
  if (tool === 'fill') {
    const actions = floodFill2D(c.sx, c.sy)
    if (actions.length > 0) {
      pushUndo(actions, '2d-fill')
      const { rebuildAllMeshes } = useVoxelGeometry()
      rebuildAllMeshes()
    }
    renderCanvas()
    return
  }

  // Spray/Scatter/NoisePen — continuous drawing
  if (tool === 'spray' || tool === 'scatter' || tool === 'noisePen') {
    drawing.value = true
    lastCell.value = c
    const actions = drawSpray(c.sx, c.sy)
    pendingActions.value.push(...actions)
    renderCanvas()
    return
  }

  // Shape tools — two-click pattern
  if (['line', 'rect', 'frect', 'circle', 'fcircle', 'ellipse', 'fellipse'].includes(tool)) {
    if (!toolAnchor.value) {
      toolAnchor.value = c
      ghostPts.value = [[c.sx, c.sy]]
      renderGhost()
    } else {
      let pts = computeShape(toolAnchor.value, c)
      // Apply brush thickness for outline tools (line, rect)
      if (tool === 'line' || tool === 'rect') {
        pts = thickenPts(pts, store.brushSize)
      }
      const s = sDims.value
      pts = pts.filter(([x, y]) => x >= 0 && y >= 0 && x < s.w && y < s.h)

      const actions = applyShapePts(pts)

      if (actions.length > 0) {
        pushUndo(actions, '2d-' + tool)
        const { rebuildAllMeshes } = useVoxelGeometry()
        rebuildAllMeshes()
      }

      toolAnchor.value = null
      ghostPts.value = []
      renderGhost()
      renderCanvas()
    }
    return
  }

  // Fill Slice — flood fill current slice
  if (tool === 'fillSlice') {
    const actions = applyShapePts(
      Array.from({ length: sDims.value.w }, (_, sx) =>
        Array.from({ length: sDims.value.h }, (_, sy) => [sx, sy] as [number, number])
      ).flat()
    )

    if (actions.length > 0) {
      pushUndo(actions, '2d-fillslice')
      const { rebuildAllMeshes } = useVoxelGeometry()
      rebuildAllMeshes()
      renderCanvas()
    }
    return
  }

  // Pen — start continuous drawing
  if (tool === 'pen') {
    drawing.value = true
    lastCell.value = c
    const actions = paintCell(c.sx, c.sy)
    pendingActions.value.push(...actions)
    return
  }
}

function handleMouseMove(e: MouseEvent) {
  const c = cellFromEvent(e)
  if (!c) return

  const tool = store.currentTool

  // Pen — continuous drawing with Bresenham line fill
  if (drawing.value && tool === 'pen' && lastCell.value) {
    if (lastCell.value.sx === c.sx && lastCell.value.sy === c.sy) return
    const line = bresenhamLine(lastCell.value.sx, lastCell.value.sy, c.sx, c.sy)
    for (const [px, py] of line) {
      const actions = paintCell(px, py)
      pendingActions.value.push(...actions)
    }
    lastCell.value = c
    return
  }

  // Spray/Scatter/NoisePen — continuous drawing
  if (drawing.value && (tool === 'spray' || tool === 'scatter' || tool === 'noisePen') && lastCell.value) {
    if (lastCell.value.sx === c.sx && lastCell.value.sy === c.sy) return
    const actions = drawSpray(c.sx, c.sy)
    pendingActions.value.push(...actions)
    lastCell.value = c
    renderCanvas()
    return
  }

  // Shape tools — update ghost preview
  if (toolAnchor.value && ['line', 'rect', 'frect'].includes(tool)) {
    let pts = computeShape(toolAnchor.value, c)
    if (tool === 'line' || tool === 'rect') {
      pts = thickenPts(pts, store.brushSize)
    }
    ghostPts.value = pts
    renderGhost()
    return
  }
}

function handleMouseUp(_e: MouseEvent) {
  if (drawing.value) {
    drawing.value = false
    flushPending()
    lastCell.value = null
  }
}

function handleMouseLeave() {
  if (drawing.value) {
    drawing.value = false
    flushPending()
    lastCell.value = null
  }
}

function handleContextMenu(e: MouseEvent) {
  e.preventDefault()
  if (toolAnchor.value) {
    cancelAnchor()
  }
}

// ===== TOOLBAR ACTIONS =====
function setAxis(ax: 'y' | 'z' | 'x') {
  sAx.value = ax
  store.currentAxis = ax
  store.currentDirection = ax  // 同步切换方向
  sIdx.value = 0
  // Sync layer state to store
  syncingFrom2D = true
  store.currentLayer = 0
  store.layerAxis = ax
  store.currentZ = 0
  syncingFrom2D = false
  cancelAnchor()
  resizeCanvas()
}

function moveSlice(dir: number) {
  sIdx.value = Math.max(0, Math.min(sliceMax.value - 1, sIdx.value + dir))
  // Sync back to store so layer panel stays in sync
  syncingFrom2D = true
  store.currentLayer = sIdx.value
  store.currentAxis = sAx.value
  store.currentZ = sIdx.value
  syncingFrom2D = false
  cancelAnchor()
  renderCanvas()
}

// ===== WATCHERS =====
watch(() => store.currentTool, () => {
  cancelAnchor()
})

watch([() => store.selectedColor, () => store.editMode, () => store.brushSize], () => {
  renderCanvas()
})

watch([() => store.dimW, () => store.dimH, () => store.dimD], () => {
  resizeCanvas()
})

// Sync from 3D editor: re-render 2D canvas when voxels change
watch(() => store.voxels, () => {
  renderCanvas()
}, { deep: true })

// Sync from layer panel: switch 2D view when a layer is selected
// (but skip when the 2D editor itself initiated the store change)
let syncingFrom2D = false
watch([() => store.currentLayer, () => store.layerAxis], ([newVal, newAxis]) => {
  if (syncingFrom2D) return
  if (newAxis && newVal >= 0) {
    sAx.value = newAxis
    sIdx.value = newVal
    cancelAnchor()
    resizeCanvas()
  }
})

// ===== LIFECYCLE =====
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  resizeCanvas()
  resizeObserver = new ResizeObserver(() => {
    resizeCanvas()
  })
  if (canvasWrap.value) {
    resizeObserver.observe(canvasWrap.value)
  }

  // Touch support
  const canvas2d = canvas2dRef.value
  if (canvas2d) {
    canvas2d.addEventListener('touchstart', (e: TouchEvent) => {
      e.preventDefault()
      const t = e.touches[0]
      const evt = new MouseEvent('mousedown', { clientX: t.clientX, clientY: t.clientY, button: 0, bubbles: true })
      canvas2d.dispatchEvent(evt)
    }, { passive: false })

    canvas2d.addEventListener('touchmove', (e: TouchEvent) => {
      e.preventDefault()
      const t = e.touches[0]
      const evt = new MouseEvent('mousemove', { clientX: t.clientX, clientY: t.clientY, button: 0, bubbles: true })
      canvas2d.dispatchEvent(evt)
    }, { passive: false })

    canvas2d.addEventListener('touchend', (e: TouchEvent) => {
      e.preventDefault()
      canvas2d.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    }, { passive: false })
  }
})

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect()
  }
})

// Expose cancelAnchor for parent (Escape key handler in App.vue)
defineExpose({
  cancelAnchor,
  setBackground2D(cfg: { type: string; color1: string; color2: string }) {
    bgType.value = cfg.type as any
    bgC1.value = cfg.color1
    bgC2.value = cfg.color2
  }
})
</script>

<template>
  <div class="flex-1 min-w-[60px] flex flex-col overflow-hidden v-theme-bg2">
    <!-- Toolbar -->
    <div class="flex items-center gap-1 px-2 py-1 v-theme-bg3 flex-shrink-0" style="border-bottom: 1px solid var(--bd)">
      <button v-for="ax in (['y', 'z', 'x'] as const)" :key="ax" @click="setAxis(ax)" :class="[
        'px-2 py-0.5 text-xs rounded',
        sAx === ax ? 'bg-blue-600 text-white' : 'v-theme-text2 hover:v-theme-bg4',
      ]">
        {{ ax.toUpperCase() }}
      </button>
      <button @click="showGrid = !showGrid" :class="[
        'px-2 py-0.5 text-xs rounded font-mono',
        showGrid ? 'bg-blue-600 text-white' : 'v-theme-text2',
      ]" title="Toggle grid">
        &#x25A6;
      </button>
      <button @click="bgType = bgType === 'solid' ? 'checker' : bgType === 'checker' ? 'gradient' : 'solid'" 
        class="text-xs px-1 py-0.5 rounded v-theme-text2 hover:!text-white" title="Toggle background">
        {{ bgType === 'solid' ? '■' : bgType === 'checker' ? '▦' : '◧' }}
      </button>
      <div class="flex-1"></div>
      <button @click="moveSlice(-1)" class="v-theme-text2 hover:!text-white text-xs px-1" title="Previous slice">
        &#x25C0;
      </button>
      <span class="text-blue-400 text-xs font-mono w-16 text-center">
        {{ sAx.toUpperCase() }}:{{ sIdx + 1 }}/{{ sliceMax }}
      </span>
      <button @click="moveSlice(1)" class="v-theme-text2 hover:!text-white text-xs px-1" title="Next slice">
        &#x25B6;
      </button>
    </div>

    <!-- Canvas area -->
    <div ref="canvasWrap" class="flex-1 relative overflow-hidden" @wheel="handleWheel">
      <canvas ref="canvas2dRef" class="absolute" style="image-rendering: pixelated; cursor: crosshair"
        @mousedown="handleMouseDown" @mousemove="handleMouseMove" @mouseup="handleMouseUp"
        @mouseleave="handleMouseLeave" @contextmenu="handleContextMenu" />
      <canvas ref="ghostCanvasRef" class="absolute pointer-events-none" style="image-rendering: pixelated" />
    </div>
  </div>
</template>
