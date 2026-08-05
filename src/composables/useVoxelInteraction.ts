import { ref } from 'vue'
import * as THREE from 'three'
import { useVoxelStore, type Point3D, type VoxelTool, type VoxelData } from '@/stores/voxelStore'
import { useVoxelGeometry } from '@/composables/useVoxelGeometry'

// Simple color distance: sum of absolute RGB differences
function colorDistance(a: string, b: string): number {
  const parseHex = (h: string): [number, number, number] => {
    const match = h.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
    if (!match) return [0, 0, 0]
    return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)]
  }
  const [r1, g1, b1] = parseHex(a)
  const [r2, g2, b2] = parseHex(b)
  return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2)
}

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  let h = 0, s = 0
  const l = (max + min) / 2
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === r) h = 60 * ((g - b) / d + (g < b ? 6 : 0))
    else if (max === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)]
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360
  s = Math.max(0, Math.min(100, s))
  l = Math.max(0, Math.min(100, l))
  const s1 = s / 100, l1 = l / 100
  const a = s1 * Math.min(l1, 1 - l1)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round(Math.max(0, Math.min(1, l1 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))) * 255)
      .toString(16).padStart(2, '0')
  }
  return '#' + f(0) + f(8) + f(4)
}

function blendColor(originalColor: string, seedColor: string, fillColor: string): string {
  const [ho, so, lo] = hexToHsl(originalColor)
  const [hs, ss, ls] = hexToHsl(seedColor)
  const [hf, sf, lf] = hexToHsl(fillColor)
  const ns = Math.max(0, Math.min(100, sf + (so - ss)))
  const nl = Math.max(0, Math.min(100, lf + (lo - ls)))
  return hslToHex(hf, ns, nl)
}

function floodFill3D(
  sx: number, sy: number, sz: number,
  store: ReturnType<typeof useVoxelStore>,
  fillColor?: string,
  isDelete: boolean = false,
  isRecolor: boolean = false,
): Point3D[] {
  const seedKey = store.vk(sx, sy, sz)
  const seedColor = store.getVoxel(sx, sy, sz)?.color ?? null
  const visited = new Set<string>()
  const queue: [number, number, number][] = [[sx, sy, sz]]
  const result: Point3D[] = []

  while (queue.length > 0 && visited.size < 80000) {
    const [x, y, z] = queue.shift()!
    if (x < 0 || y < 0 || z < 0 || x >= store.dimW || y >= store.dimH || z >= store.dimD) continue
    const key = store.vk(x, y, z)
    if (visited.has(key)) continue
    visited.add(key)

    const voxelColor = store.getVoxel(x, y, z)?.color ?? null

    // Color tolerance check
    if (seedColor === null) {
      if (voxelColor !== null) continue
    } else {
      if (voxelColor === null) continue
      const d = colorDistance(seedColor, voxelColor)
      if (d > 60) continue
    }

    result.push({ x, y, z })

    // 26 neighbors (includes diagonals)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          if (dx !== 0 || dy !== 0 || dz !== 0)
            queue.push([x + dx, y + dy, z + dz])
  }

  return result
}

export interface HitResult {
  existing: Point3D | null   // the voxel that was hit (null if hit ground plane)
  adjacent: Point3D | null   // the adjacent empty cell where new voxel goes
  color: string | null       // color of the hit voxel (for eyedropper)
}

export interface ToolActionCallback {
  (tool: VoxelTool, positions: Point3D[], color: string, mode: 'draw' | 'del' | 'recolor'): void
}

interface AnchorState {
  pos: Point3D
  tool: VoxelTool
}

export function useVoxelInteraction(
  canvas: THREE.HTMLCanvasElement,
  camera: THREE.PerspectiveCamera,
  voxelGroup: THREE.Group,
  ghostGroup: THREE.Group,
  onToolAction: ToolActionCallback,
) {
  const store = useVoxelStore()
  const { showGhost, clearGhost } = useVoxelGeometry()

  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const pointerStart = ref({ x: 0, y: 0 })
  const anchor = ref<AnchorState | null>(null)
  const clipboard = ref<Map<string, VoxelData> | null>(null)
  const pasteMode = ref(false)
  const pasteAnchor = ref<Point3D | null>(null)
  const CLICK_THRESHOLD = 3 // pixels

  function raycast(event: PointerEvent): HitResult | null {
    const rect = canvas.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

    raycaster.setFromCamera(pointer, camera)
    const hits = raycaster.intersectObjects(voxelGroup.children, false)

    if (hits.length > 0) {
      const hit = hits[0]
      const obj = hit.object as THREE.Mesh
      const normal = hit.face!.normal
      const vx = obj.userData.vx as number
      const vy = obj.userData.vy as number
      const vz = obj.userData.vz as number

      return {
        existing: { x: vx, y: vy, z: vz },
        adjacent: {
          x: vx + Math.round(normal.x),
          y: vy + Math.round(normal.y),
          z: vz + Math.round(normal.z),
        },
        color: store.getVoxel(vx, vy, vz)?.color ?? null,
      }
    }

    // Fallback: intersect with Y=0 plane
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const point = new THREE.Vector3()
    if (raycaster.ray.intersectPlane(plane, point)) {
      const gx = Math.floor(point.x)
      const gz = Math.floor(point.z)
      if (gx >= 0 && gx < store.dimW && gz >= 0 && gz < store.dimD)
        return { existing: null, adjacent: { x: gx, y: 0, z: gz }, color: null }
    }

    return null
  }

  function handlePointerDown(event: PointerEvent): void {
    pointerStart.value = { x: event.clientX, y: event.clientY }
  }

  function handlePointerUp(event: PointerEvent): void {
    const dx = Math.abs(event.clientX - pointerStart.value.x)
    const dy = Math.abs(event.clientY - pointerStart.value.y)

    if (dx < CLICK_THRESHOLD && dy < CLICK_THRESHOLD) {
      // IT'S A CLICK — process tool action
      const hit = raycast(event)
      if (!hit) return
      processToolClick(hit)
    }
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!anchor.value) return

    const hit = raycast(event)
    if (!hit) return

    // Update ghost preview for 2-click tools
    updateGhostPreview(hit, anchor.value)
  }

  function handleContextMenu(event: Event): void {
    event.preventDefault()
    // Cancel current anchor
    if (anchor.value) {
      anchor.value = null
      clearGhost()
    }
    // Cancel paste mode
    if (pasteMode.value) {
      pasteMode.value = false
      pasteAnchor.value = null
      clearGhost()
    }
  }

  function processToolClick(hit: HitResult): void {
    const tool = store.currentTool
    const isDel = tool === 'eraser'
    const pos = isDel ? (hit.existing || hit.adjacent) : hit.adjacent
    if (!pos) return

    // === SINGLE-CLICK TOOLS ===
    if (tool === 'eraser') {
      // Eraser: instant delete existing voxels
      const positions = store.getMirrorPoints(pos.x, pos.y, pos.z)
        .filter(p => store.getVoxel(p.x, p.y, p.z)) // only existing voxels
      if (positions.length > 0) {
        onToolAction('eraser', positions, '', 'del')
      }
      return
    }

    if (tool === 'fill') {
      // 3D flood fill from clicked position
      const points = floodFill3D(pos.x, pos.y, pos.z, store)
      if (points.length > 0) {
        // 对于 recolor 模式，使用 blendColor 混合颜色
        const finalColor = store.editMode === 'recolor' && store.selectedColor
          ? store.selectedColor
          : store.selectedColor || '#ff3070'
        onToolAction('fill', points, finalColor, store.editMode === 'recolor' ? 'recolor' : store.editMode === 'del' ? 'del' : 'draw')
      }
      return
    }

    // === SELECT RANGE TOOL ===
    if (tool === 'sel') {
      if (!anchor.value) {
        // First click — set anchor
        anchor.value = { pos, tool: 'sel' }
        showGhost([{ x: pos.x, y: pos.y, z: pos.z }], '#00d4f0', 'draw', store.currentDirection)
      } else {
        // Second click — select box region
        const min = {
          x: Math.min(anchor.value.pos.x, pos.x),
          y: Math.min(anchor.value.pos.y, pos.y),
          z: Math.min(anchor.value.pos.z, pos.z)
        }
        const max = {
          x: Math.max(anchor.value.pos.x, pos.x),
          y: Math.max(anchor.value.pos.y, pos.y),
          z: Math.max(anchor.value.pos.z, pos.z)
        }

        const clip = new Map<string, VoxelData>()
        for (let x = min.x; x <= max.x; x++) {
          for (let y = min.y; y <= max.y; y++) {
            for (let z = min.z; z <= max.z; z++) {
              const voxel = store.getVoxel(x, y, z)
              if (voxel) {
                clip.set(`${x - min.x},${y - min.y},${z - min.z}`, { ...voxel })
              }
            }
          }
        }

        clipboard.value = clip
        clearGhost()
        anchor.value = null
      }
      return
    }

    // === PASTE MODE ===
    if (pasteMode.value && clipboard.value) {
      if (!pasteAnchor.value) {
        // First click — show preview
        pasteAnchor.value = pos
        const pts: Point3D[] = []
        clipboard.value.forEach((_, key) => {
          const [dx, dy, dz] = key.split(',').map(Number)
          pts.push({ x: pos.x + dx, y: pos.y + dy, z: pos.z + dz })
        })
        showGhost(pts, '#00d4f0', 'draw', store.currentDirection)
      } else {
        // Second click — confirm paste
        const actions: { x: number; y: number; z: number; prev: VoxelData | null; next: VoxelData }[] = []
        clipboard.value.forEach((data, key) => {
          const [dx, dy, dz] = key.split(',').map(Number)
          const x = pasteAnchor.value!.x + dx
          const y = pasteAnchor.value!.y + dy
          const z = pasteAnchor.value!.z + dz
          if (x >= 0 && y >= 0 && z >= 0 && x < store.dimW && y < store.dimH && z < store.dimD) {
            const result = store.setVoxel(x, y, z, data.color, data.alpha ?? 255)
            if (result) actions.push({ x, y, z, prev: result.prev, next: result.next })
          }
        })

        if (actions.length > 0) {
          onToolAction('paste', [], store.selectedColor || '#ff3070', 'draw')
        }

        clearGhost()
        pasteAnchor.value = null
        // Stay in paste mode for repeated pasting
      }
      return
    }

    if (tool === 'spray' || tool === 'scatter' || tool === 'noisePen') {
      const positions: Point3D[] = []
      const r = store.brushSize + 1
      const MPAL = ['#ff3070', '#ff6040', '#ffa020', '#ffe030', '#80d040', '#30b060',
                    '#20c0a0', '#2090e0', '#4060ff', '#8040f0', '#c030d0', '#ffffff',
                    '#c0c0c0', '#808080', '#404040', '#000000']
      for (let i = 0; i < r * r * 2; i++) {
        const dx = Math.floor(Math.random() * r * 2 - r)
        const dy = Math.floor(Math.random() * r * 2 - r)
        const dz = Math.floor(Math.random() * r * 2 - r)
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) <= r) {
          const c = tool === 'scatter' ? MPAL[Math.floor(Math.random() * MPAL.length)] : store.selectedColor
          store.getMirrorPoints(pos.x + dx, pos.y + dy, pos.z + dz).forEach(p => positions.push(p))
        }
      }
      if (positions.length > 0) {
        onToolAction(tool, positions, store.selectedColor || '#ff3070', 'draw')
      }
      return
    }

    if (tool === 'fillSlice') {
      const positions: Point3D[] = []
      const currentZ = store.currentZ
      for (let x = 0; x < store.dimW; x++) {
        for (let y = 0; y < store.dimH; y++) {
          store.getMirrorPoints(x, y, currentZ).forEach(p => positions.push(p))
        }
      }
      if (positions.length > 0) {
        onToolAction('fillSlice', positions, store.selectedColor || '#ff3070', store.editMode === 'del' ? 'del' : 'draw')
      }
      return
    }

    // === 2-CLICK TOOLS ===
    // Pen, Line, Rect, FillRect: 1st click → set anchor + ghost; 2nd click → confirm
    if (!anchor.value) {
      // First click — set anchor
      anchor.value = { pos, tool }
      // Show initial ghost (single point)
      showGhost(store.getMirrorPoints(pos.x, pos.y, pos.z), store.selectedColor || '#ff3070', 'draw', store.currentDirection)
    } else {
      // Second click — confirm
      const positions = computeToolPositions(anchor.value, pos)
      clearGhost()
      anchor.value = null
      if (positions.length > 0) {
        onToolAction(tool, positions, store.selectedColor || '#ff3070', 'draw')
      }
    }
  }

  function computeToolPositions(anch: AnchorState, end: Point3D): Point3D[] {
    const allPoints: Point3D[] = []
    const brushR = store.brushSize - 1

    switch (anch.tool) {
      case 'pen': {
        // Brush cube at anchor position (pen places only at anchor, ignoring end)
        for (let dx = -brushR; dx <= brushR; dx++) {
          for (let dy = -brushR; dy <= brushR; dy++) {
            for (let dz = 0; dz <= 0; dz++) {
              store.getMirrorPoints(anch.pos.x + dx, anch.pos.y + dy, anch.pos.z + dz)
                .forEach(p => allPoints.push(p))
            }
          }
        }
        break
      }
      case 'line': {
        // Bresenham 3D line from anchor to end
        const steps = Math.max(
          Math.abs(end.x - anch.pos.x),
          Math.abs(end.y - anch.pos.y),
          Math.abs(end.z - anch.pos.z),
        )
        for (let i = 0; i <= steps; i++) {
          const t = steps ? i / steps : 0
          const x = Math.round(anch.pos.x + t * (end.x - anch.pos.x))
          const y = Math.round(anch.pos.y + t * (end.y - anch.pos.y))
          const z = Math.round(anch.pos.z + t * (end.z - anch.pos.z))
          // Apply brush thickness
          for (let dx = -brushR; dx <= brushR; dx++) {
            for (let dy = -brushR; dy <= brushR; dy++) {
              for (let dz = -brushR; dz <= brushR; dz++) {
                store.getMirrorPoints(x + dx, y + dy, z + dz)
                  .forEach(p => allPoints.push(p))
              }
            }
          }
        }
        break
      }
      case 'rect': {
        // Hollow rectangular shell
        const minX = Math.min(anch.pos.x, end.x); const maxX = Math.max(anch.pos.x, end.x)
        const minY = Math.min(anch.pos.y, end.y); const maxY = Math.max(anch.pos.y, end.y)
        const minZ = Math.min(anch.pos.z, end.z); const maxZ = Math.max(anch.pos.z, end.z)
        for (let x = minX; x <= maxX; x++)
          for (let y = minY; y <= maxY; y++)
            for (let z = minZ; z <= maxZ; z++)
              if (x === minX || x === maxX || y === minY || y === maxY || z === minZ || z === maxZ)
                store.getMirrorPoints(x, y, z).forEach(p => allPoints.push(p))
        break
      }
      case 'frect': {
        // Filled rectangular solid
        const minX = Math.min(anch.pos.x, end.x); const maxX = Math.max(anch.pos.x, end.x)
        const minY = Math.min(anch.pos.y, end.y); const maxY = Math.max(anch.pos.y, end.y)
        const minZ = Math.min(anch.pos.z, end.z); const maxZ = Math.max(anch.pos.z, end.z)
        for (let x = minX; x <= maxX; x++)
          for (let y = minY; y <= maxY; y++)
            for (let z = minZ; z <= maxZ; z++)
              store.getMirrorPoints(x, y, z).forEach(p => allPoints.push(p))
        break
      }
      case 'circle':
      case 'fcircle': {
        const rad = Math.round(Math.sqrt(
          (end.x - anch.pos.x) ** 2 + (end.y - anch.pos.y) ** 2 + (end.z - anch.pos.z) ** 2
        ))
        const filled = anch.tool === 'fcircle'
        for (let x = anch.pos.x - rad; x <= anch.pos.x + rad; x++) {
          for (let y = anch.pos.y - rad; y <= anch.pos.y + rad; y++) {
            for (let z = anch.pos.z - rad; z <= anch.pos.z + rad; z++) {
              const d = Math.sqrt((x - anch.pos.x) ** 2 + (y - anch.pos.y) ** 2 + (z - anch.pos.z) ** 2)
              if (filled ? d <= rad + 0.3 : Math.abs(d - rad) < 1.2) {
                store.getMirrorPoints(x, y, z).forEach(p => allPoints.push(p))
              }
            }
          }
        }
        break
      }
      case 'ellipse':
      case 'fellipse': {
        const rx = Math.max(1, Math.abs(end.x - anch.pos.x))
        const ry = Math.max(1, Math.abs(end.y - anch.pos.y))
        const rz = Math.max(1, Math.abs(end.z - anch.pos.z))
        const filled = anch.tool === 'fellipse'
        for (let x = anch.pos.x - rx; x <= anch.pos.x + rx; x++) {
          for (let y = anch.pos.y - ry; y <= anch.pos.y + ry; y++) {
            for (let z = anch.pos.z - rz; z <= anch.pos.z + rz; z++) {
              const dx = x - anch.pos.x, dy = y - anch.pos.y, dz = z - anch.pos.z
              if ((dx / rx) ** 2 + (dy / ry) ** 2 + (dz / rz) ** 2 <= 1.0) {
                if (filled) {
                  store.getMirrorPoints(x, y, z).forEach(p => allPoints.push(p))
                } else {
                  let isSurface = false
                  for (const [nx, ny, nz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
                    if (((dx + nx) / rx) ** 2 + ((dy + ny) / ry) ** 2 + ((dz + nz) / rz) ** 2 > 1.0) {
                      isSurface = true; break
                    }
                  }
                  if (isSurface) store.getMirrorPoints(x, y, z).forEach(p => allPoints.push(p))
                }
              }
            }
          }
        }
        break
      }
    }

    // Deduplicate
    const seen = new Set<string>()
    return allPoints.filter(p => {
      const k = `${p.x},${p.y},${p.z}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }

  function updateGhostPreview(hit: HitResult, anch: AnchorState): void {
    const pos = hit.adjacent
    if (!pos) return

    let points: Point3D[] = []
    const brushR = store.brushSize - 1

    switch (anch.tool) {
      case 'pen': {
        store.getMirrorPoints(anch.pos.x, anch.pos.y, anch.pos.z).forEach(p => {
          for (let dx = -brushR; dx <= brushR; dx++)
            for (let dy = -brushR; dy <= brushR; dy++)
              points.push({ x: p.x + dx, y: p.y + dy, z: p.z })
        })
        break
      }
      case 'line':
      case 'rect':
      case 'frect':
      case 'circle':
      case 'fcircle':
      case 'ellipse':
      case 'fellipse':
        // Reuse compute for preview
        points = computeToolPositions(anch, pos)
        break
    }

    clearGhost()
    showGhost(points, store.selectedColor || '#ff3070', 'draw', store.currentDirection)
  }

  function startPaste(): void {
    if (clipboard.value && clipboard.value.size > 0) {
      pasteMode.value = true
      pasteAnchor.value = null
    }
  }

  function cancelPaste(): void {
    pasteMode.value = false
    pasteAnchor.value = null
    clearGhost()
  }

  // Register event listeners
  function attachEvents(): void {
    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointerup', handlePointerUp)
    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('contextmenu', handleContextMenu)
  }

  function detachEvents(): void {
    canvas.removeEventListener('pointerdown', handlePointerDown)
    canvas.removeEventListener('pointerup', handlePointerUp)
    canvas.removeEventListener('pointermove', handlePointerMove)
    canvas.removeEventListener('contextmenu', handleContextMenu)
  }

  return {
    anchor,
    clipboard,
    pasteMode,
    startPaste,
    cancelPaste,
    raycast,
    attachEvents,
    detachEvents,
  }
}
