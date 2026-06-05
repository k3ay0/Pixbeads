<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useBeadStore } from '../stores/beadStore'
import { usePaletteStore } from '../stores/paletteStore'
import { useEditorStore } from '../stores/editorStore'
import { colorSystemOptions } from '../utils/colorSystemUtils'

const emit = defineEmits<{
  (e: 'trigger-file-input'): void
  (e: 'auto-remove-background'): void
  (e: 'undo-bg-removal'): void
}>()

const beadStore = useBeadStore()
const paletteStore = usePaletteStore()
const editorStore = useEditorStore()

const { originalImageSrc, mappedPixelData, granularity, granularityInput, granularityY, granularityYInput, lockAspectRatio, similarityThreshold, similarityThresholdInput, pixelationMode, croppedImageCanvas } = storeToRefs(beadStore)
const { selectedColorSystem } = storeToRefs(paletteStore)
const { bgRemovalSnapshot } = storeToRefs(editorStore)

function handleDragOver(e: DragEvent) { e.preventDefault() }
function handleDrop(e: DragEvent) {
  e.preventDefault()
  const file = e.dataTransfer?.files?.[0]
  if (file && file.type.startsWith('image/')) {
    // 由父组件处理
    emit('trigger-file-input')
  }
}
</script>

<template>
  <div class="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3">
    <!-- Upload card -->
    <div class="bg-white rounded-xl border border-black/10 p-4">
      <h3 class="text-sm font-medium text-black mb-3">图片上传</h3>
      <div
        @click="emit('trigger-file-input')"
        @dragover.prevent
        @drop="handleDrop"
        class="border-2 border-dashed border-black/10 rounded-lg p-4 text-center cursor-pointer hover:border-black/25 hover:bg-black/[0.03] transition-colors"
      >
        <img v-if="originalImageSrc" :src="originalImageSrc" class="max-h-24 mx-auto rounded mb-2" alt="预览" />
        <div v-else class="space-y-1">
          <svg class="w-8 h-8 mx-auto text-black/35" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 6v12m6-6H6" />
          </svg>
          <p class="text-xs text-black/45">点击或拖放图片</p>
        </div>
      </div>
    </div>

    <!-- Parameter controls card -->
    <div class="bg-white rounded-xl border border-black/10 p-4 space-y-4">
      <h3 class="text-sm font-medium text-black">参数设置</h3>

      <!-- Width -->
      <div>
        <label class="text-xs text-black/45 mb-1 block">宽度 (横向格子数)</label>
        <div class="flex items-center gap-2">
          <input v-model.number="granularity" type="range" min="10" max="300" step="1" class="flex-1 h-1.5 bg-black/10 rounded-lg appearance-none cursor-pointer accent-black" />
          <input v-model="granularityInput" @blur="granularity = Math.max(10, Math.min(300, parseInt(granularityInput) || 50))" @keyup.enter="granularity = Math.max(10, Math.min(300, parseInt(granularityInput) || 50))" type="text" class="w-14 px-1.5 py-0.5 text-xs font-mono text-center border border-black/10 rounded focus:outline-none focus:ring-1 focus:ring-black" />
        </div>
      </div>

      <!-- Lock aspect ratio -->
      <div class="flex justify-center">
        <button
          @click="lockAspectRatio = !lockAspectRatio"
          :class="['flex items-center gap-1 px-3 py-1 text-xs rounded-full border transition-colors', lockAspectRatio ? 'bg-black/[0.03] border-black/20 text-black' : 'bg-white border-black/10 text-black/45 hover:border-black/10']"
          :title="lockAspectRatio ? '解锁长宽比' : '锁定长宽比'"
        >
          <svg v-if="lockAspectRatio" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <svg v-else class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
          </svg>
          {{ lockAspectRatio ? '已锁定' : '锁定比例' }}
        </button>
      </div>

      <!-- Height -->
      <div>
        <label class="text-xs text-black/45 mb-1 block">
          高度 (纵向格子数)
          <span v-if="!croppedImageCanvas && !lockAspectRatio" class="text-black/35 font-normal ml-1">裁剪后可调</span>
        </label>
        <div class="flex items-center gap-2">
          <input v-model.number="granularityY" type="range" min="10" max="300" step="1" :disabled="!croppedImageCanvas || lockAspectRatio" class="flex-1 h-1.5 bg-black/10 rounded-lg appearance-none cursor-pointer accent-black disabled:opacity-40" />
          <input v-model="granularityYInput" :disabled="!croppedImageCanvas || lockAspectRatio" @blur="granularityY = Math.max(10, Math.min(300, parseInt(granularityYInput) || 0))" @keyup.enter="granularityY = Math.max(10, Math.min(300, parseInt(granularityYInput) || 0))" type="text" :placeholder="granularityY > 0 ? granularityY.toString() : '自动'" class="w-14 px-1.5 py-0.5 text-xs font-mono text-center border border-black/10 rounded focus:outline-none focus:ring-1 focus:ring-black disabled:opacity-40" />
        </div>
      </div>

      <!-- Similarity threshold -->
      <div>
        <label class="text-xs text-black/45 mb-1 block">
          颜色合并阈值
          <span class="float-right font-mono text-black">{{ similarityThreshold }}</span>
        </label>
        <input v-model.number="similarityThreshold" type="range" min="0" max="100" step="1" class="w-full h-1.5 bg-black/10 rounded-lg appearance-none cursor-pointer accent-black" />
      </div>

      <!-- Pixelation mode -->
      <div>
        <label class="text-xs text-black/45 mb-1 block">像素化模式</label>
        <div class="flex gap-2">
          <button @click="pixelationMode = 'dominant'" :class="['flex-1 px-3 py-1.5 text-xs rounded-lg border transition-colors', pixelationMode === 'dominant' ? 'bg-black text-white border-black' : 'bg-white text-black/60 border-black/10 hover:border-black/20']">卡通(主色)</button>
          <button @click="pixelationMode = 'average'" :class="['flex-1 px-3 py-1.5 text-xs rounded-lg border transition-colors', pixelationMode === 'average' ? 'bg-black text-white border-black' : 'bg-white text-black/60 border-black/10 hover:border-black/20']">真实(均色)</button>
        </div>
      </div>

      <!-- Background removal -->
      <div class="flex gap-2">
        <button @click="emit('auto-remove-background')" :disabled="!mappedPixelData" class="flex-1 px-3 py-1.5 text-xs rounded-full border border-black/10 bg-[#007be5]/[0.06] text-black hover:bg-black/[0.06] transition-colors disabled:opacity-50 disabled:cursor-not-allowed">一键去背景</button>
        <button @click="emit('undo-bg-removal')" :disabled="!bgRemovalSnapshot" class="flex-1 px-3 py-1.5 text-xs rounded-full border border-black/10 bg-white text-black/60 hover:bg-black/[0.04] transition-colors disabled:opacity-50 disabled:cursor-not-allowed">回撤上一步</button>
      </div>
    </div>

    <!-- Color system card -->
    <div class="bg-white rounded-xl border border-black/10 p-4">
      <h3 class="text-sm font-medium text-black mb-3">色号系统</h3>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="sys in colorSystemOptions"
          :key="sys.key"
          @click="selectedColorSystem = sys.key"
          :class="['px-2.5 py-1 text-xs rounded-lg border transition-all duration-150', selectedColorSystem === sys.key ? 'bg-black text-white border-black shadow-sm' : 'bg-white text-black/60 border-black/10 hover:border-black/20']"
        >{{ sys.name }}</button>
      </div>
    </div>
  </div>
</template>
