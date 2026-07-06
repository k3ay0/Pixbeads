/**
 * 画布坐标计算工具函数
 * Ported from perler-beads React project
 */

import type { GridDimensions } from '@/types'
import { CELL_SIZE, AXIS_WIDTH, AXIS_HEIGHT, AXIS_MIN_PIXEL_GAP } from '@/constants/canvasConstants'

/**
 * 将鼠标/触摸坐标转换为画布内的格子坐标
 */
export function clientToGridCoords(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  gridDimensions: GridDimensions
): { i: number; j: number } | null {
  const rect = canvas.getBoundingClientRect()
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height
  const canvasX = (clientX - rect.left) * scaleX
  const canvasY = (clientY - rect.top) * scaleY

  const { N, M } = gridDimensions
  const cellWidthOutput = canvas.width / N
  const cellHeightOutput = canvas.height / M

  const i = Math.floor(canvasX / cellWidthOutput)
  const j = Math.floor(canvasY / cellHeightOutput)

  // 检查是否在有效范围内
  if (i >= 0 && i < N && j >= 0 && j < M) {
    return { i, j }
  }

  return null
}

/**
 * 计算画布居中偏移量
 */
export function calculateCenterOffset(
  containerWidth: number,
  containerHeight: number,
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number } {
  const containerW = containerWidth - AXIS_WIDTH
  const containerH = containerHeight - AXIS_HEIGHT

  return {
    x: Math.max(0, (containerW - canvasWidth) / 2),
    y: Math.max(0, (containerH - canvasHeight) / 2)
  }
}

/**
 * 根据缩放比例计算坐标轴自动间隔（只返回 5/10/20）
 */
export function calculateInterval(zoom: number): number {
  const cellPixelSize = CELL_SIZE * zoom
  const minInterval = Math.ceil(AXIS_MIN_PIXEL_GAP / cellPixelSize)

  if (minInterval <= 5) return 5
  if (minInterval <= 10) return 10
  return 20
}

/**
 * 计算可见的列号（从 1 开始）
 */
export function calculateVisibleColumns(
  gridWidth: number,
  containerWidth: number,
  canvasTranslateX: number,
  canvasZoom: number
): number[] {
  const interval = calculateInterval(canvasZoom)
  const cellPixelSize = CELL_SIZE * canvasZoom

  const containerW = containerWidth - AXIS_WIDTH
  const startCol = Math.max(1, Math.floor(-canvasTranslateX / cellPixelSize) + 1)
  const endCol = Math.min(gridWidth, Math.ceil((-canvasTranslateX + containerW) / cellPixelSize))

  const result: number[] = []
  const firstVisible = Math.ceil(startCol / interval) * interval
  for (let i = firstVisible; i <= endCol; i += interval) {
    result.push(i)
  }

  // 始终包含 1
  if (result.length === 0 || result[0] !== 1) {
    result.unshift(1)
  }
  return result
}

/**
 * 计算可见的行号（从 1 开始）
 */
export function calculateVisibleRows(
  gridHeight: number,
  containerHeight: number,
  canvasTranslateY: number,
  canvasZoom: number
): number[] {
  const interval = calculateInterval(canvasZoom)
  const cellPixelSize = CELL_SIZE * canvasZoom

  const containerH = containerHeight - AXIS_HEIGHT
  const startRow = Math.max(1, Math.floor(-canvasTranslateY / cellPixelSize) + 1)
  const endRow = Math.min(gridHeight, Math.ceil((-canvasTranslateY + containerH) / cellPixelSize))

  const result: number[] = []
  const firstVisible = Math.ceil(startRow / interval) * interval
  for (let i = firstVisible; i <= endRow; i += interval) {
    result.push(i)
  }

  // 始终包含 1
  if (result.length === 0 || result[0] !== 1) {
    result.unshift(1)
  }
  return result
}
