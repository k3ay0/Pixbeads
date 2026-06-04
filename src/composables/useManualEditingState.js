/**
 * 手动编辑状态管理 composable
 * Ported from perler-beads React project
 * 使用 Vue 3 Composition API 重写
 */
import { ref } from 'vue'

/** 透明/擦除颜色的特殊键 */
const TRANSPARENT_KEY = 'ERASE'

/**
 * 手动编辑状态管理 composable
 *
 * @returns {Object} 包含所有状态 ref 和操作函数
 */
export function useManualEditingState() {
  // ---- 状态 ----

  /** 是否处于手动上色模式 */
  const isManualColoringMode = ref(false)

  /** 当前选中的颜色（MappedPixel 格式） */
  const selectedColor = ref(null)

  /** 是否处于一键擦除模式 */
  const isEraseMode = ref(false)

  /**
   * 颜色替换状态
   * @type {import('vue').Ref<{
   *   isActive: boolean;
   *   step: 'select-source' | 'select-target';
   *   sourceColor?: { key: string; color: string };
   * }>}
   */
  const colorReplaceState = ref({
    isActive: false,
    step: 'select-source',
  })

  /** 高亮颜色的 hex 值 */
  const highlightColorKey = ref(null)

  // ---- 重置辅助 ----

  /** 重置颜色替换相关状态 */
  function resetColorReplaceState() {
    colorReplaceState.value = {
      isActive: false,
      step: 'select-source',
    }
  }

  // ---- 操作函数 ----

  /** 进入手动编辑模式 */
  function enterManualMode() {
    isManualColoringMode.value = true
    selectedColor.value = null
    isEraseMode.value = false
    resetColorReplaceState()
    highlightColorKey.value = null
  }

  /** 退出手动编辑模式 */
  function exitManualMode() {
    isManualColoringMode.value = false
    selectedColor.value = null
    isEraseMode.value = false
    resetColorReplaceState()
    highlightColorKey.value = null
  }

  /** 切换擦除模式 */
  function toggleEraseMode() {
    if (!isManualColoringMode.value) return

    // 如果当前在颜色替换模式，退出替换模式
    if (colorReplaceState.value.isActive) {
      resetColorReplaceState()
      highlightColorKey.value = null
    }

    isEraseMode.value = !isEraseMode.value
    if (isEraseMode.value) {
      selectedColor.value = null
    }
  }

  /** 切换颜色替换模式 */
  function toggleColorReplaceMode() {
    if (colorReplaceState.value.isActive) {
      // 退出替换模式
      resetColorReplaceState()
      highlightColorKey.value = null
    } else {
      // 进入替换模式
      isEraseMode.value = false
      selectedColor.value = null
      colorReplaceState.value = {
        isActive: true,
        step: 'select-source',
      }
    }
  }

  /**
   * 选择颜色
   * @param {{ key: string; color: string; isExternal?: boolean }} colorData 颜色数据
   */
  function selectColor(colorData) {
    // 如果选择的是橡皮擦且当前在颜色替换模式，退出替换模式
    if (colorData.key === TRANSPARENT_KEY && colorReplaceState.value.isActive) {
      resetColorReplaceState()
      highlightColorKey.value = null
    }

    // 选择任何颜色时，都应该退出一键擦除模式
    if (isEraseMode.value) {
      isEraseMode.value = false
    }

    selectedColor.value = colorData
  }

  /**
   * 从画布选择源颜色（用于颜色替换）
   * @param {{ key: string; color: string }} colorData 颜色数据
   */
  function selectSourceColorFromCanvas(colorData) {
    const state = colorReplaceState.value
    if (state.isActive && state.step === 'select-source') {
      highlightColorKey.value = colorData.color
      colorReplaceState.value = {
        isActive: true,
        step: 'select-target',
        sourceColor: colorData,
      }
    }
  }

  /** 完成颜色替换 */
  function completeColorReplace() {
    resetColorReplaceState()
    highlightColorKey.value = null
  }

  /**
   * 设置高亮颜色
   * @param {string} colorHex 颜色 hex 值
   */
  function setHighlight(colorHex) {
    highlightColorKey.value = colorHex
  }

  /** 清除高亮 */
  function clearHighlight() {
    highlightColorKey.value = null
  }

  return {
    // 状态（ref，可直接解构使用 .value）
    isManualColoringMode,
    selectedColor,
    isEraseMode,
    colorReplaceState,
    highlightColorKey,

    // 操作函数
    enterManualMode,
    exitManualMode,
    toggleEraseMode,
    toggleColorReplaceMode,
    selectColor,
    selectSourceColorFromCanvas,
    completeColorReplace,
    setHighlight,
    clearHighlight,
  }
}
