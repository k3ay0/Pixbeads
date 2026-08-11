<script setup lang="ts">
import { ref } from 'vue'
import * as THREE from 'three'
import { useVoxelExport } from '@/composables/useVoxelExport'
import { useVoxelStore } from '@/stores/voxelStore'

const props = defineProps<{
  isOpen: boolean
  voxelGroup: THREE.Group | null
  rendererDomElement?: HTMLCanvasElement | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const filename = ref('voxelart')
const { exportOBJ, exportSTL, exportGLB } = useVoxelExport()
const voxelStore = useVoxelStore()

function handleExportOBJ(): void {
  if (!props.voxelGroup) return
  exportOBJ(props.voxelGroup, filename.value || 'voxelart')
}

function handleExportSTL(): void {
  if (!props.voxelGroup) return
  exportSTL(props.voxelGroup, filename.value || 'voxelart')
}

function handleExportGLB(): void {
  if (!props.voxelGroup) return
  exportGLB(props.voxelGroup, filename.value || 'voxelart')
}

function handleExportJSON(): void {
  // Serialize voxel store state
  const voxels: Record<string, { color: string; alpha?: number }> = {}
  voxelStore.voxels.forEach((data, key) => {
    voxels[key] = { color: data.color }
    if ((data.alpha ?? 255) < 255) voxels[key].alpha = data.alpha
  })

  const state = {
    version: 1,
    dimW: voxelStore.dimW,
    dimH: voxelStore.dimH,
    dimD: voxelStore.dimD,
    mirrorX: voxelStore.mirrorX,
    mirrorY: voxelStore.mirrorY,
    mirrorZ: voxelStore.mirrorZ,
    mirrorPoint: voxelStore.mirrorPoint,
    mirrorCenterX: voxelStore.mirrorCenterX,
    mirrorCenterY: voxelStore.mirrorCenterY,
    mirrorCenterZ: voxelStore.mirrorCenterZ,
    voxels,
  }

  const json = JSON.stringify(state, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename.value || 'voxelart'}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function handleExportPNG(): void {
  if (!props.rendererDomElement) {
    console.warn('[VoxelExportModal] No renderer DOM element available for screenshot')
    return
  }
  const canvas = props.rendererDomElement
  const dataUrl = canvas.toDataURL('image/png')
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = `${filename.value || 'voxelart'}.png`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

function handleOverlayClick(e: MouseEvent): void {
  if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
    emit('close')
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="isOpen" class="modal-overlay fixed inset-0 bg-black/60 z-[80] flex items-center justify-center"
      @click="handleOverlayClick">
      <div class="bg-gray-800 border border-gray-600 rounded-xl shadow-2xl w-[400px] max-w-[90vw] p-5">
        <h2 class="text-lg font-bold text-white mb-4">导出体素模型</h2>

        <!-- Filename -->
        <div class="mb-4">
          <label class="block text-xs text-gray-400 mb-1">文件名</label>
          <input v-model="filename" type="text"
            class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            placeholder="voxelart" />
        </div>

        <!-- Export buttons -->
        <div class="space-y-2">
          <button @click="handleExportOBJ"
            class="w-full py-2.5 rounded-lg text-sm font-medium transition-colors bg-blue-600 hover:bg-blue-700 text-white">
            导出为 OBJ + MTL
          </button>
          <button @click="handleExportSTL"
            class="w-full py-2.5 rounded-lg text-sm font-medium transition-colors bg-green-600 hover:bg-green-700 text-white">
            导出为 STL
          </button>
          <button @click="handleExportGLB"
            class="w-full py-2.5 rounded-lg text-sm font-medium transition-colors bg-purple-600 hover:bg-purple-700 text-white">
            导出为 GLB
          </button>
          <button @click="handleExportJSON"
            class="w-full py-2.5 rounded-lg text-sm font-medium transition-colors bg-yellow-600 hover:bg-yellow-700 text-white">
            保存为 JSON
          </button>
          <button @click="handleExportPNG"
            class="w-full py-2.5 rounded-lg text-sm font-medium transition-colors bg-pink-600 hover:bg-pink-700 text-white">
            截图为 PNG
          </button>
        </div>

        <!-- Close -->
        <button @click="emit('close')"
          class="mt-4 w-full py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-700 transition-colors">
          取消
        </button>
      </div>
    </div>
  </Teleport>
</template>
