<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useVoxelSlicing, type Slice2D } from '@/composables/useVoxelSlicing'
import { useBeadStore } from '@/stores/beadStore'
import type { MappedPixel, GridDimensions } from '@/types'
import { TRANSPARENT_KEY } from '@/types'

const props = defineProps<{
  isOpen: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'exported'): void  // fired after successful export to 2D editor
}>()

const { computeAllSlices } = useVoxelSlicing()
const beadStore = useBeadStore()

const cellSize = ref(6)
const gapCells = ref(2)
const showGrid = ref(true)

const canvasRef = ref<HTMLCanvasElement | null>(null)

// Zoom & pan
const zoom = ref(1)
const panX = ref(0)
const panY = ref(0)
const isPanning = ref(false)
const panStartX = ref(0)
const panStartY = ref(0)
const panStartPanX = ref(0)
const panStartPanY = ref(0)

// Checkerboard colors
const CHECKER_A = '#ffffff'
const CHECKER_B = '#e0e0e0'

// Compute slices when modal opens
const slices = computed(() => {
  if (!props.isOpen) return null
  return computeAllSlices()
})

// Re-render when data or settings change
watch([slices, cellSize, gapCells, showGrid, zoom, panX, panY], () => {
  nextTick(renderCanvas)
})

watch(() => props.isOpen, (val) => {
  if (val) {
    zoom.value = 1
    panX.value = 0
    panY.value = 0
    nextTick(renderCanvas)
  }
})

/** Layout info for a single axis section */
interface AxisLayout {
  axis: 'x' | 'y' | 'z'
  label: string
  slices: Slice2D[]
  startY: number
  totalWidth: number
  totalHeight: number
  slicePositions: { x: number; y: number }[]
}

function computeLayout(): { layouts: AxisLayout[]; totalW: number; totalH: number } {
  const s = slices.value
  if (!s) return { layouts: [], totalW: 0, totalH: 0 }

  const cs = cellSize.value
  const gap = gapCells.value * cs
  const labelHeight = 24
  const sectionGap = 16

  const layouts: AxisLayout[] = []
  let currentY = 0
  let maxTotalW = 0

  for (const axis of ['x', 'y', 'z'] as const) {
    const axisSlices = s[axis]
    if (axisSlices.length === 0) continue

    const sw = axisSlices[0].width * cs
    const sh = axisSlices[0].height * cs

    const totalWidth = axisSlices.length * sw + (axisSlices.length - 1) * gap
    const totalHeight = labelHeight + sh

    const slicePositions: { x: number; y: number }[] = []
    for (let i = 0; i < axisSlices.length; i++) {
      slicePositions.push({ x: i * (sw + gap), y: labelHeight })
    }

    const axisLabels = { x: 'X 轴切片 (YZ 平面)', y: 'Y 轴切片 (XZ 平面)', z: 'Z 轴切片 (XY 平面)' }

    layouts.push({
      axis,
      label: axisLabels[axis],
      slices: axisSlices,
      startY: currentY,
      totalWidth,
      totalHeight,
      slicePositions,
    })

    maxTotalW = Math.max(maxTotalW, totalWidth)
    currentY += totalHeight + sectionGap
  }

  if (layouts.length > 0) currentY -= sectionGap

  return { layouts, totalW: maxTotalW, totalH: currentY }
}

/** Draw a single checkerboard cell */
function drawCheckerboard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, cs: number) {
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? CHECKER_A : CHECKER_B
      ctx.fillRect(x + c * cs, y + r * cs, cs, cs)
    }
  }
}

function renderCanvas() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const { layouts, totalW, totalH } = computeLayout()
  if (totalW === 0 || totalH === 0) return

  const cs = cellSize.value
  const z = zoom.value

  const cw = Math.ceil(totalW * z)
  const ch = Math.ceil(totalH * z)
  canvas.width = cw
  canvas.height = ch
  canvas.style.width = cw + 'px'
  canvas.style.height = ch + 'px'

  const parent = canvas.parentElement
  if (parent) {
    const ox = Math.max(0, (parent.clientWidth - cw) / 2) + panX.value
    const oy = Math.max(0, (parent.clientHeight - ch) / 2) + panY.value
    canvas.style.left = ox + 'px'
    canvas.style.top = oy + 'px'
  }

  // White background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, cw, ch)

  ctx.save()
  ctx.scale(z, z)

  for (const layout of layouts) {
    // Axis label
    ctx.fillStyle = '#555588'
    ctx.font = 'bold 12px sans-serif'
    ctx.textBaseline = 'top'
    ctx.fillText(layout.label, 0, layout.startY)

    for (let si = 0; si < layout.slices.length; si++) {
      const slice = layout.slices[si]
      const sx = layout.slicePositions[si].x
      const sy = layout.startY + layout.slicePositions[si].y

      // Checkerboard background for empty cells
      drawCheckerboard(ctx, sx, sy, slice.width, slice.height, cs)

      // Draw voxels
      for (let r = 0; r < slice.height; r++) {
        for (let c = 0; c < slice.width; c++) {
          const color = slice.grid[r][c]
          if (color) {
            ctx.fillStyle = color
            ctx.fillRect(sx + c * cs + 0.5, sy + r * cs + 0.5, cs - 1, cs - 1)
          }
        }
      }

      // Grid lines
      if (showGrid.value && cs >= 4) {
        ctx.strokeStyle = 'rgba(100,120,160,.15)'
        ctx.lineWidth = 0.5
        for (let x = 0; x <= slice.width; x++) {
          ctx.beginPath()
          ctx.moveTo(sx + x * cs, sy)
          ctx.lineTo(sx + x * cs, sy + slice.height * cs)
          ctx.stroke()
        }
        for (let y = 0; y <= slice.height; y++) {
          ctx.beginPath()
          ctx.moveTo(sx, sy + y * cs)
          ctx.lineTo(sx + slice.width * cs, sy + y * cs)
          ctx.stroke()
        }
      }

      // Slice index label
      ctx.fillStyle = '#6666aa'
      ctx.font = '9px monospace'
      ctx.textBaseline = 'bottom'
      ctx.fillText(`${slice.index}`, sx + 2, sy - 2)
    }
  }

  ctx.restore()
}

// ===== EXPORT TO 2D EDITOR =====

/** Find bounding box of non-null cells in a slice */
function getSliceBounds(slice: Slice2D): { minR: number; maxR: number; minC: number; maxC: number } | null {
  let minR = slice.height, maxR = -1, minC = slice.width, maxC = -1
  for (let r = 0; r < slice.height; r++) {
    for (let c = 0; c < slice.width; c++) {
      if (slice.grid[r][c] !== null) {
        minR = Math.min(minR, r)
        maxR = Math.max(maxR, r)
        minC = Math.min(minC, c)
        maxC = Math.max(maxC, c)
      }
    }
  }
  if (maxR < 0) return null
  return { minR, maxR, minC, maxC }
}

/** Trim a slice to its bounding box + margin */
function trimSlice(slice: Slice2D, margin: number): { grid: (string | null)[][]; width: number; height: number } | null {
  const bounds = getSliceBounds(slice)
  if (!bounds) return null

  const r0 = Math.max(0, bounds.minR - margin)
  const r1 = Math.min(slice.height - 1, bounds.maxR + margin)
  const c0 = Math.max(0, bounds.minC - margin)
  const c1 = Math.min(slice.width - 1, bounds.maxC + margin)

  const w = c1 - c0 + 1
  const h = r1 - r0 + 1
  const grid: (string | null)[][] = []

  for (let r = r0; r <= r1; r++) {
    const row: (string | null)[] = []
    for (let c = c0; c <= c1; c++) {
      row.push(slice.grid[r][c])
    }
    grid.push(row)
  }

  return { grid, width: w, height: h }
}

/** Export all slices as a single 2D grid to the bead editor */
function handleExport() {
  const s = slices.value
  if (!s) return

  const margin = 2
  const axisLabels = ['x', 'y', 'z'] as const

  // Collect all trimmed slices from all axes
  const trimmed: { grid: (string | null)[][]; width: number; height: number; axis: string; index: number }[] = []

  for (const axis of axisLabels) {
    for (const slice of s[axis]) {
      const t = trimSlice(slice, margin)
      if (t) {
        trimmed.push({ ...t, axis, index: slice.index })
      }
    }
  }

  if (trimmed.length === 0) return

  // Find max cell dimensions among all trimmed slices
  let maxCellW = 0
  let maxCellH = 0
  for (const t of trimmed) {
    maxCellW = Math.max(maxCellW, t.width)
    maxCellH = Math.max(maxCellH, t.height)
  }

  // All slices are placed in cells of the same size (maxCellW × maxCellH)
  const cellW = maxCellW
  const cellH = maxCellH
  const gap = margin * 2  // gap between cells in the output grid

  // Determine grid layout: try to be roughly square
  const count = trimmed.length
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)

  // Final output dimensions
  const outW = cols * cellW + (cols - 1) * gap
  const outH = rows * cellH + (rows - 1) * gap

  // Build output MappedPixel[][]
  const output: MappedPixel[][] = []
  for (let r = 0; r < outH; r++) {
    const row: MappedPixel[] = []
    for (let c = 0; c < outW; c++) {
      row.push({ key: TRANSPARENT_KEY, color: '#FFFFFF', isExternal: true })
    }
    output.push(row)
  }

  // Place each trimmed slice into the grid
  for (let i = 0; i < trimmed.length; i++) {
    const t = trimmed[i]
    const colIdx = i % cols
    const rowIdx = Math.floor(i / cols)

    // Center the slice within its cell
    const offsetX = colIdx * (cellW + gap) + Math.floor((cellW - t.width) / 2)
    const offsetY = rowIdx * (cellH + gap) + Math.floor((cellH - t.height) / 2)

    for (let r = 0; r < t.height; r++) {
      for (let c = 0; c < t.width; c++) {
        const color = t.grid[r][c]
        if (color) {
          const outR = offsetY + r
          const outC = offsetX + c
          if (outR >= 0 && outR < outH && outC >= 0 && outC < outW) {
            output[outR][outC] = {
              key: color,  // use hex as key since we don't have a color system mapping
              color: color,
              isExternal: false,
            }
          }
        }
      }
    }
  }

  // Export to bead store
  const dimensions: GridDimensions = { N: outH, M: outW }
  beadStore.setPixelData(output, dimensions)

  emit('exported')
  emit('close')
}

// ===== ZOOM & PAN =====
function handleWheel(e: WheelEvent) {
  e.preventDefault()
  const delta = e.deltaY > 0 ? 0.9 : 1.1
  zoom.value = Math.max(0.25, Math.min(6, zoom.value * delta))
}

function handleMouseDown(e: MouseEvent) {
  if (e.button === 1 || e.button === 0) {
    isPanning.value = true
    panStartX.value = e.clientX
    panStartY.value = e.clientY
    panStartPanX.value = panX.value
    panStartPanY.value = panY.value
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'grabbing'
  }
}

function handleMouseMove(e: MouseEvent) {
  if (!isPanning.value) return
  panX.value = panStartPanX.value + (e.clientX - panStartX.value)
  panY.value = panStartPanY.value + (e.clientY - panStartY.value)
}

function handleMouseUp() {
  isPanning.value = false
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
  document.body.style.cursor = ''
}

function handleOverlayClick(e: MouseEvent) {
  if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
    emit('close')
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="isOpen" class="modal-overlay fixed inset-0 bg-black/70 z-[80] flex items-center justify-center"
      @click="handleOverlayClick">
      <div class="v-theme-bg2 border rounded-xl shadow-2xl flex flex-col"
        style="border-color: var(--bd); width: 90vw; max-width: 1200px; height: 85vh; max-height: 800px;">

        <!-- Header -->
        <div class="flex items-center justify-between px-4 py-2 flex-shrink-0" style="border-bottom: 1px solid var(--bd)">
          <h2 class="text-sm font-bold" style="color: var(--tx)">⊞ 三轴切片预览</h2>
          <div class="flex items-center gap-2 text-xs" style="color: var(--t2)">
            <label class="flex items-center gap-1">
              格子:
              <select v-model.number="cellSize" class="v-theme-bg3 rounded px-1 py-0.5 text-xs" style="border: 1px solid var(--bd)">
                <option :value="3">3px</option>
                <option :value="4">4px</option>
                <option :value="6">6px</option>
                <option :value="8">8px</option>
                <option :value="10">10px</option>
                <option :value="14">14px</option>
                <option :value="20">20px</option>
              </select>
            </label>
            <label class="flex items-center gap-1">
              间距:
              <select v-model.number="gapCells" class="v-theme-bg3 rounded px-1 py-0.5 text-xs" style="border: 1px solid var(--bd)">
                <option :value="1">1格</option>
                <option :value="2">2格</option>
                <option :value="3">3格</option>
                <option :value="4">4格</option>
              </select>
            </label>
            <button @click="showGrid = !showGrid" :class="[
              'px-1.5 py-0.5 rounded text-xs',
              showGrid ? 'bg-blue-600 text-white' : 'v-theme-text2',
            ]" style="border: 1px solid var(--bd)">
              {{ showGrid ? '▦' : '□' }} 网格
            </button>
            <span class="font-mono text-xs" style="color: var(--t3)">
              {{ (zoom * 100).toFixed(0) }}%
            </span>
          </div>
        </div>

        <!-- Canvas area -->
        <div class="flex-1 relative overflow-hidden" @wheel="handleWheel" @mousedown="handleMouseDown"
          style="cursor: grab; background: #ffffff">
          <canvas ref="canvasRef" class="absolute" style="image-rendering: pixelated" />

          <!-- Empty state -->
          <div v-if="slices && slices.x.length === 0 && slices.y.length === 0 && slices.z.length === 0"
            class="absolute inset-0 flex items-center justify-center" style="color: #999">
            <div class="text-center">
              <div class="text-4xl mb-2">⊘</div>
              <div class="text-sm">没有找到含垂直体素的切片</div>
              <div class="text-xs mt-1" style="color: #bbb">
                体素的 direction 需要与切面垂直（X轴切片需 direction='x'）
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-between px-4 py-1.5 flex-shrink-0 text-xs" style="border-top: 1px solid var(--bd); color: var(--t3)">
          <span>滚轮缩放 · 左键/中键拖拽平移</span>
          <span v-if="slices">
            X: {{ slices.x.length }}层 · Y: {{ slices.y.length }}层 · Z: {{ slices.z.length }}层
          </span>
          <div class="flex items-center gap-2">
            <button @click="handleExport"
              class="px-3 py-1 rounded text-xs font-medium transition-colors bg-blue-600 hover:bg-blue-700 text-white">
              导出为二维图纸
            </button>
            <button @click="emit('close')"
              class="px-3 py-1 rounded text-xs transition-colors v-theme-bg3 hover:brightness-110"
              style="border: 1px solid var(--bd); color: var(--t2)">
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
