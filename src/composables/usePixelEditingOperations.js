/**
 * 像素编辑操作 composable
 * Ported from perler-beads React project
 * 使用 Vue 3 Composition API 重写
 */
import { computed } from 'vue'
import {
  floodFillErase,
  replaceColor,
  paintSinglePixel,
  recalculateColorStats,
  TRANSPARENT_KEY,
} from '../utils/pixelEditingUtils.js'

/**
 * 像素编辑操作 composable
 * @param {Object} params
 * @param {import('vue').Ref<Array<Array|null>>|null} params.mappedPixelData 像素数据的 ref
 * @param {import('vue').Ref<{ N: number; M: number }|null>} params.gridDimensions 网格尺寸的 ref
 * @param {import('vue').Ref<Object|null>} params.colorCounts 颜色统计的 ref
 * @param {import('vue').Ref<number>} params.totalBeadCount 总珠子数的 ref
 * @param {Function} params.onPixelDataChange 像素数据变更回调
 * @param {Function} params.onColorCountsChange 颜色统计变更回调
 * @param {Function} params.onTotalCountChange 总数变更回调
 */
export function usePixelEditingOperations({
  mappedPixelData,
  gridDimensions,
  colorCounts,
  totalBeadCount,
  onPixelDataChange,
  onColorCountsChange,
  onTotalCountChange,
}) {
  /**
   * 执行洪水填充擦除
   * @param {number} startRow 起始行
   * @param {number} startCol 起始列
   * @param {string} targetKey 目标颜色键
   */
  function performFloodFillErase(startRow, startCol, targetKey) {
    const data = mappedPixelData.value
    const dims = gridDimensions.value
    if (!data || !dims) return

    const newPixelData = floodFillErase(data, dims, startRow, startCol, targetKey)
    onPixelDataChange(newPixelData)

    // 重新计算颜色统计
    const { colorCounts: newColorCounts, totalCount: newTotalCount } =
      recalculateColorStats(newPixelData)
    onColorCountsChange(newColorCounts)
    onTotalCountChange(newTotalCount)
  }

  /**
   * 执行颜色替换
   * @param {{ key: string; color: string }} sourceColor 源颜色
   * @param {{ key: string; color: string }} targetColor 目标颜色
   * @returns {number} 替换数量
   */
  function performColorReplace(sourceColor, targetColor) {
    const data = mappedPixelData.value
    const dims = gridDimensions.value
    if (!data || !dims) return 0

    const { newPixelData, replaceCount } = replaceColor(data, dims, sourceColor, targetColor)

    if (replaceCount > 0) {
      onPixelDataChange(newPixelData)

      // 重新计算颜色统计
      const { colorCounts: newColorCounts, totalCount: newTotalCount } =
        recalculateColorStats(newPixelData)
      onColorCountsChange(newColorCounts)
      onTotalCountChange(newTotalCount)

      console.log(
        `颜色替换完成：将 ${replaceCount} 个 ${sourceColor.key} 替换为 ${targetColor.key}`
      )
    }

    return replaceCount
  }

  /**
   * 执行单像素上色
   * @param {number} row 行
   * @param {number} col 列
   * @param {Object} newColor 新颜色数据（MappedPixel 格式）
   */
  function performSinglePixelPaint(row, col, newColor) {
    const data = mappedPixelData.value
    const counts = colorCounts.value
    if (!data || !counts) return

    const { newPixelData, previousCell, hasChange } = paintSinglePixel(data, row, col, newColor)

    if (!hasChange || !previousCell) return

    onPixelDataChange(newPixelData)

    // 更新颜色统计（增量更新，避免全量重算）
    const newColorCounts = { ...counts }
    let newTotalCount = totalBeadCount.value

    // 处理之前颜色的减少（使用 hex 值）
    if (!previousCell.isExternal && previousCell.key !== TRANSPARENT_KEY) {
      const previousHex = previousCell.color?.toUpperCase()
      if (previousHex && newColorCounts[previousHex]) {
        newColorCounts[previousHex].count--
        if (newColorCounts[previousHex].count <= 0) {
          delete newColorCounts[previousHex]
        }
        newTotalCount--
      }
    }

    // 处理新颜色的增加（使用 hex 值）
    if (!newColor.isExternal && newColor.key !== TRANSPARENT_KEY) {
      const newHex = newColor.color.toUpperCase()
      if (!newColorCounts[newHex]) {
        newColorCounts[newHex] = {
          count: 0,
          color: newHex,
        }
      }
      newColorCounts[newHex].count++
      newTotalCount++
    }

    onColorCountsChange(newColorCounts)
    onTotalCountChange(newTotalCount)
  }

  return {
    performFloodFillErase,
    performColorReplace,
    performSinglePixelPaint,
  }
}
