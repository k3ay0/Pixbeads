<script setup lang="ts">
import { ref } from 'vue'
import EmbeddedCropper from './EmbeddedCropper.vue'

interface Props {
  isOpen: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  close: []
  cropConfirm: [canvas: HTMLCanvasElement]
  gridConfirm: [data: {
    canvas: HTMLCanvasElement
    cols: number
    rows: number
    pixelColors: string[][]
    ocrEnabled: boolean
  }]
  pbdsDrop: [file: File]
}>()

// 步骤状态
type Step = 'select' | 'crop'
const currentStep = ref<Step>('select')

// 文件输入引用
const fileInput = ref<HTMLInputElement | null>(null)

// 图片源
const imageSrc = ref<string | null>(null)

// 拖拽状态
const isDragOver = ref(false)
let dragCounter = 0

// 选择从图片导入
function handleSelectImage() {
  fileInput.value?.click()
}

// 选择从文件导入（pbds）
function handleSelectFile() {
  emit('close')
  // 触发 pbds 文件输入
  const pbdsInput = document.querySelector('input[type="file"][accept=".pbds"]') as HTMLInputElement
  pbdsInput?.click()
}

// 文件选择变化
function handleFileChange(e: Event) {
  const file = (e.target as HTMLInputElement)?.files?.[0]
  if (!file) return

  loadImageFile(file)

  if (fileInput.value) {
    fileInput.value.value = ''
  }
}

// 加载图片文件（共用逻辑）
function loadImageFile(file: File) {
  if (!file.type.startsWith('image/')) return

  const reader = new FileReader()
  reader.onload = (event) => {
    imageSrc.value = event.target?.result as string
    currentStep.value = 'crop'
  }
  reader.readAsDataURL(file)
}

// 拖拽事件处理
function handleDragEnter(e: DragEvent) {
  e.preventDefault()
  dragCounter++
  isDragOver.value = true
}

function handleDragOver(e: DragEvent) {
  e.preventDefault()
}

function handleDragLeave(e: DragEvent) {
  e.preventDefault()
  dragCounter--
  if (dragCounter === 0) {
    isDragOver.value = false
  }
}

function handleDrop(e: DragEvent) {
  e.preventDefault()
  dragCounter = 0
  isDragOver.value = false

  const file = e.dataTransfer?.files?.[0]
  if (!file) return

  if (file.name.toLowerCase().endsWith('.pbds')) {
    emit('close')
    emit('pbdsDrop', file)
  } else if (file.type.startsWith('image/')) {
    loadImageFile(file)
  }
}

// 裁剪确认
function handleCropConfirm(canvas: HTMLCanvasElement) {
  emit('cropConfirm', canvas)
}

// 格子对齐确认
function handleGridConfirm(data: {
  canvas: HTMLCanvasElement
  cols: number
  rows: number
  pixelColors: string[][]
  ocrEnabled: boolean
}) {
  emit('gridConfirm', data)
}

// 取消裁剪
function handleCropCancel() {
  currentStep.value = 'select'
  imageSrc.value = null
}

// 关闭弹出框
function handleClose() {
  currentStep.value = 'select'
  imageSrc.value = null
  emit('close')
}

// 点击外部关闭
function handleBackdropClick(e: MouseEvent) {
  if ((e.target as HTMLElement).classList.contains('backdrop')) {
    handleClose()
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="backdrop fixed inset-0 flex items-center justify-center z-50 p-4"
      @click="handleBackdropClick"
    >
      <div
        class="bg-white rounded-xl shadow-lg overflow-hidden w-full max-w-4xl h-[80vh] flex flex-col border border-black/10"
        @click.stop
      >
        <!-- 步骤1：选择导入方式 -->
        <template v-if="currentStep === 'select'">
          <!-- 头部 -->
          <div class="flex items-center justify-between px-5 py-3 border-b border-black/10">
            <div class="w-[60px]"></div>
            <h3 class="text-base font-semibold text-black">导入文件</h3>
            <button
              @click="handleClose"
              class="text-black/45 hover:text-black transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
              </svg>
            </button>
          </div>

          <!-- 选择内容：左右两栏 -->
          <div class="p-6">
            <div class="flex gap-4 max-w-2xl mx-auto">
              <!-- 左侧：导入方式选择 -->
              <div class="flex-1 flex flex-col gap-3">
                <p class="text-black/60 text-sm mb-1">
                  选择导入方式
                </p>
                
                <!-- 从图片导入 -->
                <button
                  @click="handleSelectImage"
                  class="w-full p-4 rounded-xl border border-black/10 hover:border-black/30 hover:bg-black/[0.02] transition-all group text-left"
                >
                  <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-lg bg-black/[0.04] flex items-center justify-center group-hover:bg-black/[0.08] transition-colors flex-shrink-0">
                      <svg class="w-5 h-5 text-black/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div>
                      <h4 class="text-sm font-medium text-black">从图片导入</h4>
                      <p class="text-xs text-black/45">支持 JPG、PNG 格式的图片</p>
                    </div>
                  </div>
                </button>

                <!-- 从文件导入 -->
                <button
                  @click="handleSelectFile"
                  class="w-full p-4 rounded-xl border border-black/10 hover:border-black/30 hover:bg-black/[0.02] transition-all group text-left"
                >
                  <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-lg bg-black/[0.04] flex items-center justify-center group-hover:bg-black/[0.08] transition-colors flex-shrink-0">
                      <svg class="w-5 h-5 text-black/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div>
                      <h4 class="text-sm font-medium text-black">从文件导入</h4>
                      <p class="text-xs text-black/45">支持 .pbds 格式的图纸文件</p>
                    </div>
                  </div>
                </button>
              </div>

              <!-- 右侧：拖拽上传区域 -->
              <div class="flex-1">
                <p class="text-black/60 text-sm mb-1">
                  或拖拽文件到此处
                </p>
                <div
                  @dragenter="handleDragEnter"
                  @dragover="handleDragOver"
                  @dragleave="handleDragLeave"
                  @drop="handleDrop"
                  @click="handleSelectImage"
                  :class="[
                    'h-[calc(100%-24px)] rounded-xl border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center gap-3',
                    isDragOver
                      ? 'border-black/30 bg-black/[0.04]'
                      : 'border-black/10 hover:border-black/25 hover:bg-black/[0.02]'
                  ]"
                >
                  <div :class="[
                    'w-12 h-12 rounded-full flex items-center justify-center transition-colors',
                    isDragOver ? 'bg-black/[0.08]' : 'bg-black/[0.04]'
                  ]">
                    <svg class="w-6 h-6 text-black/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 16v-8m0 0l-3 3m3-3l3 3M3 16l4.586-4.586a2 2 0 012.828 0L16 16" />
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 16v2a2 2 0 002 2h14a2 2 0 002-2v-2" />
                    </svg>
                  </div>
                  <div class="text-center">
                    <p class="text-xs text-black/45">拖放图片或 .pbds 文件</p>
                    <p class="text-[11px] text-black/30 mt-1">松开即开始处理</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- 步骤2：裁剪图片 -->
        <template v-else-if="currentStep === 'crop' && imageSrc">
          <EmbeddedCropper
            :image-src="imageSrc"
            @confirm="handleCropConfirm"
            @grid-confirm="handleGridConfirm"
            @cancel="handleCropCancel"
          />
        </template>
      </div>
    </div>

    <!-- 隐藏的文件输入 -->
    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      class="hidden"
      @change="handleFileChange"
    />
  </Teleport>
</template>
