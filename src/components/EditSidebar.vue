<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useBeadStore } from '../stores/beadStore'
import { usePaletteStore } from '../stores/paletteStore'
import { useEditorStore } from '../stores/editorStore'
import { useFocusStore } from '../stores/focusStore'
import { useComponentStore, type SplitPreviewItem } from '../stores/componentStore'
import { getColorKeyByHex, sortColorsByHue } from '../utils/colorSystemUtils'
import { hexToRgb, replaceAllColor, recalculateColorStats } from '../utils/pixelation'
import { findClosestPaletteColor, isLightColor } from '../utils/colorUtils'
import { TRANSPARENT_KEY } from '../types'

const emit = defineEmits<{
  (e: 'color-select', color: any): void
  (e: 'color-replace', source: any, target: any): void
  (e: 'mirror-horizontal'): void
  (e: 'toggle-edit-history'): void
  (e: 'enter-3d-editor'): void
}>()

const beadStore = useBeadStore()
const paletteStore = usePaletteStore()
const editorStore = useEditorStore()
const focusStore = useFocusStore()
const componentStore = useComponentStore()

const { mappedPixelData } = storeToRefs(beadStore)
const { selectedColorSystem, activeBeadPalette } = storeToRefs(paletteStore)
const {
  selectedEditColor, isEraseMode, colorReplaceState,
  manualTool, manualBrushSize, manualMirrorX, manualMirrorY, manualShapeFill,
  selectionInfo, manualPasteActive, showFullPalette,
  selectionDragging, isCopyingSelection, moveToolMode, isFloodFillEraseMode,
  selectMode, selectedCells
} = storeToRefs(editorStore)
const { showCoordinates, coordinateInterval, showColorCodes } = storeToRefs(focusStore)

function enterFloodFillEraseMode() { editorStore.enterFloodFillEraseMode() }
function exitFloodFillEraseMode() { editorStore.exitFloodFillEraseMode() }
function toggleColorReplaceMode() { editorStore.toggleColorReplaceMode() }
function selectEditColor(color: any) { emit('color-select', color) }
function clearSelection() { editorStore.clearSelection() }
function cancelPaste() { editorStore.cancelPaste() }

function handleCopy() {
  const info = selectionInfo.value
  if (!info || !mappedPixelData.value || selectedCells.value.size === 0) return
  // 以选区边界左上角为原点，将选中的格子映射到 cells 二维数组
  const cells: any[][] = []
  for (let r = info.startRow; r <= info.endRow; r++) {
    const row: any[] = []
    for (let c = info.startCol; c <= info.endCol; c++) {
      const key = `${r},${c}`
      if (!selectedCells.value.has(key)) {
        row.push(null)
        continue
      }
      const cell = mappedPixelData.value[r]?.[c]
      row.push(cell ? { ...cell } : null)
    }
    cells.push(row)
  }
  editorStore.setClipboard({ cells, width: info.width, height: info.height })
}


// 色板面板本地状态
const colorPanelCollapsed = ref(false)
const hueSortEnabled = ref(false)
const showAllColors = ref(false) // false=当前图中色, true=全部色块
const selectedCategory = ref('all') // 分类筛选，'all'=全部

// ========== 组件拆分导入（编辑模式 2D 图纸） ==========
const editingSplitNameId = ref<string | null>(null) // 内联改名中的分组 id
const splitNameInput = ref('') // 改名输入值

/** 拆分当前 2D 图纸 → 生成预览（画布标注 + 侧栏分组列表） */
function startSplitImport() {
  if (!mappedPixelData.value) return
  componentStore.previewSplitGrid(mappedPixelData.value)
}

/** 微调后重新拆分（基于当前画布最新像素） */
function resplitImport() {
  if (!mappedPixelData.value) return
  componentStore.previewSplitGrid(mappedPixelData.value)
}

/** 确认导入全部预览分组到组件库 */
function confirmSplitImport() {
  const created = componentStore.confirmImportSplit()
  if (created.length > 0) {
    alert(`已导入 ${created.length} 个组件到体素组件库。`)
    // 切换到 3D 体素编辑器（由父组件完成模式切换与清理）
    emit('enter-3d-editor')
  }
}

function cancelSplitImport() {
  componentStore.cancelSplitImport()
  editingSplitNameId.value = null
}

function selectSplitItem(id: string) {
  componentStore.setSelectedSplitId(id)
}

function removeSplitItem(id: string) {
  componentStore.removeSplitItem(id)
}

function startRenameSplit(item: SplitPreviewItem) {
  editingSplitNameId.value = item.id
  splitNameInput.value = item.name
  nextTick(() => {
    document.querySelector<HTMLInputElement>('.split-rename-input')?.focus()
    document.querySelector<HTMLInputElement>('.split-rename-input')?.select()
  })
}

function confirmRenameSplit() {
  if (editingSplitNameId.value) {
    componentStore.renameSplitItem(editingSplitNameId.value, splitNameInput.value)
  }
  editingSplitNameId.value = null
  splitNameInput.value = ''
}

function cancelRenameSplit() {
  editingSplitNameId.value = null
  splitNameInput.value = ''
}

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
  if (!mappedPixelData.value || selectedCells.value.size === 0) return
  editorStore.saveSnapshot(mappedPixelData.value, '删除选区')
  for (const key of selectedCells.value) {
    const [r, c] = key.split(',').map(Number)
    if (mappedPixelData.value[r]?.[c] && !mappedPixelData.value[r][c].isExternal) {
      mappedPixelData.value[r][c] = { key: TRANSPARENT_KEY, color: '#FFFFFF', isExternal: true }
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

// ========== 颜色统计色块替换选择器 ==========
const showColorPicker = ref(false)
const colorPickerTarget = ref<string | null>(null) // 正在编辑的原始颜色
const pickerCategory = ref('all') // 替换弹窗的色系筛选，'all'=全部

// 可选色板：当前图片中的颜色排在最前 + 完整色板中的其他颜色
const availableColorsForPicker = computed(() => {
  if (!colorPickerTarget.value) return []
  const targetHex = colorPickerTarget.value.toUpperCase()

  // 当前图片中已有的颜色（排除目标颜色）
  const gridColorSet = new Set(currentGridColors.value.map(c => c.color.toUpperCase()))
  const gridColors = currentGridColors.value
    .filter(c => c.color.toUpperCase() !== targetHex)
    .map(c => ({ key: c.key, color: c.color, inGrid: true }))

  // 完整色板中不在当前图片中的颜色（排除目标颜色）
  const otherColors = activeBeadPalette.value
    .filter(c => {
      const hex = c.hex.toUpperCase()
      return hex !== targetHex && !gridColorSet.has(hex)
    })
    .map(c => ({
      key: getColorKeyByHex(c.hex, selectedColorSystem.value),
      color: c.hex,
      inGrid: false,
    }))

  // 合并：当前图片颜色在前，完整色板颜色在后
  return [...gridColors, ...otherColors]
})

// 替换弹窗的色系分类列表
const pickerColorCategories = computed(() => {
  const categories = new Set<string>()
  for (const c of availableColorsForPicker.value) {
    categories.add(getCategoryFromKey(c.key))
  }
  return ['all', ...Array.from(categories).sort()]
})

// 按色系分类过滤后的可选颜色
const filteredPickerColors = computed(() => {
  const colors = availableColorsForPicker.value
  if (pickerCategory.value === 'all') return colors
  return colors.filter(c => getCategoryFromKey(c.key) === pickerCategory.value)
})

/** 点击颜色统计中的色块 → 打开替换选择器 */
function handleChangeColorReplacement(originalHex: string) {
  colorPickerTarget.value = originalHex
  pickerCategory.value = 'all'
  showColorPicker.value = true
}

/** 关闭替换选择器 */
function closeColorPicker() {
  showColorPicker.value = false
  colorPickerTarget.value = null
}

/** 选择替换颜色 → 执行颜色替换 */
function selectReplacementColor(newTargetHex: string) {
  if (!colorPickerTarget.value || !mappedPixelData.value) return
  const sourceHex = colorPickerTarget.value.toUpperCase()
  const targetHex = newTargetHex.toUpperCase()
  if (sourceHex === targetHex) {
    closeColorPicker()
    return
  }
  const targetKey = getColorKeyByHex(targetHex, selectedColorSystem.value)
  const { result, count } = replaceAllColor(mappedPixelData.value, sourceHex, targetKey, targetHex)
  if (count > 0) {
    editorStore.saveSnapshot(mappedPixelData.value, '颜色替换')
    beadStore.setPixelData(result)
    const stats = recalculateColorStats(result)
    beadStore.updateColorStats(stats)
  }
  closeColorPicker()
}

// 从颜色标签中提取分类字母（如 A01 -> A, B02 -> B）
function getCategoryFromKey(key: string): string {
  const match = key.match(/^([A-Za-z]+)/)
  return match ? match[1].toUpperCase() : '#'
}

// 获取所有颜色分类
const colorCategories = computed(() => {
  const categories = new Set<string>()
  if (showAllColors.value) {
    for (const c of activeBeadPalette.value) {
      const key = getColorKeyByHex(c.hex, selectedColorSystem.value)
      categories.add(getCategoryFromKey(key))
    }
  } else {
    for (const c of currentGridColors.value) {
      categories.add(getCategoryFromKey(c.key))
    }
  }
  return ['all', ...Array.from(categories).sort()]
})

// 按分类过滤后的颜色
const filteredColors = computed(() => {
  const colors = showAllColors.value
    ? activeBeadPalette.value.map((c: any) => ({ key: getColorKeyByHex(c.hex, selectedColorSystem.value), color: c.hex }))
    : currentGridColors.value
  if (selectedCategory.value === 'all') return colors
  return colors.filter(c => getCategoryFromKey(c.key) === selectedCategory.value)
})

// 展示用颜色列表（支持分类筛选与色相排序）
const displayColors = computed(() => {
  const colors = filteredColors.value
  if (hueSortEnabled.value) return sortColorsByHue(colors)
  return colors
})

// 切换显示模式时重置分类选择
watch(showAllColors, () => {
  selectedCategory.value = 'all'
})

const toolNameMap: Record<string, string> = {
  drag: '拖拽', brush: '画笔', eraser: '橡皮', picker: '取色',
  fill: '填充', line: '直线', rect: '矩形', select: '选区', move: '移动', paste: '粘贴'
}
</script>

<template>
  <div class="flex-1 overflow-y-auto scrollbar-hide px-3 py-3 flex flex-col gap-3">
    <!-- Status indicator (color replace / erase mode) -->
    <div v-if="colorReplaceState.isActive || isEraseMode" class="rounded-xl border px-3 py-2 text-xs"
      :class="colorReplaceState.isActive ? 'border-blue-500/30 bg-blue-500/5 text-blue-600' : 'border-red-300/50 bg-red-50/50 text-red-600'">
      <template v-if="colorReplaceState.isActive">
        {{ colorReplaceState.step === 'select-source' ? '第一步，在画布上点击选择源颜色' : '第二步，在色板中选择目标颜色' }}
      </template>
      <template v-else>点击画布擦除同色连通区域</template>
    </div>

    <!-- Tool settings panel -->
    <div class="panel px-4 py-3 space-y-3">
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
          <input v-model.number="manualBrushSize" type="range" :min="1" :max="7" :step="1"
            class="w-full accent-blue-500" />
          <div class="flex flex-wrap gap-1.5">
            <button @click="manualMirrorX = !manualMirrorX" :class="[
              'px-2.5 py-1.5 text-xs rounded-lg border transition-colors',
              manualMirrorX ? 'bg-gray-900 text-gray-50 border-gray-900' : 'bg-gray-50 text-gray-600 border-gray-200 active:bg-gray-200'
            ]">↔ 镜像</button>
            <button @click="manualMirrorY = !manualMirrorY" :class="[
              'px-2.5 py-1.5 text-xs rounded-lg border transition-colors',
              manualMirrorY ? 'bg-gray-900 text-gray-50 border-gray-900' : 'bg-gray-50 text-gray-600 border-gray-200 active:bg-gray-200'
            ]">↕ 镜像</button>
          </div>
        </div>
        <!-- Rect fill toggle -->
        <button v-if="manualTool === 'rect'" @click="manualShapeFill = !manualShapeFill" :class="[
          'px-2.5 py-1.5 text-xs rounded-lg border transition-colors w-full',
          manualShapeFill ? 'bg-gray-900 text-gray-50 border-gray-900' : 'bg-gray-50 text-gray-600 border-gray-200 active:bg-gray-200'
        ]">{{ manualShapeFill ? '实心填充' : '仅描边' }}</button>
      </template>

      <!-- Eraser settings -->
      <template v-if="manualTool === 'eraser'">
        <div class="space-y-2">
          <div class="flex items-center justify-between text-xs text-gray-600">
            <span class="font-medium">笔刷大小</span>
            <span class="tabular-nums">{{ manualBrushSize }}</span>
          </div>
          <input v-model.number="manualBrushSize" type="range" :min="1" :max="7" :step="1"
            class="w-full accent-blue-500" />
        </div>
        <button @click="isFloodFillEraseMode ? exitFloodFillEraseMode() : enterFloodFillEraseMode()" :class="[
          'px-2.5 py-1.5 text-xs rounded-lg border transition-colors w-full',
          isFloodFillEraseMode ? 'bg-gray-900 text-gray-50 border-gray-900' : 'bg-gray-50 text-gray-600 border-gray-200 active:bg-gray-200'
        ]">{{ isFloodFillEraseMode ? '退出区域擦除模式' : '区域擦除（同色连通）' }}</button>
      </template>

      <!-- Picker hint -->
      <template v-if="manualTool === 'picker'">
        <p class="text-xs text-gray-400 py-1">在画布上点击拾取颜色</p>
      </template>

      <!-- Fill settings -->
      <template v-if="manualTool === 'fill'">
        <button @click="toggleColorReplaceMode()" :class="[
          'px-2.5 py-1.5 text-xs rounded-lg border transition-colors w-full',
          colorReplaceState.isActive ? 'bg-gray-900 text-gray-50 border-gray-900' : 'bg-gray-50 text-gray-600 border-gray-200 active:bg-gray-200'
        ]">{{ colorReplaceState.isActive ? '退出批量替换模式' : '批量替换颜色' }}</button>
      </template>

      <!-- Select tool: 仅选区操作 -->
      <template v-if="manualTool === 'select'">
        <div class="space-y-2">
          <!-- 选区模式切换：矩形选区 / 单格选区 -->
          <div class="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
            <button class="flex-1 text-xs py-1 px-2.5 rounded-md transition-colors"
              :class="selectMode === 'rect' ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 active:text-gray-700'"
              @click="editorStore.setSelectMode('rect')">矩形选区</button>
            <button class="flex-1 text-xs py-1 px-2.5 rounded-md transition-colors"
              :class="selectMode === 'single' ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 active:text-gray-700'"
              @click="editorStore.setSelectMode('single')">单格选区</button>
          </div>
          <p class="text-xs text-gray-400" v-if="selectMode === 'rect'">拖拽框选矩形选区，松开并入现有选区；按住 Ctrl 拖拽可减除选区</p>
          <p class="text-xs text-gray-400" v-else>点击格子并入选区，按住 Ctrl 点击可减除选区</p>
          <div v-if="selectionInfo" class="flex items-center justify-between text-xs text-gray-600">
            <span class="font-medium">选区尺寸</span>
            <span class="tabular-nums">{{ selectionInfo.width }}×{{ selectionInfo.height }} ({{ selectedCells.size }}
              格)</span>
          </div>
          <div v-if="selectionInfo" class="flex flex-wrap gap-1.5">
            <button @click="editorStore.setManualTool('move')"
              class="px-2.5 py-1.5 text-xs rounded-lg border bg-gray-900 text-gray-50 border-gray-900 transition-colors">移动选区</button>
            <button @click="clearSelection()"
              class="px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 active:bg-gray-200 transition-colors">取消选区</button>
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
            <button @click="editorStore.toggleMoveToolMode()" :class="[
              'flex-1 px-2.5 py-1.5 text-xs rounded-lg border transition-colors',
              moveToolMode === 'copy' ? 'bg-green-500 text-white border-green-500' : 'bg-orange-500 text-white border-orange-500'
            ]">{{ moveToolMode === 'copy' ? '📋 复制模式' : '✂️ 剪贴模式' }}</button>
          </div>
          <div class="flex items-center justify-between text-xs text-gray-600">
            <span class="font-medium">选区尺寸</span>
            <span class="tabular-nums">{{ selectionInfo ? `${selectionInfo.width}×${selectionInfo.height}` : '无'
              }}</span>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <button @click="handleDeleteSelection" :disabled="!selectionInfo"
              class="px-2 py-1 text-xs rounded-lg border border-gray-200 text-gray-600 active:bg-gray-200 transition-colors disabled:opacity-30">清空选区</button>
            <button @click="clearSelection()"
              class="px-2 py-1 text-xs rounded-lg border border-gray-200 text-gray-600 active:bg-gray-200 transition-colors">取消选区</button>
          </div>
        </div>
      </template>

      <!-- Paste mode -->
      <template v-if="manualPasteActive">
        <div class="space-y-2">
          <p class="text-xs text-gray-400">在画布上点击放置粘贴内容</p>
          <button @click="cancelPaste"
            class="px-2 py-1 text-xs rounded-lg border border-gray-200 text-gray-600 active:bg-gray-200 transition-colors w-full">取消粘贴</button>
        </div>
      </template>

      <!-- Drag hint -->
      <template v-if="manualTool === 'drag'">
        <p class="text-xs text-gray-400 py-1">拖拽画布进行平移</p>
      </template>
    </div>

    <!-- Global operations -->
    <div class="panel px-4 py-3 space-y-2">
      <div class="text-sm font-bold text-gray-700">全局操作</div>
      <button @click="emit('toggle-edit-history')"
        class="px-2.5 py-1.5 text-xs rounded-lg border transition-colors bg-gray-50 text-gray-600 border-gray-200 active:bg-gray-200 hover:bg-gray-100 w-full"
        title="查看修改历史">🕘 修改历史</button>
      <button @click="emit('mirror-horizontal')"
        class="px-2.5 py-1.5 text-xs rounded-lg border transition-colors bg-gray-50 text-gray-600 border-gray-200 active:bg-gray-200 hover:bg-gray-100 w-full"
        title="水平翻转整个图纸">↔ 水平镜像</button>
    </div>

    <!-- Color palette card -->
    <div class="panel overflow-hidden flex-shrink-0">
      <button
        class="w-full flex items-center justify-between px-4 py-3 active:bg-gray-100 dark:active:bg-gray-800 transition-colors"
        @click="colorPanelCollapsed = !colorPanelCollapsed">
        <span class="text-xs font-semibold text-gray-500 dark:text-gray-400">色板</span>
        <div class="flex items-center gap-2">
          <div v-if="selectedEditColor" class="flex items-center gap-1.5">
            <span class="w-4 h-4 rounded border border-gray-300 dark:border-gray-500"
              :style="{ backgroundColor: selectedEditColor.color }"></span>
            <span class="text-[10px] text-gray-500 dark:text-gray-400">{{ selectedEditColor.key }}</span>
          </div>
          <svg class="w-3.5 h-3.5 text-gray-500 dark:text-gray-400 transition-transform"
            :class="{ 'rotate-180': !colorPanelCollapsed }" fill="none" viewBox="0 0 24 24" stroke="currentColor"
            stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"></path>
          </svg>
        </div>
      </button>
      <div v-if="!colorPanelCollapsed" class="w-full select-none">
        <div class="p-3">
          <div class="flex gap-1.5 mb-3">
            <div class="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
              <button class="text-xs py-1 px-2.5 rounded-md transition-colors"
                :class="!showFullPalette ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 active:text-gray-700'"
                @click="showFullPalette = false">色块</button>
              <button class="text-xs py-1 px-2.5 rounded-md transition-colors"
                :class="showFullPalette ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 active:text-gray-700'"
                @click="showFullPalette = true">色盘</button>
            </div>
            <template v-if="!showFullPalette">
              <button
                class="flex-1 text-xs py-1.5 px-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg active:bg-gray-200 dark:active:bg-gray-600 transition-colors"
                @click="showAllColors = !showAllColors">{{ showAllColors ? '全部' : '当前' }} ({{ displayColors.length
                }})</button>
              <button
                class="text-xs py-1.5 px-2.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg active:bg-gray-200 dark:active:bg-gray-600 transition-colors whitespace-nowrap"
                :class="hueSortEnabled ? 'ring-1 ring-gray-400 dark:ring-gray-500' : ''"
                @click="hueSortEnabled = !hueSortEnabled">色相排序</button>
            </template>
          </div>

          <!-- 色块模式：颜色网格 -->
          <template v-if="!showFullPalette">
            <div v-if="displayColors.length === 0" class="text-xs text-gray-400 dark:text-gray-500 text-center py-2">
              暂无颜色</div>
            <div v-else class="flex gap-2" style="height: 240px;">
              <!-- 左侧分类标签 -->
              <div class="flex flex-col gap-0.5 overflow-y-auto scrollbar-hide w-10 flex-shrink-0">
                <button v-for="cat in colorCategories" :key="cat" @click="selectedCategory = cat"
                  class="text-[10px] py-1 px-1 rounded transition-colors whitespace-nowrap"
                  :class="selectedCategory === cat
                    ? 'bg-gray-900 text-white font-medium dark:bg-gray-100 dark:text-gray-900'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'">{{ cat === 'all' ? '全部' : cat }}</button>
              </div>
              <!-- 右侧颜色网格 -->
              <div class="flex-1 overflow-y-auto scrollbar-hide">
                <div class="grid grid-cols-5 gap-1.5">
                  <button v-for="color in displayColors" :key="color.color" @click="selectEditColor(color)"
                    class="relative rounded-lg border-2 transition-all duration-150 active:scale-95 flex items-center justify-center"
                    :style="{ backgroundColor: color.color, aspectRatio: '1 / 1' }"
                    :title="`${color.key} (${color.color})`" :class="[
                      selectedEditColor?.color === color.color
                        ? 'border-gray-900 dark:border-gray-100 ring-2 ring-gray-900/20 dark:ring-gray-100/20'
                        : 'border-gray-200 dark:border-gray-600 active:border-gray-400 dark:active:border-gray-400'
                    ]">
                    <span class="text-[9px] font-bold leading-none select-none"
                      :class="isLightColor(color.color) ? 'text-gray-900/70' : 'text-white/80'">{{ color.key }}</span>
                  </button>
                </div>
              </div>
            </div>
          </template>

          <!-- 色盘模式：HSV 颜色选择器 -->
          <template v-else>
            <div class="space-y-3">
              <!-- 饱和度/明度面板 -->
              <div ref="satPanelRef" class="relative rounded-lg cursor-crosshair touch-none select-none overflow-hidden"
                style="aspect-ratio: 224 / 144;" @mousedown="startSatDrag" @touchstart.prevent="startSatDrag">
                <div class="absolute inset-0" :style="{ backgroundColor: `hsl(${pickerHue}, 100%, 50%)` }"></div>
                <div class="absolute inset-0"
                  style="background: linear-gradient(to right, rgb(255, 255, 255), transparent);"></div>
                <div class="absolute inset-0" style="background: linear-gradient(transparent, rgb(0, 0, 0));"></div>
                <div class="absolute w-3.5 h-3.5 rounded-full border-2 border-white shadow-md pointer-events-none"
                  :style="{
                    left: pickerSat + '%',
                    top: (100 - pickerVal) + '%',
                    transform: 'translate(-50%, -50%)',
                    backgroundColor: pickerHex
                  }"></div>
              </div>

              <!-- 色相滑块 -->
              <div ref="hueBarRef" class="relative rounded-full cursor-crosshair touch-none select-none"
                style="height: 14px; background: linear-gradient(to right, rgb(255, 0, 0) 0%, rgb(255, 255, 0) 17%, rgb(0, 255, 0) 33%, rgb(0, 255, 255) 50%, rgb(0, 0, 255) 67%, rgb(255, 0, 255) 83%, rgb(255, 0, 0) 100%);"
                @mousedown="startHueDrag" @touchstart.prevent="startHueDrag">
                <div class="absolute top-1/2 w-3 h-3 rounded-full border-2 border-white shadow pointer-events-none"
                  :style="{
                    left: (pickerHue / 360 * 100) + '%',
                    transform: 'translate(-50%, -50%)',
                    backgroundColor: `hsl(${pickerHue}, 100%, 50%)`
                  }"></div>
              </div>

              <!-- 输入框 -->
              <div class="space-y-1.5">
                <div class="flex items-center gap-2">
                  <span class="text-[11px] text-gray-500 dark:text-gray-400 w-7 flex-shrink-0">HEX</span>
                  <input v-model="pickerHexInput" @change="updateFromHex" @blur="updateFromHex"
                    class="w-full px-1 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-center outline-none focus:border-brand-500 text-[11px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none flex-1" />
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="text-[11px] text-gray-500 dark:text-gray-400 w-7 flex-shrink-0">RGB</span>
                  <input v-model.number="pickerR" type="number" min="0" max="255" placeholder="R"
                    @change="updateFromRgb" @blur="updateFromRgb"
                    class="w-full px-1 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-center outline-none focus:border-brand-500 text-[11px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none flex-1" />
                  <input v-model.number="pickerG" type="number" min="0" max="255" placeholder="G"
                    @change="updateFromRgb" @blur="updateFromRgb"
                    class="w-full px-1 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-center outline-none focus:border-brand-500 text-[11px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none flex-1" />
                  <input v-model.number="pickerB" type="number" min="0" max="255" placeholder="B"
                    @change="updateFromRgb" @blur="updateFromRgb"
                    class="w-full px-1 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-center outline-none focus:border-brand-500 text-[11px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none flex-1" />
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="text-[11px] text-gray-500 dark:text-gray-400 w-7 flex-shrink-0">HSL</span>
                  <input v-model.number="pickerH" type="number" min="0" max="360" placeholder="H"
                    @change="updateFromHsl" @blur="updateFromHsl"
                    class="w-full px-1 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-center outline-none focus:border-brand-500 text-[11px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none flex-1" />
                  <input v-model.number="pickerS" type="number" min="0" max="100" placeholder="S"
                    @change="updateFromHsl" @blur="updateFromHsl"
                    class="w-full px-1 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-center outline-none focus:border-brand-500 text-[11px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none flex-1" />
                  <input v-model.number="pickerL" type="number" min="0" max="100" placeholder="L"
                    @change="updateFromHsl" @blur="updateFromHsl"
                    class="w-full px-1 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-center outline-none focus:border-brand-500 text-[11px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none flex-1" />
                </div>
              </div>

              <!-- 最近拼豆色匹配 -->
              <div v-if="closestBeadColor" class="p-2.5 bg-gray-100 dark:bg-gray-700 rounded-lg space-y-2">
                <div class="flex items-center gap-2">
                  <div class="w-6 h-6 rounded border border-gray-300 dark:border-gray-500 flex-shrink-0"
                    :style="{ backgroundColor: pickerHex }"></div>
                  <svg class="w-3 h-3 text-gray-500 dark:text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24"
                    stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"></path>
                  </svg>
                  <div class="w-6 h-6 rounded border border-gray-300 dark:border-gray-500 flex-shrink-0"
                    :style="{ backgroundColor: closestBeadColor.hex }"></div>
                  <div class="text-xs text-gray-600 dark:text-gray-300 min-w-0">
                    <span class="font-semibold">{{ closestBeadColor.displayKey }}</span>
                    <span class="text-gray-500 dark:text-gray-400 ml-1">{{ closestBeadColor.hex }}</span>
                  </div>
                </div>
                <button @click="usePickerColor"
                  class="w-full text-xs py-1.5 rounded-lg bg-blue-500 text-white font-medium active:bg-blue-600 transition-colors">使用此颜色</button>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- Color stats card -->
    <div v-if="mappedPixelData" class="panel p-4">
      <h3 class="text-sm font-medium text-black mb-2">
        颜色统计
        <span class="text-xs text-black/35 font-normal ml-1">{{ currentGridColors.length }} 种 / {{
          currentGridColors.reduce((sum, c) => sum + c.count, 0) }} 粒</span>
      </h3>
      <div class="max-h-60 overflow-y-auto scrollbar-hide space-y-1">
        <button v-for="item in currentGridColors" :key="item.color" @click="handleChangeColorReplacement(item.color)"
          class="w-full flex items-center gap-2 py-1 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
          title="点击替换该颜色">
          <div class="w-5 h-5 rounded-md border border-black/10 flex-shrink-0" :style="{ backgroundColor: item.color }">
          </div>
          <span class="text-xs font-mono flex-1 text-black dark:text-gray-200">{{ item.key }}</span>
          <span class="text-xs text-black/35 dark:text-gray-400">{{ item.count }}</span>
        </button>
      </div>
    </div>

    <!-- 颜色替换选择器弹窗 -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="showColorPicker" class="fixed inset-0 z-[9998] flex items-center justify-center bg-black/30"
          @click.self="closeColorPicker">
          <div
            class="bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 w-80 max-h-96 flex flex-col overflow-hidden">
            <div class="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <span class="text-xs font-medium text-gray-700 dark:text-gray-200">选择替换颜色</span>
              <button @click="closeColorPicker" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <!-- 色系筛选标签 -->
            <div class="px-2 py-1.5 border-b border-gray-200 dark:border-gray-700 flex flex-wrap gap-1">
              <button v-for="cat in pickerColorCategories" :key="cat" @click="pickerCategory = cat"
                class="text-[10px] py-1 px-2 rounded transition-colors whitespace-nowrap"
                :class="pickerCategory === cat
                  ? 'bg-gray-900 text-white font-medium dark:bg-gray-100 dark:text-gray-900'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'">{{ cat === 'all' ? '全部' : cat }}</button>
            </div>
            <div class="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-1">
              <!-- 当前图片中的颜色 -->
              <div v-if="filteredPickerColors.some(c => c.inGrid)" class="mb-1">
                <div class="px-2 py-1 text-[10px] text-gray-400 dark:text-gray-500 font-medium">当前图片</div>
                <div class="flex flex-wrap gap-1 content-start">
                  <button v-for="color in filteredPickerColors.filter(c => c.inGrid)" :key="color.color"
                    @click="selectReplacementColor(color.color)"
                    class="relative w-11 h-11 rounded-lg transition-all duration-100 flex items-center justify-center flex-shrink-0 border-2 border-transparent hover:border-gray-300 dark:hover:border-gray-600"
                    :style="{ backgroundColor: color.color }">
                    <span class="text-[9px] font-bold leading-none select-none"
                      :style="{ color: isLightColor(color.color) ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.7)' }">{{
                      color.key }}</span>
                  </button>
                </div>
              </div>
              <!-- 完整色板中的其他颜色 -->
              <div v-if="filteredPickerColors.some(c => !c.inGrid)">
                <div class="px-2 py-1 text-[10px] text-gray-400 dark:text-gray-500 font-medium">完整色板</div>
                <div class="flex flex-wrap gap-1 content-start">
                  <button v-for="color in filteredPickerColors.filter(c => !c.inGrid)" :key="color.color"
                    @click="selectReplacementColor(color.color)"
                    class="relative w-11 h-11 rounded-lg transition-all duration-100 flex items-center justify-center flex-shrink-0 border-2 border-transparent hover:border-gray-300 dark:hover:border-gray-600"
                    :style="{ backgroundColor: color.color }">
                    <span class="text-[9px] font-bold leading-none select-none"
                      :style="{ color: isLightColor(color.color) ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.7)' }">{{
                      color.key }}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 组件拆分导入 -->
    <div class="panel p-4 space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-gray-800 dark:text-gray-200">组件拆分导入</h3>
        <span v-if="componentStore.splitPreview?.length" class="text-[10px] text-gray-400 dark:text-gray-500">
          {{ componentStore.splitPreview.length }} 个组件
        </span>
      </div>

      <p class="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
        按连通区域自动拆分当前图纸为组件，画布中将标注各组件，可微调后导入体素组件库。
      </p>

      <!-- 拆分预览分组列表 -->
      <div v-if="componentStore.splitPreview?.length" class="space-y-1.5">
        <div v-for="item in componentStore.splitPreview" :key="item.id"
          class="flex items-center gap-2 px-2 py-1.5 rounded border transition-colors cursor-pointer"
          :class="componentStore.selectedSplitId === item.id
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'"
          @click="selectSplitItem(item.id)">
          <span class="w-4 h-4 rounded flex-shrink-0" :style="{ backgroundColor: item.color }"></span>
          <!-- 内联改名 -->
          <input v-if="editingSplitNameId === item.id" v-model="splitNameInput"
            class="split-rename-input flex-1 min-w-0 text-xs px-1 py-0.5 rounded border border-blue-400 outline-none bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
            @blur="confirmRenameSplit" @keydown.enter="confirmRenameSplit" @keydown.escape="cancelRenameSplit"
            @click.stop />
          <span v-else class="flex-1 min-w-0 text-xs text-gray-700 dark:text-gray-300 truncate cursor-text"
            @click.stop="startRenameSplit(item)">{{ item.name }}</span>
          <span class="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums flex-shrink-0">{{ item.cells.length }} 格</span>
          <button class="text-[11px] text-red-500 hover:text-red-600 flex-shrink-0" title="删除该分组"
            @click.stop="removeSplitItem(item.id)">✕</button>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div v-if="!componentStore.splitPreview?.length" class="flex gap-2">
        <button @click="startSplitImport"
          class="flex-1 py-1.5 rounded-lg text-xs font-medium bg-blue-500 text-white hover:bg-blue-600 transition-colors">
          🔀 拆分当前图纸
        </button>
      </div>
      <div v-else class="space-y-2">
        <div class="flex gap-2">
          <button @click="resplitImport"
            class="flex-1 py-1.5 rounded-lg text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
            🔄 重新拆分
          </button>
          <button @click="confirmSplitImport"
            class="flex-1 py-1.5 rounded-lg text-xs font-medium bg-green-500 text-white hover:bg-green-600 transition-colors">
            ✓ 确认导入
          </button>
          <button @click="cancelSplitImport"
            class="flex-1 py-1.5 rounded-lg text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
            ✕ 取消
          </button>
        </div>
        <p class="text-[10px] text-gray-400 dark:text-gray-500 leading-relaxed">
          微调：在画布用画笔/橡皮修改像素后，点「重新拆分」更新分组。
        </p>
      </div>
    </div>

    <!-- Display settings card -->
    <div class="panel p-4 space-y-3">
      <h3 class="text-sm font-semibold text-gray-800 dark:text-gray-200">显示设置</h3>

      <!-- Coordinates toggle -->
      <div class="flex items-center justify-between">
        <span class="text-xs text-gray-500 dark:text-gray-400">显示坐标</span>
        <button @click="showCoordinates = !showCoordinates"
          class="relative w-11 h-[26px] rounded-full transition-colors"
          :class="showCoordinates ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'">
          <div class="absolute top-[3px] w-5 h-5 rounded-full bg-white shadow-sm transition-transform"
            :class="showCoordinates ? 'translate-x-[22px]' : 'translate-x-[3px]'" />
        </button>
      </div>

      <div v-if="showCoordinates" class="flex items-center gap-3">
        <span class="text-xs text-gray-500 dark:text-gray-400 w-8">间隔</span>
        <input v-model.number="coordinateInterval" min="1" max="10"
          class="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none accent-green-500" type="range" />
        <span class="text-xs text-gray-500 dark:text-gray-400 tabular-nums w-7 text-right">{{ coordinateInterval === 1 ?
          '连续' : coordinateInterval }}</span>
      </div>

      <!-- Color codes toggle -->
      <div class="flex items-center justify-between">
        <span class="text-xs text-gray-500 dark:text-gray-400">显示色号</span>
        <button @click="showColorCodes = !showColorCodes" class="relative w-11 h-[26px] rounded-full transition-colors"
          :class="showColorCodes ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'">
          <div class="absolute top-[3px] w-5 h-5 rounded-full bg-white shadow-sm transition-transform"
            :class="showColorCodes ? 'translate-x-[22px]' : 'translate-x-[3px]'" />
        </button>
      </div>
    </div>
  </div>
</template>
