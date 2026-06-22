<script setup lang="ts">
import type { ColorSystem, MappedPixel, GridDimensions, ColorCounts, PaletteColor } from '@/types'
import { convertToCurrentSystem, colorDistance } from '@/utils/downloader'
import { hexToRgb } from '@/utils/pixelation'

interface PbdsImportResult {
  mappedPixelData: MappedPixel[][]
  gridDimensions: GridDimensions
  colorCounts: ColorCounts
  totalBeadCount: number
  sourceColorSystem: ColorSystem
}

const props = defineProps<{
  isOpen: boolean
  importData: PbdsImportResult | null
  currentColorSystem: ColorSystem
  fullPalette: PaletteColor[]
}>()

const emit = defineEmits<{
  close: []
  confirm: [data: { mappedPixelData: MappedPixel[][]; gridDimensions: GridDimensions; colorSystem: ColorSystem }]
}>()

// 计算颜色统计
function getColorStats() {
  if (!props.importData || !props.currentColorSystem) return null

  const sourceSystem = props.importData.sourceColorSystem
  const uniqueColors = new Set<string>()

  for (const row of props.importData.mappedPixelData) {
    for (const cell of row) {
      if (!cell.isExternal) {
        uniqueColors.add(cell.color.toUpperCase())
      }
    }
  }

  let convertibleCount = 0
  let approximatableCount = 0

  // 这里简化统计：假设大多数颜色可以通过 hex 映射
  // 实际转换时会更精确
  for (const hex of uniqueColors) {
    // 简单判断：如果颜色在 colorSystemMapping 中有定义，就可以转换
    convertibleCount++
  }

  return {
    totalColors: uniqueColors.size,
    convertibleCount,
    approximatableCount: 0
  }
}

// 直接使用原始数据（切换色系）
function handleUseOriginal() {
  if (!props.importData) return

  emit('confirm', {
    mappedPixelData: props.importData.mappedPixelData,
    gridDimensions: props.importData.gridDimensions,
    colorSystem: props.importData.sourceColorSystem
  })
}

// 转换为当前色系
function handleConvert() {
  if (!props.importData) return

  const result = convertToCurrentSystem(
    props.importData,
    props.currentColorSystem,
    props.fullPalette
  )

  emit('confirm', {
    mappedPixelData: result.mappedPixelData,
    gridDimensions: props.importData.gridDimensions,
    colorSystem: props.currentColorSystem
  })
}

// 取消
function handleCancel() {
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen && importData"
      class="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      @click.self="handleCancel"
    >
      <div class="bg-white rounded-xl shadow-lg overflow-hidden w-full max-w-sm">
        <div class="p-5">
          <div class="flex justify-between items-center border-b pb-3 mb-4">
            <h3 class="text-lg font-semibold text-black">导入文件</h3>
            <button
              @click="handleCancel"
              class="text-black/45 hover:text-black"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
              </svg>
            </button>
          </div>

          <div class="space-y-4">
            <!-- 色系信息 -->
            <div class="bg-black/[0.03] rounded-lg p-4 space-y-2">
              <div class="flex items-center justify-between text-sm">
                <span class="text-black/60">文件色系</span>
                <span class="font-medium text-black">{{ importData.sourceColorSystem }}</span>
              </div>
              <div class="flex items-center justify-between text-sm">
                <span class="text-black/60">当前色系</span>
                <span class="font-medium text-black">{{ currentColorSystem }}</span>
              </div>
              <div class="flex items-center justify-between text-sm">
                <span class="text-black/60">颜色数量</span>
                <span class="font-medium text-black">{{ Object.keys(importData.colorCounts).length }} 种</span>
              </div>
              <div class="flex items-center justify-between text-sm">
                <span class="text-black/60">珠子总数</span>
                <span class="font-medium text-black">{{ importData.totalBeadCount }} 粒</span>
              </div>
              <div class="flex items-center justify-between text-sm">
                <span class="text-black/60">图纸尺寸</span>
                <span class="font-medium text-black">{{ importData.gridDimensions.N }} × {{ importData.gridDimensions.M }}</span>
              </div>
            </div>

            <!-- 色系相同提示 -->
            <div
              v-if="importData.sourceColorSystem === currentColorSystem"
              class="text-sm text-black/60 text-center py-2"
            >
              文件色系与当前色系相同，可直接导入
            </div>

            <!-- 操作按钮 -->
            <div class="space-y-2">
              <!-- 转换为当前色系 -->
              <button
                v-if="importData.sourceColorSystem !== currentColorSystem"
                @click="handleConvert"
                class="w-full py-2.5 px-4 text-sm font-medium rounded-lg border border-black/10 bg-black text-white hover:bg-black/80 transition-colors"
              >
                转换为当前色系 ({{ currentColorSystem }})
              </button>

              <!-- 直接使用原始数据 -->
              <button
                @click="handleUseOriginal"
                class="w-full py-2.5 px-4 text-sm font-medium rounded-lg border border-black/10 bg-black/[0.04] text-black hover:bg-black/[0.08] transition-colors"
              >
                <template v-if="importData.sourceColorSystem !== currentColorSystem">
                  保持原色 ({{ importData.sourceColorSystem }})
                </template>
                <template v-else>
                  直接导入
                </template>
              </button>

              <!-- 取消 -->
              <button
                @click="handleCancel"
                class="w-full py-2.5 px-4 text-sm font-medium rounded-lg border border-black/10 bg-transparent text-black/60 hover:bg-black/[0.04] transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
