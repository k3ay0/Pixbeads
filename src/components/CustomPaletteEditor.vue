<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { getColorKeyByHex } from '../utils/colorSystemUtils'

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
])

const expandedGroups = ref({})
const searchTerm = ref('')
const tempSelections = ref({ ...props.currentSelections })

watch(() => props.currentSelections, (val) => {
 tempSelections.value = { ...val }
}, { deep: true })

// 对颜色进行分组的工具函数，按前缀分组
function groupColorsByPrefix(colors) {
 const groups = {}

 colors.forEach(color => {
 const displayKey = getColorKeyByHex(color.hex, props.selectedColorSystem)

 let prefix
 if (props.selectedColorSystem === '盼盼' || props.selectedColorSystem === '咪小窝') {
 if (/^\d+$/.test(displayKey)) {
 const num = parseInt(displayKey, 10)
 if (num <= 20) prefix = '1-20'
 else if (num <= 50) prefix = '21-50'
 else if (num <= 100) prefix = '51-100'
 else if (num <= 200) prefix = '101-200'
 else prefix = '200+'
 } else {
 prefix = '其他'
 }
 } else {
 prefix = displayKey.match(/^[A-Z]+/)?.[0] || '其他'
 }

 if (!groups[prefix]) groups[prefix] = []
 groups[prefix].push(color)
 })

 // 对每个组内的颜色按键进行排序
 Object.keys(groups).forEach(prefix => {
 groups[prefix].sort((a, b) => {
 const displayKeyA = getColorKeyByHex(a.hex, props.selectedColorSystem)
 const displayKeyB = getColorKeyByHex(b.hex, props.selectedColorSystem)

 if (props.selectedColorSystem === '盼盼' || props.selectedColorSystem === '咪小窝') {
 const numA = parseInt(displayKeyA, 10) || 0
 const numB = parseInt(displayKeyB, 10) || 0
 return numA - numB
 } else {
 const numA = parseInt(displayKeyA.replace(/^[A-Z]+/, ''), 10) || 0
 const numB = parseInt(displayKeyB.replace(/^[A-Z]+/, ''), 10) || 0
 return numA - numB
 }
 })
 })

 return groups
}

const selectedCount = computed(() => {
 return Object.values(tempSelections.value).filter(Boolean).length
})

const filteredColors = computed(() => {
 if (!searchTerm.value) return props.allColors
 const searchLower = searchTerm.value.toLowerCase()
 return props.allColors.filter(color => {
 const displayKey = getColorKeyByHex(color.hex, props.selectedColorSystem).toLowerCase()
 return displayKey.includes(searchLower)
 })
})

const colorGroups = computed(() => {
 return groupColorsByPrefix(filteredColors.value)
})

function toggleGroup(prefix) {
 expandedGroups.value = { ...expandedGroups.value, [prefix]: !expandedGroups.value[prefix] }
}

function toggleAllColors(selected) {
 props.allColors.forEach(color => {
  tempSelections.value[color.hex.toUpperCase()] = selected
 })
}

function toggleGroupColors(prefix, selected) {
 colorGroups.value[prefix].forEach(color => {
  tempSelections.value[color.hex.toUpperCase()] = selected
 })
}

function toggleColor(hex, checked) {
 tempSelections.value[hex] = checked
}
</script>

<template>
 <Teleport to="body">
  <div
   class="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
   @click.self="emit('close')"
  >
   <div class="bg-white rounded-xl shadow-lg overflow-hidden w-full max-w-lg max-h-[90vh] flex flex-col">
    <!-- 头部 -->
    <div class="flex justify-between items-center border-b pb-3 mb-3 px-5 pt-5">
     <h2 class="text-lg font-semibold text-black flex items-center">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2 text-[#007be5]" viewBox="0 0 20 20" fill="currentColor">
       <path fill-rule="evenodd" d="M4 2a2 2 0 00-2 2v11a3 3 0 106 0V4a2 2 0 00-2-2H4zm1 14a1 1 0 100-2 1 1 0 000 2zm5-1.757l4.9-4.9a2 2 0 000-2.828L13.485 5.1a2 2 0 00-2.828 0L10 5.757v8.486zM16 18H9.071l6-6H16a2 2 0 012 2v2a2 2 0 01-2 2z" clip-rule="evenodd" />
      </svg>
      色板管理中心 <span class="ml-2 text-sm text-[#007be5] dark:text-blue-400">({{ selectedCount }} 色)</span>
     </h2>
     <button
      @click="emit('close')"
      class="text-black/45 hover:text-black "
     >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
       <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
      </svg>
     </button>
    </div>

    <div class="flex-1 overflow-y-auto px-5 pb-5">

 <!-- 搜索框 -->
 <div class="mb-4">
 <div class="relative">
 <input
 type="text"
 placeholder="搜索色号..."
 v-model="searchTerm"
 class="w-full px-3 py-2 pl-9 border border-black/10 rounded-md text-sm bg-white text-black focus:ring-black focus:border-black"
 />
 <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
 <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-black/45 " fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
 </svg>
 </div>
 </div>
 </div>

 <!-- 说明文本 -->
 <div class="mb-4 text-xs text-black/60 bg-[#007be5]/[0.06] dark:bg-blue-900/20 p-2 rounded-md border border-black/[0.06] dark:border-blue-800/30">
 <p class="flex items-start">
 <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1 text-[#007be5] flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
 <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
 </svg>
 在此选择要使用的拼豆色系。您可以选择预设色板，然后根据需要手动添加或删除特定色号。完成后点击底部的"保存并应用"按钮。
 </p>
 </div>

 <!-- 快捷操作按钮 -->
 <div class="flex flex-wrap gap-2 mb-4 items-center">
 <button
 @click="toggleAllColors(true)"
 class="px-3 py-1.5 text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 rounded-md hover:bg-green-200 dark:hover:bg-green-900/50"
 >
 全选
 </button>
 <button
 @click="toggleAllColors(false)"
 class="px-3 py-1.5 text-xs bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 rounded-md hover:bg-red-200 dark:hover:bg-red-900/50"
 >
 全不选
 </button>
 <button
 @click="emit('importPalette')"
 class="px-3 py-1.5 text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 rounded-md hover:bg-blue-200 dark:hover:bg-blue-900/50 flex items-center gap-1"
 >
 <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
 <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
 </svg>
 导入配置
 </button>
 <button
 @click="emit('exportPalette')"
 class="px-3 py-1.5 text-xs bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 rounded-md hover:bg-purple-200 dark:hover:bg-purple-900/50 flex items-center gap-1"
 >
 <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
 <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
 </svg>
 导出配置
 </button>
 </div>

 <!-- 颜色列表 -->
 <div class="flex-1 overflow-y-auto pr-1">
 <div
 v-for="prefix in Object.keys(colorGroups).sort()"
 :key="prefix"
 class="mb-3 border border-black/10 rounded-lg overflow-hidden"
 >
 <!-- 组标题 -->
 <div
 class="flex justify-between items-center px-3 py-2 bg-white cursor-pointer hover:bg-black/[0.04] "
 @click="toggleGroup(prefix)"
 >
 <div class="flex items-center">
 <span class="font-medium text-black ">{{ prefix }} 系列</span>
 <span class="ml-2 text-xs text-black/45 ">
 ({{ colorGroups[prefix].length }} 色)
 </span>
 </div>

 <div class="flex items-center">
 <!-- 组操作按钮 -->
 <button
 @click.stop="toggleGroupColors(prefix, true)"
 class="text-xs text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300 mr-2"
 >
 全选
 </button>
 <button
 @click.stop="toggleGroupColors(prefix, false)"
 class="text-xs text-red-600 dark:text-[#f4422f]/60 hover:text-red-800 dark:hover:text-red-300 mr-2"
 >
 全不选
 </button>

 <!-- 展开/收起图标 -->
 <svg
 xmlns="http://www.w3.org/2000/svg"
 :class="['h-4 w-4 text-black/45 transform transition-transform', expandedGroups[prefix] ? 'rotate-180' : '']"
 fill="none"
 viewBox="0 0 24 24"
 stroke="currentColor"
 >
 <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
 </svg>
 </div>
 </div>

 <!-- 组内容 -->
 <div v-if="expandedGroups[prefix]" class="p-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
 <label
 v-for="color in colorGroups[prefix]"
 :key="color.key"
 class="flex items-center space-x-2 p-1.5 hover:bg-white rounded cursor-pointer"
 >
 <input
  type="checkbox"
  :checked="!!tempSelections[color.hex.toUpperCase()]"
  @change="toggleColor(color.hex.toUpperCase(), $event.target.checked)"
  class="h-4 w-4 rounded border-black/10 text-black focus:ring-black "
 />
 <div
 class="w-6 h-6 rounded-sm border border-black/10 flex-shrink-0"
 :style="{ backgroundColor: color.hex }"
 />
 <span class="text-sm text-black ">{{ getColorKeyByHex(color.hex, selectedColorSystem) }}</span>
 </label>
 </div>
 </div>
 </div>

    </div>

    <!-- 底部按钮 -->
    <div class="px-5 pb-5 pt-3 border-t flex justify-between">
     <button
      @click="handleClose"
      class="px-4 py-2 bg-black/10 text-black rounded-md hover:bg-black/10 "
     >
      取消
     </button>
     <button
      @click="emit('save', { ...tempSelections })"
      class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
     >
      保存并应用
     </button>
    </div>
   </div>
  </div>
 </Teleport>
</template>