<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import * as THREE from 'three'

const props = defineProps<{
  isOpen: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'update:background', bg: BackgroundConfig): void
}>()

export interface BackgroundConfig {
  target: '2d' | '3d'
  type: 'solid' | 'gradient' | 'checker'
  color1: string
  color2: string
  imageUrl?: string
  imageTexture?: THREE.Texture | null
}

// 2D / 3D tab
const activeTab = ref<'2d' | '3d'>('3d')

// Separate state for 2D and 3D backgrounds
interface BgState {
  type: 'solid' | 'gradient' | 'checker'
  color1: string
  color2: string
  imageUrl: string | null
  imageTexture: THREE.Texture | null
}

const bg2d = ref<BgState>({ type: 'checker', color1: '#ffffff', color2: '#e0e0e0', imageUrl: null, imageTexture: null })
const bg3d = ref<BgState>({ type: 'solid', color1: '#ffffff', color2: '#16213e', imageUrl: null, imageTexture: null })

// Computed bindings that read/write the active tab's state
const bgType = computed<'solid' | 'gradient' | 'checker'>({
  get: () => activeTab.value === '2d' ? bg2d.value.type : bg3d.value.type,
  set: (v) => { (activeTab.value === '2d' ? bg2d.value : bg3d.value).type = v; emitCurrent() }
})
const color1 = computed<string>({
  get: () => activeTab.value === '2d' ? bg2d.value.color1 : bg3d.value.color1,
  set: (v) => { (activeTab.value === '2d' ? bg2d.value : bg3d.value).color1 = v; emitCurrent() }
})
const color2 = computed<string>({
  get: () => activeTab.value === '2d' ? bg2d.value.color2 : bg3d.value.color2,
  set: (v) => { (activeTab.value === '2d' ? bg2d.value : bg3d.value).color2 = v; emitCurrent() }
})
const bgImageUrl = computed<string | null>({
  get: () => activeTab.value === '2d' ? bg2d.value.imageUrl : bg3d.value.imageUrl,
  set: (v) => { (activeTab.value === '2d' ? bg2d.value : bg3d.value).imageUrl = v }
})
const bgTexture = computed<THREE.Texture | null>({
  get: () => activeTab.value === '2d' ? bg2d.value.imageTexture : bg3d.value.imageTexture,
  set: (v) => { (activeTab.value === '2d' ? bg2d.value : bg3d.value).imageTexture = v }
})

watch(activeTab, () => emitCurrent())

function emitCurrent(): void {
  const config: BackgroundConfig = {
    target: activeTab.value,
    type: bgType.value,
    color1: color1.value,
    color2: color2.value,
    imageUrl: bgImageUrl.value ?? undefined,
    imageTexture: bgTexture.value,
  }
  emit('update:background', config)
}

function handleFileUpload(event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = (e) => {
    const url = e.target?.result as string
    bgImageUrl.value = url
    const loader = new THREE.TextureLoader()
    bgTexture.value = loader.load(url)
    bgType.value = 'solid'
    emitCurrent()
  }
  reader.readAsDataURL(file)
}

function handleClearImage(): void {
  if (bgTexture.value) {
    bgTexture.value.dispose()
  }
  bgTexture.value = null
  bgImageUrl.value = null
  emitCurrent()
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
      <div class="v-theme-bg2 border rounded-xl shadow-2xl w-[380px] max-w-[90vw] p-5 v-theme-text"
        style="border-color: var(--bd)">
        <h2 class="text-lg font-bold mb-4" style="color: var(--tx)">🎨 背景设置</h2>

        <!-- 2D / 3D Tab Switcher -->
        <div class="flex rounded-lg overflow-hidden mb-4" style="border: 1px solid var(--bd)">
          <button
            class="flex-1 py-1.5 text-xs font-medium transition-colors"
            :style="{
              backgroundColor: activeTab === '2d' ? 'var(--ac)' : 'var(--b3)',
              color: activeTab === '2d' ? '#fff' : 'var(--t2)'
            }"
            @click="activeTab = '2d'">
            2D 背景
          </button>
          <button
            class="flex-1 py-1.5 text-xs font-medium transition-colors"
            :style="{
              backgroundColor: activeTab === '3d' ? 'var(--ac)' : 'var(--b3)',
              color: activeTab === '3d' ? '#fff' : 'var(--t2)'
            }"
            @click="activeTab = '3d'">
            3D 背景
          </button>
        </div>

        <!-- Background Type -->
        <div class="mb-4">
          <label class="block text-xs mb-1" style="color: var(--t2)">背景类型</label>
          <select v-model="bgType"
            class="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
            :style="{
              backgroundColor: 'var(--b3)',
              border: '1px solid var(--bd)',
              color: 'var(--tx)'
            }">
            <option value="solid">纯色</option>
            <option value="gradient">渐变</option>
            <option value="checker">棋盘格</option>
          </select>
        </div>

        <!-- Color Inputs -->
        <div class="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs mb-1" style="color: var(--t2)">颜色 1</label>
            <div class="flex items-center gap-2">
              <input v-model="color1" type="color"
                class="w-8 h-8 rounded cursor-pointer"
                :style="{ border: '1px solid var(--bd)', backgroundColor: 'transparent' }" />
              <span class="text-xs font-mono" style="color: var(--t2)">{{ color1 }}</span>
            </div>
          </div>
          <div>
            <label class="block text-xs mb-1" style="color: var(--t2)">颜色 2</label>
            <div class="flex items-center gap-2">
              <input v-model="color2" type="color"
                class="w-8 h-8 rounded cursor-pointer"
                :style="{ border: '1px solid var(--bd)', backgroundColor: 'transparent' }" />
              <span class="text-xs font-mono" style="color: var(--t2)">{{ color2 }}</span>
            </div>
          </div>
        </div>

        <!-- 3D BG Image Upload (only for 3D tab) -->
        <div v-if="activeTab === '3d'" class="mb-4">
          <label class="block text-xs mb-1" style="color: var(--t2)">背景图片</label>
          <div class="flex items-center gap-2">
            <label
              class="flex-1 py-2 px-3 rounded-lg text-xs cursor-pointer transition-colors text-center"
              :style="{
                backgroundColor: 'var(--b3)',
                border: '1px solid var(--bd)',
                color: bgImageUrl ? 'var(--ac)' : 'var(--t2)'
              }">
              <span v-if="!bgImageUrl">选择文件...</span>
              <span v-else>更换图片</span>
              <input type="file" accept="image/*" class="hidden" @change="handleFileUpload" />
            </label>
            <button v-if="bgImageUrl" @click="handleClearImage"
              class="py-2 px-3 rounded-lg text-xs transition-colors"
              :style="{
                backgroundColor: 'rgba(240,48,112,0.15)',
                color: 'var(--a2)'
              }">
              清除
            </button>
          </div>
          <div v-if="bgImageUrl" class="mt-2 text-[10px] truncate" style="color: var(--t3)">
            {{ bgImageUrl.split('/').pop()?.split('?')[0] }}
          </div>
        </div>

        <!-- Close -->
        <button @click="emit('close')"
          class="mt-2 w-full py-2 rounded-lg text-sm transition-colors"
          :style="{
            backgroundColor: 'var(--b3)',
            border: '1px solid var(--bd)',
            color: 'var(--t2)'
          }"
          @mouseenter="($event.target as HTMLElement).style.color = 'var(--tx)'"
          @mouseleave="($event.target as HTMLElement).style.color = 'var(--t2)'">
          关闭
        </button>
      </div>
    </div>
  </Teleport>
</template>
