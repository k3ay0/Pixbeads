<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useBeadStore } from '../stores/beadStore'
import { usePaletteStore } from '../stores/paletteStore'

const emit = defineEmits<{
  (e: 'open-palette-editor'): void
  (e: 'download-stats'): void
}>()

const beadStore = useBeadStore()
const paletteStore = usePaletteStore()

const { colorCounts, totalBeadCount } = storeToRefs(beadStore)
const { fullBeadPalette } = storeToRefs(paletteStore)

const currentGridColors = computed(() => {
  if (!beadStore.mappedPixelData) return []
  const map = new Map()
  beadStore.mappedPixelData.flat().forEach(cell => {
    if (cell && cell.color && !cell.isExternal) {
      const hex = cell.color.toUpperCase()
      if (!map.has(hex)) map.set(hex, { key: cell.key, color: cell.color })
    }
  })
  return sortColorsByHue(Array.from(map.values()).map(c => ({ key: getColorKeyByHex(c.color, paletteStore.selectedColorSystem), color: c.color })))
})

import { computed } from 'vue'
import { getColorKeyByHex, sortColorsByHue } from '../utils/colorSystemUtils'
</script>

<template>
  <div class="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3">
    <!-- Color stats card -->
    <div v-if="colorCounts" class="bg-white rounded-xl border border-black/10 p-4">
      <h3 class="text-sm font-medium text-black mb-2">
        颜色统计
        <span class="text-xs text-black/35 font-normal ml-1">{{ Object.keys(colorCounts).length }} 种 / {{ totalBeadCount }} 粒</span>
      </h3>
      <div class="max-h-80 overflow-y-auto space-y-1">
        <div v-for="item in currentGridColors" :key="item.color" class="flex items-center gap-2 py-1 px-2 rounded hover:bg-white">
          <div class="w-5 h-5 rounded-md border border-black/10 flex-shrink-0" :style="{ backgroundColor: item.color }"></div>
          <span class="text-xs font-mono flex-1 text-black">{{ item.key }}</span>
          <span class="text-xs text-black/35">{{ colorCounts[item.color.toUpperCase()]?.count || 0 }}</span>
        </div>
      </div>
    </div>

    <!-- Edit palette button -->
    <button
      @click="emit('open-palette-editor')"
      class="w-full px-4 py-2 bg-white border border-black/10 rounded-xl text-sm text-black hover:bg-white transition-colors flex items-center justify-center gap-2"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
      </svg>
      编辑色板 ({{ fullBeadPalette.length }} 色)
    </button>

    <!-- Download stats button -->
    <button
      @click="emit('download-stats')"
      class="w-full px-4 py-2 bg-white border border-black/10 rounded-xl text-sm text-black hover:bg-white transition-colors flex items-center justify-center gap-2"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
      下载颜色统计表
    </button>
  </div>
</template>
