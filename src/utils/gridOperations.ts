import type { MappedPixel, GridDimensions } from '@/types'

/**
 * 通用网格深拷贝 — 使用展开运算符逐格复制
 * 适用于 MappedPixel[][] 等对象网格
 */
export function deepCopyGrid<T>(grid: T[][]): T[][] {
  return grid.map(row => row.map(cell => ({ ...cell })))
}

/**
 * 通用洪水填充（栈实现，非递归）
 *
 * 从 startRow/startCol 出发，向四方向扩展，对满足 condition 的格子执行 transform。
 * 返回新网格，不修改原数据。
 *
 * @param mappedData  - 原始网格数据
 * @param gridDimensions - 网格尺寸 { N（列数）, M（行数） }
 * @param startRow    - 起始行
 * @param startCol    - 起始列
 * @param condition   - 判断是否处理该格子（true = 需要填充）
 * @param transform   - 对满足条件的格子执行的转换
 * @returns           - 填充后的新网格
 */
export function floodFillArea(
  mappedData: MappedPixel[][],
  gridDimensions: GridDimensions,
  startRow: number,
  startCol: number,
  condition: (cell: MappedPixel) => boolean,
  transform: (cell: MappedPixel) => MappedPixel
): MappedPixel[][] {
  const { N, M } = gridDimensions
  const result = deepCopyGrid(mappedData)
  const visited: boolean[][] = Array(M).fill(null).map(() => Array(N).fill(false))
  const stack: { row: number; col: number }[] = [{ row: startRow, col: startCol }]

  while (stack.length > 0) {
    const { row, col } = stack.pop()!
    if (row < 0 || row >= M || col < 0 || col >= N || visited[row][col]) continue
    const cell = result[row][col]
    if (!condition(cell)) continue
    visited[row][col] = true
    result[row][col] = transform(cell)
    stack.push(
      { row: row - 1, col }, { row: row + 1, col },
      { row, col: col - 1 }, { row, col: col + 1 }
    )
  }
  return result
}
