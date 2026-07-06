<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useBeadStore } from '../stores/beadStore'
import { usePaletteStore } from '../stores/paletteStore'
import { useEditorStore } from '../stores/editorStore'
import { getColorKeyByHex, sortColorsByHue } from '../utils/colorSystemUtils'
import { hexToRgb } from '../utils/pixelation'
import { findClosestPaletteColor, isLightColor } from '../utils/colorUtils'
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
  selectionDragging, isCopyingSelection, moveToolMode, isFloodFillEraseMode
} = storeToRefs(editorStore)

function toggleEraseMode() { editorStore.toggleEraseMode() }
function enterFloodFillEraseMode() { editorStore.enterFloodFillEraseMode() }
function exitFloodFillEraseMode() { editorStore.exitFloodFillEraseMode() }
function setHighlight(color: string) { editorStore.setHighlight(color) }
function toggleColorReplaceMode() { editorStore.toggleColorReplaceMode() }
function toggleExcludeColor(hex: string) { paletteStore.toggleExcludeColor(hex) }
function restoreAllExcludedColors() { paletteStore.restoreAllExcluded() }
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
}

// 色板面板本地状态
const colorPanelCollapsed = ref(false)
const hueSortEnabled = ref(false)
const showAllColors = ref(false) // false=当前图中色, true=全部色块

// ========== HSV 颜色选择器 ==========
const pickerHue = ref(0)        // 0-360
const pickerSat = ref(100)      // 0-100 饱和度
const pickerVal = ref(100)      // 0-100 明度
const pickerHexInput = ref('#FF0000')
const pickerR = ref(255)
const pickerG = ref(0)
const pickerB = ref(0)
const pickerH = ref(0)
const pickerS = ref(100)
const pickerL = ref(50)
const pickerSource = ref<'hsv' | 'hex' | 'rgb' | 'hsl'>('hsv')

// 拖拽状态
const satPanelRef = ref<HTMLElement | null>(null)
const hueBarRef = ref<HTMLElement | null>(null)
const isDraggingSat = ref(false)
const isDraggingHue = ref(false)

// HSV -> RGB
function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  s /= 100; v /= 100
  const c = v * s
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else { r = c; b = x }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  }
}

// RGB -> HSV
function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 }
}

// RGB -> HSL
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0, s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
    else if (max === g) h = ((b - r) / d + 2) * 60
    else h = ((r - g) / d + 4) * 60
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
}

// HSL -> RGB
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  s /= 100; l /= 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else { r = c; b = x }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  }
}

// RGB -> HEX
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase()
}

// 当前选择器颜色的 HEX 值
const pickerHex = computed(() => {
  const rgb = hsvToRgb(pickerHue.value, pickerSat.value, pickerVal.value)
  return rgbToHex(rgb.r, rgb.g, rgb.b)
})

// 最近拼豆色
const closestBeadColor = computed(() => {
  const rgb = hexToRgb(pickerHex.value)
  if (!rgb || !activeBeadPalette.value.length) return null
  const palette = activeBeadPalette.value.map((c: any) => ({
    key: c.key,
    hex: c.hex,
    rgb: hexToRgb(c.hex) || { r: 0, g: 0, b: 0 }
  }))
  const closest = findClosestPaletteColor(rgb, palette)
  // 返回转换后的色号
  return {
    ...closest,
    displayKey: getColorKeyByHex(closest.hex, selectedColorSystem.value)
  }
})

// 同步 HSV -> 输入框
watch([pickerHue, pickerSat, pickerVal], () => {
  if (pickerSource.value !== 'hsv') return
  const rgb = hsvToRgb(pickerHue.value, pickerSat.value, pickerVal.value)
  pickerR.value = rgb.r; pickerG.value = rgb.g; pickerB.value = rgb.b
  pickerHexInput.value = rgbToHex(rgb.r, rgb.g, rgb.b)
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b)
  pickerH.value = hsl.h; pickerS.value = hsl.s; pickerL.value = hsl.l
}, { immediate: true })

// 从 HEX 输入更新
function updateFromHex() {
  const hex = pickerHexInput.value.trim()
  const rgb = hexToRgb(hex)
  if (!rgb) return
  pickerSource.value = 'hex'
  pickerR.value = rgb.r; pickerG.value = rgb.g; pickerB.value = rgb.b
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b)
  pickerHue.value = hsv.h; pickerSat.value = hsv.s; pickerVal.value = hsv.v
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b)
  pickerH.value = hsl.h; pickerS.value = hsl.s; pickerL.value = hsl.l
  nextTick(() => { pickerSource.value = 'hsv' })
}

// 从 RGB 输入更新
function updateFromRgb() {
  pickerSource.value = 'rgb'
  const r = Math.max(0, Math.min(255, pickerR.value))
  const g = Math.max(0, Math.min(255, pickerG.value))
  const b = Math.max(0, Math.min(255, pickerB.value))
  pickerR.value = r; pickerG.value = g; pickerB.value = b
  pickerHexInput.value = rgbToHex(r, g, b)
  const hsv = rgbToHsv(r, g, b)
  pickerHue.value = hsv.h; pickerSat.value = hsv.s; pickerVal.value = hsv.v
  const hsl = rgbToHsl(r, g, b)
  pickerH.value = hsl.h; pickerS.value = hsl.s; pickerL.value = hsl.l
  nextTick(() => { pickerSource.value = 'hsv' })
}

// 从 HSL 输入更新
function updateFromHsl() {
  pickerSource.value = 'hsl'
  const h = Math.max(0, Math.min(360, pickerH.value))
  const s = Math.max(0, Math.min(100, pickerS.value))
  const l = Math.max(0, Math.min(100, pickerL.value))
  pickerH.value = h; pickerS.value = s; pickerL.value = l
  const rgb = hslToRgb(h, s, l)
  pickerR.value = rgb.r; pickerG.value = rgb.g; pickerB.value = rgb.b
  pickerHexInput.value = rgbToHex(rgb.r, rgb.g, rgb.b)
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b)
  pickerHue.value = hsv.h; pickerSat.value = hsv.s; pickerVal.value = hsv.v
  nextTick(() => { pickerSource.value = 'hsv' })
}

// 饱和度/明度面板拖拽
function startSatDrag(e: MouseEvent | TouchEvent) {
  isDraggingSat.value = true
  updateSatFromEvent(e)
}
function updateSatFromEvent(e: MouseEvent | TouchEvent) {
  const panel = satPanelRef.value
  if (!panel) return
  const rect = panel.getBoundingClientRect()
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
  pickerSat.value = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100))
  pickerVal.value = Math.max(0, Math.min(100, 100 - ((clientY - rect.top) / rect.height) * 100))
}

// 色相滑块拖拽
function startHueDrag(e: MouseEvent | TouchEvent) {
  isDraggingHue.value = true
  updateHueFromEvent(e)
}
function updateHueFromEvent(e: MouseEvent | TouchEvent) {
  const bar = hueBarRef.value
  if (!bar) return
  const rect = bar.getBoundingClientRect()
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
  pickerHue.value = Math.max(0, Math.min(360, ((clientX - rect.left) / rect.width) * 360))
}

function onPickerMove(e: MouseEvent | TouchEvent) {
  if (isDraggingSat.value) updateSatFromEvent(e)
  if (isDraggingHue.value) updateHueFromEvent(e)
}
function onPickerEnd() {
  isDraggingSat.value = false
  isDraggingHue.value = false
}

// 使用选择器颜色
function usePickerColor() {
  if (closestBeadColor.value) {
    selectEditColor({ key: closestBeadColor.value.key, color: closestBeadColor.value.hex })
  }
}

// 安装全局拖拽监听
onMounted(() => {
  window.addEventListener('mousemove', onPickerMove)
  window.addEventListener('mouseup', onPickerEnd)
  window.addEventListener('touchmove', onPickerMove)
  window.addEventListener('touchend', onPickerEnd)
})
onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onPickerMove)
  window.removeEventListener('mouseup', onPickerEnd)
  window.removeEventListener('touchmove', onPickerMove)
  window.removeEventListener('touchend', onPickerEnd)
})

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
  // 实时从像素数据计算颜色统计
  const colorMap = new Map<string, { key: string; color: string; count: number }>()
  for (const row of mappedPixelData.value) {
    for (const cell of row) {
      if (cell && !cell.isExternal && cell.key !== TRANSPARENT_KEY) {
        const hex = cell.color.toUpperCase()
        const existing = colorMap.get(hex)
        if (existing) {
          existing.count++
        } else {
          colorMap.set(hex, {
            key: getColorKeyByHex(hex, selectedColorSystem.value),
            color: hex,
            count: 1
          })
        }
      }
    }
  }
  return sortColorsByHue(Array.from(colorMap.values()))
})

// 展示用颜色列表（支持色相排序）
const displayColors = computed(() => {
  const colors = showAllColors.value
    ? activeBeadPalette.value.map((c: any) => ({ key: getColorKeyByHex(c.hex, selectedColorSystem.value), color: c.hex }))
    : currentGridColors.value
  if (hueSortEnabled.value) return sortColorsByHue(colors)
  return colors
})

const toolNameMap: Record<string, string> = {
  drag: '拖拽', brush: '画笔', eraser: '橡皮', picker: '取色',
  fill: '填充', line: '直线', rect: '矩形', select: '选区', move: '移动', paste: '粘贴'
}
</script>

<template>
  <div class="flex-1 overflow-y-auto scrollbar-hide px-3 py-3 flex flex-col gap-3">
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
          @click="isFloodFillEraseMode ? exitFloodFillEraseMode() : enterFloodFillEraseMode()"
          :class="[
            'px-2.5 py-1.5 text-xs rounded-lg border transition-colors w-full',
            isFloodFillEraseMode ? 'bg-gray-900 text-gray-50 border-gray-900' : 'bg-gray-50 text-gray-600 border-gray-200 active:bg-gray-200'
          ]"
        >{{ isFloodFillEraseMode ? '退出区域擦除模式' : '区域擦除（同色连通）' }}</button>
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
    <div class="rounded-xl border border-gray-200/60 dark:border-gray-800/50 bg-gray-50/95 dark:bg-gray-900/80 shadow-sm overflow-hidden flex-shrink-0">
      <button
        class="w-full flex items-center justify-between px-4 py-3 active:bg-gray-100 dark:active:bg-gray-800 transition-colors"
        @click="colorPanelCollapsed = !colorPanelCollapsed"
      >
        <span class="text-xs font-semibold text-gray-500 dark:text-gray-400">色板</span>
        <div class="flex items-center gap-2">
          <div v-if="selectedEditColor" class="flex items-center gap-1.5">
            <span class="w-4 h-4 rounded border border-gray-300 dark:border-gray-500" :style="{ backgroundColor: selectedEditColor.color }"></span>
            <span class="text-[10px] text-gray-500 dark:text-gray-400">{{ selectedEditColor.key }}</span>
          </div>
          <svg
            class="w-3.5 h-3.5 text-gray-500 dark:text-gray-400 transition-transform"
            :class="{ 'rotate-180': !colorPanelCollapsed }"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"></path>
          </svg>
        </div>
      </button>
      <div v-if="!colorPanelCollapsed" class="w-full select-none">
        <div class="p-3">
          <div class="flex gap-1.5 mb-3">
            <div class="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
              <button
                class="text-xs py-1 px-2.5 rounded-md transition-colors"
                :class="!showFullPalette ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 active:text-gray-700'"
                @click="showFullPalette = false"
              >色块</button>
              <button
                class="text-xs py-1 px-2.5 rounded-md transition-colors"
                :class="showFullPalette ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 active:text-gray-700'"
                @click="showFullPalette = true"
              >色盘</button>
            </div>
            <template v-if="!showFullPalette">
              <button
                class="flex-1 text-xs py-1.5 px-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg active:bg-gray-200 dark:active:bg-gray-600 transition-colors"
                @click="showAllColors = !showAllColors"
              >{{ showAllColors ? '全部' : '当前' }} ({{ displayColors.length }})</button>
              <button
                class="text-xs py-1.5 px-2.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg active:bg-gray-200 dark:active:bg-gray-600 transition-colors whitespace-nowrap"
                :class="hueSortEnabled ? 'ring-1 ring-gray-400 dark:ring-gray-500' : ''"
                @click="hueSortEnabled = !hueSortEnabled"
              >色相排序</button>
            </template>
          </div>

          <!-- 色块模式：颜色网格 -->
          <template v-if="!showFullPalette">
            <div v-if="displayColors.length === 0" class="text-xs text-gray-400 dark:text-gray-500 text-center py-2">暂无颜色</div>
            <div v-else class="grid grid-cols-6 gap-1.5">
              <button
                v-for="color in displayColors"
                :key="color.color"
                @click="selectEditColor(color)"
                class="relative rounded-lg border-2 transition-all duration-150 active:scale-95 flex items-center justify-center"
                :style="{ backgroundColor: color.color, aspectRatio: '1 / 1' }"
                :title="`${color.key} (${color.color})`"
                :class="[
                  selectedEditColor?.color === color.color
                    ? 'border-gray-900 dark:border-gray-100 ring-2 ring-gray-900/20 dark:ring-gray-100/20'
                    : 'border-gray-200 dark:border-gray-600 active:border-gray-400 dark:active:border-gray-400'
                ]"
              >
                <span
                  class="text-[9px] font-bold leading-none select-none"
                  :class="isLightColor(color.color) ? 'text-gray-900/70' : 'text-white/80'"
                >{{ color.key }}</span>
              </button>
            </div>
          </template>

          <!-- 色盘模式：HSV 颜色选择器 -->
          <template v-else>
            <div class="space-y-3">
              <!-- 饱和度/明度面板 -->
              <div
                ref="satPanelRef"
                class="relative rounded-lg cursor-crosshair touch-none select-none overflow-hidden"
                style="aspect-ratio: 224 / 144;"
                @mousedown="startSatDrag"
                @touchstart.prevent="startSatDrag"
              >
                <div class="absolute inset-0" :style="{ backgroundColor: `hsl(${pickerHue}, 100%, 50%)` }"></div>
                <div class="absolute inset-0" style="background: linear-gradient(to right, rgb(255, 255, 255), transparent);"></div>
                <div class="absolute inset-0" style="background: linear-gradient(transparent, rgb(0, 0, 0));"></div>
                <div
                  class="absolute w-3.5 h-3.5 rounded-full border-2 border-white shadow-md pointer-events-none"
                  :style="{
                    left: pickerSat + '%',
                    top: (100 - pickerVal) + '%',
                    transform: 'translate(-50%, -50%)',
                    backgroundColor: pickerHex
                  }"
                ></div>
              </div>

              <!-- 色相滑块 -->
              <div
                ref="hueBarRef"
                class="relative rounded-full cursor-crosshair touch-none select-none"
                style="height: 14px; background: linear-gradient(to right, rgb(255, 0, 0) 0%, rgb(255, 255, 0) 17%, rgb(0, 255, 0) 33%, rgb(0, 255, 255) 50%, rgb(0, 0, 255) 67%, rgb(255, 0, 255) 83%, rgb(255, 0, 0) 100%);"
                @mousedown="startHueDrag"
                @touchstart.prevent="startHueDrag"
              >
                <div
                  class="absolute top-1/2 w-3 h-3 rounded-full border-2 border-white shadow pointer-events-none"
                  :style="{
                    left: (pickerHue / 360 * 100) + '%',
                    transform: 'translate(-50%, -50%)',
                    backgroundColor: `hsl(${pickerHue}, 100%, 50%)`
                  }"
                ></div>
              </div>

              <!-- 输入框 -->
              <div class="space-y-1.5">
                <div class="flex items-center gap-2">
                  <span class="text-[11px] text-gray-500 dark:text-gray-400 w-7 flex-shrink-0">HEX</span>
                  <input
                    v-model="pickerHexInput"
                    @change="updateFromHex"
                    @blur="updateFromHex"
                    class="w-full px-1 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-center outline-none focus:border-brand-500 text-[11px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none flex-1"
                  />
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="text-[11px] text-gray-500 dark:text-gray-400 w-7 flex-shrink-0">RGB</span>
                  <input
                    v-model.number="pickerR" type="number" min="0" max="255" placeholder="R"
                    @change="updateFromRgb" @blur="updateFromRgb"
                    class="w-full px-1 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-center outline-none focus:border-brand-500 text-[11px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none flex-1"
                  />
                  <input
                    v-model.number="pickerG" type="number" min="0" max="255" placeholder="G"
                    @change="updateFromRgb" @blur="updateFromRgb"
                    class="w-full px-1 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-center outline-none focus:border-brand-500 text-[11px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none flex-1"
                  />
                  <input
                    v-model.number="pickerB" type="number" min="0" max="255" placeholder="B"
                    @change="updateFromRgb" @blur="updateFromRgb"
                    class="w-full px-1 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-center outline-none focus:border-brand-500 text-[11px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none flex-1"
                  />
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="text-[11px] text-gray-500 dark:text-gray-400 w-7 flex-shrink-0">HSL</span>
                  <input
                    v-model.number="pickerH" type="number" min="0" max="360" placeholder="H"
                    @change="updateFromHsl" @blur="updateFromHsl"
                    class="w-full px-1 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-center outline-none focus:border-brand-500 text-[11px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none flex-1"
                  />
                  <input
                    v-model.number="pickerS" type="number" min="0" max="100" placeholder="S"
                    @change="updateFromHsl" @blur="updateFromHsl"
                    class="w-full px-1 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-center outline-none focus:border-brand-500 text-[11px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none flex-1"
                  />
                  <input
                    v-model.number="pickerL" type="number" min="0" max="100" placeholder="L"
                    @change="updateFromHsl" @blur="updateFromHsl"
                    class="w-full px-1 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-center outline-none focus:border-brand-500 text-[11px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none flex-1"
                  />
                </div>
              </div>

              <!-- 最近拼豆色匹配 -->
              <div v-if="closestBeadColor" class="p-2.5 bg-gray-100 dark:bg-gray-700 rounded-lg space-y-2">
                <div class="flex items-center gap-2">
                  <div class="w-6 h-6 rounded border border-gray-300 dark:border-gray-500 flex-shrink-0" :style="{ backgroundColor: pickerHex }"></div>
                  <svg class="w-3 h-3 text-gray-500 dark:text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"></path>
                  </svg>
                  <div class="w-6 h-6 rounded border border-gray-300 dark:border-gray-500 flex-shrink-0" :style="{ backgroundColor: closestBeadColor.hex }"></div>
                  <div class="text-xs text-gray-600 dark:text-gray-300 min-w-0">
                    <span class="font-semibold">{{ closestBeadColor.displayKey }}</span>
                    <span class="text-gray-500 dark:text-gray-400 ml-1">{{ closestBeadColor.hex }}</span>
                  </div>
                </div>
                <button
                  @click="usePickerColor"
                  class="w-full text-xs py-1.5 rounded-lg bg-blue-500 text-white font-medium active:bg-blue-600 transition-colors"
                >使用此颜色</button>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- Color stats card -->
    <div v-if="mappedPixelData" class="bg-white rounded-xl border border-black/10 p-4">
      <h3 class="text-sm font-medium text-black mb-2">
        颜色统计
        <span class="text-xs text-black/35 font-normal ml-1">{{ currentGridColors.length }} 种 / {{ currentGridColors.reduce((sum, c) => sum + c.count, 0) }} 粒</span>
      </h3>
      <div class="max-h-60 overflow-y-auto scrollbar-hide space-y-1">
        <div
          v-for="item in currentGridColors"
          :key="item.color"
          class="flex items-center gap-2 py-1 px-2 rounded"
        >
          <div class="w-5 h-5 rounded-md border border-black/10 flex-shrink-0" :style="{ backgroundColor: item.color }"></div>
          <span class="text-xs font-mono flex-1 text-black">{{ item.key }}</span>
          <span class="text-xs text-black/35">{{ item.count }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
