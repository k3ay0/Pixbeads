/**
 * 手动编辑状态管理 composable
 * Ported from perler-beads React project
 * 使用 Vue 3 Composition API 重写
 */
import { ref } from 'vue'
import type { Ref } from 'vue'
import type { MappedPixel, ColorReplaceState } from '@/types'

/** 透明/擦除颜色的特殊键 */
const TRANSPARENT_KEY = 'ERASE'

interface ColorData {
  key: string
  color: string
  isExternal?: boolean
}

interface ManualEditingStateReturn {
  isManualColoringMode: Ref<boolean>
  selectedColor: Ref<ColorData | null>
  isEraseMode: Ref<boolean>
  colorReplaceState: Ref<ColorReplaceState>
  highlightColorKey: Ref<string | null>
  enterManualMode: () => void
  exitManualMode: () => void
  toggleEraseMode: () => void
  toggleColorReplaceMode: () => void
  selectColor: (colorData: ColorData) => void
  selectSourceColorFromCanvas: (colorData: { key: string; color: string }) => void
  completeColorReplace: () => void
  setHighlight: (colorHex: string) => void
  clearHighlight: () => void
}

/**
 * 手动编辑状态管理 composable
 *
 * @returns 包含所有状态 ref 和操作函数
 */
export function useManualEditingState(): ManualEditingStateReturn {
  // ---- 状态 ----

  /** 是否处于手动上色模式 */
  const isManualColoringMode = ref<boolean>(false)

  /** 当前选中的颜色（MappedPixel 格式） */
  const selectedColor = ref<ColorData | null>(null)

  /** 是否处于一键擦除模式 */
  const isEraseMode = ref<boolean>(false)

  /** 颜色替换状态 */
  const colorReplaceState = ref<ColorReplaceState>({
    isActive: false,
    step: 'select-source',
  })

  /** 高亮颜色的 hex 值 */
  const highlightColorKey = ref<string | null>(null)

  // ---- 重置辅助 ----

  /** 重置颜色替换相关状态 */
  function resetColorReplaceState(): void {
    colorReplaceState.value = {
      isActive: false,
      step: 'select-source',
    }
  }

  // ---- 操作函数 ----

  /** 进入手动编辑模式 */
  function enterManualMode(): void {
    isManualColoringMode.value = true
    selectedColor.value = null
    isEraseMode.value = false
    resetColorReplaceState()
    highlightColorKey.value = null
  }

  /** 退出手动编辑模式 */
  function exitManualMode(): void {
    isManualColoringMode.value = false
    selectedColor.value = null
    isEraseMode.value = false
    resetColorReplaceState()
    highlightColorKey.value = null
  }

  /** 切换擦除模式 */
  function toggleEraseMode(): void {
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
  function toggleColorReplaceMode(): void {
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
   * @param colorData 颜色数据
   */
  function selectColor(colorData: ColorData): void {
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
   * @param colorData 颜色数据
   */
  function selectSourceColorFromCanvas(colorData: { key: string; color: string }): void {
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
  function completeColorReplace(): void {
    resetColorReplaceState()
    highlightColorKey.value = null
  }

  /**
   * 设置高亮颜色
   * @param colorHex 颜色 hex 值
   */
  function setHighlight(colorHex: string): void {
    highlightColorKey.value = colorHex
  }

  /** 清除高亮 */
  function clearHighlight(): void {
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
