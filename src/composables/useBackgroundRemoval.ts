import { useBeadStore } from '@/stores/beadStore'
import { useEditorStore } from '@/stores/editorStore'
import { recalculateColorStats } from '@/utils/pixelation'
import { TRANSPARENT_KEY, type MappedPixel } from '@/types'
import { deepCopyGrid, floodFillArea } from '@/utils/gridOperations'

export function useBackgroundRemoval() {
  const beadStore = useBeadStore()
  const editorStore = useEditorStore()

  function handleAutoRemoveBackground() {
    if (!beadStore.mappedPixelData || !beadStore.gridDimensions) return

    editorStore.setBgRemovalSnapshot({
      mappedPixelData: deepCopyGrid(beadStore.mappedPixelData),
      colorCounts: beadStore.colorCounts ? { ...beadStore.colorCounts } : {},
      totalBeadCount: beadStore.totalBeadCount,
    })
    editorStore.clearHistory()

    const { N, M } = beadStore.gridDimensions
    const borderCounts = new Map()

    const countBorderCell = (row: number, col: number) => {
      const cell = beadStore.mappedPixelData?.[row]?.[col]
      if (!cell || cell.isExternal || cell.key === TRANSPARENT_KEY) return
      const key = cell.key
      borderCounts.set(key, (borderCounts.get(key) || 0) + 1)
    }

    for (let col = 0; col < N; col++) {
      countBorderCell(0, col)
      if (M > 1) countBorderCell(M - 1, col)
    }
    for (let row = 1; row < M - 1; row++) {
      countBorderCell(row, 0)
      if (N > 1) countBorderCell(row, N - 1)
    }

    if (borderCounts.size === 0) return

    let targetKey = ''
    let maxCount = -1
    borderCounts.forEach((count, key) => {
      if (count > maxCount) {
        maxCount = count
        targetKey = key
      }
    })

    // 从所有匹配的边界格子开始洪水填充
    const condition = (cell: MappedPixel) => !cell.isExternal && cell.key === targetKey
    const transform = (): MappedPixel => ({ key: TRANSPARENT_KEY, color: '#FFFFFF', isExternal: true })

    let newPixelData: MappedPixel[][] = beadStore.mappedPixelData
    let hasMatch = false

    for (let col = 0; col < N; col++) {
      const topCell = newPixelData[0]?.[col]
      if (topCell && condition(topCell)) {
        newPixelData = floodFillArea(newPixelData, { N, M }, 0, col, condition, transform)
        hasMatch = true
      }
      if (M > 1) {
        const bottomCell = newPixelData[M - 1]?.[col]
        if (bottomCell && condition(bottomCell)) {
          newPixelData = floodFillArea(newPixelData, { N, M }, M - 1, col, condition, transform)
          hasMatch = true
        }
      }
    }
    for (let row = 1; row < M - 1; row++) {
      const leftCell = newPixelData[row]?.[0]
      if (leftCell && condition(leftCell)) {
        newPixelData = floodFillArea(newPixelData, { N, M }, row, 0, condition, transform)
        hasMatch = true
      }
      if (N > 1) {
        const rightCell = newPixelData[row]?.[N - 1]
        if (rightCell && condition(rightCell)) {
          newPixelData = floodFillArea(newPixelData, { N, M }, row, N - 1, condition, transform)
          hasMatch = true
        }
      }
    }

    if (!hasMatch) return

    beadStore.setPixelData(newPixelData)
    const stats = recalculateColorStats(newPixelData)
    beadStore.updateColorStats(stats)
  }

  function handleUndoBgRemoval() {
    const snapshot = editorStore.bgRemovalSnapshot
    if (!snapshot) return

    beadStore.setPixelData(snapshot.mappedPixelData)
    beadStore.updateColorStats({
      colorCounts: snapshot.colorCounts,
      totalCount: snapshot.totalBeadCount
    })
    editorStore.clearBgRemovalSnapshot()
  }

  return {
    handleAutoRemoveBackground,
    handleUndoBgRemoval,
  }
}
