<script setup lang="ts">
import { computed, type PropType } from 'vue'

interface RecommendedCell {
  row: number
  col: number
}

interface ColorInfo {
  color: string
  name: string
  completed: number
  total: number
}

const props = defineProps({
  progressPercentage: { type: Number, default: 0 },
  recommendedCell: { type: Object as PropType<RecommendedCell | null>, default: null },
  colorInfo: { type: Object as PropType<ColorInfo | null>, default: null },
})

const emit = defineEmits<{
  (e: 'complete-color'): void
}>()

const progressDots = computed(() => {
  return Array.from({ length: 7 }, (_, index) => {
    const threshold = (index + 1) * (100 / 7)
    return {
      filled: props.progressPercentage >= threshold,
    }
  })
})

const isColorCompleted = computed(() => {
  return props.colorInfo && props.colorInfo.completed >= props.colorInfo.total
})
</script>

<template>
  <div class="rounded-xl border border-gray-200/60 dark:border-gray-800/50 bg-gray-50/95 dark:bg-gray-900/80 px-4 py-3 shadow-sm shadow-gray-200/50">
    <!-- 当前颜色信息 -->
    <div v-if="colorInfo" class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-2">
        <div
          class="w-4 h-4 rounded-full border border-gray-300 dark:border-gray-600 shadow-sm"
          :style="{ backgroundColor: colorInfo.color }"
        />
        <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
          {{ colorInfo.name }}
        </span>
        <span class="text-xs text-gray-500 dark:text-gray-400">
          {{ colorInfo.completed }}/{{ colorInfo.total }}
        </span>
      </div>
      <button
        v-if="!isColorCompleted"
        @click="emit('complete-color')"
        class="text-xs px-2 py-1 rounded-lg bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20 transition-colors font-medium"
        title="一键完成当前颜色所有格子"
      >
        一键完成
      </button>
      <span v-else class="text-xs text-green-500 dark:text-green-400 font-medium">
        ✓ 已完成
      </span>
    </div>

    <!-- 进度条 -->
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
        <span v-else-if="isColorCompleted">已完成当前颜色</span>
      </div>
    </div>
  </div>
</template>