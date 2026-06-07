<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useEditorStore } from '../stores/editorStore'
import type { ManualTool } from '../stores/editorStore'

const emit = defineEmits<{
  (e: 'toggle-palette'): void
}>()

const editorStore = useEditorStore()
const { manualTool, selectedEditColor, isEraseMode, colorReplaceState, manualPasteActive } = storeToRefs(editorStore)

const tools: { key: ManualTool; label: string }[] = [
  { key: 'drag', label: '拖拽' },
  { key: 'brush', label: '画笔' },
  { key: 'eraser', label: '橡皮' },
  { key: 'picker', label: '取色' },
  { key: 'fill', label: '填充' },
  { key: 'line', label: '直线' },
  { key: 'rect', label: '矩形' },
  { key: 'select', label: '选区' },
  { key: 'move', label: '移动' },
]

const currentToolKey = () => manualPasteActive.value ? 'paste' : manualTool.value

function handleToolSelect(tool: ManualTool) {
  editorStore.setManualTool(tool)
}
</script>

<template>
  <div class="absolute left-3 top-1/2 -translate-y-1/2 z-30 max-h-[calc(100%-1.5rem)] overflow-y-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none] flex flex-col items-center gap-1 p-1.5 rounded-2xl bg-gray-900/85 backdrop-blur-xl border border-gray-700/40 shadow-2xl">
    <!-- Current color indicator -->
    <button
      @click="emit('toggle-palette')"
      aria-label="切换色板"
      class="flex flex-col items-center gap-0.5 cursor-pointer flex-shrink-0 mb-1"
    >
      <span
        class="w-9 h-9 rounded-lg border-2 border-gray-500/50"
        :style="{ backgroundColor: selectedEditColor?.color || '#ffffff' }"
      ></span>
      <span class="text-[9px] font-mono text-gray-400 leading-none truncate max-w-[40px]">
        {{ selectedEditColor?.key || '' }}
      </span>
    </button>

    <div class="h-px w-7 bg-gray-600/40 flex-shrink-0"></div>

    <!-- Tool buttons -->
    <button
      v-for="tool in tools"
      :key="tool.key"
      @click="handleToolSelect(tool.key)"
      :aria-label="tool.label"
      :title="tool.label"
      :class="[
        'w-10 h-10 rounded-xl transition-all flex items-center justify-center flex-shrink-0',
        currentToolKey() === tool.key && !isEraseMode && !colorReplaceState.isActive
          ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/30 scale-110'
          : 'text-gray-400 active:text-gray-50 active:bg-gray-700/60'
      ]"
    >
      <!-- brush -->
      <svg v-if="tool.key === 'brush'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5">
        <path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/>
      </svg>
      <!-- eraser -->
      <svg v-else-if="tool.key === 'eraser'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5">
        <path d="M7 21h10"/><path d="M5.5 11.5l8-8a2.83 2.83 0 114 4l-8 8a2 2 0 01-1.41.59H5a2 2 0 01-2-2v-3.17c0-.53.21-1.04.59-1.42z"/>
      </svg>
      <!-- picker -->
      <svg v-else-if="tool.key === 'picker'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5">
        <path d="M2 22l1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="M14.5 5.5l4-4a1.41 1.41 0 012 2l-4 4"/><path d="M12 8l4 4"/>
      </svg>
      <!-- fill -->
      <svg v-else-if="tool.key === 'fill'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5">
        <path d="M19 11V4a2 2 0 00-2-2H4a2 2 0 00-2 2v13a2 2 0 002 2h7"/><path d="M16 22l4.5-4.5a2.12 2.12 0 000-3L18 12l-7 7 2.5 2.5a2.12 2.12 0 003 0z"/>
      </svg>
      <!-- line -->
      <svg v-else-if="tool.key === 'line'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="w-5 h-5">
        <line x1="5" y1="19" x2="19" y2="5"/>
      </svg>
      <!-- rect -->
      <svg v-else-if="tool.key === 'rect'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
      </svg>
      <!-- select -->
      <svg v-else-if="tool.key === 'select'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5">
        <path d="M5 3h4M15 3h4M3 5v4M3 15v4M21 5v4M21 15v4M5 21h4M15 21h4"/>
      </svg>
      <!-- move -->
      <svg v-else-if="tool.key === 'move'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5">
        <path d="M5 9l-3 3 3 3"/><path d="M9 5l3-3 3 3"/><path d="M15 19l-3 3-3-3"/><path d="M19 9l3 3-3 3"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/>
      </svg>
      <!-- drag -->
      <svg v-else-if="tool.key === 'drag'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5">
        <path d="M18 11V6a2 2 0 00-4 0v3"/><path d="M14 10V4a2 2 0 00-4 0v6"/><path d="M10 10.5V5a2 2 0 00-4 0v9"/><path d="M22 10.5V14a8 8 0 01-8 8h-1C8.58 22 6 18 6 14"/>
      </svg>
    </button>

    <!-- Erase mode indicator -->
    <span v-if="isEraseMode" class="px-1.5 py-1 rounded-lg bg-red-500/20 text-red-300 text-[10px] font-medium flex-shrink-0">
      擦
    </span>
    <!-- Replace mode indicator -->
    <span v-if="colorReplaceState.isActive" class="px-1.5 py-1 rounded-lg bg-indigo-500/20 text-indigo-300 text-[10px] font-medium flex-shrink-0">
      替
    </span>
  </div>
</template>
