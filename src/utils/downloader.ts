// 下载导出工具函数
import { getColorKeyByHex, getDisplayKey } from './colorSystemUtils'
import type { MappedPixel, GridDimensions, ColorCounts, ColorSystem, GridDownloadOptions } from '@/types'
import { hexToRgb, colorDistance, findClosestPaletteColor, getContrastColor } from './colorUtils'
import { triggerImageDownload, triggerBlobDownload } from './downloadUtils'
import { recalculateColorStats } from './pixelation'

// 重新导出 colorDistance 供 ImportConvertDialog 使用
export { colorDistance }

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
    gridLineColor = '#555555',
    includeStats = true,
  } = options

  const cellSize = 60
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
  const ctx = canvas.getContext('2d')!

  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, downloadWidth, downloadHeight)

  // 标题栏
  ctx.fillStyle = '#0F172A'
  ctx.fillRect(0, 0, downloadWidth, 80)

  // 品牌色块
  const brandWidth = 64
  const gradient = ctx.createLinearGradient(0, 0, brandWidth, 80)
  gradient.addColorStop(0, '#3B82F6')
  gradient.addColorStop(1, '#60A5FA')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, brandWidth, 80)

  // Logo: 加载 favicon 图标
  const logoImg = new Image()
  logoImg.src = '/logos/android-chrome-512x512.png'

  function drawRest() {
    if (!mappedPixelData) return
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
        const x = gridOffsetX + i * cellSize + cellSize / 2
        ctx.fillText((i + 1).toString(), x, 80 + axisLabelSize / 2)
        ctx.fillText((i + 1).toString(), x, 80 + axisLabelSize + gridHeight + axisLabelSize / 2)
      }
      for (let j = 0; j < M; j++) {
        const y = gridOffsetY + j * cellSize + cellSize / 2
        ctx.textAlign = 'center'
        ctx.fillText((j + 1).toString(), axisLabelSize / 2, y)
        ctx.fillText((j + 1).toString(), axisLabelSize + gridWidth + axisLabelSize / 2, y)
      }
    }

    // 绘制网格（颜色、细网格线、色号文字）
    const fontSize = Math.max(8, Math.floor(cellSize * 0.35))
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < N; i++) {
        const cell = mappedPixelData[j]?.[i]
        const x = gridOffsetX + i * cellSize
        const y = gridOffsetY + j * cellSize

        // 填充单元格颜色（仅非外部单元格）
        if (cell && !cell.isExternal) {
          ctx.fillStyle = cell.color
          ctx.fillRect(x, y, cellSize, cellSize)

          // 色号文字
          if (showCellNumbers) {
            const displayKey = getDisplayKey(cell, selectedColorSystem)
            if (displayKey && displayKey !== '?') {
              ctx.fillStyle = getContrastColor(cell.color)
              ctx.font = `${fontSize}px sans-serif`
              ctx.textAlign = 'center'
              ctx.textBaseline = 'middle'
              ctx.fillText(displayKey, x + cellSize / 2, y + cellSize / 2)
            }
          }
        }

        // 绘制细网格线（每个单元格）
        ctx.strokeStyle = '#DDDDDD'
        ctx.lineWidth = 0.2
        ctx.strokeRect(x, y, cellSize, cellSize)
      }
    }

    // 绘制用户设定的粗网格线（每 N 格画一条，不含边界）
    if (showGrid) {
      ctx.strokeStyle = gridLineColor
      ctx.lineWidth = 1.5
      // 竖线（从第 N 格开始，到第 (M-1)*N 格结束）
      for (let i = gridInterval; i < N; i += gridInterval) {
        const x = gridOffsetX + i * cellSize
        ctx.beginPath()
        ctx.moveTo(x, gridOffsetY)
        ctx.lineTo(x, gridOffsetY + gridHeight)
        ctx.stroke()
      }
      // 横线（从第 N 格开始，到第 (M-1)*N 格结束）
      for (let j = gridInterval; j < M; j += gridInterval) {
        const y = gridOffsetY + j * cellSize
        ctx.beginPath()
        ctx.moveTo(gridOffsetX, y)
        ctx.lineTo(gridOffsetX + gridWidth, y)
        ctx.stroke()
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

    // 底部标识
    ctx.fillStyle = '#9CA3AF'
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText('由 PIXBEADS 生成', downloadWidth / 2, downloadHeight - 8)

    // 触发下载
    triggerImageDownload(canvas, `pixbeads-pattern-${N}x${M}.png`)
  }

  logoImg.onload = () => {
    ctx.drawImage(logoImg, 12, 16, 40, 40)
    drawRest()
  }
  logoImg.onerror = () => {
    // 图标加载失败时使用备用文字
    ctx.fillStyle = '#FFFFFF'
    ctx.font = '700 24px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('P', brandWidth / 2, 40)
    drawRest()
  }
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
  const ctx = canvas.getContext('2d')!

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

  triggerImageDownload(canvas, `pixbeads-stats.png`)
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
  triggerBlobDownload(blob, `pixbeads-pattern-${N}x${M}-${selectedColorSystem}.csv`)
}

// ========== .pbds 格式导入导出 ==========

import JSZip from 'jszip'
import type { PaletteColor } from '@/types'

export interface PbdsImportResult {
  mappedPixelData: MappedPixel[][]
  gridDimensions: GridDimensions
  colorCounts: ColorCounts
  totalBeadCount: number
  sourceColorSystem: ColorSystem
}

interface ColorEntry {
  index: number
  hex: string
  key: string
  count: number
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
    const targetKey = getColorKeyByHex(hex, targetSystem)
    if (targetKey !== '?') {
      // 直接映射成功
      hexMapping.set(hex, hex)
      convertedCount++
    } else {
      // 找最接近的颜色
      const targetRgb = hexToRgb(hex)
      const closest = targetRgb ? findClosestPaletteColor(targetRgb, fullPalette) : null
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
        key: getColorKeyByHex(mappedHex, targetSystem),
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
    const colorKey = getColorKeyByHex(normalizedHex, selectedColorSystem)
    colorList.push({ index, hex: normalizedHex, key: colorKey, count: data.count })
    index++
  }

  // 生成 metadata.json
  const metadata = {
    version: '1.0',
    gridWidth: N,
    gridHeight: M,
    colorSystem: selectedColorSystem,
    totalBeads: totalBeadCount,
    exportDate: new Date().toISOString()
  }
  const metadataJson = JSON.stringify(metadata)

  // 生成 colormap.json
  const colormapJson = JSON.stringify(colorList)

  // 生成 pattern.json
  const patternMatrix: number[][] = []
  for (let row = 0; row < M; row++) {
    const rowData: number[] = []
    for (let col = 0; col < N; col++) {
      const cell = mappedPixelData[row][col]
      if (cell && !cell.isExternal) {
        const idx = colorIndexMap.get(cell.color.toUpperCase())
        rowData.push(idx !== undefined ? idx : -1)
      } else {
        rowData.push(-1)
      }
    }
    patternMatrix.push(rowData)
  }
  const patternJson = JSON.stringify(patternMatrix)

  // 创建 ZIP
  const zip = new JSZip()
  zip.file('metadata.json', metadataJson)
  zip.file('colormap.json', colormapJson)
  zip.file('pattern.json', patternJson)

  const blob = await zip.generateAsync({ type: 'blob' })
  triggerBlobDownload(blob, `pixbeads-${N}x${M}-${selectedColorSystem}.pbds`)
}

/**
 * 导入 .pbds 文件
 */
export async function importPbds(file: File): Promise<PbdsImportResult> {
  const zip = await JSZip.loadAsync(file)

  // 读取 metadata.json
  const metadataFile = zip.file('metadata.json')
  if (!metadataFile) throw new Error('缺少 metadata.json 文件')
  const metadataText = await metadataFile.async('text')
  const metadata = parseMetadata(metadataText)

  // 读取 colormap.json
  const colormapFile = zip.file('colormap.json')
  if (!colormapFile) throw new Error('缺少 colormap.json 文件')
  const colormapText = await colormapFile.async('text')
  const colorMap = parseColorMap(colormapText)

  // 读取 pattern.json
  const patternFile = zip.file('pattern.json')
  if (!patternFile) throw new Error('缺少 pattern.json 文件')
  const patternText = await patternFile.async('text')
  const pattern = parsePattern(patternText, colorMap)

  return {
    mappedPixelData: pattern,
    gridDimensions: { N: metadata.gridWidth, M: metadata.gridHeight },
    colorCounts: recalculateColorStats(pattern).colorCounts,
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
  const data = JSON.parse(text)
  return {
    gridWidth: data.gridWidth,
    gridHeight: data.gridHeight,
    colorSystem: data.colorSystem as ColorSystem,
    totalBeads: data.totalBeads
  }
}

function parseColorMap(text: string): Map<number, { hex: string; key: string }> {
  const entries: ColorEntry[] = JSON.parse(text)
  const colorMap = new Map<number, { hex: string; key: string }>()

  for (const entry of entries) {
    colorMap.set(entry.index, { hex: entry.hex.toUpperCase(), key: entry.key || entry.hex })
  }
  return colorMap
}

function parsePattern(text: string, colorMap: Map<number, { hex: string; key: string }>): MappedPixel[][] {
  const matrix: number[][] = JSON.parse(text)
  const result: MappedPixel[][] = []

  for (const row of matrix) {
    const mappedRow: MappedPixel[] = []
    for (const idx of row) {
      if (idx === -1) {
        mappedRow.push({ key: 'ERASE', color: '#FFFFFF', isExternal: true })
      } else {
        const entry = colorMap.get(idx)
        if (entry) {
          mappedRow.push({ key: entry.key, color: entry.hex, isExternal: false })
        } else {
          mappedRow.push({ key: 'ERASE', color: '#FFFFFF', isExternal: true })
        }
      }
    }
    result.push(mappedRow)
  }
  return result
}
