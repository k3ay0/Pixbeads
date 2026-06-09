/**
 * 熨烫预览绘制算法
 * 移植自 perler-beads React 项目，模拟拼豆熨烫后的真实效果
 */

import type { MappedPixel, GridDimensions } from '@/types'
import { TRANSPARENT_KEY } from '@/types'

/** 材质类型 */
export type Material = 'matte' | 'glitter' | 'towel' | 'bath-towel'

/** 熨烫预览配置 */
export interface IroningPreviewConfig {
  material: Material
  edgeEnabled: boolean
  curvature: number
  shadowEnabled: boolean
  shadowAngle: number
  shadowDistance: number
  backgroundColor: string
  displayText: string
  textOpacity: number
}

/** 默认配置 */
export const DEFAULT_IRONING_CONFIG: IroningPreviewConfig = {
  material: 'matte',
  edgeEnabled: true,
  curvature: 30,
  shadowEnabled: true,
  shadowAngle: 135,
  shadowDistance: 8,
  backgroundColor: '#f0e6d3',
  displayText: '可更改此文字',
  textOpacity: 35,
}

/**
 * 检查指定位置是否有拼豆（非透明）
 */
function hasBead(
  grid: (MappedPixel | null)[][],
  row: number,
  col: number,
  rows: number,
  cols: number
): boolean {
  if (row < 0 || row >= rows || col < 0 || col >= cols) return false
  const cell = grid[row]?.[col]
  return !!cell && !cell.isExternal && cell.key !== TRANSPARENT_KEY
}

/**
 * 查找拼豆的边界框
 */
function findBoundingBox(
  grid: (MappedPixel | null)[][],
  cols: number,
  rows: number
): { minRow: number; maxRow: number; minCol: number; maxCol: number } | null {
  let minRow = rows, maxRow = -1, minCol = cols, maxCol = -1
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid[r]?.[c]
      if (cell && !cell.isExternal && cell.key !== TRANSPARENT_KEY) {
        minRow = Math.min(minRow, r)
        maxRow = Math.max(maxRow, r)
        minCol = Math.min(minCol, c)
        maxCol = Math.max(maxCol, c)
      }
    }
  }
  return maxRow < 0 ? null : { minRow, maxRow, minCol, maxCol }
}

/**
 * 绘制材质纹理效果（完全按照原代码实现）
 */
function drawMaterialTexture(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  material: Material
): void {
  ctx.save()
  ctx.globalCompositeOperation = 'overlay'

  switch (material) {
    case 'matte':
      ctx.fillStyle = 'rgba(255,255,255,0.04)'
      ctx.fillRect(x, y, w, h)
      break

    case 'glitter': {
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      const dotRadius = 0.07 * Math.min(w, h)
      // 使用原代码的伪随机算法（基于位置的 sin/cos）
      for (let i = 0; i < 3; i++) {
        const gx = x + w * (0.2 + 0.3 * Math.sin(7 * x + 2.1 * i))
        const gy = y + h * (0.2 + 0.3 * Math.cos(11 * y + 1.7 * i))
        ctx.beginPath()
        ctx.arc(gx, gy, dotRadius, 0, Math.PI * 2)
        ctx.fill()
      }
      break
    }

    case 'towel':
      ctx.strokeStyle = 'rgba(255,255,255,0.1)'
      ctx.lineWidth = 0.5
      // 水平线条
      for (let ly = y + 1; ly < y + h; ly += 2) {
        ctx.beginPath()
        ctx.moveTo(x, ly)
        ctx.lineTo(x + w, ly)
        ctx.stroke()
      }
      break

    case 'bath-towel':
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'
      ctx.lineWidth = 0.5
      // 对角线条（搓澡巾效果）
      for (let d = -w; d < w + h; d += 3) {
        ctx.beginPath()
        ctx.moveTo(x + Math.max(0, d), y + Math.max(0, -d))
        ctx.lineTo(x + Math.min(w, d + h), y + Math.min(h, h - d))
        ctx.stroke()
      }
      break
  }

  ctx.restore()
}

/**
 * 绘制边缘弧形效果（完全按照原代码实现）
 */
function drawRoundedEdges(
  ctx: CanvasRenderingContext2D,
  grid: (MappedPixel | null)[][],
  rows: number,
  cols: number,
  cellX: (col: number) => number,
  cellY: (row: number) => number,
  cellW: number,
  cellH: number,
  edgeRadius: number
): void {
  // 计算弧形突出幅度
  const u = Math.min(cellW, cellH) * edgeRadius * 0.35
  if (u < 1.5) return

  // 绘制弧形填充
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!hasBead(grid, r, c, rows, cols)) continue

      const x = cellX(c)
      const y = cellY(r)
      const w = cellW
      const h = cellH
      const color = grid[r][c]!.color

      // 检查四个方向是否有相邻拼豆
      const noTop = !hasBead(grid, r - 1, c, rows, cols)
      const noBottom = !hasBead(grid, r + 1, c, rows, cols)
      const noLeft = !hasBead(grid, r, c - 1, rows, cols)
      const noRight = !hasBead(grid, r, c + 1, rows, cols)

      if (!noTop && !noBottom && !noLeft && !noRight) continue

      ctx.fillStyle = color

      // 上边缘弧形
      if (noTop) {
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.quadraticCurveTo(x + w / 2, y - u, x + w, y)
        ctx.lineTo(x, y)
        ctx.fill()
      }

      // 下边缘弧形
      if (noBottom) {
        ctx.beginPath()
        ctx.moveTo(x, y + h)
        ctx.quadraticCurveTo(x + w / 2, y + h + u, x + w, y + h)
        ctx.lineTo(x, y + h)
        ctx.fill()
      }

      // 左边缘弧形
      if (noLeft) {
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.quadraticCurveTo(x - u, y + h / 2, x, y + h)
        ctx.lineTo(x, y)
        ctx.fill()
      }

      // 右边缘弧形
      if (noRight) {
        ctx.beginPath()
        ctx.moveTo(x + w, y)
        ctx.quadraticCurveTo(x + w + u, y + h / 2, x + w, y + h)
        ctx.lineTo(x + w, y)
        ctx.fill()
      }
    }
  }

  // 绘制边缘描边线条
  ctx.save()
  ctx.strokeStyle = 'rgba(0,0,0,0.06)'
  ctx.lineWidth = Math.max(0.5, 0.03 * cellW)

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!hasBead(grid, r, c, rows, cols)) continue

      const x = cellX(c)
      const y = cellY(r)
      const w = cellW
      const h = cellH

      // 上边缘线条
      if (!hasBead(grid, r - 1, c, rows, cols)) {
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.quadraticCurveTo(x + w / 2, y - u, x + w, y)
        ctx.stroke()
      }

      // 下边缘线条
      if (!hasBead(grid, r + 1, c, rows, cols)) {
        ctx.beginPath()
        ctx.moveTo(x, y + h)
        ctx.quadraticCurveTo(x + w / 2, y + h + u, x + w, y + h)
        ctx.stroke()
      }

      // 左边缘线条
      if (!hasBead(grid, r, c - 1, rows, cols)) {
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.quadraticCurveTo(x - u, y + h / 2, x, y + h)
        ctx.stroke()
      }

      // 右边缘线条
      if (!hasBead(grid, r, c + 1, rows, cols)) {
        ctx.beginPath()
        ctx.moveTo(x + w, y)
        ctx.quadraticCurveTo(x + w + u, y + h / 2, x + w, y + h)
        ctx.stroke()
      }
    }
  }

  ctx.restore()
}

/**
 * 绘制熨烫预览
 */
export function drawIroningPreview(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  mappedPixelData: MappedPixel[][],
  gridDimensions: GridDimensions,
  config: IroningPreviewConfig
): void {
  const { N, M } = gridDimensions
  const padding = Math.ceil(Math.max(N, M) / 2)
  const paddedCols = N + 2 * padding
  const paddedRows = M + 2 * padding
  const cellW = width / paddedCols
  const cellH = height / paddedRows

  // 填充背景
  ctx.fillStyle = config.backgroundColor
  ctx.fillRect(0, 0, width, height)

  // 创建带边距的网格
  const emptyCell: MappedPixel = { key: TRANSPARENT_KEY, color: '#FFFFFF', isExternal: true }
  const paddedGrid: (MappedPixel | null)[][] = Array.from({ length: paddedRows }, (_, r) =>
    Array.from({ length: paddedCols }, (_, c) => {
      const origR = r - padding
      const origC = c - padding
      if (origR >= 0 && origR < M && origC >= 0 && origC < N) {
        return mappedPixelData[origR]?.[origC] ?? emptyCell
      }
      return emptyCell
    })
  )

  // 查找边界框
  const bbox = findBoundingBox(paddedGrid, paddedCols, paddedRows)
  if (!bbox) return

  const { minRow, maxRow, minCol, maxCol } = bbox

  // 计算单元格像素坐标
  const cellX = (col: number) => Math.floor(col * cellW)
  const cellY = (row: number) => Math.floor(row * cellH)
  const cellWidth = (col: number) => Math.floor((col + 1) * cellW) - Math.floor(col * cellW)
  const cellHeight = (row: number) => Math.floor((row + 1) * cellH) - Math.floor(row * cellH)

  // 绘制阴影
  if (config.shadowEnabled) {
    const angleRad = (config.shadowAngle * Math.PI) / 180
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.2)'
    ctx.shadowBlur = 1.5 * config.shadowDistance
    ctx.shadowOffsetX = Math.cos(angleRad) * config.shadowDistance
    ctx.shadowOffsetY = Math.sin(angleRad) * config.shadowDistance
    ctx.fillStyle = '#888888'
    ctx.beginPath()
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        if (hasBead(paddedGrid, r, c, paddedRows, paddedCols)) {
          ctx.rect(cellX(c), cellY(r), cellWidth(c), cellHeight(r))
        }
      }
    }
    ctx.fill()
    ctx.restore()
  }

  // 绘制拼豆底色
  for (let r = 0; r < paddedRows; r++) {
    for (let c = 0; c < paddedCols; c++) {
      if (!hasBead(paddedGrid, r, c, paddedRows, paddedCols)) continue
      const cell = paddedGrid[r][c]!
      ctx.fillStyle = cell.color
      ctx.fillRect(cellX(c), cellY(r), cellWidth(c), cellHeight(r))
    }
  }

  // 绘制材质纹理
  for (let r = 0; r < paddedRows; r++) {
    for (let c = 0; c < paddedCols; c++) {
      if (!hasBead(paddedGrid, r, c, paddedRows, paddedCols)) continue
      drawMaterialTexture(
        ctx,
        cellX(c),
        cellY(r),
        cellWidth(c),
        cellHeight(r),
        config.material
      )
    }
  }

  // 绘制边缘效果（弧形突出）
  if (config.edgeEnabled) {
    const edgeRadius = config.curvature / 100 // 转换为 0-1 范围
    drawRoundedEdges(
      ctx,
      paddedGrid,
      paddedRows,
      paddedCols,
      cellX,
      cellY,
      cellWidth,
      cellHeight,
      edgeRadius
    )
  }

  // 绘制品牌文字
  if (config.displayText && config.textOpacity > 0) {
    ctx.save()
    ctx.globalAlpha = config.textOpacity / 100
    ctx.fillStyle = '#000000'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const fontSize = Math.max(12, Math.min(width, height) * 0.04)
    ctx.font = `${fontSize}px sans-serif`
    ctx.fillText(config.displayText, width / 2, height - fontSize)
    ctx.restore()
  }
}

/**
 * 下载熨烫预览图为 PNG
 */
export function downloadIroningPreview(
  canvas: HTMLCanvasElement,
  filename?: string
): void {
  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    a.download = filename || `ironing-preview_${timestamp}.png`
    a.href = url
    a.click()
    URL.revokeObjectURL(url)
  }, 'image/png')
}
