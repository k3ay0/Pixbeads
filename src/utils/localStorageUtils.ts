/**
 * localStorage 色板选择状态管理
 * Ported from perler-beads React project
 */

import type { PaletteSelections } from '@/types'

const STORAGE_KEY = 'pixbeads_palette'

/**
 * 保存自定义色板选择状态到 localStorage
 */
export function savePaletteSelections(selections: PaletteSelections): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selections))
  } catch {
    // 忽略保存失败
  }
}

/**
 * 从 localStorage 加载自定义色板选择状态
 */
export function loadPaletteSelections(): PaletteSelections | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored) as PaletteSelections
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY) // 清除无效数据
  }
  return null
}
