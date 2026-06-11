<script setup lang="ts">
import { computed, ref, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useBeadStore } from '../stores/beadStore'
import { usePaletteStore } from '../stores/paletteStore'
import { useEditorStore } from '../stores/editorStore'
import { colorSystemOptions, getColorKeyByHex, sortColorsByHue, getDisplayColorKey } from '../utils/colorSystemUtils'
import { findClosestPaletteColor, hexToRgb, recalculateColorStats, replaceAllColor } from '../utils/pixelation'
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
const { selectedColorSystem, excludedColorKeys, showExcludedColors, fullBeadPalette, colorReplacementMap } = storeToRefs(paletteStore)
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
  return Array.from(excludedColorKeys.value).map(hex => ({
    key: getColorKeyByHex(hex, selectedColorSystem.value),
    color: hex,
    replacedBy: colorReplacementMap.value.get(hex.toUpperCase()) || null,
    replacedByKey: colorReplacementMap.value.get(hex.toUpperCase())
      ? getColorKeyByHex(colorReplacementMap.value.get(hex.toUpperCase())!, selectedColorSystem.value)
      : null,
  }))
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

  // 从当前图片已有的颜色中选择（currentGridColors 已排除已排除颜色）
  // 再排除当前要排除的颜色
  const availableColors = currentGridColors.value
    .filter(c => c.color.toUpperCase() !== upperHex)
    .map(c => {
      const rgb = hexToRgb(c.color)
      return { key: c.key, hex: c.color, rgb: rgb || { r: 0, g: 0, b: 0 } }
    })

  if (availableColors.length === 0) return

  // 找到最接近的替换颜色
  const targetRgb = hexToRgb(upperHex)
  if (!targetRgb) return
  const closestColor = findClosestPaletteColor(targetRgb, availableColors)

  // 执行替换
  performColorReplace(upperHex, closestColor.hex)
}

/**
 * 执行颜色替换
 */
function performColorReplace(sourceHex: string, targetHex: string) {
  if (!mappedPixelData.value) return

  const targetKey = getDisplayColorKey(targetHex, selectedColorSystem.value)
  const { result, count } = replaceAllColor(mappedPixelData.value, sourceHex, targetKey, targetHex)

  if (count > 0) {
    editorStore.saveSnapshot(mappedPixelData.value)
    beadStore.setPixelData(result)
    const stats = recalculateColorStats(result)
    beadStore.updateColorStats(stats)

    // 记录替换映射
    paletteStore.setColorReplacement(sourceHex, targetHex)

    // 标记为已排除
    if (!excludedColorKeys.value.has(sourceHex)) {
      paletteStore.toggleExcludeColor(sourceHex)
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
    const originalKey = getColorKeyByHex(originalHex, selectedColorSystem.value)
    const { result: restoreResult } = replaceAllColor(mappedPixelData.value, currentReplacement, originalKey, originalHex)
    beadStore.setPixelData(restoreResult)
  }

  // 再用新颜色替换
  performColorReplace(originalHex, newTargetHex)

  // 关闭选择器
  showColorPicker.value = false
  colorPickerTarget.value = null
}

/**
 * 恢复单个颜色
 */
function handleRestoreColor(hex: string) {
  const upperHex = hex.toUpperCase()
  const replacement = colorReplacementMap.value.get(upperHex)

  if (replacement && mappedPixelData.value) {
    // 恢复原始颜色
    const originalKey = getColorKeyByHex(upperHex, selectedColorSystem.value)
    const { result } = replaceAllColor(mappedPixelData.value, replacement, originalKey, upperHex)

    editorStore.saveSnapshot(mappedPixelData.value)
    beadStore.setPixelData(result)
    const stats = recalculateColorStats(result)
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
  // 逐个恢复所有被替换的颜色
  for (const hex of excludedColorKeys.value) {
    const replacement = colorReplacementMap.value.get(hex)
    if (replacement && mappedPixelData.value) {
      const originalKey = getColorKeyByHex(hex, selectedColorSystem.value)
      const { result } = replaceAllColor(mappedPixelData.value, replacement, originalKey, hex)
      beadStore.setPixelData(result)
    }
  }

  // 重新计算统计
  if (mappedPixelData.value) {
    const stats = recalculateColorStats(mappedPixelData.value)
    beadStore.updateColorStats(stats)
  }

  // 清空状态（restoreAllExcluded 会同时清除 colorReplacementMap）
  paletteStore.restoreAllExcluded()
}

// 可选色板（从当前图片已有的颜色中选择，排除当前原始颜色）
// currentGridColors 已排除已排除颜色
const availableColorsForPicker = computed(() => {
  if (!colorPickerTarget.value) return []
  return currentGridColors.value
    .filter(c => c.color.toUpperCase() !== colorPickerTarget.value!.toUpperCase())
    .map(c => ({
      key: c.key,
      color: c.color,
    }))
    .sort((a, b) => a.key.localeCompare(b.key))
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
    <!-- Upload card -->
    <div class="rounded-xl border border-gray-200/60 dark:border-gray-800/50 bg-gray-50/95 dark:bg-gray-900/80 p-4 shadow-sm">
      <h3 class="text-xs font-semibold text-gray-800 dark:text-gray-200 mb-3">图片上传</h3>
      <div
        @click="emit('trigger-file-input')"
        @dragover.prevent
        @drop="handleDrop"
        class="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg p-4 text-center cursor-pointer active:bg-gray-100 dark:active:bg-gray-800 transition-colors"
      >
        <img v-if="originalImageSrc" :src="originalImageSrc" class="max-h-24 mx-auto rounded mb-2" alt="预览" />
        <div v-else class="space-y-1">
          <svg class="w-8 h-8 mx-auto text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 6v12m6-6H6" />
          </svg>
          <p class="text-xs text-gray-500 dark:text-gray-400">点击或拖放图片</p>
        </div>
      </div>
    </div>

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
      <div class="overflow-y-auto overscroll-contain px-3 pb-2.5" style="max-height: 400px;">
        <!-- 颜色列表 -->
        <ul class="space-y-0.5 text-sm">
          <li
            v-for="item in currentGridColors"
            :key="item.color"
            class="flex items-center justify-between px-2 py-1.5 rounded-lg cursor-pointer transition-colors min-h-[36px] active:bg-gray-100 dark:active:bg-gray-700"
            @click="handleExcludeColor(item.color)"
          >
            <div class="flex items-center gap-2">
              <span
                class="w-5 h-5 rounded border border-gray-300 dark:border-gray-600 flex-shrink-0"
                :style="{ backgroundColor: item.color }"
              ></span>
              <span class="font-mono text-xs font-medium text-gray-800 dark:text-gray-200">{{ item.key }}</span>
            </div>
            <span class="text-xs tabular-nums text-gray-500 dark:text-gray-400">{{ item.count }}</span>
          </li>
        </ul>

        <!-- 已排除的颜色 -->
        <div v-if="excludedColorKeys.size > 0" class="mt-3">
          <button
            @click="showExcludedColors = !showExcludedColors"
            class="w-full text-xs py-1.5 px-2 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 active:bg-gray-300 dark:hover:bg-gray-500 dark:active:bg-gray-500 transition-colors flex items-center justify-between"
          >
            <span>已排除的颜色 ({{ excludedColorKeys.size }})</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4 text-gray-500 dark:text-gray-400 transform transition-transform"
              :class="{ 'rotate-180': showExcludedColors }"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            ><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
          </button>

          <div v-if="showExcludedColors" class="mt-2 border border-gray-200/60 dark:border-gray-800/50 rounded-md p-2 bg-gray-100 dark:bg-gray-900/80">
            <ul class="space-y-1">
              <li
                v-for="item in excludedColorsList"
                :key="item.color"
                class="flex items-center justify-between p-1.5 hover:bg-gray-200 active:bg-gray-200 dark:hover:bg-gray-700 dark:active:bg-gray-700 rounded gap-2"
              >
                <!-- 原始颜色 -->
                <div class="flex items-center gap-1.5 min-w-0">
                  <span
                    class="w-4 h-4 rounded border border-gray-400 dark:border-gray-500 flex-shrink-0"
                    :style="{ backgroundColor: item.color }"
                  ></span>
                  <span class="font-mono text-xs text-gray-800 dark:text-gray-200">{{ item.key }}</span>
                </div>

                <!-- 箭头 + 替换颜色 -->
                <div class="flex items-center gap-1.5 flex-shrink-0">
                  <svg class="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                  <button
                    @click.stop="handleChangeReplacement(item.color)"
                    class="flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
                    title="点击更换替换颜色"
                  >
                    <span
                      class="w-3.5 h-3.5 rounded-sm border border-gray-400 dark:border-gray-500 flex-shrink-0"
                      :style="{ backgroundColor: item.replacedBy || '#ccc' }"
                    ></span>
                    <span class="font-mono text-[10px] text-gray-600 dark:text-gray-300">{{ item.replacedByKey || '?' }}</span>
                  </button>
                  <button
                    @click.stop="handleRestoreColor(item.color)"
                    class="text-[10px] py-0.5 px-1.5 text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                    title="恢复此颜色"
                  >
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </li>
            </ul>
            <button
              @click="handleRestoreAll"
              class="mt-2 w-full text-xs py-1 px-2 bg-brand-500 hover:bg-brand-600 active:bg-brand-600 text-white rounded transition-colors"
            >一键恢复所有颜色</button>
          </div>
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
          <div class="bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 w-64 max-h-80 flex flex-col overflow-hidden">
            <div class="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <span class="text-xs font-medium text-gray-700 dark:text-gray-200">选择替换颜色</span>
              <button @click="showColorPicker = false" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <ul class="flex-1 overflow-y-auto overscroll-contain p-1.5 space-y-0.5">
              <li
                v-for="color in availableColorsForPicker"
                :key="color.color"
                @click="selectReplacementColor(color.color)"
                class="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <span
                  class="w-5 h-5 rounded border border-gray-300 dark:border-gray-600 flex-shrink-0"
                  :style="{ backgroundColor: color.color }"
                ></span>
                <span class="font-mono text-xs text-gray-800 dark:text-gray-200">{{ color.key }}</span>
              </li>
            </ul>
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
</style>
