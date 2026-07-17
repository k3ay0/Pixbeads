<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useFocusStore } from '../stores/focusStore'
import { useBeadStore } from '../stores/beadStore'
import ProgressBar from './ProgressBar.vue'

const emit = defineEmits<{
  (e: 'color-change', color: string): void
}>()

const focusStore = useFocusStore()
const beadStore = useBeadStore()

const {
  currentColor,
  availableColors,
  progressPercentage,
  currentColorInfo,
  elapsedTime,
  guidanceMode,
  guidanceModeLabel,
  recommendedCell,
  gridSectionInterval,
  showSectionLines,
  sectionLineColor,
  showCoordinates,
  coordinateInterval,
  showColorCodes,
  showConfetti,
} = storeToRefs(focusStore)

const guidanceModes = ['nearest', 'largest', 'edge-first'] as const
const sectionLineColors = [
  { value: '#007acc', label: '蓝色' },
  { value: '#28a745', label: '绿色' },
  { value: '#dc3545', label: '红色' },
  { value: '#6f42c1', label: '紫色' },
  { value: '#fd7e14', label: '橙色' },
  { value: '#6c757d', label: '灰色' },
]

function setGuidanceMode(mode: typeof guidanceModes[number]) {
  focusStore.guidanceMode = mode
  focusStore.calculateRecommendedRegion(null)
}

function handleFocusColorChange(color: string) {
  emit('color-change', color)
}

function cycleGuidanceMode() {
  focusStore.cycleGuidanceMode()
}

function toggleSectionLines() {
  showSectionLines.value = !showSectionLines.value
}

function toggleConfetti() {
  showConfetti.value = !showConfetti.value
}

function toggleCoordinates() {
  showCoordinates.value = !showCoordinates.value
}

function toggleColorCodes() {
  showColorCodes.value = !showColorCodes.value
}

function setSectionLineColor(color: string) {
  sectionLineColor.value = color
}

function handleCompleteColor() {
  focusStore.completeEntireCurrentColor(beadStore.mappedPixelData)
}
</script>

<template>
  <div class="flex-1 overflow-y-auto scrollbar-hide px-3 py-3 flex flex-col gap-3">
    <div class="animate-mode-fade flex flex-col gap-4">
      <!-- Progress bar -->
      <ProgressBar
        :progress-percentage="progressPercentage"
        :recommended-cell="recommendedCell"
        :color-info="currentColorInfo"
        @complete-color="handleCompleteColor"
      />

      <!-- Guidance strategy -->
      <div class="rounded-xl border border-gray-200/60 dark:border-gray-800/50 bg-gray-50/95 dark:bg-gray-900/80 p-4 shadow-sm shadow-gray-200/50">
        <h3 class="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">引导策略</h3>
        <div class="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
          <button
            v-for="mode in guidanceModes"
            :key="mode"
            @click="setGuidanceMode(mode)"
            class="flex-1 py-2 text-[13px] rounded-[10px] transition-all"
            :class="guidanceMode === mode
              ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-gray-100 font-medium'
              : 'text-gray-500 dark:text-gray-400 active:bg-gray-200/50'"
          >
            {{ mode === 'nearest' ? '最近优先' : mode === 'largest' ? '大块优先' : '边缘优先' }}
          </button>
        </div>
      </div>

      <!-- Grid section lines -->
      <div class="rounded-xl border border-gray-200/60 dark:border-gray-800/50 bg-gray-50/95 dark:bg-gray-900/80 p-4 shadow-sm shadow-gray-200/50 space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold text-gray-800 dark:text-gray-200">网格分割线</h3>
          <button
            @click="toggleSectionLines"
            class="relative w-11 h-[26px] rounded-full transition-colors"
            :class="showSectionLines ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'"
          >
            <div
              class="absolute top-[3px] w-5 h-5 rounded-full bg-white shadow-sm transition-transform"
              :class="showSectionLines ? 'translate-x-[22px]' : 'translate-x-[3px]'"
            />
          </button>
        </div>
        <div v-if="showSectionLines" class="space-y-3">
          <div class="flex items-center gap-3">
            <span class="text-xs text-gray-500 dark:text-gray-400 w-8">间隔</span>
            <input
              v-model.number="gridSectionInterval"
              min="5"
              max="20"
              class="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none accent-green-500"
              type="range"
            />
            <span class="text-xs text-gray-500 dark:text-gray-400 tabular-nums w-7 text-right">{{ gridSectionInterval }}格</span>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-xs text-gray-500 dark:text-gray-400 w-8">颜色</span>
            <div class="flex gap-2">
              <button
                v-for="color in sectionLineColors"
                :key="color.value"
                @click="setSectionLineColor(color.value)"
                class="w-6 h-6 rounded-full transition-all"
                :class="sectionLineColor === color.value
                  ? 'ring-2 ring-gray-800 dark:ring-gray-200 ring-offset-2 ring-offset-gray-50 dark:ring-offset-gray-900 scale-110'
                  : 'border border-gray-200 dark:border-gray-600'"
                :title="color.label"
                :style="{ backgroundColor: color.value }"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Confetti toggle -->
      <div class="rounded-xl border border-gray-200/60 dark:border-gray-800/50 bg-gray-50/95 dark:bg-gray-900/80 p-4 shadow-sm shadow-gray-200/50">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold text-gray-800 dark:text-gray-200">完成撒花</h3>
          <button
            @click="toggleConfetti"
            class="relative w-11 h-[26px] rounded-full transition-colors"
            :class="showConfetti ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'"
          >
            <div
              class="absolute top-[3px] w-5 h-5 rounded-full bg-white shadow-sm transition-transform"
              :class="showConfetti ? 'translate-x-[22px]' : 'translate-x-[3px]'"
            />
          </button>
        </div>
      </div>

      <!-- Coordinates toggle -->
      <div
        class="rounded-xl border border-gray-200/60 dark:border-gray-800/50 bg-gray-50/95 dark:bg-gray-900/80 p-4 shadow-sm shadow-gray-200/50 space-y-3">
        <h3 class="text-sm font-semibold text-gray-800 dark:text-gray-200">显示设置</h3>
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold text-gray-800 dark:text-gray-200">显示坐标</h3>
          <button @click="toggleCoordinates" class="relative w-11 h-[26px] rounded-full transition-colors"
            :class="showCoordinates ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'">
            <div class="absolute top-[3px] w-5 h-5 rounded-full bg-white shadow-sm transition-transform"
              :class="showCoordinates ? 'translate-x-[22px]' : 'translate-x-[3px]'" />
          </button>
        </div>
        <div v-if="showCoordinates" class="flex items-center gap-3">
          <span class="text-xs text-gray-500 dark:text-gray-400 w-8">间隔</span>
          <input v-model.number="coordinateInterval" min="1" max="10"
            class="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none accent-green-500"
            type="range" />
          <span class="text-xs text-gray-500 dark:text-gray-400 tabular-nums w-7 text-right">{{ coordinateInterval === 1
            ? '连续' : coordinateInterval }}</span>
        </div>
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold text-gray-800 dark:text-gray-200">显示色号</h3>
          <button @click="toggleColorCodes" class="relative w-11 h-[26px] rounded-full transition-colors"
            :class="showColorCodes ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'">
            <div class="absolute top-[3px] w-5 h-5 rounded-full bg-white shadow-sm transition-transform"
              :class="showColorCodes ? 'translate-x-[22px]' : 'translate-x-[3px]'" />
          </button>
        </div>
      </div>

      <!-- Overall progress -->
      <div class="rounded-xl border border-gray-200/60 dark:border-gray-800/50 bg-gray-50/95 dark:bg-gray-900/80 p-4 shadow-sm shadow-gray-200/50">
        <h3 class="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">总体进度</h3>
        <div class="space-y-2">
          <div
            v-for="colorInfo in availableColors"
            :key="colorInfo.color"
            class="flex items-center gap-2"
          >
            <div
              class="w-4 h-4 rounded-full flex-shrink-0"
              :style="{ backgroundColor: colorInfo.color }"
            />
            <span class="text-xs font-mono text-gray-500 dark:text-gray-400 flex-1 truncate">
              {{ colorInfo.name }}
            </span>
            <span class="text-xs text-gray-400 dark:text-gray-500 font-mono">
              {{ colorInfo.completed }}/{{ colorInfo.total }}
            </span>
            <div class="w-16 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-300"
                :class="colorInfo.completed >= colorInfo.total ? 'bg-green-500' : 'bg-blue-500 dark:bg-blue-400'"
                :style="{
                  width: `${colorInfo.total > 0 ? Math.round((colorInfo.completed / colorInfo.total) * 100) : 0}%`
                }"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
