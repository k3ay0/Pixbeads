/**
 * 画布坐标计算工具函数
 * Ported from perler-beads React project
 */

import type { GridDimensions, Point } from '@/types'

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
 * 检查触摸是否被认为是移动而不是点击
 */
export function isTouchMove(
  startPos: Point,
  currentPos: Point,
  threshold: number = 10
): boolean {
  const dx = Math.abs(currentPos.x - startPos.x)
  const dy = Math.abs(currentPos.y - startPos.y)
  return dx > threshold || dy > threshold
}
