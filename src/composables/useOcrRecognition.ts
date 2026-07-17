import { createDefaultPPOcrV5 } from 'ffocr'
import type { PaddleOcrWeb } from 'ffocr'

export interface GridCellResult {
  row: number
  col: number
  text: string
  confidence: number
}

export type OcrProgressCallback = (info: { phase: string; percent?: number }) => void

export function useOcrRecognition() {
  let ocrInstance: PaddleOcrWeb | null = null

  function isReady(): boolean {
    return ocrInstance !== null
  }

  function getOrCreateInstance(): PaddleOcrWeb {
    if (!ocrInstance) {
      ocrInstance = createDefaultPPOcrV5({ cacheModels: true })
    }
    return ocrInstance
  }

  async function recognizeGrid(
    canvas: HTMLCanvasElement,
    cols: number,
    rows: number,
    onProgress?: OcrProgressCallback,
  ): Promise<GridCellResult[]> {
    try {
      const ocr = getOrCreateInstance()

      const result = await ocr.ocr(canvas, {
        onProgress: (progress) => {
          let percent: number | undefined
          if (progress.loaded != null && progress.totalBytes != null && progress.totalBytes > 0) {
            percent = Math.round((progress.loaded / progress.totalBytes) * 100)
          } else if (progress.current != null && progress.total != null && progress.total > 0) {
            percent = Math.round((progress.current / progress.total) * 100)
          }
          onProgress?.({ phase: progress.phase, percent })
        },
      })

      if (result.lines.length > 0) {
        console.log('[OCR] first line sample:', JSON.stringify(result.lines[0]))
      }

      const cellW = canvas.width / cols
      const cellH = canvas.height / rows

      // 同一网格位置取置信度最高的结果
      const cellMap = new Map<string, GridCellResult>()

      for (const line of result.lines) {
        const { points } = line.box
        const cx = (points[0].x + points[1].x + points[2].x + points[3].x) / 4
        const cy = (points[0].y + points[1].y + points[2].y + points[3].y) / 4

        const col = Math.floor(cx / cellW)
        const row = Math.floor(cy / cellH)

        if (col < 0 || row < 0 || col >= cols || row >= rows) continue

        const text = line.text.trim().toUpperCase()
        if (text.length === 0) continue

        const key = `${row},${col}`
        const existing = cellMap.get(key)
        if (!existing || line.score > existing.confidence) {
          cellMap.set(key, { row, col, text, confidence: line.score })
        }
      }

      return Array.from(cellMap.values())
    } catch (err) {
      throw err
    }
  }

  function dispose(): void {
    if (ocrInstance) {
      ocrInstance.dispose()
      ocrInstance = null
    }
  }

  return {
    recognizeGrid,
    isReady,
    dispose,
  }
}
