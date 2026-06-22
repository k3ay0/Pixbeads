<template>
  <Teleport to="body">
    <div class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end" @click.self="$emit('close')">
      <div class="w-full bg-white rounded-t-2xl max-h-[80vh] flex flex-col">
        <!-- 拖拽指示条 -->
        <div class="flex justify-center py-2">
          <div class="w-10 h-1 bg-black/10 rounded-full"></div>
        </div>

        <!-- 搜索框 -->
        <div class="px-4 pb-3">
          <div class="relative">
            <input
              type="text"
              placeholder="搜索颜色..."
              v-model="searchTerm"
              class="w-full pl-10 pr-4 py-2 border border-black/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <svg
              class="absolute left-3 top-2.5 h-5 w-5 text-black/35"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" :stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        <!-- 排序选项 -->
        <div class="px-4 pb-3">
          <select
            v-model="sortBy"
            class="w-full p-2 border border-black/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            @click="$emit('select', colorInfo.color)"
            class="w-full p-3 mb-2 rounded-full border-2 transition-all"
            :class="[
              colorInfo.color === currentColor
                ? 'border-blue-500 bg-[#007be5]/[0.06]'
                : 'border-black/10 bg-white hover:border-black/10',
              Math.round((colorInfo.completed / colorInfo.total) * 100) === 100 ? 'opacity-60' : ''
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
                    {{ colorInfo.completed }}/{{ colorInfo.total }} ({{ Math.round((colorInfo.completed / colorInfo.total) * 100) }}%)
                  </div>
                </div>
              </div>

              <div class="flex items-center space-x-2">
                <!-- 完成勾选 -->
                <div v-if="Math.round((colorInfo.completed / colorInfo.total) * 100) === 100" class="text-black">
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                  </svg>
                </div>
                <!-- 选中勾选 -->
                <div v-if="colorInfo.color === currentColor" class="text-[#007be5]">
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                  </svg>
                </div>
              </div>
            </div>

            <!-- 进度条 -->
            <div class="mt-2 w-full bg-black/10 rounded-full h-1.5">
              <div
                class="h-1.5 rounded-full transition-all"
                :class="Math.round((colorInfo.completed / colorInfo.total) * 100) === 100 ? 'bg-black' : 'bg-[#007be5]/[0.06]0'"
                :style="{ width: `${Math.round((colorInfo.completed / colorInfo.total) * 100)}%` }"
              />
            </div>
          </button>
        </div>

        <!-- 关闭按钮 -->
        <div class="p-4 border-t border-black/10">
          <button
            @click="$emit('close')"
            class="w-full py-3 bg-black text-white rounded-full hover:bg-black/80 transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

interface ColorInfo {
  color: string
  name: string
  total: number
  completed: number
}

const props = defineProps<{
  colors: ColorInfo[]
  currentColor?: string
}>()

const emit = defineEmits(['select', 'close'])

const searchTerm = ref('')
const sortBy = ref('progress')

const filteredAndSortedColors = computed(() => {
  return props.colors
    .filter(color =>
      color.name.toLowerCase().includes(searchTerm.value.toLowerCase()) ||
      color.color.toLowerCase().includes(searchTerm.value.toLowerCase())
    )
    .sort((a, b) => {
      switch (sortBy.value) {
        case 'progress': {
          const progressA = (a.completed / a.total) * 100
          const progressB = (b.completed / b.total) * 100
          return progressA - progressB // 进度低的在前
        }
        case 'name':
          return a.name.localeCompare(b.name)
        case 'total':
          return b.total - a.total // 数量多的在前
        default:
          return 0
      }
    })
})
</script>