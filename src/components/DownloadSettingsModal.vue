<script>
export const gridLineColorOptions = [
  { name: '深灰色', value: '#555555' },
  { name: '红色', value: '#FF0000' },
  { name: '蓝色', value: '#0000FF' },
  { name: '绿色', value: '#008000' },
  { name: '紫色', value: '#800080' },
  { name: '橙色', value: '#FFA500' },
]
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      @click.self="$emit('close')"
    >
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden w-full max-w-md">
        <div class="p-5">
          <div class="flex justify-between items-center border-b dark:border-gray-700 pb-3 mb-4">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">下载图纸设置</h3>
            <button
              @click="$emit('close')"
              class="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
              </svg>
            </button>
          </div>

          <div class="space-y-4">
            <!-- 显示网格线选项 -->
            <div class="flex items-center justify-between">
              <label class="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300">
                显示网格线
              </label>
              <label class="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  class="sr-only peer"
                  :checked="tempOptions.showGrid"
                  @change="handleOptionChange('showGrid', $event.target.checked)"
                />
                <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            <!-- 网格线设置 (仅当显示网格线时) -->
            <div v-if="tempOptions.showGrid" class="space-y-4 pl-2 border-l-2 border-gray-200 dark:border-gray-700 ml-1 pt-2 pb-1">
              <!-- 网格线间隔选项 -->
              <div class="flex flex-col space-y-2">
                <label class="text-sm font-medium text-gray-700 dark:text-gray-300">
                  网格线间隔 (每 N 格画一条线)
                </label>
                <div class="flex items-center justify-between space-x-3">
                  <input
                    type="range"
                    min="5"
                    max="20"
                    step="1"
                    :value="tempOptions.gridInterval"
                    @input="handleOptionChange('gridInterval', parseInt($event.target.value))"
                    class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                  />
                  <span class="flex items-center justify-center min-w-[40px] text-sm font-medium text-gray-900 dark:text-gray-100">
                    {{ tempOptions.gridInterval }}
                  </span>
                </div>
              </div>

              <!-- 网格线颜色选择 -->
              <div class="flex flex-col space-y-2">
                <label class="text-sm font-medium text-gray-700 dark:text-gray-300">
                  网格线颜色
                </label>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="colorOpt in gridLineColorOptions"
                    :key="colorOpt.value"
                    type="button"
                    @click="handleOptionChange('gridLineColor', colorOpt.value)"
                    class="w-8 h-8 rounded-full border-2 transition-all duration-150 flex items-center justify-center"
                    :class="tempOptions.gridLineColor === colorOpt.value
                      ? 'border-blue-500 ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-gray-800'
                      : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'"
                    :title="colorOpt.name"
                  >
                    <span
                      class="block w-6 h-6 rounded-full"
                      :style="{ backgroundColor: colorOpt.value }"
                    ></span>
                  </button>
                </div>
              </div>
            </div>

            <!-- 显示坐标选项 -->
            <div class="flex items-center justify-between">
              <label class="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300">
                显示坐标数字
              </label>
              <label class="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  class="sr-only peer"
                  :checked="tempOptions.showCoordinates"
                  @change="handleOptionChange('showCoordinates', $event.target.checked)"
                />
                <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            <!-- 隐藏格内色号选项 -->
            <div class="flex items-center justify-between">
              <label class="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300">
                隐藏格内色号
              </label>
              <label class="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  class="sr-only peer"
                  :checked="!tempOptions.showCellNumbers"
                  @change="handleOptionChange('showCellNumbers', !($event.target.checked))"
                />
                <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            <!-- 包含色号统计选项 -->
            <div class="flex items-center justify-between">
              <label class="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300">
                包含色号统计
              </label>
              <label class="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  class="sr-only peer"
                  :checked="tempOptions.includeStats"
                  @change="handleOptionChange('includeStats', $event.target.checked)"
                />
                <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            <!-- 导出CSV hex数据选项 -->
            <div class="flex items-center justify-between">
              <div class="flex flex-col">
                <label class="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300">
                  同时导出源数据
                </label>
                <span class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  导出hex颜色值的CSV文件，可用于重新导入
                </span>
              </div>
              <label class="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  class="sr-only peer"
                  :checked="tempOptions.exportCsv"
                  @change="handleOptionChange('exportCsv', $event.target.checked)"
                />
                <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
          </div>

          <div class="flex justify-end mt-6 space-x-3">
            <button
              @click="$emit('close')"
              class="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              @click="handleSave"
              class="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
            >
              下载图纸
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  isOpen: Boolean,
  options: Object,
})

const emit = defineEmits(['update:options', 'download-grid', 'close'])

const tempOptions = ref({ ...props.options })

// 同步父组件 options 变化到本地临时状态
watch(
  () => props.options,
  (newOptions) => {
    tempOptions.value = { ...newOptions }
  }
)

// 同步 isOpen 时重置临时选项
watch(
  () => props.isOpen,
  (isOpen) => {
    if (isOpen) {
      tempOptions.value = { ...props.options }
    }
  }
)

const handleOptionChange = (key, value) => {
  tempOptions.value = {
    ...tempOptions.value,
    [key]: value,
  }
}

const handleSave = () => {
  emit('update:options', { ...tempOptions.value })
  emit('download-grid', { ...tempOptions.value })
  emit('close')
}
</script>
