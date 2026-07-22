<script setup lang="ts">
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useBeadStore } from '../stores/beadStore'
import { usePaletteStore } from '../stores/paletteStore'
import { useUiStore } from '../stores/uiStore'
import { MODES } from '../constants/modeConstants'
import type { AppMode } from '../constants/modeConstants'

const emit = defineEmits<{
  (e: 'switch-mode', mode: AppMode): void
  (e: 'trigger-file-input'): void
  (e: 'trigger-pbds-input'): void
  (e: 'open-palette-editor'): void
  (e: 'export-pbds'): void
  (e: 'download-image'): void
  (e: 'download-stats'): void
  (e: 'new-2d-canvas'): void
  (e: 'new-3d-canvas'): void
}>()

const showNewMenu = ref(false)

const beadStore = useBeadStore()
const paletteStore = usePaletteStore()
const uiStore = useUiStore()

const { mappedPixelData } = storeToRefs(beadStore)
const { selectedColorSystem, customPaletteSelections } = storeToRefs(paletteStore)
const { activeMode, showImportMenu, showExportMenu } = storeToRefs(uiStore)

const modes = MODES

function toggleImportMenu() {
  uiStore.closeAllMenus()
  showImportMenu.value = !showImportMenu.value
}

function toggleExportMenu() {
  uiStore.closeAllMenus()
  showExportMenu.value = !showExportMenu.value
}

function handleExportPbds() {
  uiStore.closeAllMenus()
  // 由父组件处理
  emit('switch-mode', activeMode.value) // 触发事件，实际由父组件处理导出
}

function handleDownloadImage() {
  uiStore.closeAllMenus()
  emit('switch-mode', activeMode.value)
}

function handleDownloadStats() {
  uiStore.closeAllMenus()
  emit('switch-mode', activeMode.value)
}

function toggleNewMenu() {
  uiStore.closeAllMenus()
  showNewMenu.value = !showNewMenu.value
}
</script>

<template>
  <header class="h-12 bg-white border-b border-black/10 sticky top-0 z-40">
    <div class="mx-auto w-full h-full px-2 sm:px-4 flex items-center gap-2 sm:gap-3">
      <!-- Logo -->
      <div class="flex items-center gap-2 flex-shrink-0">
        <img src="/logos/favicon.ico" alt="Pixbeads" class="w-7 h-7 rounded-md" />
        <span class="hidden md:inline text-sm font-semibold text-black">PIXBEADS</span>
      </div>

      <!-- Mode tabs -->
      <div class="flex-1 min-w-0 flex justify-center">
        <div class="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-black/[0.04] border border-black/[0.08]">
          <button
            v-for="mode in modes"
            :key="mode.key"
            @click="emit('switch-mode', mode.key)"
            :disabled="mode.key !== 'optimize' && mode.key !== 'voxel' && !mappedPixelData"
            :title="mode.key !== 'optimize' && mode.key !== 'voxel' && !mappedPixelData ? '请先导入文件' : ''"
            :class="[
              'px-2 sm:px-3 h-8 text-[11px] sm:text-xs rounded-md font-medium transition-colors min-w-[44px] flex items-center justify-center',
              activeMode === mode.key ? 'bg-black text-white shadow-sm' : 'text-black/45 hover:text-black',
              mode.key !== 'optimize' && mode.key !== 'voxel' && !mappedPixelData && 'opacity-40 cursor-not-allowed'
            ]"
          >{{ mode.label }}</button>
        </div>
      </div>

      <!-- Right actions -->
      <div class="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
        <!-- Palette info -->
        <div class="hidden md:flex items-center gap-1.5 ml-1">
          <button
            @click="emit('open-palette-editor')"
            class="min-h-[44px] flex flex-col items-start leading-tight px-2 py-1 rounded-lg border border-black/10 bg-white text-black hover:bg-black/[0.04] transition-colors"
            title="色板设置"
          >
            <span class="text-[10px] text-black/45">{{ selectedColorSystem }}</span>
            <span class="text-[11px] font-semibold">{{ Object.keys(customPaletteSelections).filter(k => customPaletteSelections[k]).length }}</span>
          </button>
        </div>

        <!-- Import button -->
        <div class="relative">
          <button
            @click="toggleImportMenu"
            class="min-h-[44px] px-3 text-xs rounded-full border border-black/10 bg-black/[0.04] text-black/60 hover:bg-black/10 transition-colors"
          >导入</button>
          <div
            v-if="showImportMenu"
            class="absolute right-0 mt-1 w-36 bg-white rounded-lg shadow-lg border border-black/10 py-1 z-50"
          >
            <button
              @click="emit('trigger-file-input'); uiStore.closeAllMenus()"
              class="w-full px-3 py-2 text-left text-xs text-black/80 hover:bg-black/[0.04] transition-colors"
            >从图片导入</button>
            <button
              @click="emit('trigger-pbds-input'); uiStore.closeAllMenus()"
              class="w-full px-3 py-2 text-left text-xs text-black/80 hover:bg-black/[0.04] transition-colors"
            >从文件导入</button>
          </div>
        </div>

        <!-- New button -->
        <div class="relative">
          <button
            @click="toggleNewMenu"
            class="min-h-[44px] px-3 text-xs rounded-full border border-black/10 bg-black/[0.04] text-black/60 hover:bg-black/10 transition-colors"
          >新建</button>
          <div
            v-if="showNewMenu"
            class="absolute right-0 mt-1 w-36 bg-white rounded-lg shadow-lg border border-black/10 py-1 z-50"
          >
            <button
              @click="emit('new-2d-canvas'); uiStore.closeAllMenus()"
              class="w-full px-3 py-2 text-left text-xs text-black/80 hover:bg-black/[0.04] transition-colors"
            >新建 2D 画布</button>
            <button
              @click="emit('new-3d-canvas'); uiStore.closeAllMenus()"
              class="w-full px-3 py-2 text-left text-xs text-black/80 hover:bg-black/[0.04] transition-colors"
            >新建 3D 画布</button>
          </div>
        </div>

        <!-- Export dropdown -->
        <div class="relative">
          <button
            v-if="mappedPixelData"
            @click="toggleExportMenu"
            class="min-h-[44px] px-3 text-xs rounded-full border border-black/10 bg-black/[0.04] text-black/60 hover:bg-black/10 transition-colors"
          >导出</button>
          <div
            v-if="showExportMenu"
            class="absolute right-0 mt-1 w-44 bg-white rounded-lg shadow-lg border border-black/10 py-1 z-50"
          >
            <button
              @click="$emit('export-pbds'); uiStore.closeAllMenus()"
              class="w-full px-3 py-2 text-left text-xs text-black/80 hover:bg-black/[0.04] transition-colors"
            >导出图纸文件 (.pbds)</button>
            <button
              @click="$emit('download-image'); uiStore.closeAllMenus()"
              class="w-full px-3 py-2 text-left text-xs text-black/80 hover:bg-black/[0.04] transition-colors"
            >下载图纸图片 (.png)</button>
            <button
              @click="$emit('download-stats'); uiStore.closeAllMenus()"
              class="w-full px-3 py-2 text-left text-xs text-black/80 hover:bg-black/[0.04] transition-colors"
            >下载颜色统计 (.png)</button>
          </div>
        </div>

        <!-- Mobile import -->
        <div class="md:hidden relative">
          <button
            @click="emit('trigger-file-input')"
            class="min-h-[44px] min-w-[44px] flex items-center justify-center text-black/60 rounded-lg hover:bg-black/[0.04] transition-colors"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v12m6-6H6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </header>
</template>
