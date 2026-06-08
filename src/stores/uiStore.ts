import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { GridDownloadOptions } from '@/types'
import type { AppMode } from '@/constants/modeConstants'

export const useUiStore = defineStore('ui', () => {
  // ========== 模式 ==========
  const activeMode = ref<AppMode>('optimize')

  // ========== 菜单状态 ==========
  const showImportMenu = ref(false)
  const showExportMenu = ref(false)

  // ========== 弹窗状态 ==========
  const showDownloadModal = ref(false)
  const showDonationModal = ref(false)
  const showImportDialog = ref(false)
  const showPaletteEditor = ref(false)

  // ========== Toast ==========
  const toastMessage = ref<string | null>(null)
  let toastTimeout: ReturnType<typeof setTimeout> | null = null

  // ========== 下载选项 ==========
  const downloadOptions = ref<GridDownloadOptions>({
    showGrid: true,
    gridInterval: 10,
    showCoordinates: true,
    showCellNumbers: true,
    gridLineColor: '#CCCCCC',
    includeStats: true,
    exportPbds: false,
  })

  // ========== Actions ==========

  function switchMode(mode: AppMode) {
    activeMode.value = mode
  }

  function showToast(msg: string, duration: number = 2000) {
    toastMessage.value = msg
    if (toastTimeout) {
      clearTimeout(toastTimeout)
    }
    toastTimeout = setTimeout(() => {
      toastMessage.value = null
    }, duration)
  }

  function toggleImportMenu() {
    showImportMenu.value = !showImportMenu.value
    showExportMenu.value = false
  }

  function toggleExportMenu() {
    showExportMenu.value = !showExportMenu.value
    showImportMenu.value = false
  }

  function closeAllMenus() {
    showImportMenu.value = false
    showExportMenu.value = false
  }

  function updateDownloadOptions(options: Partial<GridDownloadOptions>) {
    downloadOptions.value = { ...downloadOptions.value, ...options }
  }

  return {
    // State
    activeMode,
    showImportMenu,
    showExportMenu,
    showDownloadModal,
    showDonationModal,
    showImportDialog,
    showPaletteEditor,
    toastMessage,
    downloadOptions,
    // Actions
    switchMode,
    showToast,
    toggleImportMenu,
    toggleExportMenu,
    closeAllMenus,
    updateDownloadOptions,
  }
})
