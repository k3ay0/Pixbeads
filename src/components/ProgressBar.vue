<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps({
  progressPercentage: { type: Number, default: 0 },
  recommendedCell: { type: Object, default: null },
  colorInfo: { type: Object, default: null },
})

const progressDots = computed(() => {
  return Array.from({ length: 7 }, (_, index) => {
    const threshold = (index + 1) * (100 / 7)
    return {
      filled: props.progressPercentage >= threshold,
    }
  })
})
</script>

<template>
  <div class="rounded-xl border border-gray-200/60 dark:border-gray-800/50 bg-gray-50/95 dark:bg-gray-900/80 px-4 py-3 shadow-sm shadow-gray-200/50">
    <div class="flex items-center justify-between">
      <div class="flex items-center space-x-2">
        <div
          v-for="(dot, index) in progressDots"
          :key="index"
          class="w-3 h-3 rounded-full transition-colors"
          :class="dot.filled ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'"
        />
        <span class="ml-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
          {{ progressPercentage }}%
        </span>
      </div>

      <div class="text-xs text-gray-500 dark:text-gray-400">
        <span v-if="recommendedCell">
          下一块 → {{ recommendedCell.row + 1 }},{{ recommendedCell.col + 1 }}
        </span>
        <span v-else>已完成当前颜色</span>
      </div>
    </div>
  </div>
</template>