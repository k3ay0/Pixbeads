// Web Worker for image pixelation processing
import type {
  RgbColor,
  PaletteColor,
  MappedPixel,
} from '@/types'
import {
  TRANSPARENT_KEY,
  transparentColorData,
} from '@/types'
import { PixelationMode } from '@/types'
import { colorDistance, findClosestPaletteColor, clearOklabCache } from '@/utils/colorUtils'

// ========== 核心处理函数 ==========

function calculateCellRepresentativeColor(
  imageData: ImageData,
  startX: number,
  startY: number,
  width: number,
  height: number,
  mode: PixelationMode
): RgbColor | null {
  const data = imageData.data
  const imgWidth = imageData.width
  let rSum = 0, gSum = 0, bSum = 0
  let pixelCount = 0
  const colorCountsInCell: Record<string, number> = {}
  let dominantColorRgb: RgbColor | null = null
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

function calculatePixelGrid(
  imageData: ImageData,
  imgWidth: number,
  imgHeight: number,
  N: number,
  M: number,
  palette: PaletteColor[],
  mode: PixelationMode,
  t1FallbackColor: MappedPixel
): MappedPixel[][] {
  const mappedData: MappedPixel[][] = Array(M).fill(null).map(() =>
    Array(N).fill({ key: t1FallbackColor.key, color: t1FallbackColor.color })
  )
  const cellWidthOriginal = imgWidth / N
  const cellHeightOriginal = imgHeight / M

  for (let j = 0; j < M; j++) {
    for (let i = 0; i < N; i++) {
      const startXOriginal = Math.floor(i * cellWidthOriginal)
      const startYOriginal = Math.floor(j * cellHeightOriginal)
      const endXOriginal = Math.min(imgWidth, Math.ceil((i + 1) * cellWidthOriginal))
      const endYOriginal = Math.min(imgHeight, Math.ceil((j + 1) * cellHeightOriginal))
      const currentCellWidth = Math.max(1, endXOriginal - startXOriginal)
      const currentCellHeight = Math.max(1, endYOriginal - startYOriginal)

      const representativeRgb = calculateCellRepresentativeColor(
        imageData,
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

    // 发送进度更新（每处理一行发送一次）
    self.postMessage({
      type: 'progress',
      current: j + 1,
      total: M,
      phase: 'pixelate'
    })
  }
  return mappedData
}

function mergeSimilarRegions(
  mappedData: MappedPixel[][],
  threshold: number,
  palette: PaletteColor[]
): MappedPixel[][] {
  if (!mappedData || mappedData.length === 0) return mappedData
  const M = mappedData.length
  const N = mappedData[0].length

  const keyToRgbMap = new Map<string, RgbColor>()
  const keyToColorDataMap = new Map<string, PaletteColor>()
  if (palette) {
    palette.forEach(p => {
      keyToRgbMap.set(p.key, p.rgb)
      keyToColorDataMap.set(p.key, p)
    })
  }

  const initialColorCounts: Record<string, number> = {}
  mappedData.flat().forEach(cell => {
    if (cell && cell.key && !cell.isExternal && cell.key !== TRANSPARENT_KEY) {
      initialColorCounts[cell.key] = (initialColorCounts[cell.key] || 0) + 1
    }
  })

  const colorsByFrequency = Object.entries(initialColorCounts)
    .sort((a, b) => b[1] - a[1])
    .map(entry => entry[0])

  if (colorsByFrequency.length === 0) return mappedData.map(row => row.map(cell => ({ ...cell })))

  const result: MappedPixel[][] = mappedData.map(row => row.map(cell => ({ ...cell, isExternal: cell.isExternal ?? false })))

  const replacedColors = new Set<string>()

  for (let i = 0; i < colorsByFrequency.length; i++) {
    const currentKey = colorsByFrequency[i]
    if (replacedColors.has(currentKey)) continue

    const currentRgb = keyToRgbMap.get(currentKey)
    if (!currentRgb) continue

    for (let j = i + 1; j < colorsByFrequency.length; j++) {
      const lowerFreqKey = colorsByFrequency[j]
      if (replacedColors.has(lowerFreqKey)) continue

      const lowerFreqRgb = keyToRgbMap.get(lowerFreqKey)
      if (!lowerFreqRgb) continue

      const dist = colorDistance(currentRgb, lowerFreqRgb)

      if (dist < threshold) {
        replacedColors.add(lowerFreqKey)

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

    // 发送合并进度
    self.postMessage({
      type: 'progress',
      current: i + 1,
      total: colorsByFrequency.length,
      phase: 'merge'
    })
  }

  return result
}

// ========== Worker 消息处理 ==========

interface ProcessMessage {
  type: 'process'
  imageData: ImageData
  imgWidth: number
  imgHeight: number
  N: number
  M: number
  palette: PaletteColor[]
  mode: PixelationMode
  threshold: number
  fallbackColor: MappedPixel
}

self.onmessage = (e: MessageEvent<ProcessMessage>) => {
  const { imageData, imgWidth, imgHeight, N, M, palette, mode, threshold, fallbackColor } = e.data

  // 清除缓存
  clearOklabCache()

  let result = calculatePixelGrid(imageData, imgWidth, imgHeight, N, M, palette, mode, fallbackColor)

  if (threshold > 0) {
    result = mergeSimilarRegions(result, threshold, palette)
  }

  self.postMessage({
    type: 'result',
    mappedPixelData: result
  })
}
