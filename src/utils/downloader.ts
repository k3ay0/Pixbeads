// 下载导出工具函数
import { getColorKeyByHex } from './colorSystemUtils'
import type { MappedPixel, GridDimensions, ColorCounts, ColorSystem, GridDownloadOptions } from '@/types'
import { TRANSPARENT_KEY } from '@/types'

/**
 * 获取对比色（黑/白）
 */
function getContrastColor(hex: string): string {
  // 支持简写 hex（#abc → #aabbcc）
  const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i
  const formattedHex = hex.replace(shorthandRegex, (_m, r, g, b) => r + r + g + g + b + b)
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(formattedHex)
  if (!result) return '#000000'
  const r = parseInt(result[1], 16)
  const g = parseInt(result[2], 16)
  const b = parseInt(result[3], 16)
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return luma > 0.5 ? '#000000' : '#FFFFFF'
}

/**
 * 排序色号键
 */
function sortColorKeys(a: string, b: string): number {
  const regex = /^([A-Z]+)(\d+)$/
  const matchA = a.match(regex)
  const matchB = b.match(regex)
  if (matchA && matchB) {
    if (matchA[1] !== matchB[1]) return matchA[1].localeCompare(matchB[1])
    return parseInt(matchA[2], 10) - parseInt(matchB[2], 10)
  }
  return a.localeCompare(b)
}

/**
 * 下载带 Key 的图纸
 */
export function downloadGridImage({
  mappedPixelData,
  gridDimensions,
  colorCounts,
  totalBeadCount,
  selectedColorSystem,
  options = {}
}: {
  mappedPixelData: MappedPixel[][] | null
  gridDimensions: GridDimensions | null
  colorCounts: ColorCounts | null
  totalBeadCount: number
  selectedColorSystem: ColorSystem
  options?: Partial<GridDownloadOptions>
}): void {
  if (!mappedPixelData || !gridDimensions) return

  const { N, M } = gridDimensions
  const {
    showGrid = true,
    gridInterval = 10,
    showCoordinates = true,
    showCellNumbers = true,
    gridLineColor = '#CCCCCC',
    includeStats = true,
  } = options

  const cellSize = 30
  const axisLabelSize = showCoordinates ? 30 : 0
  const gridWidth = N * cellSize
  const gridHeight = M * cellSize

  // 计算统计区域高度
  let statsHeight = 0
  if (includeStats && colorCounts) {
    const colorKeys = Object.keys(colorCounts)
    const numColumns = Math.max(1, Math.min(4, Math.floor((gridWidth - 40) / 250)))
    const numRows = Math.ceil(colorKeys.length / numColumns)
    statsHeight = 40 + numRows * 25 + 40 + 30
  }

  const downloadWidth = gridWidth + axisLabelSize * 2
  const downloadHeight = 80 + gridHeight + axisLabelSize * 2 + statsHeight + 35

  const canvas = document.createElement('canvas')
  canvas.width = downloadWidth
  canvas.height = downloadHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, downloadWidth, downloadHeight)

  // 标题栏
  ctx.fillStyle = '#1F2937'
  ctx.fillRect(0, 0, downloadWidth, 80)

  // 品牌色块
  const brandWidth = 64
  const gradient = ctx.createLinearGradient(0, 0, brandWidth, 80)
  gradient.addColorStop(0, '#6366F1')
  gradient.addColorStop(1, '#8B5CF6')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, brandWidth, 80)

  // Logo: 拼豆抽象
  ctx.fillStyle = '#FFFFFF'
  const beadSize = 8
  const beadSpacing = beadSize * 1.2
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const bx = 32 - beadSize * 1.5 + col * beadSpacing
      const by = 40 - beadSize * 1.5 + row * beadSpacing
      ctx.beginPath()
      ctx.roundRect(bx, by, beadSize, beadSize, beadSize * 0.2)
      ctx.fill()
    }
  }

  // 标题文字
  ctx.fillStyle = '#FFFFFF'
  ctx.font = '600 20px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText('PIXBEADS', brandWidth + 16, 35)
  ctx.fillStyle = 'rgba(255,255,255,0.8)'
  ctx.font = '400 12px system-ui, sans-serif'
  ctx.fillText('拼豆图纸生成工具', brandWidth + 16, 55)

  // 网格坐标
  const gridOffsetX = axisLabelSize
  const gridOffsetY = 80 + axisLabelSize

  if (showCoordinates) {
    ctx.fillStyle = '#F5F5F5'
    ctx.fillRect(gridOffsetX, 80, gridWidth, axisLabelSize)
    ctx.fillRect(gridOffsetX, 80 + axisLabelSize + gridHeight, gridWidth, axisLabelSize)
    ctx.fillRect(0, gridOffsetY, axisLabelSize, gridHeight)
    ctx.fillRect(gridOffsetX + gridWidth, gridOffsetY, axisLabelSize, gridHeight)

    ctx.fillStyle = '#333333'
    ctx.font = '12px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    for (let i = 0; i < N; i++) {
      if ((i + 1) % gridInterval === 0 || i === 0 || i === N - 1) {
        const x = gridOffsetX + i * cellSize + cellSize / 2
        ctx.fillText((i + 1).toString(), x, 80 + axisLabelSize / 2)
        ctx.fillText((i + 1).toString(), x, 80 + axisLabelSize + gridHeight + axisLabelSize / 2)
      }
    }
    for (let j = 0; j < M; j++) {
      if ((j + 1) % gridInterval === 0 || j === 0 || j === M - 1) {
        const y = gridOffsetY + j * cellSize + cellSize / 2
        ctx.textAlign = 'center'
        ctx.fillText((j + 1).toString(), axisLabelSize / 2, y)
        ctx.fillText((j + 1).toString(), axisLabelSize + gridWidth + axisLabelSize / 2, y)
      }
    }
  }

  // 绘制网格
  const fontSize = Math.max(8, Math.floor(cellSize * 0.35))
  for (let j = 0; j < M; j++) {
    for (let i = 0; i < N; i++) {
      const cell = mappedPixelData[j]?.[i]
      if (!cell || cell.isExternal) continue

      const x = gridOffsetX + i * cellSize
      const y = gridOffsetY + j * cellSize

      ctx.fillStyle = cell.color
      ctx.fillRect(x, y, cellSize, cellSize)

      // 基础单元格边框（始终绘制）
      ctx.strokeStyle = '#DDDDDD'
      ctx.lineWidth = 0.5
      ctx.strokeRect(x, y, cellSize, cellSize)

      // 网格线（在基础边框之上）
      if (showGrid) {
        ctx.strokeStyle = gridLineColor
        ctx.lineWidth = 0.5
        ctx.strokeRect(x, y, cellSize, cellSize)
      }

      // 色号文字
      if (showCellNumbers) {
        const displayKey = getColorKeyByHex(cell.color, selectedColorSystem)
        if (displayKey && displayKey !== '?') {
          ctx.fillStyle = getContrastColor(cell.color)
          ctx.font = `${fontSize}px sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(displayKey, x + cellSize / 2, y + cellSize / 2)
        }
      }
    }
  }

  // 网格外边框
  ctx.strokeStyle = '#000000'
  ctx.lineWidth = 1.5
  ctx.strokeRect(gridOffsetX, gridOffsetY, gridWidth, gridHeight)

  // 统计区域
  if (includeStats && colorCounts) {
    const statsY = gridOffsetY + gridHeight + axisLabelSize * 2
    ctx.fillStyle = '#F9FAFB'
    ctx.fillRect(0, statsY, downloadWidth, statsHeight)
    ctx.strokeStyle = '#E5E7EB'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, statsY)
    ctx.lineTo(downloadWidth, statsY)
    ctx.stroke()

    ctx.fillStyle = '#374151'
    ctx.font = '600 14px system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(`颜色统计 — 共 ${Object.keys(colorCounts).length} 种颜色，${totalBeadCount} 粒`, 20, statsY + 12)

    // 总计行
    ctx.fillStyle = '#6B7280'
    ctx.font = '400 12px system-ui, sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'top'
    ctx.fillText(`总计: ${totalBeadCount} 颗`, downloadWidth - 20, statsY + 12)

    const sortedKeys = Object.keys(colorCounts).sort(sortColorKeys)
    const numColumns = Math.max(1, Math.min(4, Math.floor((gridWidth - 40) / 250)))
    const colWidth = (gridWidth - 40) / numColumns
    const swatchSize = 16
    const rowHeight = 24
    const startY = statsY + 40

    sortedKeys.forEach((hex, idx) => {
      const col = idx % numColumns
      const row = Math.floor(idx / numColumns)
      const x = 20 + col * colWidth
      const y = startY + row * rowHeight

      ctx.fillStyle = hex
      ctx.beginPath()
      ctx.roundRect(x, y, swatchSize, swatchSize, 3)
      ctx.fill()

      const displayKey = getColorKeyByHex(hex, selectedColorSystem)
      ctx.fillStyle = '#374151'
      ctx.font = '12px sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(`${displayKey} (${colorCounts[hex].count})`, x + swatchSize + 6, y + swatchSize / 2)
    })
  }

  // 小红书标识
  ctx.fillStyle = '#9CA3AF'
  ctx.font = '10px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText('由 PIXBEADS 生成', downloadWidth / 2, downloadHeight - 8)

  // 触发下载
  const link = document.createElement('a')
  link.download = `pixbeads-pattern-${N}x${M}.png`
  link.href = canvas.toDataURL('image/png')
  link.click()
}

/**
 * 下载颜色统计图
 */
export function downloadStatsImage({
  colorCounts,
  totalBeadCount,
  selectedColorSystem
}: {
  colorCounts: ColorCounts | null
  totalBeadCount: number
  selectedColorSystem: ColorSystem
}): void {
  if (!colorCounts) return

  const sortedKeys = Object.keys(colorCounts).sort(sortColorKeys)
  const numColumns = Math.max(1, Math.min(4, Math.floor(sortedKeys.length / 15)))
  const colWidth = 280
  const swatchSize = 20
  const rowHeight = 28
  const numRows = Math.ceil(sortedKeys.length / numColumns)
  const padding = 30

  const canvas = document.createElement('canvas')
  canvas.width = numColumns * colWidth + padding * 2
  canvas.height = 80 + numRows * rowHeight + padding * 2
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.fillStyle = '#1F2937'
  ctx.font = '600 16px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(`颜色统计 — 共 ${sortedKeys.length} 种，${totalBeadCount} 粒`, padding, padding)

  sortedKeys.forEach((hex, idx) => {
    const col = idx % numColumns
    const row = Math.floor(idx / numColumns)
    const x = padding + col * colWidth
    const y = padding + 40 + row * rowHeight

    ctx.fillStyle = hex
    ctx.beginPath()
    ctx.roundRect(x, y, swatchSize, swatchSize, 3)
    ctx.fill()
    ctx.strokeStyle = '#D1D5DB'
    ctx.lineWidth = 0.5
    ctx.stroke()

    const displayKey = getColorKeyByHex(hex, selectedColorSystem)
    ctx.fillStyle = '#374151'
    ctx.font = '12px sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${displayKey} — ${colorCounts[hex].count} 粒`, x + swatchSize + 8, y + swatchSize / 2)
  })

  const link = document.createElement('a')
  link.download = `pixbeads-stats.png`
  link.href = canvas.toDataURL('image/png')
  link.click()
}

/**
 * 导出 CSV
 */
export function exportCsv({
  mappedPixelData,
  gridDimensions,
  selectedColorSystem
}: {
  mappedPixelData: MappedPixel[][] | null
  gridDimensions: GridDimensions | null
  selectedColorSystem: ColorSystem
}): void {
  if (!mappedPixelData || !gridDimensions) return
  const { N, M } = gridDimensions
  const csvLines: string[] = []

  for (let row = 0; row < M; row++) {
    const rowData: string[] = []
    for (let col = 0; col < N; col++) {
      const cell = mappedPixelData[row][col]
      if (cell && !cell.isExternal) {
        rowData.push(cell.color)
      } else {
        rowData.push('TRANSPARENT')
      }
    }
    csvLines.push(rowData.join(','))
  }

  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `pixbeads-pattern-${N}x${M}-${selectedColorSystem}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
}

// ========== .pbds 格式导入导出 ==========

import JSZip from 'jszip'
import { hexToRgb } from './pixelation'
import { getColorKeyByHex as getColorKey } from './colorSystemUtils'
import type { RgbColor, PaletteColor } from '@/types'

export interface PbdsImportResult {
  mappedPixelData: MappedPixel[][]
  gridDimensions: GridDimensions
  colorCounts: ColorCounts
  totalBeadCount: number
  sourceColorSystem: ColorSystem
}

interface ColorEntry {
  hex: string
  key: string
  count: number
}

/**
 * 计算两个颜色之间的感知距离（加权欧几里得距离）
 */
export function colorDistance(c1: RgbColor, c2: RgbColor): number {
  const rMean = (c1.r + c2.r) / 2
  const dr = c1.r - c2.r
  const dg = c1.g - c2.g
  const db = c1.b - c2.b
  return Math.sqrt(
    (2 + rMean / 256) * dr * dr +
    4 * dg * dg +
    (2 + (255 - rMean) / 256) * db * db
  )
}

/**
 * 在可用颜色中找到最接近目标颜色的
 */
export function findClosestColor(targetHex: string, availableColors: PaletteColor[]): PaletteColor | null {
  const targetRgb = hexToRgb(targetHex)
  if (!targetRgb || availableColors.length === 0) return null

  let minDistance = Infinity
  let closest = availableColors[0]

  for (const color of availableColors) {
    const distance = colorDistance(targetRgb, color.rgb)
    if (distance < minDistance) {
      minDistance = distance
      closest = color
    }
  }
  return closest
}

/**
 * 转换导入数据到目标色系
 */
export function convertToCurrentSystem(
  data: PbdsImportResult,
  targetSystem: ColorSystem,
  fullPalette: PaletteColor[]
): {
  mappedPixelData: MappedPixel[][]
  convertedCount: number
  approximatedCount: number
} {
  const hexMapping = new Map<string, string>()
  let convertedCount = 0
  let approximatedCount = 0

  // 收集所有唯一的颜色
  const uniqueColors = new Set<string>()
  for (const row of data.mappedPixelData) {
    for (const cell of row) {
      if (!cell.isExternal) {
        uniqueColors.add(cell.color.toUpperCase())
      }
    }
  }

  // 为每个颜色建立映射
  for (const hex of uniqueColors) {
    const targetKey = getColorKey(hex, targetSystem)
    if (targetKey !== '?') {
      // 直接映射成功
      hexMapping.set(hex, hex)
      convertedCount++
    } else {
      // 找最接近的颜色
      const closest = findClosestColor(hex, fullPalette)
      if (closest) {
        hexMapping.set(hex, closest.hex)
        approximatedCount++
      } else {
        hexMapping.set(hex, hex)
      }
    }
  }

  // 应用映射转换
  const mappedPixelData = data.mappedPixelData.map(row =>
    row.map(cell => {
      if (cell.isExternal) return cell
      const mappedHex = hexMapping.get(cell.color.toUpperCase()) || cell.color
      return {
        ...cell,
        key: getColorKey(mappedHex, targetSystem),
        color: mappedHex
      }
    })
  )

  return { mappedPixelData, convertedCount, approximatedCount }
}

/**
 * 导出 .pbds 文件
 */
export async function exportPbds({
  mappedPixelData,
  gridDimensions,
  colorCounts,
  totalBeadCount,
  selectedColorSystem
}: {
  mappedPixelData: MappedPixel[][] | null
  gridDimensions: GridDimensions | null
  colorCounts: ColorCounts | null
  totalBeadCount: number
  selectedColorSystem: ColorSystem
}): Promise<void> {
  if (!mappedPixelData || !gridDimensions || !colorCounts) return

  const { N, M } = gridDimensions

  // 构建颜色索引映射
  const colorIndexMap = new Map<string, number>()
  const colorList: ColorEntry[] = []
  let index = 0

  for (const [hex, data] of Object.entries(colorCounts)) {
    const normalizedHex = hex.toUpperCase()
    colorIndexMap.set(normalizedHex, index)
    const colorKey = getColorKey(normalizedHex, selectedColorSystem)
    colorList.push({ hex: normalizedHex, key: colorKey, count: data.count })
    index++
  }

  // 生成 metadata.csv
  const metadataLines = [
    'key,value',
    `version,1.0`,
    `gridWidth,${N}`,
    `gridHeight,${M}`,
    `colorSystem,${selectedColorSystem}`,
    `totalBeads,${totalBeadCount}`,
    `exportDate,${new Date().toISOString()}`
  ]
  const metadataCsv = metadataLines.join('\n')

  // 生成 colormap.csv
  const colormapLines = ['index,hex,colorKey,count']
  for (const entry of colorList) {
    colormapLines.push(`${entry.index},${entry.hex},${entry.key},${entry.count}`)
  }
  const colormapCsv = colormapLines.join('\n')

  // 生成 pattern.csv
  const patternLines: string[] = []
  for (let row = 0; row < M; row++) {
    const rowData: string[] = []
    for (let col = 0; col < N; col++) {
      const cell = mappedPixelData[row][col]
      if (cell && !cell.isExternal) {
        const idx = colorIndexMap.get(cell.color.toUpperCase())
        rowData.push(idx !== undefined ? idx.toString() : '-1')
      } else {
        rowData.push('-1')
      }
    }
    patternLines.push(rowData.join(','))
  }
  const patternCsv = patternLines.join('\n')

  // 创建 ZIP
  const zip = new JSZip()
  zip.file('metadata.csv', metadataCsv)
  zip.file('colormap.csv', colormapCsv)
  zip.file('pattern.csv', patternCsv)

  const blob = await zip.generateAsync({ type: 'blob' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `pixbeads-${N}x${M}-${selectedColorSystem}.pbds`
  link.click()
  URL.revokeObjectURL(link.href)
}

/**
 * 导入 .pbds 文件
 */
export async function importPbds(file: File): Promise<PbdsImportResult> {
  const zip = await JSZip.loadAsync(file)

  // 读取 metadata.csv
  const metadataFile = zip.file('metadata.csv')
  if (!metadataFile) throw new Error('缺少 metadata.csv 文件')
  const metadataText = await metadataFile.async('text')
  const metadata = parseMetadata(metadataText)

  // 读取 colormap.csv
  const colormapFile = zip.file('colormap.csv')
  if (!colormapFile) throw new Error('缺少 colormap.csv 文件')
  const colormapText = await colormapFile.async('text')
  const colorMap = parseColorMap(colormapText)

  // 读取 pattern.csv
  const patternFile = zip.file('pattern.csv')
  if (!patternFile) throw new Error('缺少 pattern.csv 文件')
  const patternText = await patternFile.async('text')
  const pattern = parsePattern(patternText, colorMap)

  return {
    mappedPixelData: pattern,
    gridDimensions: { N: metadata.gridWidth, M: metadata.gridHeight },
    colorCounts: buildColorCounts(pattern),
    totalBeadCount: metadata.totalBeads,
    sourceColorSystem: metadata.colorSystem
  }
}

function parseMetadata(text: string): {
  gridWidth: number
  gridHeight: number
  colorSystem: ColorSystem
  totalBeads: number
} {
  const lines = text.trim().split('\n')
  const data: Record<string, string> = {}
  for (let i = 1; i < lines.length; i++) {
    const [key, value] = lines[i].split(',')
    if (key && value) data[key.trim()] = value.trim()
  }

  return {
    gridWidth: parseInt(data.gridWidth, 10),
    gridHeight: parseInt(data.gridHeight, 10),
    colorSystem: data.colorSystem as ColorSystem,
    totalBeads: parseInt(data.totalBeads, 10)
  }
}

function parseColorMap(text: string): Map<number, string> {
  const lines = text.trim().split('\n')
  const colorMap = new Map<number, string>()

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',')
    if (parts.length >= 2) {
      const idx = parseInt(parts[0], 10)
      const hex = parts[1].trim().toUpperCase()
      colorMap.set(idx, hex)
    }
  }
  return colorMap
}

function parsePattern(text: string, colorMap: Map<number, string>): MappedPixel[][] {
  const lines = text.trim().split('\n')
  const result: MappedPixel[][] = []

  for (const line of lines) {
    const row: MappedPixel[] = []
    const indices = line.split(',')

    for (const idxStr of indices) {
      const idx = parseInt(idxStr.trim(), 10)
      if (idx === -1 || isNaN(idx)) {
        row.push({ key: 'ERASE', color: '#FFFFFF', isExternal: true })
      } else {
        const hex = colorMap.get(idx)
        if (hex) {
          row.push({ key: hex, color: hex, isExternal: false })
        } else {
          row.push({ key: 'ERASE', color: '#FFFFFF', isExternal: true })
        }
      }
    }
    result.push(row)
  }
  return result
}

function buildColorCounts(mappedPixelData: MappedPixel[][]): ColorCounts {
  const counts: ColorCounts = {}

  for (const row of mappedPixelData) {
    for (const cell of row) {
      if (!cell.isExternal && cell.key !== 'ERASE') {
        const hex = cell.color.toUpperCase()
        if (!counts[hex]) {
          counts[hex] = { count: 0, color: hex }
        }
        counts[hex].count++
      }
    }
  }
  return counts
}
