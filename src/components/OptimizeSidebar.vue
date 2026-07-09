<script setup lang="ts">
import { computed, ref, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useBeadStore } from '../stores/beadStore'
import { usePaletteStore } from '../stores/paletteStore'
import { useEditorStore } from '../stores/editorStore'
import { colorSystemOptions, getColorKeyByHex, sortColorsByHue } from '../utils/colorSystemUtils'
import { hexToRgb, recalculateColorStats, replaceAllColor } from '../utils/pixelation'
import { findClosestPaletteColor, isLightColor } from '../utils/colorUtils'
import { PixelationMode } from '../types'
import type { ColorSystem } from '../types'

const emit = defineEmits<{
  (e: 'trigger-file-input'): void
  (e: 'auto-remove-background'): void
  (e: 'undo-bg-removal'): void
}>()

const beadStore = useBeadStore()
const paletteStore = usePaletteStore()
const editorStore = useEditorStore()

const { originalImageSrc, mappedPixelData, granularity, granularityInput, granularityY, granularityYInput, lockAspectRatio, similarityThreshold, similarityThresholdInput, pixelationMode, croppedImageCanvas, colorCounts, totalBeadCount } = storeToRefs(beadStore)
const { selectedColorSystem, excludedColorKeys, showExcludedColors, fullBeadPalette, colorReplacementMap, replacedCellsMap } = storeToRefs(paletteStore)
const { setReplacedCells } = paletteStore
const { bgRemovalSnapshot } = storeToRefs(editorStore)

// ========== Tooltip ==========

const activeTooltip = ref<string | null>(null)
const tooltipPosition = ref({ x: 0, y: 0 })
const tooltipRef = ref<HTMLElement | null>(null)

const tooltipContent: Record<string, string> = {
  merge: '自动合并相近颜色。数值越大合并越多、颜色越少。设为 0 不合并。',
  mode: '卡通模式色块分明，真实模式过渡自然。',
  optimize: '点击某个颜色可将其排除，该颜色的拼豆会自动替换为最接近的其他颜色。点击替换颜色可进行修改。',
}

function showTooltip(id: string, event: MouseEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  tooltipPosition.value = {
    x: rect.left + rect.width / 2,
    y: rect.top - 8,
  }
  activeTooltip.value = id
}

function hideTooltip() {
  activeTooltip.value = null
}

// ========== 色彩优化 ==========

// 当前网格中使用的颜色列表（按色相排序，排除已排除颜色）
const currentGridColors = computed(() => {
  if (!mappedPixelData.value || !colorCounts.value) return []
  const list = Object.entries(colorCounts.value)
    .filter(([, data]) => data.count > 0)
    .filter(([hex]) => !excludedColorKeys.value.has(hex.toUpperCase()))
    .map(([hex]) => ({
      key: getColorKeyByHex(hex, selectedColorSystem.value),
      color: hex,
      count: colorCounts.value![hex]?.count || 0,
    }))
  return sortColorsByHue(list)
})

// 已排除的颜色列表（含替换颜色信息）
const excludedColorsList = computed(() => {
  const list = Array.from(excludedColorKeys.value).map(hex => ({
    key: getColorKeyByHex(hex, selectedColorSystem.value),
    color: hex,
    replacedBy: colorReplacementMap.value.get(hex.toUpperCase()) || null,
    replacedByKey: colorReplacementMap.value.get(hex.toUpperCase())
      ? getColorKeyByHex(colorReplacementMap.value.get(hex.toUpperCase())!, selectedColorSystem.value)
      : null,
  }))
  return list
})

// 颜色选择器状态
const showColorPicker = ref(false)
const colorPickerTarget = ref<string | null>(null) // 正在编辑的原始颜色

/**
 * 点击颜色 → 排除该颜色并自动替换为最接近的其他颜色
 */
function handleExcludeColor(hex: string) {
  if (!mappedPixelData.value || !colorCounts.value) return

  const upperHex = hex.toUpperCase()

  // 从当前图片已有的颜色中选择
  // 再排除当前要排除的颜色
  const availableColors = currentGridColors.value
    .filter(c => c.color.toUpperCase() !== upperHex)
    .map(c => {
      const rgb = hexToRgb(c.color)
      return { key: c.color, hex: c.color, rgb: rgb || { r: 0, g: 0, b: 0 } }
    })

  if (availableColors.length === 0) return

  // 找到最接近的替换颜色
  const targetRgb = hexToRgb(upperHex)
  if (!targetRgb) return
  const closestColor = findClosestPaletteColor(targetRgb, availableColors)

  performColorReplace(upperHex, closestColor.hex, closestColor.hex)
}

/**
 * 执行颜色替换
 */
function performColorReplace(sourceHex: string, targetHex: string, targetKey: string) {
  if (!mappedPixelData.value) return

  // 记录被替换的像素位置
  const normalizedSource = sourceHex.toUpperCase()
  const cellsToReplace: { row: number; col: number }[] = []
  for (let row = 0; row < mappedPixelData.value.length; row++) {
    for (let col = 0; col < mappedPixelData.value[row].length; col++) {
      const cell = mappedPixelData.value[row][col]
      if (cell && !cell.isExternal && cell.color.toUpperCase() === normalizedSource) {
        cellsToReplace.push({ row, col })
      }
    }
  }

  const { result, count } = replaceAllColor(mappedPixelData.value, sourceHex, targetKey, targetHex)

  if (count > 0) {
    editorStore.saveSnapshot(mappedPixelData.value)
    beadStore.setPixelData(result)
    const stats = recalculateColorStats(result)
    beadStore.updateColorStats(stats)

    // 记录被替换的像素位置
    setReplacedCells(normalizedSource, cellsToReplace)

    // 记录替换映射
    paletteStore.setColorReplacement(normalizedSource, targetHex)

    // 标记为已排除
    if (!excludedColorKeys.value.has(normalizedSource)) {
      paletteStore.toggleExcludeColor(normalizedSource)
    }
  }
}

/**
 * 点击替换颜色 → 打开颜色选择器
 */
function handleChangeReplacement(originalHex: string) {
  colorPickerTarget.value = originalHex
  showColorPicker.value = true
}

/**
 * 从色板中选择新的替换颜色
 */
function selectReplacementColor(newTargetHex: string) {
  if (!colorPickerTarget.value || !mappedPixelData.value) return

  const originalHex = colorPickerTarget.value
  const currentReplacement = colorReplacementMap.value.get(originalHex)

  // 先恢复原始颜色（撤销上次替换）
  if (currentReplacement) {
    // 保存恢复前的快照
    editorStore.saveSnapshot(mappedPixelData.value)

    // 精准恢复被替换的像素
    const replacedCells = replacedCellsMap.value.get(originalHex)
    if (replacedCells && replacedCells.length > 0) {
      const originalKey = originalHex
      const restored = mappedPixelData.value.map(row => row.map(cell => ({ ...cell })))
      for (const { row, col } of replacedCells) {
        if (restored[row]?.[col]) {
          restored[row][col] = { key: originalKey, color: originalHex, isExternal: false }
        }
      }
      beadStore.setPixelData(restored)
    }
  }

  // 再用新颜色替换
  performColorReplace(originalHex, newTargetHex, newTargetHex)

  // 关闭选择器
  showColorPicker.value = false
  colorPickerTarget.value = null
}

/**
 * 恢复单个颜色
 */
function handleRestoreColor(hex: string) {
  const upperHex = hex.toUpperCase()
  const replacedCells = replacedCellsMap.value.get(upperHex)

  if (replacedCells && replacedCells.length > 0 && mappedPixelData.value) {
    const originalKey = upperHex
    const restored = mappedPixelData.value.map(row => row.map(cell => ({ ...cell })))
    for (const { row, col } of replacedCells) {
      if (restored[row]?.[col]) {
        restored[row][col] = { key: originalKey, color: upperHex, isExternal: false }
      }
    }

    editorStore.saveSnapshot(mappedPixelData.value)
    beadStore.setPixelData(restored)
    const stats = recalculateColorStats(restored)
    beadStore.updateColorStats(stats)
  }

  // 清除替换映射
  paletteStore.deleteColorReplacement(upperHex)

  // 从排除列表移除
  if (excludedColorKeys.value.has(upperHex)) {
    paletteStore.toggleExcludeColor(upperHex)
  }
}

/**
 * 一键恢复所有颜色
 */
function handleRestoreAll() {
  if (!mappedPixelData.value) return

  const restored = mappedPixelData.value.map(row => row.map(cell => ({ ...cell })))
  let hasChanges = false

  for (const [hex, cells] of replacedCellsMap.value) {
    const originalKey = hex
    for (const { row, col } of cells) {
      if (restored[row]?.[col]) {
        restored[row][col] = { key: originalKey, color: hex, isExternal: false }
        hasChanges = true
      }
    }
  }

  if (hasChanges) {
    editorStore.saveSnapshot(mappedPixelData.value)
    beadStore.setPixelData(restored)
    const stats = recalculateColorStats(restored)
    beadStore.updateColorStats(stats)
  }

  // 清空状态（restoreAllExcluded 会同时清除 colorReplacementMap 和 replacedCellsMap）
  paletteStore.restoreAllExcluded()
}

// 可选色板：完整色板 + 当前图片中的颜色排在最前
const availableColorsForPicker = computed(() => {
  if (!colorPickerTarget.value) return []
  const targetHex = colorPickerTarget.value.toUpperCase()
  
  // 当前图片中已有的颜色（排除目标颜色）
  const gridColorSet = new Set(currentGridColors.value.map(c => c.color.toUpperCase()))
  const gridColors = currentGridColors.value
    .filter(c => c.color.toUpperCase() !== targetHex)
    .map(c => ({ key: c.key, color: c.color, inGrid: true }))
  
  // 完整色板中不在当前图片中的颜色（排除目标颜色和已排除颜色）
  const otherColors = fullBeadPalette.value
    .filter(c => {
      const hex = c.hex.toUpperCase()
      return hex !== targetHex && !gridColorSet.has(hex) && !excludedColorKeys.value.has(hex)
    })
    .map(c => ({
      key: getColorKeyByHex(c.hex, selectedColorSystem.value),
      color: c.hex,
      inGrid: false,
    }))
  
  // 合并：当前图片颜色在前，完整色板颜色在后
  return [...gridColors, ...otherColors]
})

// ========== 拖拽上传 ==========

function handleDragOver(e: DragEvent) { e.preventDefault() }
function handleDrop(e: DragEvent) {
  e.preventDefault()
  const file = e.dataTransfer?.files?.[0]
  if (file && file.type.startsWith('image/')) {
    emit('trigger-file-input')
  }
}
</script>

<template>
  <div class="flex-1 overflow-y-auto scrollbar-hide px-3 py-3 flex flex-col gap-3">
    <!-- Parameter controls card -->
    <div class="rounded-xl border border-gray-200/60 dark:border-gray-800/50 bg-gray-50/95 dark:bg-gray-900/80 shadow-sm overflow-visible">
      <div class="divide-y divide-gray-200/60 dark:divide-gray-800/40">
        <!-- 颜色合并程度 -->
        <div class="relative flex items-center justify-between px-3 h-11">
          <div class="flex items-center gap-0.5">
            <span class="text-xs text-gray-500 dark:text-gray-400">颜色合并程度</span>
            <button
              type="button"
              class="w-5 h-5 rounded-full flex items-center justify-center text-gray-400 dark:text-gray-500 active:text-brand-500 active:bg-brand-500/10 transition-colors flex-shrink-0"
              @mouseenter="showTooltip('merge', $event)"
              @mouseleave="hideTooltip"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"></path></svg>
            </button>
          </div>
          <input
            v-model.number="similarityThreshold"
            min="0"
            max="100"
            type="number"
            class="w-20 h-7 px-2 text-right text-xs font-medium text-gray-900 dark:text-gray-100 bg-gray-100 dark:bg-gray-800 border-none rounded-md focus:ring-1 focus:ring-brand-500 focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>

        <!-- 宽度 -->
        <div class="relative flex items-center justify-between px-3 h-11">
          <div class="flex items-center gap-0.5">
            <span class="text-xs text-gray-500 dark:text-gray-400">宽度</span>
          </div>
          <input
            v-model="granularityInput"
            @blur="granularity = Math.max(10, Math.min(300, parseInt(granularityInput) || 50))"
            @keyup.enter="granularity = Math.max(10, Math.min(300, parseInt(granularityInput) || 50))"
            min="10"
            max="300"
            type="number"
            class="w-20 h-7 px-2 text-right text-xs font-medium text-gray-900 dark:text-gray-100 bg-gray-100 dark:bg-gray-800 border-none rounded-md focus:ring-1 focus:ring-brand-500 focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>

        <!-- 锁定比例 + 高度 -->
        <div class="relative flex items-center justify-between px-3 h-11">
          <div class="flex items-center gap-1.5">
            <span class="text-xs text-gray-500 dark:text-gray-400">高度</span>
            <button
              @click="lockAspectRatio = !lockAspectRatio"
              :class="[
                'px-1.5 py-0.5 text-[10px] rounded transition-colors',
                lockAspectRatio
                  ? 'bg-brand-500/10 text-brand-500'
                  : 'text-gray-400 dark:text-gray-500 active:text-brand-500'
              ]"
            >{{ lockAspectRatio ? '已锁' : '锁比' }}</button>
          </div>
          <input
            v-model="granularityYInput"
            :disabled="(!croppedImageCanvas && !mappedPixelData) || lockAspectRatio"
            @blur="granularityY = Math.max(10, Math.min(300, parseInt(granularityYInput) || 0))"
            @keyup.enter="granularityY = Math.max(10, Math.min(300, parseInt(granularityYInput) || 0))"
            min="10"
            max="300"
            type="number"
            :placeholder="granularityY > 0 ? granularityY.toString() : '自动'"
            class="w-20 h-7 px-2 text-right text-xs font-medium text-gray-900 dark:text-gray-100 bg-gray-100 dark:bg-gray-800 border-none rounded-md focus:ring-1 focus:ring-brand-500 focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none disabled:opacity-40"
          />
        </div>

        <!-- 处理模式 -->
        <div class="relative flex items-center justify-between px-3 h-11">
          <div class="flex items-center gap-0.5">
            <span class="text-xs text-gray-500 dark:text-gray-400">处理模式</span>
            <button
              type="button"
              class="w-5 h-5 rounded-full flex items-center justify-center text-gray-400 dark:text-gray-500 active:text-brand-500 active:bg-brand-500/10 transition-colors flex-shrink-0"
              @mouseenter="showTooltip('mode', $event)"
              @mouseleave="hideTooltip"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"></path></svg>
            </button>
          </div>
          <div class="flex h-7 rounded-md bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <button
              @click="pixelationMode = PixelationMode.Dominant"
              :class="[
                'px-3 text-[11px] font-medium transition-colors',
                pixelationMode === PixelationMode.Dominant
                  ? 'bg-gray-900 text-gray-50 dark:bg-gray-200 dark:text-gray-900'
                  : 'text-gray-500 dark:text-gray-400 active:bg-gray-200 dark:active:bg-gray-700'
              ]"
            >卡通</button>
            <button
              @click="pixelationMode = PixelationMode.Average"
              :class="[
                'px-3 text-[11px] font-medium transition-colors',
                pixelationMode === PixelationMode.Average
                  ? 'bg-gray-900 text-gray-50 dark:bg-gray-200 dark:text-gray-900'
                  : 'text-gray-500 dark:text-gray-400 active:bg-gray-200 dark:active:bg-gray-700'
              ]"
            >真实</button>
          </div>
        </div>
      </div>

      <!-- 一键去除背景 -->
      <button
        @click="emit('auto-remove-background')"
        :disabled="!mappedPixelData"
        class="w-full h-10 text-xs font-medium text-gray-500 dark:text-gray-400 border-t border-gray-200/60 dark:border-gray-800/40 active:bg-gray-100 dark:active:bg-gray-800 transition-colors disabled:opacity-30"
      >一键去除背景</button>
    </div>

    <!-- 色号系统 -->
    <div class="rounded-xl border border-gray-200/60 dark:border-gray-800/50 bg-gray-50/95 dark:bg-gray-900/80 p-3 shadow-sm">
      <div class="text-xs font-semibold text-gray-800 dark:text-gray-200 mb-2">色号系统</div>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="sys in colorSystemOptions"
          :key="sys.key"
          @click="selectedColorSystem = sys.key as ColorSystem"
          :class="[
            'px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors',
            selectedColorSystem === sys.key
              ? 'bg-gray-900 text-gray-50 dark:bg-gray-200 dark:text-gray-900'
              : 'text-gray-500 dark:text-gray-400 active:bg-gray-200 dark:active:bg-gray-700'
          ]"
        >{{ sys.name }}</button>
      </div>
    </div>

    <!-- 色彩优化面板 -->
    <div
      v-if="colorCounts && currentGridColors.length > 0"
      class="rounded-xl border border-gray-200/60 dark:border-gray-800/50 bg-gray-50/95 dark:bg-gray-900/80 shadow-sm shadow-gray-200/50 color-stats-panel flex flex-col"
    >
      <!-- 头部 (固定) -->
      <div class="relative flex items-center justify-between px-3 pt-2.5 pb-2 flex-shrink-0">
        <div class="flex items-center gap-0.5">
          <span class="text-sm font-semibold text-gray-800 dark:text-gray-200">色彩优化</span>
          <button
            type="button"
            class="w-5 h-5 rounded-full flex items-center justify-center text-gray-400 dark:text-gray-500 active:text-brand-500 active:bg-brand-500/10 transition-colors flex-shrink-0"
            @mouseenter="showTooltip('optimize', $event)"
            @mouseleave="hideTooltip"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"></path></svg>
          </button>
        </div>
        <span class="text-xs text-gray-400 dark:text-gray-500 tabular-nums">{{ totalBeadCount }} 颗</span>
      </div>

      <!-- 可滚动内容区域 -->
      <div class="overflow-y-auto overscroll-contain scrollbar-hide px-3 pb-2.5" style="max-height: 400px;">
        <!-- 颜色列表 -->
        <ul class="text-sm">
          <li
            v-for="item in currentGridColors"
            :key="item.color"
            class="group flex items-center justify-between px-2 py-2 rounded-lg cursor-pointer transition-all duration-150 active:scale-[0.98] active:bg-gray-200/70 dark:active:bg-gray-700/70 hover:bg-gray-100/80 dark:hover:bg-gray-800/60"
            @click="handleExcludeColor(item.color)"
          >
            <div class="flex items-center gap-2.5">
              <button
                class="w-5 h-5 rounded-md border border-gray-300/80 dark:border-gray-600/80 flex-shrink-0 shadow-sm hover:scale-110 transition-transform"
                :style="{ backgroundColor: item.color }"
                @click.stop="handleChangeReplacement(item.color)"
                title="点击更换颜色"
              ></button>
              <span class="font-mono text-xs font-medium text-gray-700 dark:text-gray-300 tracking-wide">{{ item.key }}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-[11px] tabular-nums text-gray-400 dark:text-gray-500 font-medium">{{ item.count }}</span>
              <svg class="w-3 h-3 text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </li>
        </ul>

        <!-- 已排除的颜色 -->
        <div v-if="excludedColorKeys.size > 0" class="mt-3 pt-3 border-t border-gray-200/50 dark:border-gray-700/40">
          <button
            @click="showExcludedColors = !showExcludedColors"
            class="w-full text-xs py-2 px-2.5 rounded-lg transition-colors flex items-center justify-between group/toggle hover:bg-gray-100 dark:hover:bg-gray-800/50"
          >
            <div class="flex items-center gap-1.5">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-3.5 w-3.5 text-gray-400 dark:text-gray-500 transition-transform duration-200"
                :class="{ 'rotate-90': showExcludedColors }"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              ><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"></path></svg>
              <span class="font-medium text-gray-600 dark:text-gray-400">已排除颜色</span>
              <span class="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400">{{ excludedColorKeys.size }}</span>
            </div>
            <svg class="w-3 h-3 text-gray-400 dark:text-gray-500 opacity-0 group-hover/toggle:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>

          <Transition name="expand">
            <div v-if="showExcludedColors" class="mt-1.5 rounded-lg border border-gray-200/60 dark:border-gray-800/50 bg-gray-100/60 dark:bg-gray-900/60 overflow-hidden">
              <ul class="divide-y divide-gray-200/40 dark:divide-gray-800/30">
                <li
                  v-for="item in excludedColorsList"
                  :key="item.color"
                  class="flex items-center justify-between px-2.5 py-2 hover:bg-gray-200/50 dark:hover:bg-gray-700/50 transition-colors"
                >
                  <!-- 原始颜色 -->
                  <div class="flex items-center gap-2 min-w-0">
                    <span
                      class="w-4 h-4 rounded border border-gray-300 dark:border-gray-600 flex-shrink-0 opacity-50"
                      :style="{ backgroundColor: item.color }"
                    ></span>
                    <span class="font-mono text-[11px] text-gray-500 dark:text-gray-400 line-through decoration-gray-400/50 dark:decoration-gray-500/50">{{ item.key }}</span>
                  </div>

                  <!-- 箭头 + 替换颜色 + 恢复按钮 -->
                  <div class="flex items-center gap-1.5 flex-shrink-0">
                    <svg class="w-3 h-3 text-gray-300 dark:text-gray-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                    <button
                      @click.stop="handleChangeReplacement(item.color)"
                      class="flex items-center gap-1.5 pl-1.5 pr-2 py-1 rounded-md bg-white dark:bg-gray-800 border border-gray-200/80 dark:border-gray-700/80 hover:border-gray-300 dark:hover:border-gray-600 shadow-xs transition-colors"
                      title="点击更换替换颜色"
                    >
                      <span
                        class="w-3.5 h-3.5 rounded-sm border border-gray-300 dark:border-gray-600 flex-shrink-0"
                        :style="{ backgroundColor: item.replacedBy || '#ccc' }"
                      ></span>
                      <span class="font-mono text-[10px] font-medium text-gray-700 dark:text-gray-300">{{ item.replacedByKey || '?' }}</span>
                    </button>
                    <button
                      @click.stop="handleRestoreColor(item.color)"
                      class="p-1 rounded-md text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors flex-shrink-0"
                      title="恢复此颜色"
                    >
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </li>
              </ul>
              <div class="px-2.5 py-2 border-t border-gray-200/40 dark:border-gray-800/30">
                <button
                  @click="handleRestoreAll"
                  class="w-full text-[11px] font-medium py-1.5 px-3 rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 active:bg-gray-100 dark:active:bg-gray-700 transition-colors"
                >一键恢复所有颜色</button>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </div>

    <!-- Tooltip (Teleport to body to avoid clipping) -->
    <Teleport to="body">
      <Transition name="tooltip-fade">
        <div
          v-if="activeTooltip"
          ref="tooltipRef"
          class="fixed z-[9999] px-2.5 py-2 text-[11px] leading-relaxed text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg pointer-events-none whitespace-normal max-w-[200px]"
          :style="{
            left: tooltipPosition.x + 'px',
            top: tooltipPosition.y + 'px',
            transform: 'translate(-50%, -100%)',
          }"
        >
          {{ tooltipContent[activeTooltip] }}
          <div class="absolute left-1/2 -translate-x-1/2 top-full w-2 h-2 bg-white dark:bg-gray-800 border-b border-r border-gray-200 dark:border-gray-700 rotate-45 -mt-1"></div>
        </div>
      </Transition>
    </Teleport>

    <!-- 颜色选择器弹窗 -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div
          v-if="showColorPicker"
          class="fixed inset-0 z-[9998] flex items-center justify-center bg-black/30"
          @click.self="showColorPicker = false"
        >
          <div class="bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 w-80 max-h-96 flex flex-col overflow-hidden">
            <div class="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <span class="text-xs font-medium text-gray-700 dark:text-gray-200">选择替换颜色</span>
              <button @click="showColorPicker = false" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-1">
              <!-- 当前图片中的颜色 -->
              <div v-if="availableColorsForPicker.some(c => c.inGrid)" class="mb-1">
                <div class="px-2 py-1 text-[10px] text-gray-400 dark:text-gray-500 font-medium">当前图片</div>
                <div class="flex flex-wrap gap-1 content-start">
                  <button
                    v-for="color in availableColorsForPicker.filter(c => c.inGrid)"
                    :key="color.color"
                    @click="selectReplacementColor(color.color)"
                    class="relative w-11 h-11 rounded-lg transition-all duration-100 flex items-center justify-center flex-shrink-0 border-2 border-transparent hover:border-gray-300 dark:hover:border-gray-600"
                    :style="{ backgroundColor: color.color }"
                  >
                    <span
                      class="text-[9px] font-bold leading-none select-none"
                      :style="{ color: isLightColor(color.color) ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.7)' }"
                    >{{ color.key }}</span>
                  </button>
                </div>
              </div>
              <!-- 完整色板中的其他颜色 -->
              <div v-if="availableColorsForPicker.some(c => !c.inGrid)">
                <div class="px-2 py-1 text-[10px] text-gray-400 dark:text-gray-500 font-medium">完整色板</div>
                <div class="flex flex-wrap gap-1 content-start">
                  <button
                    v-for="color in availableColorsForPicker.filter(c => !c.inGrid)"
                    :key="color.color"
                    @click="selectReplacementColor(color.color)"
                    class="relative w-11 h-11 rounded-lg transition-all duration-100 flex items-center justify-center flex-shrink-0 border-2 border-transparent hover:border-gray-300 dark:hover:border-gray-600"
                    :style="{ backgroundColor: color.color }"
                  >
                    <span
                      class="text-[9px] font-bold leading-none select-none"
                      :style="{ color: isLightColor(color.color) ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.7)' }"
                    >{{ color.key }}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.tooltip-fade-enter-active,
.tooltip-fade-leave-active {
  transition: opacity 0.15s ease;
}

.tooltip-fade-enter-from,
.tooltip-fade-leave-to {
  opacity: 0;
}

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.expand-enter-active {
  transition: all 0.2s ease-out;
  overflow: hidden;
}

.expand-leave-active {
  transition: all 0.15s ease-in;
  overflow: hidden;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  max-height: 0;
  transform: translateY(-4px);
}

.expand-enter-to,
.expand-leave-from {
  opacity: 1;
  max-height: 500px;
  transform: translateY(0);
}
</style>
