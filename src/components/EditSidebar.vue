<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useBeadStore } from '../stores/beadStore'
import { usePaletteStore } from '../stores/paletteStore'
import { useEditorStore } from '../stores/editorStore'
import { getColorKeyByHex } from '../utils/colorSystemUtils'
import { TRANSPARENT_KEY } from '../types'
import ColorPalette from './ColorPalette.vue'

const emit = defineEmits<{
  (e: 'trigger-file-input'): void
  (e: 'open-palette-editor'): void
  (e: 'color-select', color: any): void
  (e: 'color-replace', source: any, target: any): void
}>()

const beadStore = useBeadStore()
const paletteStore = usePaletteStore()
const editorStore = useEditorStore()

const { mappedPixelData, colorCounts, totalBeadCount } = storeToRefs(beadStore)
const { selectedColorSystem, customPaletteSelections, excludedColorKeys, activeBeadPalette, showExcludedColors, fullBeadPalette } = storeToRefs(paletteStore)
const { isManualColoringMode, selectedEditColor, isEraseMode, colorReplaceState, highlightColorKey, showFullPalette, isFloodFillEraseMode, isMagnifierActive } = storeToRefs(editorStore)

function toggleMagnifier() { editorStore.toggleMagnifier() }
function enterManualMode() { editorStore.enterManualMode() }
function exitManualMode() { editorStore.exitManualMode() }
function toggleEraseMode() { editorStore.toggleEraseMode() }
function setHighlight(color: string) { editorStore.setHighlight(color) }
function toggleColorReplaceMode() { editorStore.toggleColorReplaceMode() }
function enterColorReplaceMode() { editorStore.enterColorReplaceMode() }
function exitColorReplaceMode() { editorStore.exitColorReplaceMode() }
function enterFloodFillEraseMode() { editorStore.enterFloodFillEraseMode() }
function exitFloodFillEraseMode() { editorStore.exitFloodFillEraseMode() }
function toggleExcludeColor(hex: string) { paletteStore.toggleExcludeColor(hex) }
function restoreAllExcludedColors() { paletteStore.restoreAllExcludedColors() }
function selectEditColor(color: any) { emit('color-select', color) }
</script>

<template>
  <div class="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3">
    <!-- Edit tools card -->
    <div class="bg-white rounded-xl border border-black/10 p-4 space-y-3">
      <h3 class="text-sm font-medium text-black">编辑工具</h3>
      <div class="flex gap-2">
        <button
          @click="isManualColoringMode && toggleMagnifier()"
          :class="['flex-1 px-3 py-1.5 text-xs rounded-lg border transition-colors', isMagnifierActive ? 'bg-cyan-500 text-white border-cyan-500' : 'bg-white text-black/60 border-black/10 hover:border-cyan-300']"
          :disabled="!isManualColoringMode"
        >🔍 放大镜</button>
      </div>
      <div class="flex gap-2 flex-wrap">
        <button
          @click="isManualColoringMode ? exitManualMode() : enterManualMode()"
          :class="['flex-1 px-3 py-1.5 text-xs rounded-lg border transition-colors', isManualColoringMode ? 'bg-black text-white border-black' : 'bg-white text-black/60 border-black/10 hover:border-black/20']"
        >{{ isManualColoringMode ? '退出编辑' : '手动编辑' }}</button>
      </div>

      <ColorPalette
        v-if="isManualColoringMode && currentGridColors.length > 0"
        :colors="currentGridColors"
        :selected-color="selectedEditColor"
        :transparent-key="TRANSPARENT_KEY"
        :selected-color-system="selectedColorSystem"
        :is-erase-mode="isEraseMode"
        :full-palette-colors="activeBeadPalette"
        :show-full-palette="showFullPalette"
        :color-replace-state="colorReplaceState"
        @color-select="emit('color-select', $event)"
        @erase-toggle="toggleEraseMode"
        @highlight-color="setHighlight"
        @toggle-full-palette="showFullPalette = !showFullPalette"
        @color-replace-toggle="toggleColorReplaceMode"
        @color-replace="emit('color-replace', $event.source, $event.target)"
      />

      <p v-if="isManualColoringMode && currentGridColors.length === 0" class="text-xs text-black/35">当前图纸无可用颜色。</p>
    </div>

    <!-- Color palette card -->
    <div class="bg-white rounded-xl border border-black/10 p-4">
      <h3 class="text-sm font-medium text-black mb-3">
        调色盘
        <span class="text-xs text-black/35 font-normal ml-1">{{ currentGridColors.length }} 种</span>
      </h3>
      <div v-if="currentGridColors.length === 0" class="text-xs text-black/35 text-center py-2">暂无颜色</div>
      <div v-else class="grid grid-cols-8 gap-1">
        <button
          v-for="color in currentGridColors"
          :key="color.color"
          @click="selectEditColor(color)"
          class="w-7 h-7 rounded border border-black/10 hover:scale-125 transition-transform relative group"
          :style="{ backgroundColor: color.color }"
          :title="color.key"
          :class="{ 'ring-2 ring-black ring-offset-1': selectedEditColor?.color === color.color }"
        >
          <span class="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] text-black/45 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none bg-white px-1 rounded shadow">{{ color.key }}</span>
        </button>
      </div>
    </div>

    <!-- Color stats/exclude card -->
    <div v-if="colorCounts" class="bg-white rounded-xl border border-black/10 p-4">
      <h3 class="text-sm font-medium text-black mb-2">
        颜色统计
        <span class="text-xs text-black/35 font-normal ml-1">{{ Object.keys(colorCounts).length }} 种 / {{ totalBeadCount }} 粒</span>
      </h3>
      <div class="max-h-60 overflow-y-auto space-y-1">
        <div
          v-for="item in currentGridColors"
          :key="item.color"
          class="flex items-center gap-2 py-1 px-2 rounded hover:bg-white cursor-pointer group"
          :class="excludedColorKeys.has(item.color.toUpperCase()) ? 'bg-[#f4422f]/[0.06] opacity-60' : ''"
          @click="selectEditColor(item)"
        >
          <div class="w-5 h-5 rounded-md border border-black/10 flex-shrink-0" :style="{ backgroundColor: item.color }"></div>
          <span class="text-xs font-mono flex-1" :class="excludedColorKeys.has(item.color.toUpperCase()) ? 'text-[#f4422f] line-through' : 'text-black'">{{ item.key }}</span>
          <span class="text-xs text-black/35">{{ colorCounts[item.color.toUpperCase()]?.count || 0 }}</span>
          <button
            @click.stop="toggleExcludeColor(item.color.toUpperCase())"
            class="text-xs text-[#f4422f]/60 hover:text-[#f4422f]"
            :class="excludedColorKeys.has(item.color.toUpperCase()) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
          >{{ excludedColorKeys.has(item.color.toUpperCase()) ? '恢复' : '✕' }}</button>
        </div>
      </div>

      <!-- Excluded colors panel -->
      <div v-if="excludedColorKeys.size > 0" class="mt-3 pt-3 border-t border-black/[0.06]">
        <button @click="showExcludedColors = !showExcludedColors" class="flex items-center gap-1 text-xs text-[#f4422f] hover:text-[#f4422f] w-full">
          <span>{{ showExcludedColors ? '▼' : '▶' }}</span>
          <span>已排除 {{ excludedColorKeys.size }} 种颜色</span>
        </button>
        <div v-if="showExcludedColors" class="mt-2 space-y-1 max-h-40 overflow-y-auto">
          <div v-for="hex in Array.from(excludedColorKeys)" :key="hex" class="flex items-center gap-2 py-1 px-2 rounded bg-[#f4422f]/[0.06]">
            <div class="w-4 h-4 rounded-md border border-black/10 flex-shrink-0" :style="{ backgroundColor: hex }"></div>
            <span class="text-xs font-mono text-[#f4422f] flex-1">{{ getColorKeyByHex(hex, selectedColorSystem) }}</span>
            <button @click="toggleExcludeColor(hex)" class="text-xs text-[#007be5] hover:text-[#007be5]/80">恢复</button>
          </div>
        </div>
        <button @click="restoreAllExcludedColors" class="mt-2 w-full px-3 py-1.5 text-xs rounded-full border border-black/10 bg-[#007be5]/[0.06] text-black hover:bg-black/[0.06] transition-colors">一键恢复所有颜色</button>
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

    <!-- Empty palette warning -->
    <div v-if="activeBeadPalette.length === 0 && excludedColorKeys.size > 0" class="bg-[#ffbe2e]/[0.08] border border-[#ffbe2e]/20 rounded-xl p-4">
      <p class="text-xs text-black/70 mb-2">所有颜色已被排除，请恢复部分颜色后重试。</p>
      <button @click="restoreAllExcludedColors" class="w-full px-3 py-1.5 text-xs rounded-lg border border-[#ffbe2e]/30 bg-[#ffbe2e]/10 text-black hover:bg-[#ffbe2e]/20 transition-colors">查看已排除颜色</button>
    </div>
  </div>
</template>
