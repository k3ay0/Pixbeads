/**
 * 状态持久化 composable
 * 将应用状态保存到 localStorage 并在启动时恢复
 */

import { watch, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useBeadStore } from '@/stores/beadStore'
import { usePaletteStore } from '@/stores/paletteStore'
import { useUiStore } from '@/stores/uiStore'
import type { MappedPixel, GridDimensions, ColorCounts, PixelationMode, ColorSystem } from '@/types'

const STORAGE_KEY = 'pixbeads_app_state'
const AUTO_SAVE_DELAY = 1000 // 自动保存延迟（毫秒）

interface PersistedState {
  // 图片数据
  originalImageSrc: string | null
  // 像素数据
  mappedPixelData: MappedPixel[][] | null
  gridDimensions: GridDimensions | null
  colorCounts: ColorCounts | null
  totalBeadCount: number
  // 控制参数
  granularity: number
  granularityY: number
  similarityThreshold: number
  pixelationMode: PixelationMode
  // 色板设置
  selectedColorSystem: ColorSystem
  customPaletteSelections: Record<string, boolean>
  excludedColorKeys: string[]
  // 模式
  activeMode: string
  // 时间戳
  savedAt: number
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null

/**
 * 延迟保存状态到 localStorage
 */
function debounceSave(state: PersistedState): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout)
  }
  saveTimeout = setTimeout(() => {
    try {
      // 检查数据大小，localStorage 通常限制 5-10MB
      const jsonStr = JSON.stringify(state)
      const sizeInMB = new Blob([jsonStr]).size / (1024 * 1024)

      if (sizeInMB > 4) {
        return
      }

      localStorage.setItem(STORAGE_KEY, jsonStr)
    } catch {
      // 忽略保存失败
    }
  }, AUTO_SAVE_DELAY)
}

/**
 * 从 localStorage 加载状态
 */
function loadPersistedState(): PersistedState | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return null

    const state = JSON.parse(stored) as PersistedState

    // 验证数据完整性
    if (!state.savedAt || typeof state.savedAt !== 'number') {
      return null
    }

    // 检查数据是否过期（7天）
    const maxAge = 7 * 24 * 60 * 60 * 1000
    if (Date.now() - state.savedAt > maxAge) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }

    return state
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

/**
 * 清除持久化状态
 */
export function clearPersistedState(): void {
  localStorage.removeItem(STORAGE_KEY)
}

/**
 * 初始化状态持久化
 */
export function useStatePersistence(): {
  restoreState: () => boolean
  clearState: () => void
} {
  const beadStore = useBeadStore()
  const paletteStore = usePaletteStore()
  const uiStore = useUiStore()

  const {
    originalImageSrc,
    mappedPixelData,
    gridDimensions,
    colorCounts,
    totalBeadCount,
    granularity,
    granularityY,
    similarityThreshold,
    pixelationMode,
  } = storeToRefs(beadStore)

  const {
    selectedColorSystem,
    customPaletteSelections,
    excludedColorKeys,
  } = storeToRefs(paletteStore)

  const { activeMode } = storeToRefs(uiStore)

  /**
   * 设置自动保存 watchers
   */
  function setupAutoSave(): void {
    // 监听关键状态变化
    watch(
      [
        originalImageSrc,
        mappedPixelData,
        gridDimensions,
        colorCounts,
        totalBeadCount,
        granularity,
        granularityY,
        similarityThreshold,
        pixelationMode,
        selectedColorSystem,
        customPaletteSelections,
        excludedColorKeys,
        activeMode,
      ],
      () => {
        // 只在有数据时保存
        if (!mappedPixelData.value || !gridDimensions.value) {
          return
        }

        const state: PersistedState = {
          originalImageSrc: originalImageSrc.value,
          mappedPixelData: mappedPixelData.value,
          gridDimensions: gridDimensions.value,
          colorCounts: colorCounts.value,
          totalBeadCount: totalBeadCount.value,
          granularity: granularity.value,
          granularityY: granularityY.value,
          similarityThreshold: similarityThreshold.value,
          pixelationMode: pixelationMode.value,
          selectedColorSystem: selectedColorSystem.value,
          customPaletteSelections: customPaletteSelections.value,
          excludedColorKeys: Array.from(excludedColorKeys.value),
          activeMode: activeMode.value,
          savedAt: Date.now(),
        }

        debounceSave(state)
      },
      { deep: true }
    )
  }

  /**
   * 从 localStorage 恢复状态
   * @returns 是否成功恢复状态
   */
  function restoreState(): boolean {
    const state = loadPersistedState()
    if (!state) {
      return false
    }

    // 恢复图片数据
    if (state.originalImageSrc) {
      beadStore.setImage(state.originalImageSrc)

      // 从 data URL 创建 Image 对象
      const img = new Image()
      img.onload = () => {
        beadStore.setImage(state.originalImageSrc!, img)
      }
      img.src = state.originalImageSrc
    }

    // 恢复像素数据
    if (state.mappedPixelData && state.gridDimensions) {
      beadStore.setPixelData(state.mappedPixelData, state.gridDimensions)
    }

    // 恢复颜色统计
    if (state.colorCounts) {
      beadStore.updateColorStats({
        colorCounts: state.colorCounts,
        totalCount: state.totalBeadCount,
      })
    }

    // 恢复控制参数
    if (state.granularity !== undefined && state.granularity !== null) {
      beadStore.updateGranularity(state.granularity)
    }
    if (state.granularityY !== undefined && state.granularityY !== null) {
      beadStore.updateGranularityY(state.granularityY)
    }
    if (state.similarityThreshold !== undefined && state.similarityThreshold !== null) {
      beadStore.updateSimilarityThreshold(state.similarityThreshold)
    }
    if (state.pixelationMode) {
      beadStore.pixelationMode = state.pixelationMode
    }

    // 恢复色板设置
    if (state.selectedColorSystem) {
      paletteStore.selectedColorSystem = state.selectedColorSystem
    }
    if (state.customPaletteSelections) {
      paletteStore.customPaletteSelections = state.customPaletteSelections
    }
    if (state.excludedColorKeys) {
      paletteStore.excludedColorKeys = new Set(state.excludedColorKeys)
    }

    // 恢复模式（但不恢复focus模式，因为需要重新初始化）
    if (state.activeMode && state.activeMode !== 'focus') {
      uiStore.switchMode(state.activeMode as any)
    }

    return true
  }

  /**
   * 清除状态
   */
  function clearState(): void {
    clearPersistedState()
  }

  // 在组件挂载时设置自动保存
  onMounted(() => {
    setupAutoSave()
  })

  return {
    restoreState,
    clearState,
  }
}
