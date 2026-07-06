// 色号系统工具函数
import type { ColorSystem, ColorSystemMappingEntry } from '@/types'
import colorSystemMappingJson from '../data/colorSystemMapping.json'

const colorSystemMapping = colorSystemMappingJson as unknown as Record<string, ColorSystemMappingEntry>

// 色号系统选项
export const colorSystemOptions = [
  { key: 'MARD', name: 'MARD' },
  { key: 'COCO', name: 'COCO' },
  { key: '漫漫', name: '漫漫' },
  { key: '盼盼', name: '盼盼' },
  { key: '咪小窝', name: '咪小窝' },
]

/**
 * 获取所有 MARD 色号到 hex 的映射
 */
export function getMardToHexMapping(): Record<string, string> {
  const mapping: Record<string, string> = {}
  Object.entries(colorSystemMapping).forEach(([hex, colorData]) => {
    const mardKey = colorData.MARD
    if (mardKey) mapping[mardKey] = hex
  })
  return mapping
}

/**
 * 通过 hex 值获取指定色号系统的色号
 */
export function getColorKeyByHex(hexValue: string, colorSystem: ColorSystem): string {
  const normalizedHex = hexValue.toUpperCase()
  const mapping = colorSystemMapping[normalizedHex]
  if (mapping && mapping[colorSystem]) return mapping[colorSystem]
  return '?'
}

/**
 * 将 hex 颜色转换为 HSL
 */
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const cleanHex = hex.replace('#', '')
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const diff = max - min

  let h = 0, s = 0
  const l = (max + min) / 2

  if (diff !== 0) {
    s = l > 0.5 ? diff / (2 - max - min) : diff / (max + min)
    switch (max) {
      case r: h = ((g - b) / diff + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / diff + 2) / 6; break
      case b: h = ((r - g) / diff + 4) / 6; break
    }
  }
  return { h: h * 360, s: s * 100, l: l * 100 }
}

/**
 * 按色相排序颜色
 */
export function sortColorsByHue<T extends { color: string }>(colors: T[]): T[] {
  return colors.slice().sort((a, b) => {
    const hslA = hexToHsl(a.color)
    const hslB = hexToHsl(b.color)
    if (Math.abs(hslA.h - hslB.h) > 5) return hslA.h - hslB.h
    if (Math.abs(hslA.l - hslB.l) > 3) return hslB.l - hslA.l
    return hslB.s - hslA.s
  })
}