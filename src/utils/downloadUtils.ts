/**
 * 下载触发工具函数
 * 从 canvas 或 Blob 触发浏览器下载
 */

/**
 * 从 canvas 触发 PNG 下载
 * @param canvas - HTML Canvas 元素
 * @param filename - 下载文件名
 */
export function triggerImageDownload(canvas: HTMLCanvasElement, filename: string): void {
  const link = document.createElement('a')
  link.download = filename
  link.href = canvas.toDataURL('image/png')
  link.click()
}

/**
 * 从 Blob 触发下载
 * @param blob - Blob 对象
 * @param filename - 下载文件名
 */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}
