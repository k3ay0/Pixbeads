<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { IroningPreviewConfig, Material } from '../utils/ironingPreview'

const emit = defineEmits<{
  (e: 'download-preview'): void
  (e: 'update:config', config: IroningPreviewConfig): void
}>()

// 材质选项
const material = ref<Material>('matte')
const materialOptions: { key: Material; label: string }[] = [
  { key: 'matte', label: '磨砂' },
  { key: 'glitter', label: '格力特' },
  { key: 'towel', label: '毛巾' },
  { key: 'bath-towel', label: '搓澡巾' },
]

// 边缘效果
const edgeEnabled = ref(true)
const curvature = ref(30)

// 阴影
const shadowEnabled = ref(true)
const shadowAngle = ref(135)
const shadowDistance = ref(8)

// 背景
interface BackgroundOption {
  key: string
  color: string
  label: string
  isCustom?: boolean
}

const selectedBackground = ref('wood')
const backgroundOptions: BackgroundOption[] = [
  { key: 'warmWhite', color: '#f5f0eb', label: '暖白' },
  { key: 'pureWhite', color: '#ffffff', label: '纯白' },
  { key: 'beige', color: '#e8e6dc', label: '米色' },
  { key: 'dark', color: '#2d2d2d', label: '深色' },
  { key: 'black', color: '#1a1a1a', label: '黑色' },
  { key: 'wood', color: '#f0e6d3', label: '木纹' },
  { key: 'custom', color: '', label: '自定义', isCustom: true },
]
const customColor = ref('#f0e6d3')

// 显示文字
const displayText = ref('可更改此文字')
const textOpacity = ref(35)

// 计算当前背景颜色
const currentBackgroundColor = computed(() => {
  if (selectedBackground.value === 'custom') {
    return customColor.value
  }
  const option = backgroundOptions.find((bg) => bg.key === selectedBackground.value)
  return option?.color || '#f0e6d3'
})

// 计算当前配置
const currentConfig = computed<IroningPreviewConfig>(() => ({
  material: material.value,
  edgeEnabled: edgeEnabled.value,
  curvature: curvature.value,
  shadowEnabled: shadowEnabled.value,
  shadowAngle: shadowAngle.value,
  shadowDistance: shadowDistance.value,
  backgroundColor: currentBackgroundColor.value,
  displayText: displayText.value,
  textOpacity: textOpacity.value,
}))

// 监听配置变化并 emit
watch(
  currentConfig,
  (newConfig) => {
    emit('update:config', newConfig)
  },
  { deep: true, immediate: true }
)

const handleDownload = () => {
  emit('download-preview')
}
</script>

<template>
  <div class="flex-1 overflow-y-auto scrollbar-hide px-3 py-3 flex flex-col gap-3">
    <div class="flex flex-col gap-4">
      <!-- 头部标题卡片 -->
      <div
        class="rounded-xl border border-brand-500/20 bg-brand-500/5 p-3 flex items-center justify-between gap-3"
      >
        <div>
          <div class="text-xs font-semibold text-brand-500 mb-1">熨烫预览</div>
          <div class="text-[11px] text-gray-600 dark:text-gray-400">
            预览拼豆熨烫后的真实效果。可调整材质、阴影和边缘效果。
          </div>
        </div>
        <button
          class="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-brand-500/40 text-brand-500 active:bg-brand-500/10 transition-colors"
          title="下载预览图"
          @click="handleDownload"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="w-3.5 h-3.5"
          >
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          下载
        </button>
      </div>

      <!-- 材质选择 -->
      <div
        class="rounded-xl border border-gray-200/60 dark:border-gray-800/50 bg-gray-50/95 dark:bg-gray-900/80 p-4 shadow-sm"
      >
        <div class="text-xs font-medium text-gray-600 dark:text-gray-300 mb-3">材质</div>
        <div class="grid grid-cols-4 gap-1.5">
          <button
            v-for="option in materialOptions"
            :key="option.key"
            class="py-2 px-1 text-xs rounded-lg border transition-colors"
            :class="
              material === option.key
                ? 'bg-gray-900 text-gray-50 border-gray-900 dark:bg-gray-100 dark:text-gray-900'
                : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 active:bg-gray-200 dark:active:bg-gray-700'
            "
            @click="material = option.key"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <!-- 边缘效果 -->
      <div
        class="rounded-xl border border-gray-200/60 dark:border-gray-800/50 bg-gray-50/95 dark:bg-gray-900/80 p-4 shadow-sm"
      >
        <div class="text-xs font-medium text-gray-600 dark:text-gray-300 mb-3">边缘效果</div>
        <div class="space-y-3">
          <label
            class="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer"
          >
            <input
              v-model="edgeEnabled"
              class="accent-brand-500 w-4 h-4"
              type="checkbox"
            />
            弧形边缘（模拟热熔膨出）
          </label>
          <div v-if="edgeEnabled" class="flex items-center gap-2">
            <span class="text-[11px] text-gray-600 dark:text-gray-400 flex-shrink-0">弧度</span>
            <input
              v-model.number="curvature"
              min="10"
              max="80"
              step="5"
              class="flex-1 accent-brand-500"
              type="range"
            />
            <span class="text-[11px] text-gray-600 dark:text-gray-400 tabular-nums w-8 text-right">
              {{ curvature }}%
            </span>
          </div>
        </div>
      </div>

      <!-- 阴影 -->
      <div
        class="rounded-xl border border-gray-200/60 dark:border-gray-800/50 bg-gray-50/95 dark:bg-gray-900/80 p-4 shadow-sm"
      >
        <div class="text-xs font-medium text-gray-600 dark:text-gray-300 mb-3">阴影</div>
        <div class="space-y-3">
          <label
            class="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer"
          >
            <input
              v-model="shadowEnabled"
              class="accent-brand-500 w-4 h-4"
              type="checkbox"
            />
            显示投影
          </label>
          <template v-if="shadowEnabled">
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-gray-600 dark:text-gray-400 flex-shrink-0">角度</span>
              <input
                v-model.number="shadowAngle"
                min="0"
                max="360"
                step="15"
                class="flex-1 accent-brand-500"
                type="range"
              />
              <span class="text-[11px] text-gray-600 dark:text-gray-400 tabular-nums w-8 text-right">
                {{ shadowAngle }}°
              </span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-gray-600 dark:text-gray-400 flex-shrink-0">距离</span>
              <input
                v-model.number="shadowDistance"
                min="2"
                max="20"
                step="1"
                class="flex-1 accent-brand-500"
                type="range"
              />
              <span class="text-[11px] text-gray-600 dark:text-gray-400 tabular-nums w-8 text-right">
                {{ shadowDistance }}
              </span>
            </div>
          </template>
        </div>
      </div>

      <!-- 背景 -->
      <div
        class="rounded-xl border border-gray-200/60 dark:border-gray-800/50 bg-gray-50/95 dark:bg-gray-900/80 p-4 shadow-sm"
      >
        <div class="text-xs font-medium text-gray-600 dark:text-gray-300 mb-3">背景</div>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="bg in backgroundOptions"
            :key="bg.key"
            class="flex flex-col items-center gap-1"
            @click="selectedBackground = bg.key"
          >
            <div
              class="w-8 h-8 rounded-lg border-2 transition-all"
              :class="
                selectedBackground === bg.key
                  ? 'border-brand-500 scale-110'
                  : 'border-gray-200 dark:border-gray-600'
              "
              :style="
                bg.isCustom
                  ? {
                      background:
                        'conic-gradient(rgb(255, 0, 0), rgb(255, 255, 0), rgb(0, 255, 0), rgb(0, 255, 255), rgb(0, 0, 255), rgb(255, 0, 255), rgb(255, 0, 0))',
                    }
                  : { backgroundColor: bg.color }
              "
            />
            <span class="text-[10px] text-gray-600 dark:text-gray-400">{{ bg.label }}</span>
          </button>
        </div>
        <!-- 自定义颜色选择器 -->
        <div v-if="selectedBackground === 'custom'" class="mt-3">
          <input
            v-model="customColor"
            type="color"
            class="w-full h-8 rounded-lg cursor-pointer"
          />
        </div>
      </div>

      <!-- 显示文字 -->
      <div
        class="rounded-xl border border-gray-200/60 dark:border-gray-800/50 bg-gray-50/95 dark:bg-gray-900/80 p-4 shadow-sm"
      >
        <div class="text-xs font-medium text-gray-600 dark:text-gray-300 mb-3">显示文字</div>
        <input
          v-model="displayText"
          placeholder="如：@你的店铺名"
          class="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-700 dark:text-gray-200 placeholder:text-gray-400 outline-none focus:border-brand-500 transition-colors"
          type="text"
        />
        <div class="flex items-center gap-2 mt-2.5">
          <span class="text-[11px] text-gray-600 dark:text-gray-400 flex-shrink-0">透明度</span>
          <input
            v-model.number="textOpacity"
            min="20"
            max="100"
            step="5"
            class="flex-1 accent-brand-500"
            type="range"
          />
          <span class="text-[11px] text-gray-600 dark:text-gray-400 tabular-nums w-8 text-right">
            {{ textOpacity }}%
          </span>
        </div>
        <div class="text-[10px] text-gray-500 dark:text-gray-400 mt-1.5">
          显示在图案下方背景区域
        </div>
      </div>
    </div>
  </div>
</template>
