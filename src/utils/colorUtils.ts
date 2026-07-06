// 颜色计算共享模块
// 从 pixelation.ts 和 downloader.ts 中提取的纯颜色工具函数

import type { RgbColor, PaletteColor } from '@/types'

/**
 * Hex 字符串转 RGB
 */
export function hexToRgb(hex: string): RgbColor | null {
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
 * sRGB 通道转线性值
 */
function srgbChannelToLinear(channel: number): number {
  const normalized = channel / 255
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4)
}

/**
 * RGB 转 Oklab 色彩空间
 */
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

/** Oklab 缓存，避免重复计算 */
const oklabCache: Map<string, { l: number; a: number; b: number }> = new Map()

/** 清除 Oklab 缓存（Worker 处理前调用） */
export function clearOklabCache(): void {
  oklabCache.clear()
}

/**
 * 获取 Oklab 值（带缓存）
 */
function getOklabColor(rgb: RgbColor): { l: number; a: number; b: number } {
  const cacheKey = `${rgb.r},${rgb.g},${rgb.b}`
  const cached = oklabCache.get(cacheKey)
  if (cached) return cached
  const oklab = rgbToOklab(rgb)
  oklabCache.set(cacheKey, oklab)
  return oklab
}

/**
 * 基于 Oklab 色彩空间计算两个颜色之间的感知距离
 */
export function colorDistance(rgb1: RgbColor, rgb2: RgbColor): number {
  const oklab1 = getOklabColor(rgb1)
  const oklab2 = getOklabColor(rgb2)
  const dl = oklab1.l - oklab2.l
  const da = oklab1.a - oklab2.a
  const db = oklab1.b - oklab2.b
  return Math.sqrt(dl * dl + da * da + db * db) * 100
}

/**
 * 在调色板中找到最接近目标颜色的颜色
 */
export function findClosestPaletteColor(targetRgb: RgbColor, palette: PaletteColor[]): PaletteColor {
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
 * 获取对比色（黑/白），支持简写 hex
 */
export function getContrastColor(hex: string): string {
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
 * 判断颜色是否为亮色（ITU-R BT.709 亮度公式）
 */
export function isLightColor(hex: string): boolean {
  const rgb = hexToRgb(hex)
  if (!rgb) return false
  return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255 > 0.5
}
