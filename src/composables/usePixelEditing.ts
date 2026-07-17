import { useBeadStore } from '@/stores/beadStore'
import { useEditorStore } from '@/stores/editorStore'
import { usePaletteStore } from '@/stores/paletteStore'
import { useFocusStore } from '@/stores/focusStore'
import { useUiStore } from '@/stores/uiStore'
import { useImageProcessing } from './useImageProcessing'
import { recalculateColorStats, floodFillErase, replaceAllColor, paintPixel } from '@/utils/pixelation'
import { TRANSPARENT_KEY } from '@/types'
import type { MappedPixel } from '@/types'
import { getColorKeyByHex } from '@/utils/colorSystemUtils'
import { deepCopyGrid } from '@/utils/gridOperations'

export function usePixelEditing() {
  const beadStore = useBeadStore()
  const editorStore = useEditorStore()
  const paletteStore = usePaletteStore()
  const uiStore = useUiStore()
  const { processImage } = useImageProcessing()

  function performSinglePixelPaint(row: number, col: number, newColor: MappedPixel) {
    if (!beadStore.mappedPixelData || !beadStore.colorCounts) return

    const previousCell = beadStore.mappedPixelData[row]?.[col] ? { ...beadStore.mappedPixelData[row][col] } : null
    const { result, changed } = paintPixel(beadStore.mappedPixelData, row, col, newColor)

    if (!changed || !previousCell) return

    const newPixelData = result
    beadStore.setPixelData(newPixelData)

    const newColorCounts = { ...beadStore.colorCounts }
    let newTotalCount = beadStore.totalBeadCount

    if (!previousCell.isExternal && previousCell.key !== TRANSPARENT_KEY) {
      const previousHex = previousCell.color?.toUpperCase()
      if (previousHex && newColorCounts[previousHex]) {
        newColorCounts[previousHex].count--
        if (newColorCounts[previousHex].count <= 0) {
          delete newColorCounts[previousHex]
        }
        newTotalCount--
      }
    }

    if (!newColor.isExternal && newColor.key !== TRANSPARENT_KEY) {
      const newHex = newColor.color.toUpperCase()
      if (!newColorCounts[newHex]) {
        newColorCounts[newHex] = { count: 0, color: newHex }
      }
      newColorCounts[newHex].count++
      newTotalCount++
    }

    beadStore.updateColorStats({ colorCounts: newColorCounts, totalCount: newTotalCount })
  }

  function performFloodFillErase(row: number, col: number, targetKey: string) {
    if (!beadStore.mappedPixelData || !beadStore.gridDimensions) return

    const newPixelData = floodFillErase(
      beadStore.mappedPixelData,
      beadStore.gridDimensions,
      row,
      col,
      targetKey
    )
    beadStore.setPixelData(newPixelData)

    const stats = recalculateColorStats(newPixelData)
    beadStore.updateColorStats(stats)
  }

  function performColorReplace(
    sourceColor: { key: string; color: string },
    targetColor: { key: string; color: string }
  ): number {
    if (!beadStore.mappedPixelData || !beadStore.gridDimensions) return 0

    const { result, count } = replaceAllColor(
      beadStore.mappedPixelData,
      sourceColor.color.toUpperCase(),
      targetColor.key,
      targetColor.color.toUpperCase()
    )
    const newPixelData = result
    const replaceCount = count

    if (replaceCount > 0) {
      beadStore.setPixelData(newPixelData)
      const stats = recalculateColorStats(newPixelData)
      beadStore.updateColorStats(stats)
    }

    return replaceCount
  }

  function selectEditColor(color: { key: string; color: string }) {
    editorStore.selectEditColor(color)
  }

  function handlePaletteColorSelect(colorData: { key: string; color: string }) {
    selectEditColor(colorData)
  }

  function handlePaletteColorReplace(sourceColor: { key: string; color: string }, targetColor: { key: string; color: string }) {
    editorStore.saveSnapshot(beadStore.mappedPixelData || [])
    performColorReplace(sourceColor, targetColor)
    editorStore.resetColorReplaceState()
  }

  function enterFloodFillEraseMode() {
    editorStore.enterFloodFillEraseMode()
  }

  function exitFloodFillEraseMode() {
    editorStore.exitFloodFillEraseMode()
  }

  function enterColorReplaceMode() {
    editorStore.colorReplaceState = {
      isActive: true,
      step: 'select-source',
    }
    editorStore.isEraseMode = false
    editorStore.isFloodFillEraseMode = false
    editorStore.selectedEditColor = null
  }

  function exitColorReplaceMode() {
    editorStore.resetColorReplaceState()
  }

  function handleFloodFillErase(row: number, col: number) {
    if (!beadStore.mappedPixelData || !beadStore.gridDimensions) return
    const cell = beadStore.mappedPixelData[row]?.[col]
    if (!cell || cell.isExternal) return

    editorStore.saveSnapshot(beadStore.mappedPixelData)
    performFloodFillErase(row, col, cell.key)
  }

  function handleColorReplaceClick(row: number, col: number) {
    if (!beadStore.mappedPixelData || !beadStore.gridDimensions) return
    const cell = beadStore.mappedPixelData[row]?.[col]
    if (!cell || cell.isExternal) return

    if (editorStore.colorReplaceState.step === 'select-source') {
      editorStore.colorReplaceState.sourceColor = {
        color: cell.color.toUpperCase(),
        key: getColorKeyByHex(cell.color.toUpperCase(), paletteStore.selectedColorSystem),
      }
      editorStore.colorReplaceState.step = 'select-target'
    } else if (editorStore.colorReplaceState.step === 'select-target') {
      const targetHex = cell.color.toUpperCase()
      const targetKey = getColorKeyByHex(targetHex, paletteStore.selectedColorSystem)
      const sourceHex = editorStore.colorReplaceState.sourceColor?.color

      if (sourceHex === targetHex) {
        exitColorReplaceMode()
        return
      }

      editorStore.saveSnapshot(beadStore.mappedPixelData)
      const sourceColor = {
        key: editorStore.colorReplaceState.sourceColor!.key,
        color: editorStore.colorReplaceState.sourceColor!.color
      }
      const targetColor = { key: targetKey, color: targetHex }
      performColorReplace(sourceColor, targetColor)
      exitColorReplaceMode()
    }
  }

  function handleMagnifierPixelEdit({ row, col, color }: { row: number; col: number; color: { key: string; color: string } | null }) {
    if (!beadStore.mappedPixelData || !beadStore.gridDimensions) return
    editorStore.saveSnapshot(beadStore.mappedPixelData)

    const newData = deepCopyGrid(beadStore.mappedPixelData)
    if (color === null) {
      newData[row][col] = { key: TRANSPARENT_KEY, color: '#FFFFFF', isExternal: true }
    } else {
      newData[row][col] = { key: color.key, color: color.color, isExternal: false }
    }

    beadStore.setPixelData(newData)
    const stats = recalculateColorStats(newData)
    beadStore.updateColorStats(stats)
  }

  function undoEdit() {
    const snapshot = editorStore.undo()
    if (snapshot) {
      beadStore.setPixelData(snapshot)
      const stats = recalculateColorStats(snapshot)
      beadStore.updateColorStats(stats)
      uiStore.showToast('已撤回上一步')
    }
  }

  function redoEdit() {
    const snapshot = editorStore.redo()
    if (snapshot) {
      beadStore.setPixelData(snapshot)
      const stats = recalculateColorStats(snapshot)
      beadStore.updateColorStats(stats)
      uiStore.showToast('已重做上一步')
    }
  }

  return {
    performSinglePixelPaint,
    performFloodFillErase,
    performColorReplace,
    selectEditColor,
    handlePaletteColorSelect,
    handlePaletteColorReplace,
    enterFloodFillEraseMode,
    exitFloodFillEraseMode,
    enterColorReplaceMode,
    exitColorReplaceMode,
    handleFloodFillErase,
    handleColorReplaceClick,
    handleMagnifierPixelEdit,
    undoEdit,
    redoEdit,
  }
}
