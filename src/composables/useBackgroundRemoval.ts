import { useBeadStore } from '@/stores/beadStore'
import { useEditorStore } from '@/stores/editorStore'
import { recalculateColorStats } from '@/utils/pixelation'
import { TRANSPARENT_KEY } from '@/types'

export function useBackgroundRemoval() {
  const beadStore = useBeadStore()
  const editorStore = useEditorStore()

  function handleAutoRemoveBackground() {
    if (!beadStore.mappedPixelData || !beadStore.gridDimensions) return

    editorStore.setBgRemovalSnapshot({
      mappedPixelData: beadStore.mappedPixelData.map(r => r.map(c => ({ ...c }))),
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

    const newPixelData = beadStore.mappedPixelData.map(r => r.map(c => ({ ...c })))
    const visited = Array(M).fill(null).map(() => Array(N).fill(false))
    const stack: Array<{ row: number; col: number }> = []

    const pushIfTarget = (row: number, col: number) => {
      if (row < 0 || row >= M || col < 0 || col >= N || visited[row][col]) return
      const cell = newPixelData[row][col]
      if (!cell || cell.isExternal || cell.key !== targetKey) return
      visited[row][col] = true
      stack.push({ row, col })
    }

    for (let col = 0; col < N; col++) {
      pushIfTarget(0, col)
      if (M > 1) pushIfTarget(M - 1, col)
    }
    for (let row = 1; row < M - 1; row++) {
      pushIfTarget(row, 0)
      if (N > 1) pushIfTarget(row, N - 1)
    }

    if (stack.length === 0) return

    while (stack.length > 0) {
      const { row, col } = stack.pop()!
      newPixelData[row][col] = { key: TRANSPARENT_KEY, color: '#FFFFFF', isExternal: true }
      pushIfTarget(row - 1, col)
      pushIfTarget(row + 1, col)
      pushIfTarget(row, col - 1)
      pushIfTarget(row, col + 1)
    }

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
