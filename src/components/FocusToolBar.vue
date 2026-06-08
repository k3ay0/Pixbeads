<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useFocusStore } from '../stores/focusStore'
import { useBeadStore } from '../stores/beadStore'

const focusStore = useFocusStore()
const beadStore = useBeadStore()

const {
  currentColor,
  currentColorInfo,
  progressPercentage,
  elapsedTime,
  isPaused,
} = storeToRefs(focusStore)

const emit = defineEmits<{
  (e: 'locate'): void
  (e: 'toggle-settings'): void
}>()

function handlePauseToggle() {
  focusStore.handlePauseToggle()
}

function handleMarkComplete() {
  focusStore.markCurrentColorComplete(beadStore.mappedPixelData)
}
</script>

<template>
  <!-- 顶部工具栏叠加层 -->
  <div class="pointer-events-auto absolute top-3 left-3 right-3 flex items-center gap-2 h-12 px-3.5 rounded-2xl bg-black/50 backdrop-blur-xl shadow-lg">
    <!-- 左侧颜色信息 -->
    <div class="flex items-center gap-2.5 flex-1 min-w-0">
      <!-- 颜色圆点 -->
      <div
        class="w-7 h-7 rounded-full border-2 border-white/60 flex-shrink-0 shadow-sm"
        :style="{ backgroundColor: currentColor }"
      />
      <!-- 文字信息 -->
      <div class="min-w-0 leading-tight">
        <span class="text-[13px] font-semibold text-white truncate block">
          {{ currentColorInfo?.name }}
        </span>
        <span class="text-[11px] text-white/60">
          {{ currentColorInfo?.completed }}/{{ currentColorInfo?.total }}
          <span class="ml-1 text-white/80 font-medium">{{ progressPercentage }}%</span>
        </span>
      </div>
    </div>

    <!-- 右侧按钮组 -->
    <div class="flex items-center gap-0.5 flex-shrink-0">
      <!-- 计时器 -->
      <span class="text-[11px] font-mono text-white/70 tabular-nums mr-1">{{ elapsedTime }}</span>
      <!-- 暂停/继续 -->
      <button
        @click="handlePauseToggle"
        class="w-10 h-10 rounded-xl flex items-center justify-center active:bg-white/10 transition-colors"
      >
        <!-- 暂停状态：播放图标 -->
        <svg v-if="isPaused" class="w-4.5 h-4.5 text-green-400" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
        <!-- 运行状态：暂停图标 -->
        <svg v-else class="w-4.5 h-4.5 text-white/70" fill="currentColor" viewBox="0 0 24 24">
          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
        </svg>
      </button>
    </div>
  </div>

  <!-- 右侧按钮组 -->
  <div class="pointer-events-auto absolute right-3 bottom-[76px] flex flex-col gap-2">
    <!-- 定位按钮 -->
    <button
      @click="emit('locate')"
      class="w-11 h-11 rounded-[14px] bg-black/50 backdrop-blur-xl shadow-lg flex items-center justify-center active:scale-90 transition-transform"
    >
      <svg class="w-5 h-5 text-white/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="3" />
        <path stroke-linecap="round" d="M12 2v4m0 12v4M2 12h4m12 0h4" />
      </svg>
    </button>
    <!-- 标记完成按钮 -->
    <button
      @click="handleMarkComplete"
      :disabled="!currentColorInfo || currentColorInfo.completed >= currentColorInfo.total"
      class="w-11 h-11 rounded-[14px] bg-green-500 shadow-lg flex items-center justify-center active:scale-90 transition-transform disabled:opacity-30"
    >
      <svg class="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </button>
  </div>
</template>