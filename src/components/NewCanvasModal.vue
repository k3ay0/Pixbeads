<script setup lang="ts">
import { ref, watch } from 'vue'

export interface NewCanvasPayload {
  type: '2d' | '3d'
  width: number
  height: number
  depth: number
}

const props = defineProps<{
  isOpen: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'confirm', payload: NewCanvasPayload): void
}>()

const canvasType = ref<'2d' | '3d'>('2d')
const dimW = ref(32)
const dimH = ref(32)
const dimD = ref(16)

// 每次打开弹窗时重置为默认值
watch(
  () => props.isOpen,
  (open) => {
    if (open) {
      canvasType.value = '2d'
      dimW.value = 32
      dimH.value = 32
      dimD.value = 16
    }
  }
)

function switchType(type: '2d' | '3d') {
  canvasType.value = type
  if (type === '2d') {
    dimW.value = 32
    dimH.value = 32
  } else {
    dimW.value = 16
    dimH.value = 16
    dimD.value = 16
  }
}

function clamp(v: number): number {
  return Math.max(1, Math.min(128, Math.round(v) || 1))
}

function handleConfirm() {
  emit('confirm', {
    type: canvasType.value,
    width: clamp(dimW.value),
    height: clamp(dimH.value),
    depth: clamp(dimD.value),
  })
}
</script>

<template>
  <Teleport to="body">
    <div v-if="isOpen" class="fixed inset-0 bg-black/60 z-[90] flex items-center justify-center"
      @click.self="emit('close')">
      <div class="v-theme-bg2 border rounded-xl shadow-2xl w-[340px] max-w-[90vw] p-5 v-theme-text"
        style="border-color: var(--bd)">
        <h2 class="text-lg font-bold mb-4" style="color: var(--tx)">➕ 新建画布</h2>

        <!-- 画布类型选择 -->
        <div class="flex rounded-lg overflow-hidden mb-4" style="border: 1px solid var(--bd)">
          <button
            class="flex-1 py-2 text-sm font-medium transition-colors"
            :style="canvasType === '2d'
              ? { backgroundColor: 'var(--ac)', color: '#fff' }
              : { backgroundColor: 'var(--b3)', color: 'var(--t2)' }"
            @click="switchType('2d')">
            2D 画布
          </button>
          <button
            class="flex-1 py-2 text-sm font-medium transition-colors"
            :style="canvasType === '3d'
              ? { backgroundColor: 'var(--ac)', color: '#fff' }
              : { backgroundColor: 'var(--b3)', color: 'var(--t2)' }"
            @click="switchType('3d')">
            3D 画布
          </button>
        </div>

        <div class="space-y-3">
          <div>
            <label class="text-[10px] block mb-1" style="color: var(--t2)">宽 (W)</label>
            <input v-model.number="dimW" type="number" min="1" max="128"
              class="w-full rounded px-3 py-1.5 text-sm font-mono focus:outline-none"
              :style="{ backgroundColor: 'var(--b3)', border: '1px solid var(--bd)', color: 'var(--tx)' }" />
          </div>
          <div>
            <label class="text-[10px] block mb-1" style="color: var(--t2)">高 (H)</label>
            <input v-model.number="dimH" type="number" min="1" max="128"
              class="w-full rounded px-3 py-1.5 text-sm font-mono focus:outline-none"
              :style="{ backgroundColor: 'var(--b3)', border: '1px solid var(--bd)', color: 'var(--tx)' }" />
          </div>
          <div v-if="canvasType === '3d'">
            <label class="text-[10px] block mb-1" style="color: var(--t2)">深 (D)</label>
            <input v-model.number="dimD" type="number" min="1" max="128"
              class="w-full rounded px-3 py-1.5 text-sm font-mono focus:outline-none"
              :style="{ backgroundColor: 'var(--b3)', border: '1px solid var(--bd)', color: 'var(--tx)' }" />
          </div>
        </div>

        <div class="flex gap-2 mt-5">
          <button @click="emit('close')" class="flex-1 py-2 rounded-lg text-sm transition-colors"
            :style="{ backgroundColor: 'var(--b3)', border: '1px solid var(--bd)', color: 'var(--t2)' }">
            取消
          </button>
          <button @click="handleConfirm" class="flex-1 py-2 rounded-lg text-sm font-medium transition-colors"
            :style="{ backgroundColor: 'var(--ac)', color: '#fff' }">
            创建
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
