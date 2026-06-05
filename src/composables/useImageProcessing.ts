import { toRaw, nextTick } from 'vue'
import { useBeadStore } from '@/stores/beadStore'
import { usePaletteStore } from '@/stores/paletteStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { useEditorStore } from '@/stores/editorStore'
import { processImageInWorker } from '@/utils/workerManager'
import { recalculateColorStats } from '@/utils/pixelation'
import { calculateCenterOffset } from '@/utils/canvasUtils'

export function useImageProcessing() {
  const beadStore = useBeadStore()
  const paletteStore = usePaletteStore()
  const canvasStore = useCanvasStore()
  const editorStore = useEditorStore()

  async function processImage() {
    if (!beadStore.originalImage && !beadStore.croppedImageCanvas) return
    beadStore.setProcessing(true)

    try {
      const N = beadStore.granularity
      let sourceCanvas: HTMLCanvasElement
      let imgWidth: number
      let imgHeight: number

      if (beadStore.croppedImageCanvas) {
        sourceCanvas = beadStore.croppedImageCanvas
        imgWidth = sourceCanvas.width
        imgHeight = sourceCanvas.height
      } else {
        const img = beadStore.originalImage!
        imgWidth = img.width
        imgHeight = img.height
        sourceCanvas = document.createElement('canvas')
        sourceCanvas.width = imgWidth
        sourceCanvas.height = imgHeight
        const ctx = sourceCanvas.getContext('2d')!
        ctx.drawImage(img, 0, 0)
      }

      let M: number
      if (beadStore.croppedImageCanvas && beadStore.granularityY > 0) {
        M = beadStore.granularityY
      } else {
        const aspectRatio = imgHeight / imgWidth
        M = Math.max(1, Math.round(N * aspectRatio))
      }

      const ctx = sourceCanvas.getContext('2d')!
      const imageData = ctx.getImageData(0, 0, imgWidth, imgHeight)

      const palette = toRaw(paletteStore.activeBeadPalette)
      const fallbackColor = palette.find(p => p.key === 'T1')
        || palette.find(p => p.hex.toUpperCase() === '#FFFFFF')
        || palette[0]
        || { key: '?', hex: '#000000', rgb: { r: 0, g: 0, b: 0 } }

      const result = await processImageInWorker(
        {
          imageData,
          imgWidth,
          imgHeight,
          N,
          M,
          palette,
          mode: beadStore.pixelationMode,
          threshold: beadStore.similarityThreshold,
          fallbackColor: toRaw(fallbackColor)
        },
        (progress) => {
          beadStore.setProcessing(true, progress)
        }
      )

      beadStore.setPixelData(result, { N, M })

      const stats = recalculateColorStats(result)
      beadStore.updateColorStats(stats)

      editorStore.clearHistory()
      editorStore.saveSnapshot(result)

      nextTick(() => {
        canvasStore.resetViewToCenter()
      })
    } catch (err) {
      if (err instanceof Error && err.message === 'Processing cancelled') {
        console.log('处理已取消')
      } else {
        console.error('处理失败:', err)
      }
    } finally {
      beadStore.setProcessing(false)
    }
  }

  return {
    processImage,
  }
}
