<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useBeadStore } from '../stores/beadStore'
import { usePaletteStore } from '../stores/paletteStore'
import { useEditorStore } from '../stores/editorStore'
import { getColorKeyByHex, sortColorsByHue } from '../utils/colorSystemUtils'
import { TRANSPARENT_KEY } from '../types'

const emit = defineEmits<{
  (e: 'color-select', color: any): void
  (e: 'color-replace', source: any, target: any): void
}>()

const beadStore = useBeadStore()
const paletteStore = usePaletteStore()
const editorStore = useEditorStore()

const { mappedPixelData, colorCounts, totalBeadCount } = storeToRefs(beadStore)
const { selectedColorSystem, excludedColorKeys, activeBeadPalette, showExcludedColors, fullBeadPalette } = storeToRefs(paletteStore)
const {
  isManualColoringMode, selectedEditColor, isEraseMode, colorReplaceState,
  manualTool, manualBrushSize, manualMirrorX, manualMirrorY, manualShapeFill,
  selectionInfo, clipboard, manualPasteActive, showFullPalette, highlightColorKey,
  selectionDragging, isCopyingSelection, moveToolMode
} = storeToRefs(editorStore)

function toggleEraseMode() { editorStore.toggleEraseMode() }
function setHighlight(color: string) { editorStore.setHighlight(color) }
function toggleColorReplaceMode() { editorStore.toggleColorReplaceMode() }
function toggleExcludeColor(hex: string) { paletteStore.toggleExcludeColor(hex) }
function restoreAllExcludedColors() { paletteStore.restoreAllExcludedColors() }
function selectEditColor(color: any) { emit('color-select', color) }
function handleColorReplace() { emit('color-replace', colorReplaceState.value.sourceColor, selectedEditColor.value) }
function clearSelection() { editorStore.clearSelection() }
function clearClipboard() { editorStore.clearClipboard() }
function startPaste() { editorStore.startPaste() }
function cancelPaste() { editorStore.cancelPaste() }

function handleCopy() {
  const info = selectionInfo.value
  if (!info || !mappedPixelData.value) return
  const cells: any[][] = []
  for (let r = info.startRow; r <= info.endRow; r++) {
    const row: any[] = []
    for (let c = info.startCol; c <= info.endCol; c++) {
      const cell = mappedPixelData.value[r]?.[c]
      row.push(cell ? { ...cell } : null)
    }
    cells.push(row)
  }
  editorStore.setClipboard({ cells, width: info.width, height: info.height })
}

function handleCut() {
  handleCopy()
  // TODO: clear the selected area
}

function handleDeleteSelection() {
  const info = selectionInfo.value
  if (!info || !mappedPixelData.value) return
  editorStore.saveSnapshot(mappedPixelData.value)
  for (let r = info.startRow; r <= info.endRow; r++) {
    for (let c = info.startCol; c <= info.endCol; c++) {
      if (mappedPixelData.value[r]?.[c] && !mappedPixelData.value[r][c].isExternal) {
        mappedPixelData.value[r][c] = { key: TRANSPARENT_KEY, color: '#FFFFFF', isExternal: true }
      }
    }
  }
  clearSelection()
}

const currentGridColors = computed(() => {
  if (!mappedPixelData.value) return []
  const map = new Map()
  mappedPixelData.value.flat().forEach((cell: any) => {
    if (cell && cell.color && !cell.isExternal) {
      const hex = cell.color.toUpperCase()
      if (!map.has(hex)) map.set(hex, { key: cell.key, color: cell.color })
    }
  })
  return sortColorsByHue(Array.from(map.values()).map((c: any) => ({ key: getColorKeyByHex(c.color, selectedColorSystem.value), color: c.color })))
})

const toolNameMap: Record<string, string> = {
  drag: '拖拽', brush: '画笔', eraser: '橡皮', picker: '取色',
  fill: '填充', line: '直线', rect: '矩形', select: '选区', move: '移动', paste: '粘贴'
}
</script>

<template>
  <div class="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3">
    <!-- Status indicator (color replace / erase mode) -->
    <div
      v-if="colorReplaceState.isActive || isEraseMode"
      class="rounded-xl border px-3 py-2 text-xs"
      :class="colorReplaceState.isActive ? 'border-blue-500/30 bg-blue-500/5 text-blue-600' : 'border-red-300/50 bg-red-50/50 text-red-600'"
    >
      <template v-if="colorReplaceState.isActive">
        {{ colorReplaceState.step === 'select-source' ? '第一步，在画布上点击选择源颜色' : '第二步，在色板中选择目标颜色' }}
      </template>
      <template v-else>点击画布擦除同色连通区域</template>
    </div>

    <!-- Tool settings panel -->
    <div class="bg-white rounded-xl border border-black/10 shadow-sm px-4 py-3 space-y-3">
      <div class="text-sm font-bold text-gray-700">
        {{ toolNameMap[manualPasteActive ? 'paste' : manualTool] || manualTool }}
      </div>

      <!-- Brush / Line / Rect settings -->
      <template v-if="manualTool === 'brush' || manualTool === 'line' || manualTool === 'rect'">
        <div class="space-y-2">
          <div class="flex items-center justify-between text-xs text-gray-600">
            <span class="font-medium">笔刷大小</span>
            <span class="tabular-nums">{{ manualBrushSize }}</span>
          </div>
          <input
            v-model.number="manualBrushSize"
            type="range"
            :min="1"
            :max="7"
            :step="1"
            class="w-full accent-blue-500"
          />
          <div class="flex flex-wrap gap-1.5">
            <button
              @click="manualMirrorX = !manualMirrorX"
              :class="[
                'px-2.5 py-1.5 text-xs rounded-lg border transition-colors',
                manualMirrorX ? 'bg-gray-900 text-gray-50 border-gray-900' : 'bg-gray-50 text-gray-600 border-gray-200 active:bg-gray-200'
              ]"
            >↔ 镜像</button>
            <button
              @click="manualMirrorY = !manualMirrorY"
              :class="[
                'px-2.5 py-1.5 text-xs rounded-lg border transition-colors',
                manualMirrorY ? 'bg-gray-900 text-gray-50 border-gray-900' : 'bg-gray-50 text-gray-600 border-gray-200 active:bg-gray-200'
              ]"
            >↕ 镜像</button>
          </div>
        </div>
        <!-- Rect fill toggle -->
        <button
          v-if="manualTool === 'rect'"
          @click="manualShapeFill = !manualShapeFill"
          :class="[
            'px-2.5 py-1.5 text-xs rounded-lg border transition-colors w-full',
            manualShapeFill ? 'bg-gray-900 text-gray-50 border-gray-900' : 'bg-gray-50 text-gray-600 border-gray-200 active:bg-gray-200'
          ]"
        >{{ manualShapeFill ? '实心填充' : '仅描边' }}</button>
      </template>

      <!-- Eraser settings -->
      <template v-if="manualTool === 'eraser'">
        <div class="space-y-2">
          <div class="flex items-center justify-between text-xs text-gray-600">
            <span class="font-medium">笔刷大小</span>
            <span class="tabular-nums">{{ manualBrushSize }}</span>
          </div>
          <input
            v-model.number="manualBrushSize"
            type="range"
            :min="1"
            :max="7"
            :step="1"
            class="w-full accent-blue-500"
          />
        </div>
        <button
          @click="toggleEraseMode()"
          :class="[
            'px-2.5 py-1.5 text-xs rounded-lg border transition-colors w-full',
            isEraseMode ? 'bg-gray-900 text-gray-50 border-gray-900' : 'bg-gray-50 text-gray-600 border-gray-200 active:bg-gray-200'
          ]"
        >{{ isEraseMode ? '退出区域擦除模式' : '区域擦除（同色连通）' }}</button>
      </template>

      <!-- Picker hint -->
      <template v-if="manualTool === 'picker'">
        <p class="text-xs text-gray-400 py-1">在画布上点击拾取颜色</p>
      </template>

      <!-- Fill settings -->
      <template v-if="manualTool === 'fill'">
        <button
          @click="toggleColorReplaceMode()"
          :class="[
            'px-2.5 py-1.5 text-xs rounded-lg border transition-colors w-full',
            colorReplaceState.isActive ? 'bg-gray-900 text-gray-50 border-gray-900' : 'bg-gray-50 text-gray-600 border-gray-200 active:bg-gray-200'
          ]"
        >{{ colorReplaceState.isActive ? '退出批量替换模式' : '批量替换颜色' }}</button>
      </template>

      <!-- Select tool: 仅选区操作 -->
      <template v-if="manualTool === 'select'">
        <div class="space-y-2">
          <p class="text-xs text-gray-400">点击拖拽创建选区，松开后选区确定</p>
          <div v-if="selectionInfo" class="flex items-center justify-between text-xs text-gray-600">
            <span class="font-medium">选区尺寸</span>
            <span class="tabular-nums">{{ selectionInfo.width }}×{{ selectionInfo.height }}</span>
          </div>
          <div v-if="selectionInfo" class="flex flex-wrap gap-1.5">
            <button
              @click="editorStore.setManualTool('move')"
              class="px-2.5 py-1.5 text-xs rounded-lg border bg-gray-900 text-gray-50 border-gray-900 transition-colors"
            >移动选区</button>
            <button
              @click="clearSelection()"
              class="px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 active:bg-gray-200 transition-colors"
            >取消选区</button>
          </div>
        </div>
      </template>

      <!-- Move tool: 移动/复制操作 -->
      <template v-if="manualTool === 'move'">
        <div class="space-y-2">
          <!-- 拖拽状态提示 -->
          <div v-if="selectionDragging" class="rounded-lg px-2.5 py-1.5 text-xs border"
            :class="isCopyingSelection ? 'border-green-300 bg-green-50 text-green-700' : 'border-orange-300 bg-orange-50 text-orange-700'">
            {{ isCopyingSelection ? '📋 复制模式' : '✂️ 剪贴模式' }} — 松开鼠标完成
          </div>
          <template v-else>
            <p class="text-xs text-gray-400">在选区内拖拽移动内容，按住 Ctrl 临时切换模式</p>
          </template>
          <!-- 模式切换 -->
          <div class="flex items-center gap-1.5">
            <button
              @click="editorStore.toggleMoveToolMode()"
              :class="[
                'flex-1 px-2.5 py-1.5 text-xs rounded-lg border transition-colors',
                moveToolMode === 'copy' ? 'bg-green-500 text-white border-green-500' : 'bg-orange-500 text-white border-orange-500'
              ]"
            >{{ moveToolMode === 'copy' ? '📋 复制模式' : '✂️ 剪贴模式' }}</button>
          </div>
          <div class="flex items-center justify-between text-xs text-gray-600">
            <span class="font-medium">选区尺寸</span>
            <span class="tabular-nums">{{ selectionInfo ? `${selectionInfo.width}×${selectionInfo.height}` : '无' }}</span>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <button @click="handleDeleteSelection" :disabled="!selectionInfo"
              class="px-2 py-1 text-xs rounded-lg border border-gray-200 text-gray-600 active:bg-gray-200 transition-colors disabled:opacity-30"
            >清空选区</button>
            <button @click="clearSelection()"
              class="px-2 py-1 text-xs rounded-lg border border-gray-200 text-gray-600 active:bg-gray-200 transition-colors"
            >取消选区</button>
          </div>
        </div>
      </template>

      <!-- Paste mode -->
      <template v-if="manualPasteActive">
        <div class="space-y-2">
          <p class="text-xs text-gray-400">在画布上点击放置粘贴内容</p>
          <button @click="cancelPaste"
            class="px-2 py-1 text-xs rounded-lg border border-gray-200 text-gray-600 active:bg-gray-200 transition-colors w-full"
          >取消粘贴</button>
        </div>
      </template>

      <!-- Drag hint -->
      <template v-if="manualTool === 'drag'">
        <p class="text-xs text-gray-400 py-1">拖拽画布进行平移</p>
      </template>
    </div>

    <!-- Color palette card -->
    <div class="bg-white rounded-xl border border-black/10 p-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-medium text-black">
          调色盘
          <span class="text-xs text-black/35 font-normal ml-1">{{ currentGridColors.length }} 种</span>
        </h3>
        <button
          v-if="activeBeadPalette.length > 0"
          @click="showFullPalette = !showFullPalette"
          class="text-[10px] px-2 py-1 rounded border transition-colors"
          :class="showFullPalette ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-gray-50 text-gray-500 border-gray-200'"
        >
          {{ showFullPalette ? '图中色' : '全部色' }}
        </button>
      </div>
      <div v-if="currentGridColors.length === 0 && !showFullPalette" class="text-xs text-black/35 text-center py-2">暂无颜色</div>
      <div v-else class="grid grid-cols-8 gap-1">
        <button
          v-for="color in (showFullPalette ? activeBeadPalette.map((c: any) => ({ key: getColorKeyByHex(c.hex, selectedColorSystem), color: c.hex })) : currentGridColors)"
          :key="color.color"
          @click="selectEditColor(color)"
          class="w-7 h-7 rounded border border-black/10 hover:scale-125 transition-transform relative flex items-center justify-center aspect-square"
          :style="{ backgroundColor: color.color }"
          :title="`${color.key} (${color.color})`"
          :class="[
            selectedEditColor?.color === color.color
              ? 'border-brand-500 ring-2 ring-brand-500/30 scale-105'
              : 'border-black/10'
          ]"
        >
          <span class="text-[9px] font-bold leading-none text-gray-900/70 select-none">{{ color.key }}</span>
        </button>
      </div>
    </div>

    <!-- Color stats card -->
    <div v-if="colorCounts" class="bg-white rounded-xl border border-black/10 p-4">
      <h3 class="text-sm font-medium text-black mb-2">
        颜色统计
        <span class="text-xs text-black/35 font-normal ml-1">{{ Object.keys(colorCounts).length }} 种 / {{ totalBeadCount }} 粒</span>
      </h3>
      <div class="max-h-60 overflow-y-auto space-y-1">
        <div
          v-for="item in currentGridColors"
          :key="item.color"
          class="flex items-center gap-2 py-1 px-2 rounded hover:bg-gray-50 cursor-pointer group"
          :class="excludedColorKeys.has(item.color.toUpperCase()) ? 'bg-red-50 opacity-60' : ''"
          @click="selectEditColor(item)"
        >
          <div class="w-5 h-5 rounded-md border border-black/10 flex-shrink-0" :style="{ backgroundColor: item.color }"></div>
          <span class="text-xs font-mono flex-1" :class="excludedColorKeys.has(item.color.toUpperCase()) ? 'text-red-500 line-through' : 'text-black'">{{ item.key }}</span>
          <span class="text-xs text-black/35">{{ colorCounts[item.color.toUpperCase()]?.count || 0 }}</span>
          <button
            @click.stop="toggleExcludeColor(item.color.toUpperCase())"
            class="text-xs text-red-400 hover:text-red-600"
            :class="excludedColorKeys.has(item.color.toUpperCase()) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
          >{{ excludedColorKeys.has(item.color.toUpperCase()) ? '恢复' : '✕' }}</button>
        </div>
      </div>

      <!-- Excluded colors panel -->
      <div v-if="excludedColorKeys.size > 0" class="mt-3 pt-3 border-t border-black/[0.06]">
        <button @click="showExcludedColors = !showExcludedColors" class="flex items-center gap-1 text-xs text-red-500 hover:text-red-600 w-full">
          <span>{{ showExcludedColors ? '▼' : '▶' }}</span>
          <span>已排除 {{ excludedColorKeys.size }} 种颜色</span>
        </button>
        <div v-if="showExcludedColors" class="mt-2 space-y-1 max-h-40 overflow-y-auto">
          <div v-for="hex in Array.from(excludedColorKeys)" :key="hex" class="flex items-center gap-2 py-1 px-2 rounded bg-red-50">
            <div class="w-4 h-4 rounded-md border border-black/10 flex-shrink-0" :style="{ backgroundColor: hex }"></div>
            <span class="text-xs font-mono text-red-500 flex-1">{{ getColorKeyByHex(hex, selectedColorSystem) }}</span>
            <button @click="toggleExcludeColor(hex)" class="text-xs text-blue-500 hover:text-blue-600">恢复</button>
          </div>
        </div>
        <button @click="restoreAllExcludedColors" class="mt-2 w-full px-3 py-1.5 text-xs rounded-lg border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">一键恢复所有颜色</button>
      </div>
    </div>
  </div>
</template>
