/**
 * 绘制算法工具函数
 * 包含画线、矩形、颜色应用等核心绘制逻辑
 */

import type { MappedPixel, SelectionInfo } from '@/types'
import { TRANSPARENT_KEY } from '@/types'

/** Bresenham 画线算法：返回两点间所有格子坐标 */
export function getLinePoints(r0: number, c0: number, r1: number, c1: number): { row: number; col: number }[] {
  const points: { row: number; col: number }[] = []
  let dx = Math.abs(c1 - c0), dy = Math.abs(r1 - r0)
  let sx = c0 < c1 ? 1 : -1, sy = r0 < r1 ? 1 : -1
  let err = dx - dy
  let cr = r0, cc = c0
  while (true) {
    points.push({ row: cr, col: cc })
    if (cr === r1 && cc === c1) break
    const e2 = 2 * err
    if (e2 > -dy) { err -= dy; cc += sx }
    if (e2 < dx) { err += dx; cr += sy }
  }
  return points
}

/** 获取矩形内所有格子坐标 */
export function getRectPoints(r0: number, c0: number, r1: number, c1: number): { row: number; col: number }[] {
  const points: { row: number; col: number }[] = []
  const minR = Math.min(r0, r1), maxR = Math.max(r0, r1)
  const minC = Math.min(c0, c1), maxC = Math.max(c0, c1)
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      points.push({ row: r, col: c })
    }
  }
  return points
}

/** 批量应用颜色到格子列表 */
export function applyColorToPoints(
  mappedPixelData: MappedPixel[][],
  gridDimensions: { N: number; M: number },
  points: { row: number; col: number }[],
  color: { key: string; color: string } | null,
  isErasing: boolean
): void {
  const { N, M } = gridDimensions
  for (const { row, col } of points) {
    if (row < 0 || row >= M || col < 0 || col >= N) continue
    const cell = mappedPixelData[row]?.[col]
    if (!cell) continue
    if (isErasing) {
      if (!cell.isExternal) mappedPixelData[row][col] = { key: TRANSPARENT_KEY, color: '#FFFFFF', isExternal: true }
    } else {
      // 允许在透明格子上绘制（line/rect工具可以覆盖透明区域）
      mappedPixelData[row][col] = { key: color!.key, color: color!.color, isExternal: false }
    }
  }
}

/** 判断点是否在选区内 */
export function isPointInSelection(row: number, col: number, selectionInfo: SelectionInfo | null): boolean {
  if (!selectionInfo) return false
  return row >= selectionInfo.startRow && row <= selectionInfo.endRow && col >= selectionInfo.startCol && col <= selectionInfo.endCol
}
