import type { MappedPixel, GridPoint } from '@/types'

/**
 * 洪水填充获取连通区域
 * 使用栈实现非递归洪水填充
 */
export function getConnectedRegion(mappedPixelData: MappedPixel[][], startRow: number, startCol: number, targetColor: string): GridPoint[] {
  if (!mappedPixelData || !mappedPixelData[startRow] || !mappedPixelData[startRow][startCol]) {
    return []
  }

  const M = mappedPixelData.length
  const N = mappedPixelData[0].length
  const visited = Array(M).fill(null).map(() => Array(N).fill(false))
  const region: GridPoint[] = []

  const stack: GridPoint[] = [{ row: startRow, col: startCol }]

  while (stack.length > 0) {
    const { row, col } = stack.pop()!

    if (row < 0 || row >= M || col < 0 || col >= N || visited[row][col]) {
      continue
    }

    const currentCell = mappedPixelData[row][col]

    if (!currentCell || currentCell.isExternal || currentCell.color !== targetColor) {
      continue
    }

    visited[row][col] = true
    region.push({ row, col })

    stack.push(
      { row: row - 1, col },
      { row: row + 1, col },
      { row, col: col - 1 },
      { row, col: col + 1 }
    )
  }

  return region
}

/**
 * 获取所有同颜色的连通区域
 */
export function getAllConnectedRegions(mappedPixelData: MappedPixel[][], targetColor: string): GridPoint[][] {
  if (!mappedPixelData || mappedPixelData.length === 0) {
    return []
  }

  const M = mappedPixelData.length
  const N = mappedPixelData[0].length
  const visited = Array(M).fill(null).map(() => Array(N).fill(false))
  const regions: GridPoint[][] = []

  for (let row = 0; row < M; row++) {
    for (let col = 0; col < N; col++) {
      if (!visited[row][col]) {
        const currentCell = mappedPixelData[row][col]

        if (currentCell && !currentCell.isExternal && currentCell.color === targetColor) {
          const region = getConnectedRegion(mappedPixelData, row, col, targetColor)

          if (region.length > 0) {
            regions.push(region)
            region.forEach(({ row: r, col: c }) => {
              visited[r][c] = true
            })
          }
        }
      }
    }
  }

  return regions
}

/**
 * 检查区域是否完全已完成
 */
export function isRegionCompleted(region: GridPoint[], completedCells: Set<string>): boolean {
  return region.every(({ row, col }) => completedCells.has(`${row},${col}`))
}

/**
 * 获取区域的中心点（用于定位和显示）
 */
export function getRegionCenter(region: GridPoint[]): GridPoint {
  if (region.length === 0) {
    return { row: 0, col: 0 }
  }

  const totalRow = region.reduce((sum, cell) => sum + cell.row, 0)
  const totalCol = region.reduce((sum, cell) => sum + cell.col, 0)

  return {
    row: Math.floor(totalRow / region.length),
    col: Math.floor(totalCol / region.length),
  }
}

/**
 * 根据距离排序区域（用于最近优先的引导模式）
 */
export function sortRegionsByDistance(regions: GridPoint[][], referencePoint: GridPoint): GridPoint[][] {
  return [...regions].sort((a, b) => {
    const centerA = getRegionCenter(a)
    const centerB = getRegionCenter(b)

    const distanceA = Math.abs(centerA.row - referencePoint.row) + Math.abs(centerA.col - referencePoint.col)
    const distanceB = Math.abs(centerB.row - referencePoint.row) + Math.abs(centerB.col - referencePoint.col)

    return distanceA - distanceB
  })
}

/**
 * 根据大小排序区域（用于最大优先的引导模式）
 */
export function sortRegionsBySize(regions: GridPoint[][]): GridPoint[][] {
  return [...regions].sort((a, b) => b.length - a.length)
}
