<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useBeadStore } from '../stores/beadStore'
import { usePaletteStore } from '../stores/paletteStore'
import { useCanvasStore } from '../stores/canvasStore'
import { useEditorStore } from '../stores/editorStore'
import { useUiStore } from '../stores/uiStore'

const emit = defineEmits<{
  (e: 'color-select', color: any): void
  (e: 'color-replace', source: any, target: any): void
}>()

const beadStore = useBeadStore()
const paletteStore = usePaletteStore()
const canvasStore = useCanvasStore()
const editorStore = useEditorStore()
const uiStore = useUiStore()

const { mappedPixelData } = storeToRefs(beadStore)
const { selectedColorSystem } = storeToRefs(paletteStore)
const { canvasZoom, canvasTranslate, isDragging, tooltipData, previewCanvas, canvasContainer } = storeToRefs(canvasStore)
const { isManualColoringMode, selectedEditColor, isEraseMode, colorReplaceState, highlightColorKey, showFullPalette, isFloodFillEraseMode, isMagnifierActive, floatingPalette, editHistory, editHistoryIndex } = storeToRefs(editorStore)
const { activeMode } = storeToRefs(uiStore)

const currentGridColors = computed(() => {
  if (!mappedPixelData.value) return []
  const map = new Map()
  mappedPixelData.value.flat().forEach(cell => {
    if (cell && cell.color && !cell.isExternal) {
      const hex = cell.color.toUpperCase()
      if (!map.has(hex)) map.set(hex, { key: cell.key, color: cell.color })
    }
  })
  return sortColorsByHue(Array.from(map.values()).map(c => ({ key: getColorKeyByHex(c.color, selectedColorSystem.value), color: c.color })))
})

import { computed } from 'vue'
import { getColorKeyByHex, sortColorsByHue } from '../utils/colorSystemUtils'

function togglePaletteCollapse() { editorStore.togglePaletteCollapse() }
function toggleEraseMode() { editorStore.toggleEraseMode() }
function enterFloodFillEraseMode() { editorStore.enterFloodFillEraseMode() }
function exitFloodFillEraseMode() { editorStore.exitFloodFillEraseMode() }
function enterColorReplaceMode() { editorStore.enterColorReplaceMode() }
function exitColorReplaceMode() { editorStore.exitColorReplaceMode() }
function undoEdit() { editorStore.undoEdit() }
function redoEdit() { editorStore.redoEdit() }
function selectEditColor(color: any) { emit('color-select', color) }

let dragOffset = { x: 0, y: 0 }
function onPaletteHeaderMouseDown(e: MouseEvent) {
  if (!floatingPalette.value) return
  dragOffset.x = e.clientX - floatingPalette.value.x
  dragOffset.y = e.clientY - floatingPalette.value.y
  document.addEventListener('mousemove', onPaletteDragMove)
  document.addEventListener('mouseup', onPaletteDragEnd)
  document.body.classList.add('palette-dragging')
}
function onPaletteDragMove(e: MouseEvent) {
  if (floatingPalette.value) {
    floatingPalette.value.x = e.clientX - dragOffset.x
    floatingPalette.value.y = e.clientY - dragOffset.y
  }
}
function onPaletteDragEnd() {
  document.removeEventListener('mousemove', onPaletteDragMove)
  document.removeEventListener('mouseup', onPaletteDragEnd)
  document.body.classList.remove('palette-dragging')
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="mappedPixelData && activeMode === 'edit'"
      class="fixed z-40 select-none"
      :style="{ left: floatingPalette.x + 'px', top: floatingPalette.y + 'px' }"
    >
      <div class="bg-white rounded-xl shadow-lg border border-black/10 overflow-hidden" :class="{ 'w-12': floatingPalette.collapsed, 'w-64': !floatingPalette.collapsed }">
        <!-- Drag handle -->
        <div
          class="bg-gradient-to-r from-black to-black/80 px-3 py-2 flex items-center justify-between cursor-move"
          @mousedown="onPaletteHeaderMouseDown"
        >
          <span class="text-white text-xs font-medium" v-if="!floatingPalette.collapsed">调色盘</span>
          <button
            @click.stop="togglePaletteCollapse"
            class="text-white/80 hover:text-white text-xs ml-1"
            :title="floatingPalette.collapsed ? '展开' : '收起'"
          >{{ floatingPalette.collapsed ? '◀' : '▶' }}</button>
        </div>

        <!-- Tool buttons -->
        <div v-if="!floatingPalette.collapsed" class="p-2 border-b border-black/[0.06]">
          <div class="flex gap-1 flex-wrap">
            <button @click="undoEdit" :disabled="editHistoryIndex < 0" class="px-2 py-1 text-xs rounded bg-black/[0.04] text-black/60 hover:bg-black/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" title="撤销 (Ctrl+Z)">↩ 撤销</button>
            <button @click="redoEdit" :disabled="editHistoryIndex >= editHistory.length - 1" class="px-2 py-1 text-xs rounded bg-black/[0.04] text-black/60 hover:bg-black/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" title="重做 (Ctrl+Shift+Z)">↪ 重做</button>
            <button @click="toggleEraseMode()" :class="['px-2 py-1 text-xs rounded transition-colors', isEraseMode ? 'bg-[#f4422f] text-white' : 'bg-black/[0.04] text-black/60 hover:bg-black/10']" title="橡皮擦">🧹 橡皮</button>
            <button @click="isFloodFillEraseMode ? exitFloodFillEraseMode() : enterFloodFillEraseMode()" :class="['px-2 py-1 text-xs rounded transition-colors', isFloodFillEraseMode ? 'bg-orange-500 text-white' : 'bg-black/[0.04] text-black/60 hover:bg-black/10']" title="洪水填充擦除">🪣 区域</button>
            <button @click="colorReplaceState.isActive ? exitColorReplaceMode() : enterColorReplaceMode()" :class="['px-2 py-1 text-xs rounded transition-colors', colorReplaceState.isActive ? 'bg-purple-500 text-white' : 'bg-black/[0.04] text-black/60 hover:bg-black/10']" title="颜色批量替换">🔄 替换</button>
          </div>
        </div>

        <!-- Color grid -->
        <div v-if="!floatingPalette.collapsed" class="p-2 max-h-48 overflow-y-auto">
          <div v-if="currentGridColors.length === 0" class="text-xs text-black/35 text-center py-2">暂无颜色</div>
          <div class="grid grid-cols-8 gap-1">
            <button
              v-for="color in currentGridColors"
              :key="color.color"
              @click="selectEditColor(color)"
              class="w-6 h-6 rounded border border-black/10 hover:scale-125 transition-transform relative group"
              :style="{ backgroundColor: color.color }"
              :title="color.key"
              :class="{ 'ring-2 ring-black ring-offset-1': selectedEditColor?.color === color.color }"
            >
              <span class="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] text-black/45 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none bg-white px-1 rounded shadow">{{ color.key }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
