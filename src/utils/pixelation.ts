import type {
  RgbColor,
  PaletteColor,
  MappedPixel,
  GridDimensions,
  ColorCounts,
  ColorCount,
} from '@/types'
import {
  TRANSPARENT_KEY,
  transparentColorData,
} from '@/types'
import { PixelationMode } from '@/types'
import { hexToRgb, colorDistance, findClosestPaletteColor } from './colorUtils'
import { deepCopyGrid, floodFillArea } from './gridOperations'

// 重新导出 hexToRgb，供 paletteStore 等外部模块使用
export { hexToRgb }

// srgbChannelToLinear 和 rgbToOklab 仅供 getDominantColorByArea 内部使用
function srgbChannelToLinear(channel: number): number {
  const normalized = channel / 255
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4)
}

function rgbToOklab(rgb: RgbColor): { l: number; a: number; b: number } {
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

export function calculatePixelGrid(
  originalCtx: CanvasRenderingContext2D,
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

  let fullImageData: ImageData | null = null
  try {
    fullImageData = originalCtx.getImageData(0, 0, imgWidth, imgHeight)
  } catch {
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

export function mergeSimilarRegions(
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

  if (colorsByFrequency.length === 0) return deepCopyGrid(mappedData)

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
  }

  return result
}

export function removeBackground(mappedData: MappedPixel[][], backgroundKeys: string[]): MappedPixel[][] {
  if (!mappedData || mappedData.length === 0) return mappedData
  const M = mappedData.length
  const N = mappedData[0].length
  const dimensions: GridDimensions = { N, M }
  const bgSet = new Set(backgroundKeys.map(bk => bk.toUpperCase()))

  let result = deepCopyGrid(mappedData)

  // 从所有边界单元格开始洪水填充
  for (let i = 0; i < N; i++) {
    result = floodFillArea(result, dimensions, 0, i,
      (cell) => !cell.isExternal && bgSet.has(cell.color.toUpperCase()),
      (cell) => ({ ...cell, isExternal: true })
    )
    result = floodFillArea(result, dimensions, M - 1, i,
      (cell) => !cell.isExternal && bgSet.has(cell.color.toUpperCase()),
      (cell) => ({ ...cell, isExternal: true })
    )
  }
  for (let j = 0; j < M; j++) {
    result = floodFillArea(result, dimensions, j, 0,
      (cell) => !cell.isExternal && bgSet.has(cell.color.toUpperCase()),
      (cell) => ({ ...cell, isExternal: true })
    )
    result = floodFillArea(result, dimensions, j, N - 1,
      (cell) => !cell.isExternal && bgSet.has(cell.color.toUpperCase()),
      (cell) => ({ ...cell, isExternal: true })
    )
  }

  return result
}

export function replaceAllColor(
  mappedData: MappedPixel[][],
  sourceHex: string,
  targetKey: string,
  targetColor: string
): { result: MappedPixel[][]; count: number } {
  const result: MappedPixel[][] = deepCopyGrid(mappedData)
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

export function paintPixel(
  mappedData: MappedPixel[][],
  row: number,
  col: number,
  newColor: MappedPixel
): { result: MappedPixel[][]; changed: boolean } {
  const result: MappedPixel[][] = deepCopyGrid(mappedData)
  const old = result[row]?.[col]
  if (!old) return { result: mappedData, changed: false }
  const changed = old.key !== newColor.key || old.isExternal !== newColor.isExternal
  if (changed) result[row][col] = { ...newColor }
  return { result, changed }
}

export function floodFillErase(
  mappedData: MappedPixel[][],
  gridDimensions: GridDimensions,
  startRow: number,
  startCol: number,
  targetKey: string
): MappedPixel[][] {
  return floodFillArea(
    mappedData,
    gridDimensions,
    startRow,
    startCol,
    (cell) => cell.key === targetKey && !cell.isExternal,
    () => ({ ...transparentColorData })
  )
}

export function floodFill(
  mappedData: MappedPixel[][],
  gridDimensions: GridDimensions,
  startRow: number,
  startCol: number,
  fillColor: { key: string; color: string }
): MappedPixel[][] {
  const startCell = mappedData[startRow]?.[startCol]
  if (!startCell || startCell.isExternal) return mappedData
  const targetColor = startCell.color.toUpperCase()
  // 如果填充色和目标色相同，不做任何事
  if (fillColor.color.toUpperCase() === targetColor) return mappedData

  return floodFillArea(
    mappedData,
    gridDimensions,
    startRow,
    startCol,
    (cell) => !cell.isExternal && cell.color.toUpperCase() === targetColor,
    () => ({ key: fillColor.key, color: fillColor.color, isExternal: false })
  )
}

export function recalculateColorStats(
  mappedData: MappedPixel[][]
): { colorCounts: ColorCounts; totalCount: number } {
  const colorCounts: ColorCounts = {}
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

// ========== 区域主色提取 ==========

export interface DominantColorOptions {
  blackMax?: number;
  whiteMin?: number;
  ratioThreshold?: number;
  forceIgnoreBlackWhite?: boolean;
  step?: number; // 颜色量化步长
}

export function getDominantColorByArea(
  imageData: ImageData,
  borderTrim: number = 0,
  options: DominantColorOptions = {}
): string {
  const {
    blackMax = 60,
    whiteMin = 200,
    ratioThreshold = 0.2,
    forceIgnoreBlackWhite = false,
    step = 16, // 默认步长16
  } = options;

  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;

  const startX = Math.max(0, Math.floor(borderTrim));
  const startY = Math.max(0, Math.floor(borderTrim));
  const endX = Math.min(width, Math.ceil(width - borderTrim));
  const endY = Math.min(height, Math.ceil(height - borderTrim));

  // Step 1: Count black/white pixels and total valid pixels
  let totalPixels = 0;
  let blackWhitePixels = 0;

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      if (a < 128) continue;
      totalPixels++;

      const isBlack = r <= blackMax && g <= blackMax && b <= blackMax;
      const isWhite = r >= whiteMin && g >= whiteMin && b >= whiteMin;
      if (isBlack || isWhite) {
        blackWhitePixels++;
      }
    }
  }

  if (totalPixels === 0) {
    return "rgb(0, 0, 0)";
  }

  // Step 2: Determine whether to ignore black/white pixels
  const blackWhiteRatio = blackWhitePixels / totalPixels;
  const shouldIgnoreBlackWhite = forceIgnoreBlackWhite || blackWhiteRatio < ratioThreshold;

  // Step 3: Count colors with quantization
  const colorMap = new Map<string, number>();

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      if (a < 128) continue;

      if (shouldIgnoreBlackWhite) {
        const isBlack = r <= blackMax && g <= blackMax && b <= blackMax;
        const isWhite = r >= whiteMin && g >= whiteMin && b >= whiteMin;
        if (isBlack || isWhite) continue;
      }

      const qr = Math.min(255, Math.round(r / step) * step);
      const qg = Math.min(255, Math.round(g / step) * step);
      const qb = Math.min(255, Math.round(b / step) * step);
      const key = `${qr},${qg},${qb}`;

      colorMap.set(key, (colorMap.get(key) || 0) + 1);
    }
  }

  // Step 3.5: Merge similar colors in Oklab space
  const mergeThreshold = 0.25;
  const entries = Array.from(colorMap.entries());
  const mergedMap = new Map<string, number>();
  const labCache = new Map<string, { l: number; a: number; b: number }>();

  for (const [key, count] of entries) {
    const [cr, cg, cb] = key.split(',').map(Number);
    const rgb = { r: cr, g: cg, b: cb };
    const lab = rgbToOklab(rgb);
    let mergedKey = key;
    for (const [existingKey] of mergedMap) {
      const existingLab = labCache.get(existingKey)!;
      const dl = lab.l - existingLab.l;
      const da = lab.a - existingLab.a;
      const db = lab.b - existingLab.b;
      const dist = Math.sqrt(dl * dl + da * da + db * db);
      if (dist < mergeThreshold) {
        mergedKey = existingKey;
        break;
      }
    }
    if (mergedKey === key) {
      labCache.set(key, lab);
    }
    mergedMap.set(mergedKey, (mergedMap.get(mergedKey) || 0) + count);
  }

  // Step 4: Find the most frequent color in merged map
  let maxCount = 0;
  let dominantColor = "0,0,0";

  for (const [color, count] of mergedMap.entries()) {
    if (count > maxCount) {
      maxCount = count;
      dominantColor = color;
    }
  }

  if (maxCount === 0) {
    return "rgb(0, 0, 0)";
  }

  const [r, g, b] = dominantColor.split(",").map(Number);
  return `rgb(${r}, ${g}, ${b})`;
}
