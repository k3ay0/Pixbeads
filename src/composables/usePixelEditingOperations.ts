/**
 * 像素编辑操作 composable
 * Ported from perler-beads React project
 * 使用 Vue 3 Composition API 重写
 */
import type { Ref } from 'vue'
import type { MappedPixel, GridDimensions, ColorCounts } from '@/types'
import {
  floodFillErase,
  replaceColor,
  paintSinglePixel,
  recalculateColorStats,
  TRANSPARENT_KEY,
} from '../utils/pixelEditingUtils.js'

interface PixelEditingOperationsParams {
  mappedPixelData: Ref<(MappedPixel | null)[][] | null>
  gridDimensions: Ref<GridDimensions | null>
  colorCounts: Ref<ColorCounts | null>
  totalBeadCount: Ref<number>
  onPixelDataChange: (newPixelData: (MappedPixel | null)[][]) => void
  onColorCountsChange: (newColorCounts: ColorCounts) => void
  onTotalCountChange: (newTotalCount: number) => void
}

interface PixelEditingOperationsReturn {
  performFloodFillErase: (startRow: number, startCol: number, targetKey: string) => void
  performColorReplace: (sourceColor: { key: string; color: string }, targetColor: { key: string; color: string }) => number
  performSinglePixelPaint: (row: number, col: number, newColor: MappedPixel) => void
}

/**
 * 像素编辑操作 composable
 * @param params 配置参数
 */
export function usePixelEditingOperations({
  mappedPixelData,
  gridDimensions,
  colorCounts,
  totalBeadCount,
  onPixelDataChange,
  onColorCountsChange,
  onTotalCountChange,
}: PixelEditingOperationsParams): PixelEditingOperationsReturn {
  /**
   * 执行洪水填充擦除
   * @param startRow 起始行
   * @param startCol 起始列
   * @param targetKey 目标颜色键
   */
  function performFloodFillErase(startRow: number, startCol: number, targetKey: string): void {
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
   * @param sourceColor 源颜色
   * @param targetColor 目标颜色
   * @returns 替换数量
   */
  function performColorReplace(
    sourceColor: { key: string; color: string },
    targetColor: { key: string; color: string }
  ): number {
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
   * @param row 行
   * @param col 列
   * @param newColor 新颜色数据（MappedPixel 格式）
   */
  function performSinglePixelPaint(row: number, col: number, newColor: MappedPixel): void {
    const data = mappedPixelData.value
    const counts = colorCounts.value
    if (!data || !counts) return

    const { newPixelData, previousCell, hasChange } = paintSinglePixel(data, row, col, newColor)

    if (!hasChange || !previousCell) return

    onPixelDataChange(newPixelData)

    // 更新颜色统计（增量更新，避免全量重算）
    const newColorCounts: ColorCounts = { ...counts }
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
