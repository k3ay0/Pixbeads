<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { getColorKeyByHex, colorSystemOptions } from '../utils/colorSystemUtils'
import { getContrastColor } from '../utils/colorUtils'
import type { ColorSystem } from '@/types'

const props = defineProps({
  allColors: { type: Array, default: () => [] },
  currentSelections: { type: Object, default: () => ({}) },
  selectedColorSystem: { type: String, default: 'MARD' },
})

const emit = defineEmits([
  'save',
  'close',
  'exportPalette',
  'importPalette',
  'update:colorSystem',
])

const searchTerm = ref('')
const tempSelections = ref<Record<string, boolean>>({ ...props.currentSelections })
const activeCategory = ref('全部')

watch(() => props.currentSelections, (val) => {
  tempSelections.value = { ...val }
}, { deep: true })

// 获取颜色的显示色号
function getDisplayKey(hex: string): string {
  return getColorKeyByHex(hex, props.selectedColorSystem as ColorSystem)
}

// 获取颜色的分类前缀
function getColorPrefix(hex: string): string {
  const displayKey = getDisplayKey(hex)
  if (props.selectedColorSystem === '盼盼' || props.selectedColorSystem === '咪小窝') {
    if (/^\d+$/.test(displayKey)) {
      const num = parseInt(displayKey, 10)
      if (num <= 20) return '1-20'
      if (num <= 50) return '21-50'
      if (num <= 100) return '51-100'
      if (num <= 200) return '101-200'
      return '200+'
    }
    return '其他'
  }
  return displayKey.match(/^[A-Z]+/)?.[0] || '其他'
}

// 已选数量
const selectedCount = computed(() => {
  return Object.values(tempSelections.value).filter(Boolean).length
})

// 搜索过滤
const filteredColors = computed(() => {
  if (!searchTerm.value) return props.allColors
  const searchLower = searchTerm.value.toLowerCase()
  return (props.allColors as any[]).filter((color: any) => {
    const displayKey = getDisplayKey(color.hex).toLowerCase()
    return displayKey.includes(searchLower)
  })
})

// 分类列表（带计数）
const categories = computed(() => {
  const prefixMap = new Map<string, { total: number; selected: number }>()
  let totalAll = 0
  let selectedAll = 0

  ;(props.allColors as any[]).forEach((color: any) => {
    const hex = color.hex.toUpperCase()
    const prefix = getColorPrefix(color.hex)
    const isSelected = !!tempSelections.value[hex]

    if (!prefixMap.has(prefix)) {
      prefixMap.set(prefix, { total: 0, selected: 0 })
    }
    const entry = prefixMap.get(prefix)!
    entry.total++
    if (isSelected) entry.selected++

    totalAll++
    if (isSelected) selectedAll++
  })

  // 按前缀排序
  const sortedPrefixes = Array.from(prefixMap.entries()).sort((a, b) => {
    const isNumA = /^\d/.test(a[0])
    const isNumB = /^\d/.test(b[0])
    if (isNumA && !isNumB) return 1
    if (!isNumA && isNumB) return -1
    return a[0].localeCompare(b[0])
  })

  return [
    { prefix: '全部', total: totalAll, selected: selectedAll },
    ...sortedPrefixes.map(([prefix, data]) => ({ prefix, ...data })),
  ]
})

// 当前分类过滤后的颜色
const displayedColors = computed(() => {
  if (activeCategory.value === '全部') return filteredColors.value
  return (filteredColors.value as any[]).filter((color: any) => {
    return getColorPrefix(color.hex) === activeCategory.value
  })
})

function toggleColor(hex: string) {
  const upperHex = hex.toUpperCase()
  tempSelections.value[upperHex] = !tempSelections.value[upperHex]
}

function selectAll() {
  ;(displayedColors.value as any[]).forEach((color: any) => {
    tempSelections.value[color.hex.toUpperCase()] = true
  })
}

function clearAll() {
  ;(displayedColors.value as any[]).forEach((color: any) => {
    tempSelections.value[color.hex.toUpperCase()] = false
  })
}

function handleSave() {
  emit('save', { ...tempSelections.value })
}

function handleClose() {
  emit('close')
}

function handleColorSystemChange(system: string) {
  emit('update:colorSystem', system)
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      @click.self="handleClose"
    >
      <div class="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div class="flex-1 overflow-y-auto">
          <div class="p-4 sm:p-6">
            <div class="flex flex-col h-full max-h-[calc(90vh-40px)]">
              <!-- 标题栏 -->
              <div class="flex flex-col gap-2 pb-3 border-b border-gray-200 dark:border-gray-700">
                <div class="flex items-center justify-between gap-2">
                  <div>
                    <div class="text-base font-semibold text-gray-900 dark:text-gray-100">色板设置</div>
                    <div class="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums">
                      已选 {{ selectedCount }} / {{ allColors.length }}
                    </div>
                  </div>
                  <button
                    aria-label="关闭"
                    class="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 active:bg-gray-200 dark:active:bg-gray-700 transition-colors flex-shrink-0"
                    @click="handleClose"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <!-- 色系切换 + 搜索 -->
                <div class="flex items-center gap-2 flex-wrap">
                  <div class="flex h-8 rounded-lg bg-gray-100 dark:bg-gray-800 overflow-hidden flex-shrink-0">
                    <button
                      v-for="system in colorSystemOptions"
                      :key="system.key"
                      class="px-3 text-[11px] font-medium transition-colors"
                      :class="selectedColorSystem === system.key
                        ? 'bg-gray-900 text-gray-50 dark:bg-gray-200 dark:text-gray-900'
                        : 'text-gray-500 dark:text-gray-400 active:bg-gray-200 dark:active:bg-gray-700'"
                      @click="handleColorSystemChange(system.key)"
                    >
                      {{ system.name }}
                    </button>
                  </div>

                  <div class="relative flex-1 min-w-[120px]">
                    <input
                      v-model="searchTerm"
                      placeholder="搜索色号"
                      class="w-full h-8 pl-8 pr-2 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-200 focus:ring-1 focus:ring-brand-500 focus:outline-none"
                      type="text"
                    />
                    <svg xmlns="http://www.w3.org/2000/svg" class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                </div>
              </div>

              <!-- 分类筛选 + 色彩网格 -->
              <div class="flex-1 flex min-h-0 mt-0 sm:mt-3 gap-3">
                <!-- 左侧分类栏（桌面端） -->
                <div class="hidden sm:flex w-28 flex-shrink-0 flex-col gap-1 overflow-y-auto overscroll-contain pr-1">
                  <button
                    v-for="cat in categories"
                    :key="cat.prefix"
                    class="w-full text-left px-3 py-2 text-xs rounded-lg transition-colors"
                    :class="activeCategory === cat.prefix
                      ? 'bg-gray-900 text-gray-50 dark:bg-gray-200 dark:text-gray-900'
                      : 'text-gray-600 dark:text-gray-400 active:bg-gray-200 dark:active:bg-gray-700'"
                    @click="activeCategory = cat.prefix"
                  >
                    {{ cat.prefix }}
                    <span class="tabular-nums" :class="activeCategory === cat.prefix ? 'text-gray-400 dark:text-gray-500' : 'text-gray-400 dark:text-gray-500'">
                      {{ cat.selected }}/{{ cat.total }}
                    </span>
                  </button>
                </div>

                <!-- 移动端分类横滑 -->
                <div class="sm:hidden flex gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none] py-2 flex-shrink-0">
                  <button
                    v-for="cat in categories"
                    :key="cat.prefix"
                    class="flex-shrink-0 px-3 py-1.5 text-xs rounded-lg transition-colors whitespace-nowrap"
                    :class="activeCategory === cat.prefix
                      ? 'bg-gray-900 text-gray-50 dark:bg-gray-200 dark:text-gray-900'
                      : 'text-gray-600 dark:text-gray-400 active:bg-gray-200 dark:active:bg-gray-700'"
                    @click="activeCategory = cat.prefix"
                  >
                    {{ cat.prefix }}
                    <span class="tabular-nums" :class="activeCategory === cat.prefix ? '' : 'text-gray-500 dark:text-gray-400'">
                      {{ cat.selected }}/{{ cat.total }}
                    </span>
                  </button>
                </div>

                <!-- 色彩网格 -->
                <div class="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-1">
                  <div class="flex flex-wrap gap-1.5 content-start">
                    <button
                      v-for="color in displayedColors"
                      :key="color.hex"
                      class="relative w-11 h-11 rounded-lg transition-all duration-100 flex items-center justify-center flex-shrink-0"
                      :class="tempSelections[color.hex.toUpperCase()]
                        ? 'border-2 border-brand-500'
                        : 'border-2 border-transparent opacity-35 active:opacity-70'"
                      :style="{ backgroundColor: color.hex }"
                      @click="toggleColor(color.hex)"
                    >
                      <span
                        class="text-[9px] font-bold leading-none select-none"
                        :style="{ color: getContrastColor(color.hex) }"
                      >
                        {{ getDisplayKey(color.hex) }}
                      </span>
                      <div
                        v-if="tempSelections[color.hex.toUpperCase()]"
                        class="absolute top-0 right-0 w-3 h-3 bg-brand-500 rounded-bl-md rounded-tr-[5px] flex items-center justify-center"
                      >
                        <svg class="w-2 h-2 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="3">
                          <path d="M2 6l3 3 5-5" />
                        </svg>
                      </div>
                    </button>
                  </div>
                </div>
              </div>

              <!-- 底部操作栏 -->
              <div class="flex items-center justify-between flex-wrap gap-2 pt-3 mt-3 border-t border-gray-200 dark:border-gray-700">
                <div class="flex items-center gap-2 flex-wrap">
                  <button
                    class="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 active:bg-gray-200 dark:active:bg-gray-700 transition-colors"
                    @click="selectAll"
                  >
                    全选
                  </button>
                  <button
                    class="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 active:bg-gray-200 dark:active:bg-gray-700 transition-colors"
                    @click="clearAll"
                  >
                    清空
                  </button>
                  <div class="w-px h-5 bg-gray-200 dark:bg-gray-700"></div>
                  <button
                    class="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 active:bg-gray-200 dark:active:bg-gray-700 transition-colors"
                    @click="emit('importPalette')"
                  >
                    导入
                  </button>
                  <button
                    class="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 active:bg-gray-200 dark:active:bg-gray-700 transition-colors"
                    @click="emit('exportPalette')"
                  >
                    导出
                  </button>
                </div>
                <div class="flex items-center gap-2">
                  <button
                    class="px-4 py-2 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 active:bg-gray-200 dark:active:bg-gray-700 transition-colors"
                    @click="handleClose"
                  >
                    取消
                  </button>
                  <button
                    class="px-4 py-2 text-xs rounded-lg bg-gray-900 text-gray-50 dark:bg-gray-200 dark:text-gray-900 active:bg-gray-800 dark:active:bg-gray-300 transition-colors"
                    @click="handleSave"
                  >
                    保存并应用
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
