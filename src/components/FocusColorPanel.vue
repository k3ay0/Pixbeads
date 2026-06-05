<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
 colors: Array<{ color: string; name: string; total: number; completed: number }>
 currentColor: string
 mode?: 'sidebar' | 'bottomsheet'
}>()

const emit = defineEmits<{
 colorSelect: [color: string]
 close: []
}>()

const searchTerm = ref('')
const sortBy = ref('progress')

const filteredAndSortedColors = computed(() => {
 return props.colors
 .filter(
 (color) =>
 color.name.toLowerCase().includes(searchTerm.value.toLowerCase()) ||
 color.color.toLowerCase().includes(searchTerm.value.toLowerCase())
 )
 .sort((a, b) => {
 switch (sortBy.value) {
 case 'progress': {
 const progressA = (a.completed / a.total) * 100
 const progressB = (b.completed / b.total) * 100
 return progressA - progressB
 }
 case 'name':
 return a.name.localeCompare(b.name)
 case 'total':
 return b.total - a.total
 default:
 return 0
 }
 })
})

function handleSelect(color: string) {
 emit('colorSelect', color)
}

const isSidebar = computed(() => props.mode === 'sidebar')
</script>

<template>
 <!-- 桌面端：右侧侧边栏 -->
 <div
 v-if="isSidebar"
 class="w-72 bg-white border-l border-black/10 flex flex-col h-full flex-shrink-0"
 >
 <div class="px-4 py-3 border-b border-black/10">
 <div class="flex items-center justify-between mb-3">
 <h3 class="text-sm font-medium text-black">选择颜色</h3>
 <button @click="emit('close')" class="text-black/35 hover:text-black/60">
 <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
 </svg>
 </button>
 </div>
 <!-- 搜索框 -->
 <div class="relative">
 <input
 v-model="searchTerm"
 type="text"
 placeholder="搜索颜色..."
 class="w-full pl-10 pr-4 py-2 border border-black/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black"
 />
 <svg class="absolute left-3 top-2.5 h-4 w-4 text-black/35" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
 </svg>
 </div>
 <!-- 排序 -->
 <select v-model="sortBy" class="w-full mt-2 p-2 border border-black/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black">
 <option value="progress">按进度排序</option>
 <option value="name">按名称排序</option>
 <option value="total">按数量排序</option>
 </select>
 </div>

 <!-- 颜色列表 -->
 <div class="flex-1 overflow-y-auto px-3 py-2">
 <button
 v-for="colorInfo in filteredAndSortedColors"
 :key="colorInfo.color"
 @click="handleSelect(colorInfo.color)"
 class="w-full p-2.5 mb-1.5 rounded-lg border-2 transition-all text-left"
 :class="[
 colorInfo.color === currentColor
 ? 'border-black bg-[#007be5]/[0.06]'
 : 'border-black/10 bg-white hover:border-black/10',
 colorInfo.completed >= colorInfo.total ? 'opacity-60' : '',
 ]"
 >
 <div class="flex items-center justify-between">
 <div class="flex items-center space-x-2">
 <div class="w-7 h-7 rounded-full border-2 border-black/10 flex-shrink-0" :style="{ backgroundColor: colorInfo.color }" />
 <div>
 <div class="text-xs font-medium text-black font-mono">{{ colorInfo.name }}</div>
 <div class="text-[10px] text-black/45">{{ colorInfo.completed }}/{{ colorInfo.total }}</div>
 </div>
 </div>
 <div v-if="colorInfo.completed >= colorInfo.total" class="text-[#00a63e]">
 <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
 <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
 </svg>
 </div>
 <div v-else-if="colorInfo.color === currentColor" class="text-[#007be5]">
 <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
 <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
 </svg>
 </div>
 </div>
 <!-- 进度条 -->
 <div class="mt-1.5 w-full bg-black/10 rounded-full h-1">
 <div class="h-1 rounded-full transition-all" :class="colorInfo.completed >= colorInfo.total ? 'bg-black' : 'bg-[#007be5]'" :style="{ width: `${Math.round((colorInfo.completed / colorInfo.total) * 100)}%` }" />
 </div>
 </button>
 </div>
 </div>

 <!-- 移动端：底部弹窗 -->
 <div v-else class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end" @click.self="emit('close')">
 <div class="w-full bg-white rounded-t-2xl max-h-[80vh] flex flex-col">
 <!-- 拖拽指示条 -->
 <div class="flex justify-center py-2">
 <div class="w-10 h-1 bg-black/10 rounded-full"></div>
 </div>

 <!-- 搜索框 -->
 <div class="px-4 pb-3">
 <div class="relative">
 <input
 v-model="searchTerm"
 type="text"
 placeholder="搜索颜色..."
 class="w-full pl-10 pr-4 py-2 border border-black/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-black"
 />
 <svg
 class="absolute left-3 top-2.5 h-5 w-5 text-black/35"
 fill="none"
 stroke="currentColor"
 viewBox="0 0 24 24"
 >
 <path
 stroke-linecap="round"
 stroke-linejoin="round"
 stroke-width="2"
 d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
 />
 </svg>
 </div>
 </div>

 <!-- 排序选项 -->
 <div class="px-4 pb-3">
 <select
 v-model="sortBy"
 class="w-full p-2 border border-black/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-black"
 >
 <option value="progress">按进度排序</option>
 <option value="name">按名称排序</option>
 <option value="total">按数量排序</option>
 </select>
 </div>

 <!-- 颜色列表 -->
 <div class="flex-1 overflow-y-auto px-4 pb-4">
 <button
 v-for="colorInfo in filteredAndSortedColors"
 :key="colorInfo.color"
 @click="handleSelect(colorInfo.color)"
 class="w-full p-3 mb-2 rounded-lg border-2 transition-all"
 :class="[
 colorInfo.color === currentColor
 ? 'border-black bg-[#007be5]/[0.06]'
 : 'border-black/10 bg-white hover:border-black/10',
 colorInfo.completed >= colorInfo.total ? 'opacity-60' : '',
 ]"
 >
 <div class="flex items-center justify-between">
 <div class="flex items-center space-x-3">
 <div
 class="w-10 h-10 rounded-full border-2 border-black/10 flex-shrink-0"
 :style="{ backgroundColor: colorInfo.color }"
 />
 <div class="text-left">
 <div class="text-sm font-medium text-black font-mono">
 {{ colorInfo.name }}
 </div>
 <div class="text-xs text-black/45">
 {{ colorInfo.completed }}/{{ colorInfo.total }} ({{
 Math.round((colorInfo.completed / colorInfo.total) * 100)
 }}%)
 </div>
 </div>
 </div>

 <div class="flex items-center space-x-2">
 <!-- 完成标记 -->
 <div v-if="colorInfo.completed >= colorInfo.total" class="text-[#00a63e]">
 <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
 <path
 fill-rule="evenodd"
 d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
 clip-rule="evenodd"
 />
 </svg>
 </div>
 <!-- 选中标记 -->
 <div v-if="colorInfo.color === currentColor" class="text-[#007be5]">
 <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
 <path
 fill-rule="evenodd"
 d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
 clip-rule="evenodd"
 />
 </svg>
 </div>
 </div>
 </div>

 <!-- 进度条 -->
 <div class="mt-2 w-full bg-black/10 rounded-full h-1.5">
 <div
 class="h-1.5 rounded-full transition-all"
 :class="
 colorInfo.completed >= colorInfo.total ? 'bg-black' : 'bg-[#007be5]'
 "
 :style="{
 width: `${Math.round((colorInfo.completed / colorInfo.total) * 100)}%`,
 }"
 />
 </div>
 </button>
 </div>

 <!-- 关闭按钮 -->
 <div class="p-4 border-t border-black/10">
 <button
 @click="emit('close')"
 class="w-full py-3 bg-black text-white rounded-lg hover:bg-black/70 transition-colors"
 >
 关闭
 </button>
 </div>
 </div>
 </div>
</template>