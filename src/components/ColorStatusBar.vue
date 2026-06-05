<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps({
  currentColor: { type: String, default: '' },
  colorInfo: { type: Object, default: null },
  progressPercentage: { type: Number, default: 0 },
})

const estimatedTime = computed(() => {
  if (!props.colorInfo) return 0
  return Math.ceil((props.colorInfo.total - props.colorInfo.completed) * 0.1)
})
</script>

<template>
  <div class="h-12 bg-white border-b border-black/10 px-4 py-2 flex items-center justify-between">
    <div v-if="!colorInfo" class="text-black/45">请选择颜色</div>

    <template v-else>
      <div class="flex items-center space-x-3">
        <div
          class="w-8 h-8 rounded-full border-2 border-black/10"
          :style="{ backgroundColor: currentColor }"
        />
        <div class="text-sm font-mono font-bold text-black px-2">
          {{ colorInfo.name }}
        </div>
        <div class="flex flex-col">
          <div class="text-sm font-medium text-black">
            {{ colorInfo.completed }}/{{ colorInfo.total }}
          </div>
          <div class="text-xs text-black/45">
            预计还需 {{ estimatedTime }}分钟
          </div>
        </div>
      </div>

      <div class="text-right">
        <div class="text-lg font-bold text-blue-600">
          {{ progressPercentage }}%
        </div>
      </div>
    </template>
  </div>
</template>