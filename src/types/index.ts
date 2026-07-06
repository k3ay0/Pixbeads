// 共享类型定义（移植自 perler-beads + Pixbeads 扩展）

// ========== 像素化相关 ==========

export enum PixelationMode {
  Dominant = 'dominant',
  Average = 'average',
}

export type ColorSystem = 'MARD' | 'COCO' | '漫漫' | '盼盼' | '咪小窝'

export interface RgbColor {
  r: number
  g: number
  b: number
}

export interface PaletteColor {
  key: string
  hex: string
  rgb: RgbColor
}

export interface MappedPixel {
  key: string
  color: string
  isExternal?: boolean
}

// ========== 网格相关 ==========

export interface GridDimensions {
  N: number
  M: number
}

export interface GridPoint {
  row: number
  col: number
}

export interface Point {
  x: number
  y: number
}

// ========== 统计相关 ==========

export interface ColorCount {
  count: number
  color: string
}

export type ColorCounts = Record<string, ColorCount>

// ========== 色板相关 ==========

export type PaletteSelections = Record<string, boolean>

export interface ColorReplaceState {
  isActive: boolean
  step: 'select-source' | 'select-target'
  sourceColor?: { key: string; color: string }
}

// ========== 色号系统映射 ==========

export interface ColorSystemMappingEntry {
  MARD?: string
  COCO?: string
  漫漫?: string
  盼盼?: string
  咪小窝?: string
}

// ========== 下载相关 ==========

export interface GridDownloadOptions {
  showGrid: boolean
  gridInterval: number
  showCoordinates: boolean
  showCellNumbers: boolean
  gridLineColor: string
  includeStats: boolean
  exportPbds: boolean
}

// ========== 像素编辑相关 ==========

export const TRANSPARENT_KEY = 'ERASE'

export const transparentColorData: MappedPixel = {
  key: TRANSPARENT_KEY,
  color: '#FFFFFF',
  isExternal: true,
}
