/**
 * localStorage 色板选择状态管理
 * Ported from perler-beads React project
 */

const STORAGE_KEY = 'pixbeads_palette'

/**
 * @typedef {Object<string, boolean>} PaletteSelections
 */

/**
 * 保存自定义色板选择状态到 localStorage
 * @param {PaletteSelections} selections 选择状态对象
 */
export function savePaletteSelections(selections) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selections))
  } catch (error) {
    console.error('无法保存色板选择到本地存储:', error)
  }
}

/**
 * 从 localStorage 加载自定义色板选择状态
 * @returns {PaletteSelections | null} 选择状态对象或 null
 */
export function loadPaletteSelections() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (error) {
    console.error('无法从本地存储加载色板选择:', error)
    localStorage.removeItem(STORAGE_KEY) // 清除无效数据
  }
  return null
}

/**
 * 将预设色板转换为选择状态对象（基于 hex 值）
 * @param {string[]} allHexValues 所有可选的 hex 值
 * @param {string[]} presetHexValues 预设的 hex 值
 * @returns {PaletteSelections} 选择状态对象
 */
export function presetToSelections(allHexValues, presetHexValues) {
  const presetSet = new Set(presetHexValues.map(hex => hex.toUpperCase()))
  const selections = {}

  allHexValues.forEach(hex => {
    const normalizedHex = hex.toUpperCase()
    selections[normalizedHex] = presetSet.has(normalizedHex)
  })

  return selections
}

/**
 * 根据 MARD 色号预设生成基于 hex 值的选择状态（用于兼容旧预设）
 * @param {Array<{ key: string; hex: string }>} allBeadPalette 所有珠子调色板
 * @param {string[]} presetKeys 预设的 MARD 色号
 * @returns {PaletteSelections} 选择状态对象
 */
export function presetKeysToHexSelections(allBeadPalette, presetKeys) {
  const presetKeySet = new Set(presetKeys)
  const selections = {}
  const processedHexValues = new Set()

  console.log(
    `presetKeysToHexSelections: 输入调色板大小 ${allBeadPalette.length}, 预设键数量 ${presetKeys.length}`
  )

  allBeadPalette.forEach(color => {
    const normalizedHex = color.hex.toUpperCase()

    // 检查是否已经处理过这个 hex 值
    if (processedHexValues.has(normalizedHex)) {
      console.warn(`重复的hex值: ${normalizedHex}, MARD键: ${color.key}`)
      return // 跳过重复的 hex 值
    }

    processedHexValues.add(normalizedHex)
    selections[normalizedHex] = presetKeySet.has(color.key)
  })

  const selectedCount = Object.values(selections).filter(Boolean).length
  console.log(
    `presetKeysToHexSelections: 生成选择对象，总数 ${Object.keys(selections).length}, 选中 ${selectedCount}`
  )

  return selections
}
