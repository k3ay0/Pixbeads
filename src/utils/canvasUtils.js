/**
 * 画布坐标计算工具函数
 * Ported from perler-beads React project
 */

/**
 * 将鼠标/触摸坐标转换为画布内的格子坐标
 * @param {number} clientX 客户端X坐标
 * @param {number} clientY 客户端Y坐标
 * @param {HTMLCanvasElement} canvas 画布元素
 * @param {{ N: number; M: number }} gridDimensions 网格尺寸
 * @returns {{ i: number; j: number } | null} 格子坐标或 null（如果超出范围）
 */
export function clientToGridCoords(clientX, clientY, canvas, gridDimensions) {
  const rect = canvas.getBoundingClientRect()
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height
  const canvasX = (clientX - rect.left) * scaleX
  const canvasY = (clientY - rect.top) * scaleY

  const { N, M } = gridDimensions
  const cellWidthOutput = canvas.width / N
  const cellHeightOutput = canvas.height / M

  const i = Math.floor(canvasX / cellWidthOutput)
  const j = Math.floor(canvasY / cellHeightOutput)

  // 检查是否在有效范围内
  if (i >= 0 && i < N && j >= 0 && j < M) {
    return { i, j }
  }

  return null
}

/**
 * 检查触摸是否被认为是移动而不是点击
 * @param {{ x: number; y: number }} startPos 开始位置
 * @param {{ x: number; y: number }} currentPos 当前位置
 * @param {number} [threshold=10] 移动阈值（像素）
 * @returns {boolean} 是否是移动
 */
export function isTouchMove(startPos, currentPos, threshold = 10) {
  const dx = Math.abs(currentPos.x - startPos.x)
  const dy = Math.abs(currentPos.y - startPos.y)
  return dx > threshold || dy > threshold
}
