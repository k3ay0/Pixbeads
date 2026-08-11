<script lang="ts">
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
        <div v-if="isOpen" class="modal-overlay backdrop-blur-sm" @click.self="$emit('close')">
            <div class="modal max-w-md">
                <div class="p-5 pb-3 flex-shrink-0">
                    <div class="flex justify-between items-center border-b pb-3">
                        <h3 class="text-lg font-semibold text-black ">下载图纸设置</h3>
                        <button @click="$emit('close')" class="text-black/45 hover:text-black ">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20"
                                fill="currentColor">
                                <path fill-rule="evenodd"
                                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                    clip-rule="evenodd" />
                            </svg>
                        </button>
                    </div>
                </div>

                <div class="flex-1 overflow-y-auto overscroll-contain min-h-0 px-5 pt-4 pb-4">
                    <div class="space-y-4">
                        <!-- 显示网格线选项 -->
                        <div class="flex items-center justify-between">
                            <label class="flex items-center text-sm font-medium text-black ">
                                显示网格线
                            </label>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" class="sr-only peer" :checked="tempOptions.showGrid"
                                    @change="handleOptionChange('showGrid', getChecked($event))" />
                                <div
                                    class="w-11 h-6 bg-black/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-black/10 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-black">
                                </div>
                            </label>
                        </div>

                        <!-- 网格线设置 (仅当显示网格线时) -->
                        <div v-if="tempOptions.showGrid"
                            class="space-y-4 pl-2 border-l-2 border-black/10 ml-1 pt-2 pb-1">
                            <!-- 网格线间隔选项 -->
                            <div class="flex flex-col space-y-2">
                                <label class="text-sm font-medium text-black ">
                                    网格线间隔 (每 N 格画一条线)
                                </label>
                                <div class="flex items-center justify-between space-x-3">
                                    <input type="range" min="5" max="20" step="1" :value="tempOptions.gridInterval"
                                        @input="handleOptionChange('gridInterval', parseInt(getValue($event)))"
                                        class="w-full h-2 bg-black/10 rounded-lg appearance-none cursor-pointer " />
                                    <span
                                        class="flex items-center justify-center min-w-[40px] text-sm font-medium text-black ">
                                        {{ tempOptions.gridInterval }}
                                    </span>
                                </div>
                            </div>

                            <!-- 网格线颜色选择 -->
                            <div class="flex flex-col space-y-2">
                                <label class="text-sm font-medium text-black ">
                                    网格线颜色
                                </label>
                                <div class="flex flex-wrap gap-2">
                                    <button v-for="colorOpt in gridLineColorOptions" :key="colorOpt.value" type="button"
                                        @click="handleOptionChange('gridLineColor', colorOpt.value)"
                                        class="w-8 h-8 rounded-full border-2 transition-all duration-150 flex items-center justify-center"
                                        :class="tempOptions.gridLineColor === colorOpt.value
                                            ? 'border-black ring-2 ring-black ring-offset-1 '
                                            : 'border-black/10 hover:border-black/25 dark:hover:border-black/30'" :title="colorOpt.name">
                                        <span class="block w-6 h-6 rounded-full"
                                            :style="{ backgroundColor: colorOpt.value }"></span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- 显示坐标选项 -->
                        <div class="flex items-center justify-between">
                            <label class="flex items-center text-sm font-medium text-black ">
                                显示坐标数字
                            </label>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" class="sr-only peer" :checked="tempOptions.showCoordinates"
                                    @change="handleOptionChange('showCoordinates', getChecked($event))" />
                                <div
                                    class="w-11 h-6 bg-black/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-black/10 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-black">
                                </div>
                            </label>
                        </div>

                        <!-- 隐藏格内色号选项 -->
                        <div class="flex items-center justify-between">
                            <label class="flex items-center text-sm font-medium text-black ">
                                隐藏格内色号
                            </label>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" class="sr-only peer" :checked="!tempOptions.showCellNumbers"
                                    @change="handleOptionChange('showCellNumbers', !getChecked($event))" />
                                <div
                                    class="w-11 h-6 bg-black/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-black/10 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-black">
                                </div>
                            </label>
                        </div>

                        <!-- 包含色号统计选项 -->
                        <div class="flex items-center justify-between">
                            <label class="flex items-center text-sm font-medium text-black ">
                                包含色号统计
                            </label>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" class="sr-only peer" :checked="tempOptions.includeStats"
                                    @change="handleOptionChange('includeStats', getChecked($event))" />
                                <div
                                    class="w-11 h-6 bg-black/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-black/10 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-black">
                                </div>
                            </label>
                        </div>

                        <!-- 同时导出方案选项 -->
                        <div class="flex items-center justify-between">
                            <div class="flex flex-col">
                                <label class="flex items-center text-sm font-medium text-black ">
                                    导出分享方案
                                </label>
                                <span class="text-xs text-black/45 mt-1">
                                    同时导出 .pbds 文件，包含完整项目数据，可以分享。
                                </span>
                            </div>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" class="sr-only peer" :checked="tempOptions.exportPbds"
                                    @change="handleOptionChange('exportPbds', getChecked($event))" />
                                <div
                                    class="w-11 h-6 bg-black/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-black/10 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-black">
                                </div>
                            </label>
                        </div>

                        <!-- 添加水印选项 -->
                        <div class="flex items-center justify-between">
                            <div class="flex flex-col">
                                <label class="flex items-center text-sm font-medium text-black ">
                                    添加水印
                                </label>
                                <span class="text-xs text-black/45 mt-1">
                                    在图纸上叠加水印，防止图案被盗用。
                                </span>
                            </div>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" class="sr-only peer" :checked="tempOptions.showWatermark"
                                    @change="handleOptionChange('showWatermark', getChecked($event))" />
                                <div
                                    class="w-11 h-6 bg-black/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-black/10 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-black">
                                </div>
                            </label>
                        </div>

                        <!-- 水印类型设置 (仅当添加水印开启时) -->
                        <div v-if="tempOptions.showWatermark"
                            class="space-y-4 pl-2 border-l-2 border-black/10 ml-1 pt-2 pb-1">
                            <!-- 文字水印子开关 -->
                            <div class="flex items-center justify-between">
                                <label class="flex items-center text-sm font-medium text-black ">
                                    文字水印
                                </label>
                                <label class="relative inline-flex items-center cursor-pointer">
                                    <input type="checkbox" class="sr-only peer"
                                        :checked="tempOptions.watermarkTextEnabled"
                                        @change="handleOptionChange('watermarkTextEnabled', getChecked($event))" />
                                    <div
                                        class="w-11 h-6 bg-black/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-black/10 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-black">
                                    </div>
                                </label>
                            </div>

                            <!-- 水印文字内容 (仅当文字水印开启时) -->
                            <div v-if="tempOptions.watermarkTextEnabled"
                                class="flex flex-col space-y-2 pl-2 border-l-2 border-black/10 ml-1 pt-2 pb-1">
                                <label class="text-sm font-medium text-black ">
                                    水印文字
                                </label>
                                <input type="text" :value="tempOptions.watermarkText"
                                    @input="handleOptionChange('watermarkText', getValue($event))" maxlength="30"
                                    placeholder="输入水印文字，留空则不显示"
                                    class="w-full px-3 py-2 text-sm border border-black/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-black/20" />
                                <label class="text-sm font-medium text-black mt-2">
                                    水印密度
                                </label>
                                <div class="flex items-center justify-between space-x-3">
                                    <input type="range" min="0" max="100" step="5" :value="tempOptions.watermarkDensity"
                                        @input="handleOptionChange('watermarkDensity', parseInt(getValue($event)))"
                                        class="w-full h-2 bg-black/10 rounded-lg appearance-none cursor-pointer " />
                                    <span
                                        class="flex items-center justify-center min-w-[40px] text-sm font-medium text-black ">
                                        {{ tempOptions.watermarkDensity }}%
                                    </span>
                                </div>
                            </div>

                            <!-- 图片水印子开关 -->
                            <div class="flex items-center justify-between">
                                <div class="flex flex-col">
                                    <label class="flex items-center text-sm font-medium text-black ">
                                        图片水印
                                    </label>
                                    <span class="text-xs text-black/45 mt-1">
                                        上传图片作为图纸背景，未填充的格子会透出图片。
                                    </span>
                                </div>
                                <label class="relative inline-flex items-center cursor-pointer">
                                    <input type="checkbox" class="sr-only peer"
                                        :checked="tempOptions.showBackgroundImage"
                                        @change="handleOptionChange('showBackgroundImage', getChecked($event))" />
                                    <div
                                        class="w-11 h-6 bg-black/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-black/10 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-black">
                                    </div>
                                </label>
                            </div>

                            <!-- 图片水印设置 (仅当图片水印开启时) -->
                            <div v-if="tempOptions.showBackgroundImage"
                                class="space-y-4 pl-2 border-l-2 border-black/10 ml-1 pt-2 pb-1">
                                <div class="flex flex-col space-y-2">
                                    <label class="text-sm font-medium text-black ">
                                        背景图片
                                    </label>
                                    <div class="flex items-center gap-3">
                                        <img v-if="tempOptions.backgroundImage" :src="tempOptions.backgroundImage"
                                            class="w-16 h-16 object-cover rounded-lg border border-black/10 bg-black/5"
                                            alt="背景图预览" />
                                        <button type="button" @click="fileInput?.click()"
                                            class="text-xs px-3 py-2 rounded-lg border border-black/10 hover:border-black/25 text-black/70 hover:text-black transition-colors">
                                            {{ tempOptions.backgroundImage ? '更换图片' : '选择图片' }}
                                        </button>
                                        <button v-if="tempOptions.backgroundImage" type="button"
                                            @click="handleRemoveBackground"
                                            class="text-xs px-3 py-2 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors">
                                            移除
                                        </button>
                                    </div>
                                    <input ref="fileInput" type="file" accept="image/*" class="hidden"
                                        @change="handleImageUpload" />
                                </div>

                                <div class="flex flex-col space-y-2">
                                    <label class="text-sm font-medium text-black ">
                                        背景透明度
                                    </label>
                                    <div class="flex items-center justify-between space-x-3">
                                        <input type="range" min="10" max="100" step="5"
                                            :value="Math.round(tempOptions.backgroundOpacity * 100)"
                                            @input="handleOptionChange('backgroundOpacity', parseInt(getValue($event)) / 100)"
                                            class="w-full h-2 bg-black/10 rounded-lg appearance-none cursor-pointer " />
                                        <span
                                            class="flex items-center justify-center min-w-[40px] text-sm font-medium text-black ">
                                            {{ Math.round(tempOptions.backgroundOpacity * 100) }}%
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="flex justify-end space-x-3 px-5 pt-3 pb-5 flex-shrink-0">
                    <button @click="$emit('close')" class="btn btn-secondary px-4 py-2 rounded-lg">
                        取消
                    </button>
                    <button @click="handleSave"
                        class="btn px-4 py-2 bg-[#007be5] hover:bg-blue-600 text-white rounded-lg">
                        下载图纸
                    </button>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { GridDownloadOptions } from '../types'

const props = defineProps<{
    isOpen: boolean
    options: GridDownloadOptions
}>()

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

const handleOptionChange = (key: string, value: any) => {
    tempOptions.value = {
        ...tempOptions.value,
        [key]: value,
    }
}

const getChecked = (e: Event): boolean => (e.target as HTMLInputElement).checked
const getValue = (e: Event): string => (e.target as HTMLInputElement).value

const fileInput = ref<HTMLInputElement | null>(null)

const handleImageUpload = (e: Event) => {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
        handleOptionChange('backgroundImage', reader.result as string)
    }
    reader.readAsDataURL(file)
    input.value = ''
}

const handleRemoveBackground = () => {
    handleOptionChange('backgroundImage', null)
}

const handleSave = () => {
    emit('update:options', { ...tempOptions.value })
    emit('download-grid', { ...tempOptions.value })
    emit('close')
}
</script>