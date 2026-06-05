<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useFocusStore } from '../stores/focusStore'
import ProgressBar from './ProgressBar.vue'
import FocusColorPanel from './FocusColorPanel.vue'

const emit = defineEmits<{
  (e: 'color-change', color: string): void
}>()

const focusStore = useFocusStore()

const { currentColor, showColorPanel, availableColors, progressPercentage, currentColorInfo, elapsedTime, guidanceModeLabel, recommendedCell } = storeToRefs(focusStore)

function cycleGuidanceMode() { focusStore.cycleGuidanceMode() }
function handleFocusColorChange(color: string) { emit('color-change', color) }
</script>

<template>
  <div class="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3">
    <!-- Current color info -->
    <div v-if="currentColorInfo" class="bg-white rounded-xl border border-black/10 p-4">
      <div class="flex items-center gap-3 mb-3">
        <div class="w-10 h-10 rounded-full border-2 border-black/10" :style="{ backgroundColor: currentColor }"></div>
        <div>
          <div class="text-sm font-medium text-black font-mono">{{ currentColorInfo.name }}</div>
          <div class="text-xs text-black/45">{{ currentColorInfo.completed }}/{{ currentColorInfo.total }} · {{ progressPercentage }}%</div>
        </div>
      </div>
      <div class="flex items-center gap-2 text-xs text-black/45">
        <span>{{ elapsedTime }}</span>
        <span class="text-black/25">|</span>
        <button @click="cycleGuidanceMode" class="px-2 py-0.5 bg-black/[0.04] hover:bg-black/10 rounded-full text-black/60 transition-colors">
          {{ guidanceModeLabel }}
        </button>
      </div>
    </div>

    <!-- Progress bar -->
    <ProgressBar
      :progress-percentage="progressPercentage"
      :recommended-cell="recommendedCell"
      :color-info="currentColorInfo"
    />

    <!-- Focus color panel -->
    <FocusColorPanel
      mode="sidebar"
      :colors="availableColors"
      :current-color="currentColor"
      @color-select="handleFocusColorChange"
      @close="showColorPanel = false"
    />
  </div>
</template>
