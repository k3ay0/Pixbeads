<script setup lang="ts">
const props = defineProps({
 guidanceMode: { type: String, default: 'nearest' },
 gridSectionInterval: { type: Number, default: 10 },
 showSectionLines: { type: Boolean, default: false },
 sectionLineColor: { type: String, default: '#007acc' },
 enableCelebration: { type: Boolean, default: true },
})

const emit = defineEmits([
 'update:guidanceMode',
 'update:gridSectionInterval',
 'update:showSectionLines',
 'update:sectionLineColor',
 'update:enableCelebration',
 'close',
])

const sectionLineColors = [
 { color: '#007acc', name: '蓝色' },
 { color: '#28a745', name: '绿色' },
 { color: '#dc3545', name: '红色' },
 { color: '#6f42c1', name: '紫色' },
 { color: '#fd7e14', name: '橙色' },
 { color: '#6c757d', name: '灰色' },
]

function setGuidanceMode(mode) {
 emit('update:guidanceMode', mode)
}

function setShowSectionLines(val) {
 emit('update:showSectionLines', val)
}

function setGridSectionInterval(val) {
 emit('update:gridSectionInterval', val)
}

function setSectionLineColor(color) {
 emit('update:sectionLineColor', color)
}

function setEnableCelebration(val) {
 emit('update:enableCelebration', val)
}
</script>

<template>
 <div class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-start justify-end" @click.self="emit('close')">
 <div class="w-80 max-w-[90vw] h-full bg-white shadow-lg flex flex-col">
 <!-- 头部 -->
 <div class="flex items-center justify-between p-4 border-b border-black/10">
 <h2 class="text-lg font-medium text-black">设置</h2>
 <button
 @click="emit('close')"
 class="text-black/45 hover:text-black"
 >
 <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
 </svg>
 </button>
 </div>

 <!-- 设置内容 -->
 <div class="flex-1 overflow-y-auto p-4 space-y-6">
 <!-- 引导设置 -->
 <div>
 <h3 class="text-base font-medium text-black mb-3">智能引导</h3>
 <div class="space-y-3">
 <label class="flex items-center">
 <input
 type="radio"
 name="guidanceMode"
 value="nearest"
 :checked="guidanceMode === 'nearest'"
 @change="setGuidanceMode('nearest')"
 class="mr-3 text-black"
 />
 <div>
 <div class="text-sm font-medium text-black">最近优先</div>
 <div class="text-xs text-black/45">推荐距离最近的格子</div>
 </div>
 </label>

 <label class="flex items-center">
 <input
 type="radio"
 name="guidanceMode"
 value="largest"
 :checked="guidanceMode === 'largest'"
 @change="setGuidanceMode('largest')"
 class="mr-3 text-black"
 />
 <div>
 <div class="text-sm font-medium text-black">大块优先</div>
 <div class="text-xs text-black/45">优先推荐大色块区域</div>
 </div>
 </label>

 <label class="flex items-center">
 <input
 type="radio"
 name="guidanceMode"
 value="edge-first"
 :checked="guidanceMode === 'edge-first'"
 @change="setGuidanceMode('edge-first')"
 class="mr-3 text-black"
 />
 <div>
 <div class="text-sm font-medium text-black">边缘优先</div>
 <div class="text-xs text-black/45">先完成边缘，再填充内部</div>
 </div>
 </label>
 </div>
 </div>

 <!-- 显示设置 -->
 <div>
 <h3 class="text-base font-medium text-black mb-3">显示设置</h3>
 <div class="space-y-4">
 <!-- 分割线开关 -->
 <label class="flex items-center justify-between">
 <div>
 <div class="text-sm font-medium text-black">显示分割线</div>
 <div class="text-xs text-black/45">将画布分割成区块帮助定位</div>
 </div>
 <input
 type="checkbox"
 :checked="showSectionLines"
 @change="setShowSectionLines($event.target.checked)"
 class="h-4 w-4 text-black rounded"
 />
 </label>

 <!-- 只有开启分割线时才显示后续选项 -->
 <template v-if="showSectionLines">
 <!-- 分割线间隔 -->
 <div>
 <label class="text-sm font-medium text-black block mb-2">
 分割间隔
 </label>
 <div class="flex items-center space-x-3">
 <input
 type="range"
 min="5"
 max="20"
 :value="gridSectionInterval"
 @input="setGridSectionInterval(parseInt($event.target.value))"
 class="flex-1 h-2 bg-black/10 rounded-lg appearance-none cursor-pointer"
 />
 <span class="text-sm font-medium text-black min-w-[3rem]">
 {{ gridSectionInterval }} 格
 </span>
 </div>
 </div>

 <!-- 分割线颜色 -->
 <div>
 <label class="text-sm font-medium text-black block mb-2">
 分割线颜色
 </label>
 <div class="flex gap-2 flex-wrap">
 <button
 v-for="colorOption in sectionLineColors"
 :key="colorOption.color"
 @click="setSectionLineColor(colorOption.color)"
 :class="[
 'w-6 h-6 rounded-full border-2 transition-all',
 sectionLineColor === colorOption.color
 ? 'border-black scale-110'
 : 'border-black/10 hover:border-black/30'
 ]"
 :style="{ backgroundColor: colorOption.color }"
 :title="colorOption.name"
 />
 </div>
 </div>
 </template>

 <!-- 庆祝动画开关 -->
 <label class="flex items-center justify-between">
 <div>
 <div class="text-sm font-medium text-black">庆祝动画</div>
 <div class="text-xs text-black/45">完成颜色时显示撒花效果</div>
 </div>
 <input
 type="checkbox"
 :checked="enableCelebration"
 @change="setEnableCelebration($event.target.checked)"
 class="h-4 w-4 text-black rounded"
 />
 </label>
 </div>
 </div>

 <!-- 进度重置 -->
 <div>
 <h3 class="text-base font-medium text-black mb-3">数据管理</h3>
 <div class="space-y-3">
 <button class="w-full py-2 px-4 bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 transition-colors text-sm">
 导出进度数据
 </button>
 <button class="w-full py-2 px-4 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors text-sm">
 重置所有进度
 </button>
 </div>
 </div>

 <!-- 关于信息 -->
 <div>
 <h3 class="text-base font-medium text-black mb-3">关于</h3>
 <div class="text-sm text-black/60 space-y-2">
 <p>专心拼豆模式 v1.0</p>
 <p>专为手机设计的拼豆助手</p>
 <div class="pt-2 text-xs text-black/45">
 <p>💡 提示：长按格子可以快速标记</p>
 <p>💡 提示：双指缩放可以查看细节</p>
 </div>
 </div>
 </div>
 </div>
 </div>
 </div>
</template>