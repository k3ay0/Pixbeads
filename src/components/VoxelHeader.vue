<script setup lang="ts">
import { ref } from 'vue'
import * as THREE from 'three'
import { useVoxelStore } from '@/stores/voxelStore'
import { useVoxelHistory } from '@/composables/useVoxelHistory'
import { useVoxelGeometry } from '@/composables/useVoxelGeometry'

const emit = defineEmits<{
  'open-bg': []
  'open-export': []
  'open-dims': []
  'toggle-2d': []
  'open-slice-grid': []
}>()

const store = useVoxelStore()
const { undo, redo } = useVoxelHistory()
const { meshMap } = useVoxelGeometry()

const wireframe = ref(false)
const lang = ref('en')

function toggleWireframe(): void {
  wireframe.value = !wireframe.value
  meshMap.forEach((mesh) => {
    const mat = mesh.material as THREE.MeshStandardMaterial
    mat.wireframe = wireframe.value
  })
}

function toggle2D(): void {
  emit('toggle-2d')
}

function setTheme(e: Event): void {
  const t = (e.target as HTMLSelectElement).value
  const layout = document.querySelector('.voxoB-layout')
  if (layout) {
    if (t === 'dark') {
      layout.removeAttribute('data-theme')
    } else {
      layout.setAttribute('data-theme', t)
    }
  }
  // Also set theme on body for teleported modals
  if (t === 'dark') {
    document.body.removeAttribute('data-theme')
  } else {
    document.body.setAttribute('data-theme', t)
  }
}

function setLang(e: Event): void {
  lang.value = (e.target as HTMLSelectElement).value
}

</script>

<template>
  <header
    class="h-10 v-theme-bg2 flex items-center px-2 gap-1.5 overflow-x-auto text-xs v-theme-text flex-shrink-0 select-none"
    style="border-bottom: 1px solid var(--bd)">
    <button class="px-2 py-1 v-theme-bg3 rounded whitespace-nowrap hover:!border-cyan-400"
      title="Ctrl+Z" @click="undo" style="border: 1px solid var(--bd)">
      ↩ 撤销
    </button>
    <button class="px-2 py-1 v-theme-bg3 rounded whitespace-nowrap hover:!border-cyan-400"
      title="Ctrl+Y" @click="redo" style="border: 1px solid var(--bd)">
      ↪ 重做
    </button>
    <button class="px-2 py-1 v-theme-bg3 rounded whitespace-nowrap hover:!border-cyan-400"
      title="修改画布尺寸" @click="emit('open-dims')" style="border: 1px solid var(--bd)">
      📐 尺寸
    </button>

    <div class="w-px h-4 mx-0.5" style="background: var(--bd)"></div>

    <button
      class="hidden sm:inline-flex px-2 py-1 v-theme-bg3 rounded whitespace-nowrap hover:!border-cyan-400"
      @click="toggle2D" style="border: 1px solid var(--bd)">
      ◧ 2D 面板
    </button>

    <div class="w-px h-4 mx-0.5" style="background: var(--bd)"></div>

    <select class="v-theme-bg3 rounded px-2 py-1 text-xs v-theme-text" style="border: 1px solid var(--bd)" @change="setTheme">
      <option value="light" selected>☀ 亮色</option>
      <option value="grey">⬜ 灰色</option>
      <option value="warm">🔥 暖色</option>
      <option value="sepia">📜 怀旧</option>
      <option value="forest">🌿 森林</option>
      <option value="ocean">🌊 海洋</option>
    </select>

    <div class="flex-1"></div>

    <button class="px-2 py-1 v-theme-bg3 rounded whitespace-nowrap hover:!border-cyan-400"
      @click="emit('open-bg')" style="border: 1px solid var(--bd)">
      🎨 背景
    </button>
    <button
      class="px-2 py-1 v-theme-bg3 rounded whitespace-nowrap hover:!border-pink-400 v-theme-accent2"
      @click="emit('open-export')" style="border: 1px solid var(--bd)">
      ⬇ 导出
    </button>
    <button
      class="px-2 py-1 v-theme-bg3 rounded whitespace-nowrap hover:!border-cyan-400"
      @click="emit('open-slice-grid')" style="border: 1px solid var(--bd)">
      ⊞ 切片
    </button>
  </header>
</template>
