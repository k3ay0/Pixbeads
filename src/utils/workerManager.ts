// Worker 管理工具 - 实现 Worker 池复用和进度回调
import type { PaletteColor, MappedPixel } from '@/types'
import { PixelationMode } from '@/types'

export interface ProcessProgress {
  current: number
  total: number
  phase: 'pixelate' | 'merge'
}

export interface ProcessParams {
  imageData: ImageData
  imgWidth: number
  imgHeight: number
  N: number
  M: number
  palette: PaletteColor[]
  mode: PixelationMode
  threshold: number
  fallbackColor: MappedPixel
}

type ProgressCallback = (progress: ProcessProgress) => void

class WorkerPool {
  private worker: Worker | null = null
  private isProcessing = false
  private pendingReject: ((reason?: any) => void) | null = null

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL('../workers/pixelation.worker.ts', import.meta.url),
        { type: 'module' }
      )
    }
    return this.worker
  }

  async process(
    params: ProcessParams,
    onProgress?: ProgressCallback
  ): Promise<MappedPixel[][]> {
    // 如果正在处理，取消当前任务
    if (this.isProcessing) {
      this.cancel()
    }

    return new Promise((resolve, reject) => {
      const worker = this.getWorker()
      this.isProcessing = true
      this.pendingReject = reject

      const handleMessage = (e: MessageEvent) => {
        if (e.data.type === 'progress' && onProgress) {
          onProgress({
            current: e.data.current,
            total: e.data.total,
            phase: e.data.phase
          })
        } else if (e.data.type === 'result') {
          cleanup()
          this.isProcessing = false
          resolve(e.data.mappedPixelData)
        }
      }

      const handleError = (e: ErrorEvent) => {
        cleanup()
        this.isProcessing = false
        reject(new Error(`Worker error: ${e.message}`))
      }

      const cleanup = () => {
        worker.removeEventListener('message', handleMessage)
        worker.removeEventListener('error', handleError)
        this.pendingReject = null
      }

      worker.addEventListener('message', handleMessage)
      worker.addEventListener('error', handleError)

      worker.postMessage({
        type: 'process',
        ...params
      })
    })
  }

  cancel() {
    if (this.pendingReject) {
      this.pendingReject(new Error('Processing cancelled'))
      this.pendingReject = null
    }
    this.isProcessing = false
    // 重新创建 Worker 以确保干净状态
    this.terminate()
  }

  terminate() {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    this.isProcessing = false
  }
}

// 全局单例
let poolInstance: WorkerPool | null = null

export function getWorkerPool(): WorkerPool {
  if (!poolInstance) {
    poolInstance = new WorkerPool()
  }
  return poolInstance
}

export function processImageInWorker(
  params: ProcessParams,
  onProgress?: ProgressCallback
): Promise<MappedPixel[][]> {
  const pool = getWorkerPool()
  return pool.process(params, onProgress)
}
