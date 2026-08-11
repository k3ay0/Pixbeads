<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useEditorStore } from '@/stores/editorStore'
import { usePixelEditing } from '@/composables/usePixelEditing'
import { TRANSPARENT_KEY } from '@/types'

const emit = defineEmits<{
  (e: 'close'): void
}>()

const editorStore = useEditorStore()
const { editHistory, editHistoryTools, editHistoryIndex, canUndo, canRedo } = storeToRefs(editorStore)
const { undoEdit, redoEdit, jumpToHistoryEdit } = usePixelEditing()

// 为每条历史快照计算非透明格子数，用于展示
const historyItems = computed(() => {
  return editHistory.value.map((snapshot, index) => {
    let count = 0
    for (const row of snapshot) {
      for (const cell of row) {
        if (cell && !cell.isExternal && cell.key !== TRANSPARENT_KEY) count++
      }
    }
    return { index, count, tool: editHistoryTools.value[index] || '编辑' }
  })
})

function jumpTo(index: number) {
  jumpToHistoryEdit(index)
  emit('close')
}
</script>

<template>
  <div
    class="absolute top-4 right-4 z-40 w-60 max-h-[calc(100%-2rem)] flex flex-col overflow-hidden rounded-2xl bg-gray-900/90 backdrop-blur-xl border border-gray-700/40 shadow-2xl">
    <!-- Header -->
    <div class="flex items-center justify-between px-3 py-2 border-b border-gray-700/40 flex-shrink-0">
      <span class="text-xs font-semibold text-gray-200">修改历史</span>
      <button @click="emit('close')"
        class="w-6 h-6 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700/60 transition-colors flex items-center justify-center text-sm leading-none"
        aria-label="关闭修改历史">✕</button>
    </div>

    <!-- Undo / Redo -->
    <div class="flex gap-1.5 p-2 border-b border-gray-700/40 flex-shrink-0">
      <button @click="undoEdit" :disabled="!canUndo"
        class="flex-1 px-2 py-1.5 rounded-lg text-xs flex items-center justify-center gap-1 transition-colors"
        :class="canUndo ? 'bg-gray-800 text-gray-200 hover:bg-gray-700' : 'bg-gray-900 text-gray-600 cursor-not-allowed'"
        title="撤销 (Ctrl+Z)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
          stroke-linejoin="round" class="w-3.5 h-3.5">
          <path d="M9 14L4 9l5-5" />
          <path d="M4 9h10.5a5.5 5.5 0 015.5 5.5v0a5.5 5.5 0 01-5.5 5.5H11" />
        </svg>
        撤销
      </button>
      <button @click="redoEdit" :disabled="!canRedo"
        class="flex-1 px-2 py-1.5 rounded-lg text-xs flex items-center justify-center gap-1 transition-colors"
        :class="canRedo ? 'bg-gray-800 text-gray-200 hover:bg-gray-700' : 'bg-gray-900 text-gray-600 cursor-not-allowed'"
        title="重做 (Ctrl+Y)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
          stroke-linejoin="round" class="w-3.5 h-3.5">
          <path d="M15 14l5-5-5-5" />
          <path d="M20 9H9.5A5.5 5.5 0 004 14.5v0A5.5 5.5 0 009.5 20H13" />
        </svg>
        重做
      </button>
    </div>

    <!-- History list -->
    <div class="flex-1 overflow-y-auto p-1.5 space-y-1 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
      <div v-if="historyItems.length === 0" class="text-xs text-gray-500 text-center py-4">暂无历史记录</div>
      <button v-for="item in historyItems" :key="item.index" @click="jumpTo(item.index)"
        class="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors" :class="item.index === editHistoryIndex
          ? 'bg-blue-500 text-white font-medium'
          : 'text-gray-300 hover:bg-gray-700/60'" :title="`跳转到此状态`">
        <span class="flex items-center gap-1.5 min-w-0">
          <span v-if="item.index === editHistoryIndex" class="flex-shrink-0">
            <svg viewBox="0 0 24 24" fill="currentColor" class="w-3 h-3">
              <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
            </svg>
          </span>
          <span class="truncate">{{ item.index === 0 ? '初始状态' : item.tool }}</span>
        </span>
        <span :class="item.index === editHistoryIndex ? 'text-white/80' : 'text-gray-500'">{{ item.count }} 格</span>
      </button>
    </div>
  </div>
</template>
