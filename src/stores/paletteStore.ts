import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { PaletteColor, ColorSystem } from '@/types'
import { getMardToHexMapping, getColorKeyByHex, sortColorsByHue } from '@/utils/colorSystemUtils'
import { hexToRgb } from '@/utils/pixelation'
import { loadPaletteSelections, savePaletteSelections } from '@/utils/localStorageUtils'

export const usePaletteStore = defineStore('palette', () => {
  // ========== 完整色板 ==========
  const mardToHexMapping = getMardToHexMapping()
  const fullBeadPalette = ref<PaletteColor[]>(Object.entries(mardToHexMapping)
    .map(([mardKey, hex]) => {
      const rgb = hexToRgb(hex)
      if (!rgb) return null
      return { key: hex, hex, rgb }
    })
    .filter((c): c is PaletteColor => c !== null))

  // ========== 色板选择状态 ==========
  const selectedColorSystem = ref<ColorSystem>('MARD')
  const customPaletteSelections = ref<Record<string, boolean>>({})
  const excludedColorKeys = ref<Set<string>>(new Set())
  const showExcludedColors = ref(false)

  // ========== 颜色替换映射（原始颜色 → 替换后的颜色） ==========
  const colorReplacementMap = ref<Map<string, string>>(new Map())

  // ========== 被替换像素位置映射（原始颜色 → 被替换的单元格坐标） ==========
  const replacedCellsMap = ref<Map<string, { row: number; col: number }[]>>(new Map())

  // ========== Getters ==========

  const activeBeadPalette = computed(() => {
    return fullBeadPalette.value.filter(color => {
      const hex = color.hex.toUpperCase()
      return customPaletteSelections.value[hex] && !excludedColorKeys.value.has(hex)
    })
  })

  // 像素化用色板：仅按勾选状态过滤，不受排除颜色影响
  // 排除颜色是后处理优化，不应触发重新像素化
  const pixelationPalette = computed(() => {
    return fullBeadPalette.value.filter(color => {
      const hex = color.hex.toUpperCase()
      return customPaletteSelections.value[hex]
    })
  })

  // ========== Actions ==========

  function initPalette() {
    const allHexValues = fullBeadPalette.value.map(c => c.hex.toUpperCase())
    const saved = loadPaletteSelections()

    if (saved) {
      const valid: Record<string, boolean> = {}
      let hasValid = false
      Object.entries(saved).forEach(([key, value]) => {
        if (/^#[0-9A-F]{6}$/i.test(key) && allHexValues.includes(key.toUpperCase())) {
          valid[key.toUpperCase()] = value
          hasValid = true
        }
      })
      if (hasValid) {
        customPaletteSelections.value = valid
      } else {
        initDefaultPalette(allHexValues)
      }
    } else {
      initDefaultPalette(allHexValues)
    }
  }

  function initDefaultPalette(allHexValues: string[]) {
    const selections: Record<string, boolean> = {}
    allHexValues.forEach(hex => { selections[hex.toUpperCase()] = true })
    customPaletteSelections.value = selections
  }

  function toggleExcludeColor(hex: string) {
    const newSet = new Set(excludedColorKeys.value)
    if (newSet.has(hex)) {
      newSet.delete(hex)
    } else {
      newSet.add(hex)
    }
    excludedColorKeys.value = newSet
  }

  function restoreAllExcluded() {
    excludedColorKeys.value = new Set()
    showExcludedColors.value = false
    colorReplacementMap.value = new Map()
    replacedCellsMap.value = new Map()
  }

  /**
   * 清空排除颜色状态（保留像素数据中的替换结果）
   * 用于离开色彩优化界面时重置UI状态
   */
  function clearExcludedState() {
    excludedColorKeys.value = new Set()
    showExcludedColors.value = false
    colorReplacementMap.value = new Map()
    replacedCellsMap.value = new Map()
  }

  function setColorReplacement(originalHex: string, replacedHex: string) {
    colorReplacementMap.value.set(originalHex, replacedHex)
  }

  function deleteColorReplacement(originalHex: string) {
    colorReplacementMap.value.delete(originalHex)
    replacedCellsMap.value.delete(originalHex)
  }

  function setReplacedCells(sourceHex: string, cells: { row: number; col: number }[]) {
    replacedCellsMap.value.set(sourceHex, cells)
  }

  function deleteReplacedCells(sourceHex: string) {
    replacedCellsMap.value.delete(sourceHex)
  }

  function saveSelections() {
    savePaletteSelections(customPaletteSelections.value)
  }

  function loadSelections() {
    const saved = loadPaletteSelections()
    if (saved) {
      customPaletteSelections.value = saved
    }
  }

  function updateSelections(selections: Record<string, boolean>) {
    customPaletteSelections.value = selections
  }

  return {
    // State
    fullBeadPalette,
    selectedColorSystem,
    customPaletteSelections,
    excludedColorKeys,
    showExcludedColors,
    colorReplacementMap,
    replacedCellsMap,
    // Getters
    activeBeadPalette,
    pixelationPalette,
    // Actions
    initPalette,
    initDefaultPalette,
    toggleExcludeColor,
    restoreAllExcluded,
    clearExcludedState,
    setColorReplacement,
    deleteColorReplacement,
    setReplacedCells,
    deleteReplacedCells,
    saveSelections,
    loadSelections,
    updateSelections,
  }
})
