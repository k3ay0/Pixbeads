<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  colors: Array<{ color: string; name: string; total: number; completed: number }>
  currentColor: string
}>()

const emit = defineEmits<{
  (e: 'color-select', color: string): void
}>()

// 计算进度环的周长
const circumference = computed(() => 2 * Math.PI * 18.75)
</script>

<template>
  <div class="pointer-events-auto absolute bottom-3 left-3 right-14">
    <div
      class="flex items-center gap-2 px-2.5 h-[56px] rounded-2xl bg-black/50 backdrop-blur-xl shadow-lg overflow-x-auto"
      style="scrollbar-width: none;"
    >
      <!-- 颜色按钮 -->
      <button
        v-for="colorInfo in colors"
        :key="colorInfo.color"
        @click="emit('color-select', colorInfo.color)"
        class="relative flex-shrink-0 w-10 h-10 rounded-full transition-all duration-200 active:scale-95"
        :class="[
          colorInfo.color === currentColor ? 'scale-[1.15] z-10' : '',
          colorInfo.completed >= colorInfo.total ? 'opacity-40' : ''
        ]"
        :data-current="colorInfo.color === currentColor ? 'true' : undefined"
        :title="`${colorInfo.name} (${colorInfo.completed}/${colorInfo.total})`"
      >
        <!-- 颜色圆点 -->
        <div
          class="w-full h-full rounded-full shadow-sm transition-all"
          :class="colorInfo.color === currentColor
            ? 'ring-[2.5px] ring-white ring-offset-1 ring-offset-black/50'
            : 'border border-white/20'"
          :style="{ backgroundColor: colorInfo.color }"
        />
        <!-- SVG 进度环 -->
        <svg width="40" height="40" class="absolute inset-0 -rotate-90 pointer-events-none">
          <!-- 底圈 -->
          <circle
            cx="20"
            cy="20"
            r="18.75"
            fill="none"
            stroke="rgba(0,0,0,0.15)"
            stroke-width="2.5"
          />
          <!-- 进度圈（有进度时显示） -->
          <circle
            v-if="colorInfo.completed > 0"
            cx="20"
            cy="20"
            r="18.75"
            fill="none"
            :stroke="colorInfo.completed >= colorInfo.total ? '#22c55e' : 'rgba(255,255,255,0.85)'"
            stroke-width="2.5"
            :stroke-dasharray="circumference"
            :stroke-dashoffset="circumference * (1 - (colorInfo.total > 0 ? colorInfo.completed / colorInfo.total : 0))"
            stroke-linecap="round"
            class="transition-all duration-300"
          />
        </svg>
        <!-- 完成覆盖层 -->
        <div
          v-if="colorInfo.completed >= colorInfo.total"
          class="absolute inset-0 flex items-center justify-center bg-black/30 rounded-full"
        >
          <svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
      </button>
    </div>
  </div>
</template>
