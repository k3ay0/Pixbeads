import { nextTick } from 'vue'
import { useBeadStore } from '@/stores/beadStore'
import { usePaletteStore } from '@/stores/paletteStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { useEditorStore } from '@/stores/editorStore'
import { useUiStore } from '@/stores/uiStore'
import { importPbds, exportPbds, downloadGridImage, downloadStatsImage } from '@/utils/downloader'
import { recalculateColorStats } from '@/utils/pixelation'
import { calculateCenterOffset } from '@/utils/canvasUtils'
import type { MappedPixel, GridDimensions, ColorSystem } from '@/types'

export function useFileIO() {
  const beadStore = useBeadStore()
  const paletteStore = usePaletteStore()
  const canvasStore = useCanvasStore()
  const editorStore = useEditorStore()
  const uiStore = useUiStore()

  function triggerFileInput(fileInput: HTMLInputElement | null) {
    uiStore.closeAllMenus()
    fileInput?.click()
  }

  function triggerPbdsInput(pbdsFileInput: HTMLInputElement | null) {
    uiStore.closeAllMenus()
    pbdsFileInput?.click()
  }

  function loadImage(file: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      beadStore.setImage(e.target?.result as string)
      editorStore.clearBgRemovalSnapshot()
      beadStore.updateGranularityY(0)

      const img = new Image()
      img.onload = () => {
        beadStore.originalImage = img
        beadStore.showCropper = true
      }
      img.src = e.target?.result as string
    }
    reader.readAsDataURL(file)
  }

  async function loadPbds(file: File) {
    try {
      const result = await importPbds(file)
      return result
    } catch {
      return null
    }
  }

  function handleImportConfirm(data: { mappedPixelData: MappedPixel[][]; gridDimensions: GridDimensions; colorSystem: ColorSystem }) {
    beadStore.setPixelData(data.mappedPixelData, data.gridDimensions)
    paletteStore.selectedColorSystem = data.colorSystem
    beadStore.originalImageSrc = null
    beadStore.originalImage = null
    editorStore.clearBgRemovalSnapshot()

    const stats = recalculateColorStats(data.mappedPixelData)
    beadStore.updateColorStats(stats)

    editorStore.clearHistory()
    editorStore.saveSnapshot(data.mappedPixelData)

    beadStore.updateGranularity(data.gridDimensions.N)

    uiStore.showImportDialog = false

    nextTick(() => {
      canvasStore.resetViewToCenter()
    })
  }

  function handleCropConfirm(canvas: HTMLCanvasElement) {
    beadStore.setCroppedCanvas(canvas)
    beadStore.showCropper = false
    const aspectRatio = canvas.height / canvas.width
    const defaultY = Math.max(1, Math.round(beadStore.granularity * aspectRatio))
    beadStore.updateGranularityY(defaultY)
  }

  function handleCropSkip() {
    beadStore.setCroppedCanvas(null)
    beadStore.showCropper = false
    beadStore.updateGranularityY(0)
  }

  function handleDownloadGrid() {
    downloadGridImage({
      mappedPixelData: beadStore.mappedPixelData,
      gridDimensions: beadStore.gridDimensions,
      colorCounts: beadStore.colorCounts,
      totalBeadCount: beadStore.totalBeadCount,
      selectedColorSystem: paletteStore.selectedColorSystem,
      options: uiStore.downloadOptions,
    })

    if (uiStore.downloadOptions.exportPbds) {
      handleExportPbds()
    }
  }

  function handleDownloadImage() {
    uiStore.closeAllMenus()
    uiStore.showDownloadModal = true
  }

  function handleDownloadStats() {
    uiStore.closeAllMenus()
    downloadStatsImage({
      colorCounts: beadStore.colorCounts,
      totalBeadCount: beadStore.totalBeadCount,
      selectedColorSystem: paletteStore.selectedColorSystem,
    })
  }

  async function handleExportPbds() {
    uiStore.closeAllMenus()
    await exportPbds({
      mappedPixelData: beadStore.mappedPixelData,
      gridDimensions: beadStore.gridDimensions,
      colorCounts: beadStore.colorCounts,
      totalBeadCount: beadStore.totalBeadCount,
      selectedColorSystem: paletteStore.selectedColorSystem,
    })
    uiStore.showToast('导出成功')
  }

  function handleFileDrop(e: DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer?.files?.[0]
    if (!file) return
    if (file.name.toLowerCase().endsWith('.pbds')) {
      loadPbds(file)
    } else if (file.type.startsWith('image/')) {
      loadImage(file)
    }
  }

  function handleFileChange(e: Event) {
    const file = (e.target as HTMLInputElement)?.files?.[0]
    if (!file) return
    loadImage(file)
  }

  function handlePbdsFileChange(e: Event) {
    const file = (e.target as HTMLInputElement)?.files?.[0]
    if (!file) return
    loadPbds(file)
  }

  return {
    triggerFileInput,
    triggerPbdsInput,
    loadImage,
    loadPbds,
    handleImportConfirm,
    handleCropConfirm,
    handleCropSkip,
    handleDownloadGrid,
    handleDownloadImage,
    handleDownloadStats,
    handleExportPbds,
    handleFileDrop,
    handleFileChange,
    handlePbdsFileChange,
  }
}
