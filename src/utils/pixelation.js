// 像素化核心工具函数
// Ported from perler-beads React project

export const TRANSPARENT_KEY = 'ERASE'

export const transparentColorData = {
  key: TRANSPARENT_KEY,
  color: '#FFFFFF',
  isExternal: true,
}

// 像素化模式
export const PixelationMode = {
  Dominant: 'dominant', // 卡通模式（主色）
  Average: 'average',   // 真实模式（平均色）
}

/**
 * Hex 转 RGB
 */
export function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null
}

/**
 * sRGB 通道转线性
 */
function srgbChannelToLinear(channel) {
  const normalized = channel / 255
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4)
}

/**
 * RGB 转 Oklab
 */
function rgbToOklab(rgb) {
  const r = srgbChannelToLinear(rgb.r)
  const g = srgbChannelToLinear(rgb.g)
  const b = srgbChannelToLinear(rgb.b)

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b

  const lRoot = Math.cbrt(l)
  const mRoot = Math.cbrt(m)
  const sRoot = Math.cbrt(s)

  return {
    l: 0.2104542553 * lRoot + 0.7936177850 * mRoot - 0.0040720468 * sRoot,
    a: 1.9779984951 * lRoot - 2.4285922050 * mRoot + 0.4505937099 * sRoot,
    b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.8086757660 * sRoot,
  }
}

// Oklab 缓存
const oklabCache = new Map()

function getOklabColor(rgb) {
  const cacheKey = `${rgb.r},${rgb.g},${rgb.b}`
  const cached = oklabCache.get(cacheKey)
  if (cached) return cached
  const oklab = rgbToOklab(rgb)
  oklabCache.set(cacheKey, oklab)
  return oklab
}

/**
 * 使用 Oklab 空间计算颜色距离（保持 0-100 阈值兼容）
 */
export function colorDistance(rgb1, rgb2) {
  const oklab1 = getOklabColor(rgb1)
  const oklab2 = getOklabColor(rgb2)
  const dl = oklab1.l - oklab2.l
  const da = oklab1.a - oklab2.a
  const db = oklab1.b - oklab2.b
  return Math.sqrt(dl * dl + da * da + db * db) * 100
}

/**
 * 查找最接近的调色板颜色
 */
export function findClosestPaletteColor(targetRgb, palette) {
  if (!palette || palette.length === 0) {
    return { key: 'ERR', hex: '#000000', rgb: { r: 0, g: 0, b: 0 } }
  }
  let minDistance = Infinity
  let closestColor = palette[0]
  for (const paletteColor of palette) {
    const distance = colorDistance(targetRgb, paletteColor.rgb)
    if (distance < minDistance) {
      minDistance = distance
      closestColor = paletteColor
    }
    if (distance === 0) break
  }
  return closestColor
}

/**
 * 计算图像指定区域的代表色
 */
function calculateCellRepresentativeColor(imageData, startX, startY, width, height, mode) {
  const data = imageData.data
  const imgWidth = imageData.width
  let rSum = 0, gSum = 0, bSum = 0
  let pixelCount = 0
  const colorCountsInCell = {}
  let dominantColorRgb = null
  let maxCount = 0

  const endX = startX + width
  const endY = startY + height

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const index = (y * imgWidth + x) * 4
      if (data[index + 3] < 128) continue

      const r = data[index]
      const g = data[index + 1]
      const b = data[index + 2]
      pixelCount++

      if (mode === PixelationMode.Average) {
        rSum += r
        gSum += g
        bSum += b
      } else {
        const colorKey = `${r},${g},${b}`
        colorCountsInCell[colorKey] = (colorCountsInCell[colorKey] || 0) + 1
        if (colorCountsInCell[colorKey] > maxCount) {
          maxCount = colorCountsInCell[colorKey]
          dominantColorRgb = { r, g, b }
        }
      }
    }
  }

  if (pixelCount === 0) return null

  if (mode === PixelationMode.Average) {
    return {
      r: Math.round(rSum / pixelCount),
      g: Math.round(gSum / pixelCount),
      b: Math.round(bSum / pixelCount),
    }
  }
  return dominantColorRgb
}

/**
 * 计算像素化网格数据
 */
export function calculatePixelGrid(originalCtx, imgWidth, imgHeight, N, M, palette, mode, t1FallbackColor) {
  const mappedData = Array(M).fill(null).map(() =>
    Array(N).fill({ key: t1FallbackColor.key, color: t1FallbackColor.hex })
  )
  const cellWidthOriginal = imgWidth / N
  const cellHeightOriginal = imgHeight / M

  let fullImageData = null
  try {
    fullImageData = originalCtx.getImageData(0, 0, imgWidth, imgHeight)
  } catch (e) {
    console.error('Failed to get full image data:', e)
    return mappedData
  }

  for (let j = 0; j < M; j++) {
    for (let i = 0; i < N; i++) {
      const startXOriginal = Math.floor(i * cellWidthOriginal)
      const startYOriginal = Math.floor(j * cellHeightOriginal)
      const endXOriginal = Math.min(imgWidth, Math.ceil((i + 1) * cellWidthOriginal))
      const endYOriginal = Math.min(imgHeight, Math.ceil((j + 1) * cellHeightOriginal))
      const currentCellWidth = Math.max(1, endXOriginal - startXOriginal)
      const currentCellHeight = Math.max(1, endYOriginal - startYOriginal)

      const representativeRgb = calculateCellRepresentativeColor(
        fullImageData,
        startXOriginal, startYOriginal,
        currentCellWidth, currentCellHeight,
        mode
      )

      if (representativeRgb) {
        const closestBead = findClosestPaletteColor(representativeRgb, palette)
        mappedData[j][i] = { key: closestBead.key, color: closestBead.hex }
      } else {
        mappedData[j][i] = { ...transparentColorData }
      }
    }
  }
  return mappedData
}

/**
 * 全局频率排序颜色合并（移植自 perler-beads）
 * 按出现频率从高到低排序，高频颜色优先保留，低频相似颜色被合并
 */
export function mergeSimilarRegions(mappedData, threshold, palette) {
  if (!mappedData || mappedData.length === 0) return mappedData
  const M = mappedData.length
  const N = mappedData[0].length

  // 构建 key → RGB 和 key → 完整调色板条目的映射
  const keyToRgbMap = new Map()
  const keyToColorDataMap = new Map()
  if (palette) {
    palette.forEach(p => {
      keyToRgbMap.set(p.key, p.rgb)
      keyToColorDataMap.set(p.key, p)
    })
  }

  // 统计各 key 的出现频率
  const initialColorCounts = {}
  mappedData.flat().forEach(cell => {
    if (cell && cell.key && !cell.isExternal && cell.key !== TRANSPARENT_KEY) {
      initialColorCounts[cell.key] = (initialColorCounts[cell.key] || 0) + 1
    }
  })

  // 按频率降序排序
  const colorsByFrequency = Object.entries(initialColorCounts)
    .sort((a, b) => b[1] - a[1])
    .map(entry => entry[0])

  if (colorsByFrequency.length === 0) return mappedData.map(row => row.map(cell => ({ ...cell })))

  // 复制数据准备合并
  const result = mappedData.map(row => row.map(cell => ({ ...cell, isExternal: cell.isExternal ?? false })))

  // 已被合并的颜色集合
  const replacedColors = new Set()

  // 对每个颜色按频率从高到低处理
  for (let i = 0; i < colorsByFrequency.length; i++) {
    const currentKey = colorsByFrequency[i]
    if (replacedColors.has(currentKey)) continue

    const currentRgb = keyToRgbMap.get(currentKey)
    if (!currentRgb) continue

    // 检查剩余的低频颜色
    for (let j = i + 1; j < colorsByFrequency.length; j++) {
      const lowerFreqKey = colorsByFrequency[j]
      if (replacedColors.has(lowerFreqKey)) continue

      const lowerFreqRgb = keyToRgbMap.get(lowerFreqKey)
      if (!lowerFreqRgb) continue

      const dist = colorDistance(currentRgb, lowerFreqRgb)

      if (dist < threshold) {
        replacedColors.add(lowerFreqKey)

        // 替换所有使用低频颜色的单元格
        for (let r = 0; r < M; r++) {
          for (let c = 0; c < N; c++) {
            if (result[r][c].key === lowerFreqKey) {
              const colorData = keyToColorDataMap.get(currentKey)
              if (colorData) {
                result[r][c] = {
                  key: currentKey,
                  color: colorData.hex,
                  isExternal: false
                }
              }
            }
          }
        }
      }
    }
  }

  return result
}

/**
 * 背景移除 - 从边界洪水填充
 */
export function removeBackground(mappedData, backgroundKeys) {
  if (!mappedData || mappedData.length === 0) return mappedData
  const M = mappedData.length
  const N = mappedData[0].length
  const result = mappedData.map(row => row.map(cell => ({ ...cell })))
  const visited = Array(M).fill(null).map(() => Array(N).fill(false))

  const stack = []

  // 从所有边界单元格开始
  for (let i = 0; i < N; i++) {
    stack.push({ r: 0, c: i }, { r: M - 1, c: i })
  }
  for (let j = 0; j < M; j++) {
    stack.push({ r: j, c: 0 }, { r: j, c: N - 1 })
  }

  while (stack.length > 0) {
    const { r, c } = stack.pop()
    if (r < 0 || r >= M || c < 0 || c >= N) continue
    if (visited[r][c]) continue

    const cell = result[r][c]
    if (!cell || cell.isExternal) continue

    const cellHex = cell.color.toUpperCase()
    const isBg = backgroundKeys.some(bk => bk.toUpperCase() === cellHex)
    if (!isBg) continue

    visited[r][c] = true
    result[r][c] = { ...result[r][c], isExternal: true }

    stack.push(
      { r: r - 1, c }, { r: r + 1, c },
      { r, c: c - 1 }, { r, c: c + 1 }
    )
  }

  return result
}

/**
 * 颜色替换
 */
export function replaceAllColor(mappedData, sourceHex, targetKey, targetColor) {
  const result = mappedData.map(row => row.map(cell => ({ ...cell })))
  const M = result.length
  const N = result[0].length
  let count = 0
  for (let j = 0; j < M; j++) {
    for (let i = 0; i < N; i++) {
      if (result[j][i] && !result[j][i].isExternal &&
          result[j][i].color.toUpperCase() === sourceHex.toUpperCase()) {
        result[j][i] = { key: targetKey, color: targetColor, isExternal: false }
        count++
      }
    }
  }
  return { result, count }
}

/**
 * 单像素上色
 */
export function paintPixel(mappedData, row, col, newColor) {
  const result = mappedData.map(r => r.map(c => ({ ...c })))
  const old = result[row]?.[col]
  if (!old) return { result: mappedData, changed: false }
  const changed = old.key !== newColor.key || old.isExternal !== newColor.isExternal
  if (changed) result[row][col] = { ...newColor }
  return { result, changed }
}

/**
 * 洪水填充擦除
 */
export function floodFillErase(mappedData, gridDimensions, startRow, startCol, targetKey) {
  const { N, M } = gridDimensions
  const result = mappedData.map(row => row.map(cell => ({ ...cell })))
  const visited = Array(M).fill(null).map(() => Array(N).fill(false))
  const stack = [{ row: startRow, col: startCol }]

  while (stack.length > 0) {
    const { row, col } = stack.pop()
    if (row < 0 || row >= M || col < 0 || col >= N || visited[row][col]) continue
    const cell = result[row][col]
    if (!cell || cell.isExternal || cell.key !== targetKey) continue
    visited[row][col] = true
    result[row][col] = { ...transparentColorData }
    stack.push(
      { row: row - 1, col }, { row: row + 1, col },
      { row, col: col - 1 }, { row, col: col + 1 }
    )
  }
  return result
}

/**
 * 重新计算颜色统计
 */
export function recalculateColorStats(mappedData) {
  const colorCounts = {}
  let totalCount = 0
  mappedData.flat().forEach(cell => {
    if (cell && !cell.isExternal && cell.key !== TRANSPARENT_KEY) {
      const hex = cell.color.toUpperCase()
      if (!colorCounts[hex]) colorCounts[hex] = { count: 0, color: hex }
      colorCounts[hex].count++
      totalCount++
    }
  })
  return { colorCounts, totalCount }
}
