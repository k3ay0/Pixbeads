// 下载导出工具函数
import { getColorKeyByHex } from './colorSystemUtils'
import { TRANSPARENT_KEY } from './pixelation'

/**
 * 获取对比色（黑/白）
 */
function getContrastColor(hex) {
  // 支持简写 hex（#abc → #aabbcc）
  const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i
  const formattedHex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b)
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
function sortColorKeys(a, b) {
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
}) {
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
export function downloadStatsImage({ colorCounts, totalBeadCount, selectedColorSystem }) {
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
export function exportCsv({ mappedPixelData, gridDimensions, selectedColorSystem }) {
  if (!mappedPixelData || !gridDimensions) return
  const { N, M } = gridDimensions
  const csvLines = []

  for (let row = 0; row < M; row++) {
    const rowData = []
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

/**
 * 导入 CSV hex 数据
 * @param {File} file CSV 文件
 * @returns {Promise<{ mappedPixelData: Array, gridDimensions: { N: number; M: number } }>}
 */
export function importCsvData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const text = e.target?.result
        if (!text) {
          reject(new Error('无法读取文件内容'))
          return
        }

        const lines = text.trim().split('\n')
        const M = lines.length

        if (M === 0) {
          reject(new Error('CSV文件为空'))
          return
        }

        const firstRowData = lines[0].split(',')
        const N = firstRowData.length

        if (N === 0) {
          reject(new Error('CSV文件格式无效'))
          return
        }

        const mappedPixelData = []

        for (let row = 0; row < M; row++) {
          const rowData = lines[row].split(',')
          const mappedRow = []

          if (rowData.length !== N) {
            reject(new Error(`第${row + 1}行的列数不匹配，期望${N}列，实际${rowData.length}列`))
            return
          }

          for (let col = 0; col < N; col++) {
            const cellValue = rowData[col].trim()

            if (cellValue === 'TRANSPARENT' || cellValue === '') {
              mappedRow.push({
                key: 'TRANSPARENT',
                color: '#FFFFFF',
                isExternal: true
              })
            } else {
              const hexPattern = /^#[0-9A-Fa-f]{6}$/
              if (!hexPattern.test(cellValue)) {
                reject(new Error(`第${row + 1}行第${col + 1}列的颜色值无效：${cellValue}`))
                return
              }

              mappedRow.push({
                key: cellValue.toUpperCase(),
                color: cellValue.toUpperCase(),
                isExternal: false
              })
            }
          }

          mappedPixelData.push(mappedRow)
        }

        resolve({
          mappedPixelData,
          gridDimensions: { N, M }
        })

      } catch (error) {
        reject(new Error(`解析CSV文件失败：${error}`))
      }
    }

    reader.onerror = () => {
      reject(new Error('读取文件失败'))
    }

    reader.readAsText(file, 'utf-8')
  })
}
