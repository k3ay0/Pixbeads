<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  isVisible: { type: Boolean, default: false },
  mappedPixelData: { type: Array, default: null },
  gridDimensions: { type: Object, default: null },
  totalElapsedTime: { type: Number, default: 0 },
})

const emit = defineEmits(['close'])

const userPhoto = ref(null)
const isCapturing = ref(false)
const cameraError = ref(false)
const videoRef = ref(null)
const canvasRef = ref(null)
const cardCanvasRef = ref(null)

// 计算总豆子数（排除透明区域）
const totalBeads = computed(() => {
  if (!props.mappedPixelData) return 0
  let count = 0
  for (let row = 0; row < props.gridDimensions.M; row++) {
    for (let col = 0; col < props.gridDimensions.N; col++) {
      const pixel = props.mappedPixelData[row][col]
      if (pixel.color &&
          pixel.color !== 'transparent' &&
          pixel.color !== 'rgba(0,0,0,0)' &&
          !pixel.color.includes('rgba(0, 0, 0, 0)')) {
        count++
      }
    }
  }
  return count
})

// 格式化时间
function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  if (hours > 0) {
    return `${hours}小时${minutes}分钟`
  } else {
    return `${minutes}分${secs}秒`
  }
}

// 生成原图缩略图
function generateThumbnail() {
  if (!props.mappedPixelData) return null
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const aspectRatio = props.gridDimensions.N / props.gridDimensions.M
  const maxThumbnailSize = 200
  let thumbnailWidth, thumbnailHeight
  if (aspectRatio > 1) {
    thumbnailWidth = maxThumbnailSize
    thumbnailHeight = maxThumbnailSize / aspectRatio
  } else {
    thumbnailHeight = maxThumbnailSize
    thumbnailWidth = maxThumbnailSize * aspectRatio
  }

  canvas.width = thumbnailWidth
  canvas.height = thumbnailHeight
  const cellWidth = thumbnailWidth / props.gridDimensions.N
  const cellHeight = thumbnailHeight / props.gridDimensions.M

  for (let row = 0; row < props.gridDimensions.M; row++) {
    for (let col = 0; col < props.gridDimensions.N; col++) {
      const pixel = props.mappedPixelData[row][col]
      ctx.fillStyle = pixel.color
      ctx.fillRect(col * cellWidth, row * cellHeight, cellWidth, cellHeight)
    }
  }

  return canvas.toDataURL()
}

// 开启相机
async function startCamera() {
  try {
    isCapturing.value = true
    cameraError.value = false
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
    })
    if (videoRef.value) {
      videoRef.value.srcObject = stream
    }
  } catch (error) {
    console.error('无法访问相机:', error)
    isCapturing.value = false
    cameraError.value = true
  }
}

// 拍照
function takePhoto() {
  if (!videoRef.value || !canvasRef.value) return
  const video = videoRef.value
  const canvas = canvasRef.value
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  ctx.drawImage(video, 0, 0)
  const photoDataURL = canvas.toDataURL('image/jpeg', 0.8)
  userPhoto.value = photoDataURL

  // 停止相机
  const stream = video.srcObject
  if (stream) stream.getTracks().forEach(track => track.stop())
  isCapturing.value = false
}

// 跳过拍照
function skipPhoto() {
  const thumbnailDataURL = generateThumbnail()
  if (thumbnailDataURL) {
    userPhoto.value = thumbnailDataURL
  }
}

// 取消拍照
function cancelCapture() {
  if (videoRef.value) {
    const stream = videoRef.value.srcObject
    if (stream) stream.getTracks().forEach(track => track.stop())
  }
  isCapturing.value = false
}

// 生成打卡图
function generateCompletionCard() {
  if (!userPhoto.value || !cardCanvasRef.value) return null

  const canvas = cardCanvasRef.value
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const thumbnailDataURL = generateThumbnail()
  const isUsingPixelArt = userPhoto.value === thumbnailDataURL

  // 设置画布尺寸 (3:4比例，适合分享)
  const cardWidth = 720
  const cardHeight = 960
  canvas.width = cardWidth
  canvas.height = cardHeight

  return new Promise((resolve) => {
    const userImg = new Image()
    userImg.onload = () => {
      if (isUsingPixelArt) {
        // ===== 拼豆原图模式：原图占主导 =====
        const gradient = ctx.createLinearGradient(0, 0, 0, cardHeight)
        gradient.addColorStop(0, '#1a1a2e')
        gradient.addColorStop(0.3, '#16213e')
        gradient.addColorStop(0.7, '#0f3460')
        gradient.addColorStop(1, '#533483')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, cardWidth, cardHeight)

        const imgAspectRatio = userImg.naturalWidth / userImg.naturalHeight
        const maxWidth = cardWidth * 0.9
        const maxHeight = cardHeight * 0.6
        let imageWidth, imageHeight
        if (maxWidth / maxHeight > imgAspectRatio) {
          imageHeight = maxHeight
          imageWidth = imageHeight * imgAspectRatio
        } else {
          imageWidth = maxWidth
          imageHeight = imageWidth / imgAspectRatio
        }

        const imageX = (cardWidth - imageWidth) / 2
        const imageY = (cardHeight - imageHeight) / 2 - 80

        // 绘制主图片的装饰背景和阴影
        ctx.save()
        const glowGradient = ctx.createRadialGradient(
          imageX + imageWidth / 2, imageY + imageHeight / 2, Math.min(imageWidth, imageHeight) / 2,
          imageX + imageWidth / 2, imageY + imageHeight / 2, Math.min(imageWidth, imageHeight) / 2 + 30
        )
        glowGradient.addColorStop(0, 'rgba(255,255,255,0.1)')
        glowGradient.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = glowGradient
        ctx.fillRect(imageX - 30, imageY - 30, imageWidth + 60, imageHeight + 60)

        ctx.fillStyle = '#ffffff'
        ctx.shadowColor = 'rgba(0,0,0,0.3)'
        ctx.shadowBlur = 25
        ctx.shadowOffsetX = 0
        ctx.shadowOffsetY = 15
        const borderWidth = 12
        ctx.fillRect(imageX - borderWidth, imageY - borderWidth, imageWidth + borderWidth * 2, imageHeight + borderWidth * 2)
        ctx.restore()

        ctx.drawImage(userImg, imageX, imageY, imageWidth, imageHeight)

        // 顶部区域：简洁的完成标识
        ctx.fillStyle = '#ffffff'
        ctx.font = 'bold 28px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        ctx.textAlign = 'center'
        ctx.shadowColor = 'rgba(0,0,0,0.3)'
        ctx.shadowBlur = 8
        ctx.fillText('🎉 作品完成 🎉', cardWidth / 2, 80)
        ctx.shadowBlur = 0

        const infoY = imageY + imageHeight + 40
        ctx.fillStyle = '#ffffff'
        ctx.font = 'bold 22px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        ctx.textAlign = 'center'
        ctx.shadowColor = 'rgba(0,0,0,0.5)'
        ctx.shadowBlur = 8
        ctx.fillText(`⏱️ ${formatTime(props.totalElapsedTime)} | 🔗 完成 ${totalBeads.value} 颗豆子`, cardWidth / 2, infoY + 40)

        ctx.font = '14px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        ctx.fillStyle = 'rgba(255,255,255,0.7)'
        ctx.fillText('PIXBEADS', cardWidth / 2, cardHeight - 50)
        ctx.font = '12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        ctx.fillStyle = 'rgba(255,255,255,0.5)'
        ctx.fillText('pixbeads.app', cardWidth / 2, cardHeight - 25)

        resolve(canvas.toDataURL('image/jpeg', 0.95))
      } else {
        // ===== 用户照片模式：照片占主导 =====
        const gradient = ctx.createLinearGradient(0, 0, 0, cardHeight)
        gradient.addColorStop(0, '#ff9a9e')
        gradient.addColorStop(0.3, '#fecfef')
        gradient.addColorStop(0.7, '#fecfef')
        gradient.addColorStop(1, '#ff9a9e')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, cardWidth, cardHeight)

        const photoAspectRatio = userImg.naturalWidth / userImg.naturalHeight
        const maxPhotoWidth = cardWidth * 0.85
        const maxPhotoHeight = cardHeight * 0.6
        let photoWidth, photoHeight
        if (maxPhotoWidth / maxPhotoHeight > photoAspectRatio) {
          photoHeight = maxPhotoHeight
          photoWidth = photoHeight * photoAspectRatio
        } else {
          photoWidth = maxPhotoWidth
          photoHeight = photoWidth / photoAspectRatio
        }

        const photoX = (cardWidth - photoWidth) / 2
        const photoY = (cardHeight - photoHeight) / 2 - 80

        ctx.save()
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'
        ctx.lineWidth = 8
        ctx.strokeRect(photoX - 15, photoY - 15, photoWidth + 30, photoHeight + 30)

        ctx.fillStyle = '#ffffff'
        ctx.shadowColor = 'rgba(0,0,0,0.2)'
        ctx.shadowBlur = 20
        ctx.shadowOffsetX = 0
        ctx.shadowOffsetY = 10
        ctx.fillRect(photoX - 12, photoY - 12, photoWidth + 24, photoHeight + 24)
        ctx.restore()

        ctx.drawImage(userImg, photoX, photoY, photoWidth, photoHeight)

        const infoCardY = photoY + photoHeight + 30
        ctx.fillStyle = '#ffffff'
        ctx.font = 'bold 22px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        ctx.textAlign = 'center'
        ctx.shadowColor = 'rgba(0,0,0,0.5)'
        ctx.shadowBlur = 8
        ctx.fillText(`⏱️ 总用时 ${formatTime(props.totalElapsedTime)} | 🔗 共完成 ${totalBeads.value} 颗豆子`, cardWidth / 2, infoCardY + 35)

        if (thumbnailDataURL) {
          const thumbnailImg = new Image()
          thumbnailImg.onload = () => {
            const maxThumbSize = 60
            const thumbAspectRatio = thumbnailImg.naturalWidth / thumbnailImg.naturalHeight
            let thumbWidth, thumbHeight
            if (thumbAspectRatio > 1) {
              thumbWidth = maxThumbSize
              thumbHeight = maxThumbSize / thumbAspectRatio
            } else {
              thumbHeight = maxThumbSize
              thumbWidth = maxThumbSize * thumbAspectRatio
            }

            const thumbX = cardWidth / 2 - thumbWidth / 2
            const thumbY = infoCardY + 80

            ctx.fillStyle = '#ffffff'
            ctx.shadowColor = 'rgba(0,0,0,0.3)'
            ctx.shadowBlur = 8
            ctx.fillRect(thumbX - 3, thumbY - 3, thumbWidth + 6, thumbHeight + 6)
            ctx.shadowBlur = 0

            ctx.drawImage(thumbnailImg, thumbX, thumbY, thumbWidth, thumbHeight)

            ctx.strokeStyle = '#ffffff'
            ctx.lineWidth = 3
            ctx.strokeRect(thumbX - 3, thumbY - 3, thumbWidth + 6, thumbHeight + 6)

            ctx.font = '14px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
            ctx.fillStyle = 'rgba(255,255,255,0.8)'
            ctx.textAlign = 'center'
            ctx.shadowColor = 'rgba(0,0,0,0.5)'
            ctx.shadowBlur = 4
            ctx.fillText('PIXBEADS', cardWidth / 2, cardHeight - 40)
            ctx.font = '12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
            ctx.fillStyle = 'rgba(255,255,255,0.6)'
            ctx.fillText('pixbeads.app', cardWidth / 2, cardHeight - 20)
            ctx.shadowBlur = 0

            resolve(canvas.toDataURL('image/jpeg', 0.95))
          }
          thumbnailImg.src = thumbnailDataURL
        } else {
          ctx.font = '14px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
          ctx.fillStyle = 'rgba(255,255,255,0.8)'
          ctx.textAlign = 'center'
          ctx.shadowColor = 'rgba(0,0,0,0.5)'
          ctx.shadowBlur = 4
          ctx.fillText('PIXBEADS', cardWidth / 2, cardHeight - 40)
          ctx.font = '12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
          ctx.fillStyle = 'rgba(255,255,255,0.6)'
          ctx.fillText('pixbeads.app', cardWidth / 2, cardHeight - 20)
          ctx.shadowBlur = 0
          resolve(canvas.toDataURL('image/jpeg', 0.95))
        }
      }
    }
    userImg.src = userPhoto.value
  })
}

// 下载打卡图
async function downloadCard() {
  const cardDataURL = await generateCompletionCard()
  if (cardDataURL) {
    const link = document.createElement('a')
    link.download = `拼豆完成打卡-${new Date().toLocaleDateString()}.jpg`
    link.href = cardDataURL
    link.click()
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="isVisible" class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div class="p-6">
          <div class="text-center mb-6">
            <h2 class="text-2xl font-bold text-gray-800 mb-2">
              🎉 作品完成 🎉
            </h2>
            <div class="text-gray-600 space-y-1">
              <p>总用时：{{ formatTime(totalElapsedTime) }}</p>
              <p>共完成：{{ totalBeads }} 颗豆子</p>
            </div>
          </div>

          <!-- 没有照片时 -->
          <div v-if="!userPhoto" class="text-center">
            <!-- 未开启相机 -->
            <div v-if="!isCapturing">
              <p class="text-gray-600 mb-4">
                拍一张照片生成专属打卡图吧！
              </p>
              <div v-if="cameraError" class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
                <p class="text-yellow-800 text-sm">
                  📱 无法访问相机，可能是权限限制或设备不支持。<br/>
                  你可以选择使用作品图生成打卡图。
                </p>
              </div>
              <div class="space-y-3">
                <button
                  @click="startCamera"
                  class="w-full bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600 transition-colors"
                >
                  📸 开启相机拍照
                </button>
                <button
                  @click="skipPhoto"
                  class="w-full bg-green-500 text-white px-6 py-3 rounded-lg hover:bg-green-600 transition-colors"
                >
                  🎨 跳过拍照，使用作品图
                </button>
              </div>
            </div>

            <!-- 开启相机中 -->
            <div v-else>
              <video
                ref="videoRef"
                autoPlay
                playsInline
                class="w-full max-w-xs mx-auto rounded-lg mb-4"
              />
              <button
                @click="takePhoto"
                class="bg-green-500 text-white px-6 py-3 rounded-lg hover:bg-green-600 transition-colors mr-2"
              >
                📸 拍照
              </button>
              <button
                @click="cancelCapture"
                class="bg-gray-500 text-white px-4 py-3 rounded-lg hover:bg-gray-600 transition-colors"
              >
                取消
              </button>
            </div>
          </div>

          <!-- 有照片时 -->
          <div v-else class="text-center">
            <img
              :src="userPhoto"
              alt="用户照片"
              class="w-32 h-32 rounded-full mx-auto mb-4 object-cover"
            />
            <div class="space-y-3">
              <button
                @click="downloadCard"
                class="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white py-3 rounded-lg hover:from-purple-600 hover:to-pink-600 transition-colors"
              >
                📥 下载打卡图
              </button>
              <button
                @click="userPhoto = null"
                class="w-full bg-gray-500 text-white py-2 rounded-lg hover:bg-gray-600 transition-colors"
              >
                重新拍照
              </button>
            </div>
          </div>

          <div class="mt-6 pt-4 border-t border-gray-200">
            <button
              @click="emit('close')"
              class="w-full bg-gray-100 text-gray-600 py-2 rounded-lg hover:bg-gray-200 transition-colors"
            >
              稍后再说
            </button>
          </div>
        </div>
      </div>

      <!-- 隐藏的canvas用于生成图片 -->
      <canvas ref="canvasRef" style="display: none" />
      <canvas ref="cardCanvasRef" style="display: none" />
    </div>
  </Teleport>
</template>
