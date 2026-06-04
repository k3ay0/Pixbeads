/**
 * 像素编辑操作工具函数（桥接层）
 * 为 usePixelEditingOperations composable 提供所需接口
 * 包装 pixelation.js 中的函数以适配 composable 的签名
 */
import type { MappedPixel, GridDimensions } from '@/types'
import { TRANSPARENT_KEY } from '@/types'
import {
  floodFillErase as _floodFillErase,
  replaceAllColor,
  paintPixel,
  recalculateColorStats,
} from './pixelation'

export { TRANSPARENT_KEY }

/**
 * 重新计算颜色统计
 */
export { recalculateColorStats }

/**
 * 洪水填充擦除
 */
export function floodFillErase(
  mappedData: MappedPixel[][],
  gridDimensions: GridDimensions,
  startRow: number,
  startCol: number,
  targetKey: string
): MappedPixel[][] {
  return _floodFillErase(mappedData, gridDimensions, startRow, startCol, targetKey)
}

/**
 * 颜色替换（适配 composable 接口）
 * @param data 像素数据
 * @param dims 网格尺寸
 * @param sourceColor 源颜色
 * @param targetColor 目标颜色
 * @returns { newPixelData: MappedPixel[][], replaceCount: number }
 */
export function replaceColor(
  data: MappedPixel[][],
  dims: GridDimensions,
  sourceColor: { key: string; color: string },
  targetColor: { key: string; color: string }
): { newPixelData: MappedPixel[][]; replaceCount: number } {
  const sourceHex = sourceColor.color.toUpperCase()
  const targetHex = targetColor.color.toUpperCase()
  const { result, count } = replaceAllColor(data, sourceHex, targetColor.key, targetHex)
  return { newPixelData: result, replaceCount: count }
}

/**
 * 单像素上色（适配 composable 接口）
 * @param data 像素数据
 * @param row 行
 * @param col 列
 * @param newColor 新颜色
 * @returns { newPixelData: MappedPixel[][], previousCell: MappedPixel | null, hasChange: boolean }
 */
export function paintSinglePixel(
  data: MappedPixel[][],
  row: number,
  col: number,
  newColor: MappedPixel
): { newPixelData: MappedPixel[][]; previousCell: MappedPixel | null; hasChange: boolean } {
  const previousCell = data[row]?.[col] ? { ...data[row][col] } : null
  const { result, changed } = paintPixel(data, row, col, newColor)
  return { newPixelData: result, previousCell, hasChange: changed }
}
