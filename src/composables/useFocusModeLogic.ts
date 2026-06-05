import { watch, computed } from 'vue'
import { useBeadStore } from '@/stores/beadStore'
import { usePaletteStore } from '@/stores/paletteStore'
import { useFocusStore } from '@/stores/focusStore'

export function useFocusModeLogic() {
  const beadStore = useBeadStore()
  const paletteStore = usePaletteStore()
  const focusStore = useFocusStore()

  function initFocusMode() {
    focusStore.initFocusMode(
      beadStore.mappedPixelData,
      beadStore.colorCounts,
      paletteStore.selectedColorSystem
    )
  }

  function handleCellClick(row: number, col: number) {
    focusStore.handleCellClick(row, col, beadStore.mappedPixelData)
  }

  function handleFocusColorChange(color: string) {
    focusStore.handleFocusColorChange(color)
  }

  function handleLocateRecommended() {
    focusStore.handleLocateRecommended(beadStore.gridDimensions)
  }

  // 监听推荐区域变化
  watch(
    () => focusStore.guidanceMode,
    () => {
      focusStore.calculateRecommendedRegion(beadStore.mappedPixelData)
    }
  )

  return {
    initFocusMode,
    handleCellClick,
    handleFocusColorChange,
    handleLocateRecommended,
  }
}
