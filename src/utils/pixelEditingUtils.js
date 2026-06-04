/**
 * 像素编辑操作工具函数（桥接层）
 * 为 usePixelEditingOperations composable 提供所需接口
 * 包装 pixelation.js 中的函数以适配 composable 的签名
 */
import {
  floodFillErase as _floodFillErase,
  replaceAllColor,
  paintPixel,
  recalculateColorStats,
  TRANSPARENT_KEY,
} from './pixelation.js'

export { TRANSPARENT_KEY }

/**
 * 重新计算颜色统计
 */
export { recalculateColorStats }

/**
 * 洪水填充擦除
 */
export function floodFillErase(mappedData, gridDimensions, startRow, startCol, targetKey) {
  return _floodFillErase(mappedData, gridDimensions, startRow, startCol, targetKey)
}

/**
 * 颜色替换（适配 composable 接口）
 * @param {Array} data 像素数据
 * @param {Object} dims 网格尺寸
 * @param {{ key: string; color: string }} sourceColor 源颜色
 * @param {{ key: string; color: string }} targetColor 目标颜色
 * @returns {{ newPixelData: Array, replaceCount: number }}
 */
export function replaceColor(data, dims, sourceColor, targetColor) {
  const sourceHex = sourceColor.color.toUpperCase()
  const targetHex = targetColor.color.toUpperCase()
  const { result, count } = replaceAllColor(data, sourceHex, targetColor.key, targetHex)
  return { newPixelData: result, replaceCount: count }
}

/**
 * 单像素上色（适配 composable 接口）
 * @param {Array} data 像素数据
 * @param {number} row 行
 * @param {number} col 列
 * @param {Object} newColor 新颜色
 * @returns {{ newPixelData: Array, previousCell: Object|null, hasChange: boolean }}
 */
export function paintSinglePixel(data, row, col, newColor) {
  const previousCell = data[row]?.[col] ? { ...data[row][col] } : null
  const { result, changed } = paintPixel(data, row, col, newColor)
  return { newPixelData: result, previousCell, hasChange: changed }
}
