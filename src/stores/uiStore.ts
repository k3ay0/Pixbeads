import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { GridDownloadOptions } from '@/types'
import type { AppMode } from '@/constants/modeConstants'

export const useUiStore = defineStore('ui', () => {
  // ========== 模式 ==========
  const activeMode = ref<AppMode>('optimize')

  // ========== 画布工作区 ==========
  // none: 尚未导入/新建任何画布；2d: 已有 2D 画布；3d: 已新建 3D 画布
  const workspace = ref<'none' | '2d' | '3d'>('none')

  // ========== 菜单状态 ==========
  const showImportMenu = ref(false)
  const showExportMenu = ref(false)

  // ========== 弹窗状态 ==========
  const showDownloadModal = ref(false)
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
    gridLineColor: '#555555',
    includeStats: true,
    exportPbds: false,
    showWatermark: false,
    watermarkTextEnabled: true,
    watermarkText: 'PIXBEADS',
    watermarkDensity: 10,
    showBackgroundImage: false,
    backgroundImage: null,
    backgroundOpacity: 0.5,
  })

  // ========== Actions ==========

  function switchMode(mode: AppMode) {
    activeMode.value = mode
  }

  function setWorkspace(w: 'none' | '2d' | '3d') {
    workspace.value = w
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
    workspace,
    showImportMenu,
    showExportMenu,
    showDownloadModal,
    showImportDialog,
    showPaletteEditor,
    toastMessage,
    downloadOptions,
    // Actions
    switchMode,
    setWorkspace,
    showToast,
    toggleImportMenu,
    toggleExportMenu,
    closeAllMenus,
    updateDownloadOptions,
  }
})
