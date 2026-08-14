import { nextTick } from 'vue'
import { useBeadStore } from '@/stores/beadStore'
import { usePaletteStore } from '@/stores/paletteStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { useEditorStore } from '@/stores/editorStore'
import { useUiStore } from '@/stores/uiStore'
import { useVoxelStore } from '@/stores/voxelStore'
import { useComponentStore } from '@/stores/componentStore'
import { importPbds, exportPbds, downloadGridImage, downloadStatsImage, type PbdsVoxelData } from '@/utils/downloader'
import { recalculateColorStats } from '@/utils/pixelation'
import { calculateCenterOffset } from '@/utils/canvasUtils'
import type { MappedPixel, GridDimensions, ColorSystem } from '@/types'

export function useFileIO() {
  const beadStore = useBeadStore()
  const paletteStore = usePaletteStore()
  const canvasStore = useCanvasStore()
  const editorStore = useEditorStore()
  const uiStore = useUiStore()
  const voxelStore = useVoxelStore()
  const componentStore = useComponentStore()

  function triggerFileInput(fileInput: HTMLInputElement | null) {
    uiStore.closeAllMenus()
    fileInput?.click()
  }

  function triggerPbdsInput(pbdsFileInput: HTMLInputElement | null) {
    uiStore.closeAllMenus()
    pbdsFileInput?.click()
  }

  async function loadPbds(file: File) {
    try {
      const result = await importPbds(file)
      return result
    } catch {
      return null
    }
  }

  function handleImportConfirm(data: { mappedPixelData: MappedPixel[][]; gridDimensions: GridDimensions; colorSystem: ColorSystem; voxelData?: PbdsVoxelData }) {
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

    // 新版 pbds：恢复体素编辑信息 + 组件信息（旧版无 voxelData 则跳过）
    if (data.voxelData) {
      const v = data.voxelData.voxel
      voxelStore.setDimensions(v.dimW, v.dimH, v.dimD)
      voxelStore.voxels = new Map(v.voxels)
      voxelStore.layerNames = new Map(v.layerNames)
      voxelStore.layerVisibility = new Map(v.layerVisibility)
      voxelStore.currentAxis = v.currentAxis
      voxelStore.currentZ = v.currentZ
      componentStore.importComponents(data.voxelData.components)
    }

    uiStore.showImportDialog = false

    nextTick(() => {
      canvasStore.resetViewToCenter()
    })
  }

  function handleCropConfirm(canvas: HTMLCanvasElement) {
    beadStore.setCroppedCanvas(canvas)
    const aspectRatio = canvas.height / canvas.width
    const defaultY = Math.max(1, Math.round(beadStore.granularity * aspectRatio))
    beadStore.updateGranularityY(defaultY)
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

    // 组装体素编辑信息 + 组件信息（写入 pbds 包内 voxelData.json）
    const voxelData: PbdsVoxelData = {
      version: '1.0',
      voxel: {
        dimW: voxelStore.dimW,
        dimH: voxelStore.dimH,
        dimD: voxelStore.dimD,
        voxels: Array.from(voxelStore.voxels.entries()),
        layerNames: Array.from(voxelStore.layerNames.entries()),
        layerVisibility: Array.from(voxelStore.layerVisibility.entries()),
        currentAxis: voxelStore.currentAxis,
        currentZ: voxelStore.currentZ,
      },
      components: componentStore.components,
    }

    await exportPbds({
      mappedPixelData: beadStore.mappedPixelData,
      gridDimensions: beadStore.gridDimensions,
      colorCounts: beadStore.colorCounts,
      totalBeadCount: beadStore.totalBeadCount,
      selectedColorSystem: paletteStore.selectedColorSystem,
      voxelData,
    })
    uiStore.showToast('导出成功')
  }

  return {
    triggerFileInput,
    triggerPbdsInput,
    loadPbds,
    handleImportConfirm,
    handleCropConfirm,
    handleDownloadGrid,
    handleDownloadImage,
    handleDownloadStats,
    handleExportPbds,
  }
}
