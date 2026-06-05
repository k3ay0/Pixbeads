import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { MappedPixel, GridDimensions, ColorCounts } from '@/types'
import { PixelationMode } from '@/types'
import type { ColorSystem } from '@/types'
import type { ProcessProgress } from '@/utils/workerManager'

export const useBeadStore = defineStore('bead', () => {
  // ========== 图片相关 ==========
  const originalImageSrc = ref<string | null>(null)
  const originalImage = ref<HTMLImageElement | null>(null)
  const showCropper = ref(false)
  const croppedImageCanvas = ref<HTMLCanvasElement | null>(null)

  // ========== 像素数据 ==========
  const mappedPixelData = ref<MappedPixel[][] | null>(null)
  const gridDimensions = ref<GridDimensions | null>(null)
  const colorCounts = ref<ColorCounts | null>(null)
  const totalBeadCount = ref(0)

  // ========== 控制参数 ==========
  const granularity = ref(50)
  const granularityInput = ref('50')
  const granularityY = ref(0)
  const granularityYInput = ref('0')
  const lockAspectRatio = ref(false)
  const similarityThreshold = ref(30)
  const similarityThresholdInput = ref('30')
  const pixelationMode = ref<PixelationMode>(PixelationMode.Dominant)

  // ========== 处理状态 ==========
  const isProcessing = ref(false)
  const processingProgress = ref<ProcessProgress | null>(null)
  const isCropProcessing = ref(false)

  // ========== Actions ==========

  function setImage(src: string, img: HTMLImageElement | null = null) {
    originalImageSrc.value = src
    originalImage.value = img
    croppedImageCanvas.value = null
  }

  function setCroppedCanvas(canvas: HTMLCanvasElement | null) {
    croppedImageCanvas.value = canvas
  }

  function setPixelData(data: MappedPixel[][] | null, dimensions: GridDimensions | null = null) {
    mappedPixelData.value = data
    if (dimensions) {
      gridDimensions.value = dimensions
    }
  }

  function updateGranularity(value: number) {
    granularity.value = value
    granularityInput.value = value.toString()
  }

  function updateGranularityY(value: number) {
    granularityY.value = value
    granularityYInput.value = value.toString()
  }

  function updateSimilarityThreshold(value: number) {
    similarityThreshold.value = value
    similarityThresholdInput.value = value.toString()
  }

  function setProcessing(processing: boolean, progress: ProcessProgress | null = null) {
    isProcessing.value = processing
    processingProgress.value = progress
  }

  function setCropProcessing(processing: boolean) {
    isCropProcessing.value = processing
  }

  function updateColorStats(stats: { colorCounts: ColorCounts; totalCount: number }) {
    colorCounts.value = stats.colorCounts
    totalBeadCount.value = stats.totalCount
  }

  function reset() {
    originalImageSrc.value = null
    originalImage.value = null
    showCropper.value = false
    croppedImageCanvas.value = null
    mappedPixelData.value = null
    gridDimensions.value = null
    colorCounts.value = null
    totalBeadCount.value = 0
    isProcessing.value = false
    processingProgress.value = null
  }

  return {
    // State
    originalImageSrc,
    originalImage,
    showCropper,
    croppedImageCanvas,
    mappedPixelData,
    gridDimensions,
    colorCounts,
    totalBeadCount,
    granularity,
    granularityInput,
    granularityY,
    granularityYInput,
    lockAspectRatio,
    similarityThreshold,
    similarityThresholdInput,
    pixelationMode,
    isProcessing,
    processingProgress,
    isCropProcessing,
    // Actions
    setImage,
    setCroppedCanvas,
    setPixelData,
    updateGranularity,
    updateGranularityY,
    updateSimilarityThreshold,
    setProcessing,
    setCropProcessing,
    updateColorStats,
    reset,
  }
})
