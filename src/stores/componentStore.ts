import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useVoxelStore, type VoxelDirection } from './voxelStore'
import type { MappedPixel } from '@/types'
import { TRANSPARENT_KEY } from '@/types'

/**
 * 组件 = 从 2D 编辑器某个切面抓取保存的二维图纸。
 * cells 存图纸平面内的二维局部坐标（x/y），与保存轴（axis）无关。
 * 放置时用 remapComponentCellsToAxis 把二维图纸映射到目标平面
 * （目标平面 = 2D 编辑器当前所选轴，即切面法线 / 平面垂直方向）。
 */
export interface ComponentCell {
  x: number
  y: number
  color: string
  alpha?: number
}

export interface VoxelComponent {
  id: string
  name: string
  /** 保存时 2D 编辑器所选切面轴（图纸平面的法线方向），用于缩略图与方向信息 */
  axis: VoxelDirection
  w: number
  h: number
  cells: ComponentCell[]
  createdAt: number
}

/** 拆分预览中的单个分组（未持久化） */
export interface SplitPreviewItem {
  id: string
  name: string
  w: number
  h: number
  cells: ComponentCell[]
  /** 标识色（画布标注用） */
  color: string
  /** 原始像素坐标 key 列表（"row,col"），供画布标注与回查 */
  pixelKeys: string[]
}

/** 拆分标注预置高对比色（按分组索引循环） */
const SPLIT_COLORS = ['#ff3070', '#2090e0', '#30b060', '#f0a020', '#8040f0', '#c030d0', '#e03030', '#20c0a0']

/** 轴索引：x=0, y=1, z=2 */
function axisIndex(axis: VoxelDirection): number {
  return axis === 'x' ? 0 : axis === 'y' ? 1 : 2
}

/**
 * 把二维图纸 cells 映射到目标平面（toAxis 为法线），返回世界坐标三维偏移。
 * 两个自由轴按升序索引承载 x/y，目标固定轴偏移归 0。
 * 例：图纸 (x,y) → Z 平面时 dx=x、dy=y、dz=0；→ Y 平面时 dx=x、dy=0、dz=y。
 */
export function remapComponentCellsToAxis(
  cells: ComponentCell[],
  toAxis: VoxelDirection,
): Array<{ dx: number; dy: number; dz: number; color: string; alpha?: number }> {
  const toIdx = axisIndex(toAxis)
  const toFree = [0, 1, 2].filter((i) => i !== toIdx)
  return cells.map((c) => {
    const out = [0, 0, 0]
    out[toFree[0]] = c.x
    out[toFree[1]] = c.y
    return { dx: out[0], dy: out[1], dz: out[2], color: c.color, alpha: c.alpha }
  })
}

const STORAGE_KEY = 'voxoB_components'

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/**
 * 归一化二维 cells：过滤非法坐标、计算包围盒并平移到 (0,0) 起始。
 * 返回归一化后的 cells 与 w/h；无有效格子时返回 null。
 */
function normalizeCells(
  raw: Array<{ x: number; y: number; color: string; alpha?: number }>,
): { cells: ComponentCell[]; w: number; h: number } | null {
  const valid = raw.filter((c) => Number.isFinite(c.x) && Number.isFinite(c.y))
  if (valid.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const c of valid) {
    const x = Math.floor(c.x)
    const y = Math.floor(c.y)
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  const cells: ComponentCell[] = valid.map((c) => ({
    x: Math.floor(c.x) - minX,
    y: Math.floor(c.y) - minY,
    color: c.color,
    alpha: c.alpha,
  }))

  return { cells, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/**
 * 二维 4-邻接连通分量拆分：上下左右相邻的格子归为一组，不连通则拆开。
 */
function splitConnected(
  pts: Array<{ x: number; y: number; color: string; alpha?: number }>,
): Array<Array<{ x: number; y: number; color: string; alpha?: number }>> {
  const unvisited = new Set(pts.map((p) => `${p.x},${p.y}`))
  const map = new Map<string, { x: number; y: number; color: string; alpha?: number }>()
  pts.forEach((p) => map.set(`${p.x},${p.y}`, p))

  const clusters: Array<Array<{ x: number; y: number; color: string; alpha?: number }>> = []

  while (unvisited.size > 0) {
    const startKey = unvisited.values().next().value as string
    unvisited.delete(startKey)
    const queue = [startKey]
    const cluster: Array<{ x: number; y: number; color: string; alpha?: number }> = []
    while (queue.length > 0) {
      const key = queue.shift()!
      const cell = map.get(key)!
      cluster.push(cell)
      const [cx, cy] = key.split(',').map(Number)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nk = `${cx + dx},${cy + dy}`
        if (unvisited.has(nk)) {
          unvisited.delete(nk)
          queue.push(nk)
        }
      }
    }
    clusters.push(cluster)
  }

  return clusters
}

/**
 * 从 2D 像素网格（MappedPixel[][]，row=行/col=列）拆分连通组件。
 * 跳过透明格（TRANSPARENT_KEY / isExternal），4-邻接连通分组，
 * 每组生成默认名「组件 N」与标识色，pixelKeys 保留原始 "row,col" 供画布标注。
 */
export function splitPixelGridToComponents(
  pixels: MappedPixel[][],
  baseName = '组件',
): SplitPreviewItem[] {
  const pts: Array<{ x: number; y: number; color: string; alpha?: number }> = []
  const keyOf = new Map<string, string>() // "x,y" → "row,col"
  pixels.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (!cell || cell.key === TRANSPARENT_KEY || cell.isExternal) return
      pts.push({ x: c, y: r, color: cell.color })
      keyOf.set(`${c},${r}`, `${r},${c}`)
    })
  })

  const clusters = splitConnected(pts)
  const items: SplitPreviewItem[] = []

  clusters.forEach((cluster, i) => {
    const normalized = normalizeCells(cluster)
    if (!normalized) return
    items.push({
      id: uid(),
      name: `${baseName} ${i + 1}`,
      w: normalized.w,
      h: normalized.h,
      cells: normalized.cells,
      color: SPLIT_COLORS[i % SPLIT_COLORS.length],
      pixelKeys: cluster.map((p) => keyOf.get(`${p.x},${p.y}`) ?? `${p.y},${p.x}`),
    })
  })

  return items
}

export const useComponentStore = defineStore('component', () => {
  const voxelStore = useVoxelStore()

  // ===== STATE =====
  const components = ref<VoxelComponent[]>([])
  const activeComponentId = ref<string | null>(null)
  /** 拆分预览分组（未持久化，确认导入后清空） */
  const splitPreview = ref<SplitPreviewItem[] | null>(null)
  /** 画布标注当前选中的拆分分组 id */
  const selectedSplitId = ref<string | null>(null)

  // ===== COMPUTED =====
  const activeComponent = computed(
    () => components.value.find((c) => c.id === activeComponentId.value) ?? null,
  )

  // ===== PERSISTENCE =====
  function persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(components.value))
    } catch (e) {
      console.error('Component persist failed:', e)
    }
  }

  function loadComponents(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      const data = raw ? JSON.parse(raw) : []
      // 迁移旧格式（v1: cells 含 dx/dy/dz 三维偏移）→ 新格式（v2: cells 含 x/y 二维坐标）
      components.value = (Array.isArray(data) ? data : []).map((c: any) => {
        const cells = (c.cells ?? []).map((cell: any) =>
          typeof cell.x === 'number'
            ? cell
            : { x: cell.dx ?? 0, y: cell.dy ?? 0, color: cell.color, alpha: cell.alpha },
        )
        return { ...c, cells }
      })
    } catch {
      components.value = []
    }
  }

  // ===== ACTIONS =====

  /**
   * 抓取当前 2D 编辑器切面（currentAxis/currentZ）上、方向垂直切面的体素，
   * 按二维 4-邻接连通性拆分为一个或多个组件（不连通则拆开），返回数组。
   */
  function saveComponentFromSlice(name: string): VoxelComponent[] {
    const axis = voxelStore.currentAxis
    const sliceVal = voxelStore.currentZ
    const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
    const freeIdx = [0, 1, 2].filter((i) => i !== axisIdx)

    // Collect voxels on the current slice plane whose direction is perpendicular to it
    const pts: { x: number; y: number; color: string; alpha?: number }[] = []
    voxelStore.voxels.forEach((data, key) => {
      const [x, y, z] = voxelStore.pv(key)
      const coord = [x, y, z][axisIdx]
      // 只保留方向垂直切面的体素（voxel.direction === 切面轴）
      if (coord === sliceVal && (data.direction ?? 'y') === axis) {
        pts.push({
          x: [x, y, z][freeIdx[0]],
          y: [x, y, z][freeIdx[1]],
          color: data.color,
          alpha: data.alpha ?? 255,
        })
      }
    })

    if (pts.length === 0) return []

    const baseName = name.trim() || '组件'
    const clusters = splitConnected(pts)
    const created: VoxelComponent[] = []

    clusters.forEach((cluster, i) => {
      const normalized = normalizeCells(cluster)
      if (!normalized) return
      const comp: VoxelComponent = {
        id: uid(),
        name: clusters.length > 1 ? `${baseName} ${i + 1}` : baseName,
        axis,
        w: normalized.w,
        h: normalized.h,
        cells: normalized.cells,
        createdAt: Date.now(),
      }
      components.value.push(comp)
      created.push(comp)
    })

    if (created.length > 0) persist()
    return created
  }

  /**
   * 从外部数据导入组件（文件 / API / 预置库）。
   * cells 为图纸平面内二维坐标（可为任意整数范围，自动平移到 0 起始），
   * 自动生成 id、计算 w/h 并持久化。
   * axis 仅用于工具栏徽标显示（图纸来源方向），与放置方向无关，可省略（默认 'z'）。
   */
  function addComponent(input: {
    name: string
    axis?: VoxelDirection
    cells: Array<{ x: number; y: number; color: string; alpha?: number }>
  }): VoxelComponent | null {
    const name = input.name?.trim()
    if (!name || !Array.isArray(input.cells)) return null

    const normalized = normalizeCells(input.cells)
    if (!normalized) return null

    const comp: VoxelComponent = {
      id: uid(),
      name,
      axis: input.axis ?? 'z',
      w: normalized.w,
      h: normalized.h,
      cells: normalized.cells,
      createdAt: Date.now(),
    }
    components.value.push(comp)
    persist()
    return comp
  }

  function deleteComponent(id: string): void {
    components.value = components.value.filter((c) => c.id !== id)
    if (activeComponentId.value === id) activeComponentId.value = null
    persist()
  }

  /** 整体替换组件库（pbds 导入恢复），并持久化 */
  function importComponents(list: VoxelComponent[]): void {
    components.value = Array.isArray(list) ? list : []
    activeComponentId.value = null
    persist()
  }

  function setActive(id: string | null): void {
    activeComponentId.value = id
  }

  function clearActive(): void {
    activeComponentId.value = null
  }

  // ===== SPLIT PREVIEW（编辑模式 2D 图纸拆分导入） =====

  /** 从像素网格生成拆分预览（不写入 components、不持久化） */
  function previewSplitGrid(pixels: MappedPixel[][], baseName = '组件'): SplitPreviewItem[] {
    splitPreview.value = splitPixelGridToComponents(pixels, baseName)
    selectedSplitId.value = splitPreview.value[0]?.id ?? null
    return splitPreview.value
  }

  /** 确认导入：把预览分组逐个加入组件库并持久化，随后清空预览 */
  function confirmImportSplit(): VoxelComponent[] {
    const items = splitPreview.value ?? []
    const created: VoxelComponent[] = []
    for (const item of items) {
      const comp = addComponent({ name: item.name, cells: item.cells })
      if (comp) created.push(comp)
    }
    splitPreview.value = null
    selectedSplitId.value = null
    return created
  }

  /** 取消拆分导入，清空预览 */
  function cancelSplitImport(): void {
    splitPreview.value = null
    selectedSplitId.value = null
  }

  /** 移除某个预览分组（微调：去掉误分的连通块） */
  function removeSplitItem(id: string): void {
    if (!splitPreview.value) return
    splitPreview.value = splitPreview.value.filter((s) => s.id !== id)
    if (selectedSplitId.value === id) {
      selectedSplitId.value = splitPreview.value[0]?.id ?? null
    }
  }

  /** 重命名某个预览分组（默认名可修改） */
  function renameSplitItem(id: string, name: string): void {
    if (!splitPreview.value) return
    const item = splitPreview.value.find((s) => s.id === id)
    if (item) item.name = name.trim() || item.name
  }

  function setSelectedSplitId(id: string | null): void {
    selectedSplitId.value = id
  }

  // ===== INIT =====
  loadComponents()

  return {
    // State
    components,
    activeComponentId,
    splitPreview,
    selectedSplitId,
    // Computed
    activeComponent,
    // Actions
    saveComponentFromSlice,
    addComponent,
    deleteComponent,
    importComponents,
    setActive,
    clearActive,
    previewSplitGrid,
    confirmImportSplit,
    cancelSplitImport,
    removeSplitItem,
    renameSplitItem,
    setSelectedSplitId,
  }
})
