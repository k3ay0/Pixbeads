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
  const showPaletteEditor = ref(false)
  const showExcludedColors = ref(false)

  // ========== Getters ==========

  const activeBeadPalette = computed(() => {
    return fullBeadPalette.value.filter(color => {
      const hex = color.hex.toUpperCase()
      return customPaletteSelections.value[hex] && !excludedColorKeys.value.has(hex)
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
    showPaletteEditor,
    showExcludedColors,
    // Getters
    activeBeadPalette,
    // Actions
    initPalette,
    initDefaultPalette,
    toggleExcludeColor,
    restoreAllExcluded,
    saveSelections,
    loadSelections,
    updateSelections,
  }
})
