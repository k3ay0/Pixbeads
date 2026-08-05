<script setup lang="ts">
import { useVoxelStore, type VoxelTool, type VoxelDirection } from '@/stores/voxelStore'

const store = useVoxelStore()

const modes = [
  { id: 'draw' as const, icon: '✏', label: '绘制', activeClass: 'bg-blue-600 text-white' },
  { id: 'del' as const, icon: '✕', label: '删除', activeClass: 'bg-red-600 text-white' },
  { id: 'recolor' as const, icon: '🎨', label: '改色', activeClass: 'bg-green-600 text-white' },
]

const tools: { id: VoxelTool; icon: string; label: string }[] = [
  { id: 'pen', icon: '✏', label: '画笔' },
  { id: 'line', icon: '╱', label: '直线' },
  { id: 'rect', icon: '▢', label: '矩形' },
  { id: 'frect', icon: '▣', label: '填充矩形' },
  { id: 'circle', icon: '○', label: '圆形' },
  { id: 'fcircle', icon: '●', label: '填充圆' },
  { id: 'ellipse', icon: '⬭', label: '椭圆' },
  { id: 'fellipse', icon: '⬬', label: '填充椭圆' },
  { id: 'fill', icon: '🪣', label: '填充' },
  { id: 'eyedropper', icon: '💉', label: '吸管' },
  { id: 'spray', icon: '🌫', label: '喷雾' },
  { id: 'scatter', icon: '✨', label: '散布' },
  { id: 'noisePen', icon: '〰', label: '噪点' },
]

interface SymmetryItem {
  key: string
  label: string
  get: () => boolean
  set: (v: boolean) => void
  hasCenter: boolean
  centerGet?: () => number
  centerSet?: (v: number) => void
}

const symmetries: SymmetryItem[] = [
  { key: 'mirrorX', label: 'X', get: () => store.mirrorX, set: (v: boolean) => { store.mirrorX = v }, hasCenter: true, centerGet: () => store.mirrorCenterX, centerSet: (v: number) => { store.mirrorCenterX = v } },
  { key: 'mirrorY', label: 'Y', get: () => store.mirrorY, set: (v: boolean) => { store.mirrorY = v }, hasCenter: true, centerGet: () => store.mirrorCenterY, centerSet: (v: number) => { store.mirrorCenterY = v } },
  { key: 'mirrorZ', label: 'Z', get: () => store.mirrorZ, set: (v: boolean) => { store.mirrorZ = v }, hasCenter: true, centerGet: () => store.mirrorCenterZ, centerSet: (v: number) => { store.mirrorCenterZ = v } },
  { key: 'mirrorPoint', label: 'Point', get: () => store.mirrorPoint, set: (v: boolean) => { store.mirrorPoint = v }, hasCenter: false },
]
</script>

<template>
  <div class="flex flex-col h-full overflow-y-auto v-theme-bg2 v-theme-text select-none">
    <!-- Mode Toggle -->
    <div class="p-2" style="border-bottom: 1px solid var(--bd)">
      <div class="flex rounded overflow-hidden" style="border: 1px solid var(--bd)">
        <button v-for="m in modes" :key="m.id" @click="store.editMode = m.id" :title="m.label + ' mode (E)'" :class="[
          'flex-1 py-1.5 text-xs font-bold text-center transition-colors',
          store.editMode === m.id ? m.activeClass : 'v-theme-bg3 v-theme-text3',
        ]">
          {{ m.icon }} {{ m.label }}
        </button>
      </div>
    </div>

    <!-- Tools -->
    <div class="p-2" style="border-bottom: 1px solid var(--bd)">
      <div class="text-[10px] v-theme-text3 uppercase tracking-wider mb-1">工具</div>
      <div class="grid grid-cols-2 gap-0.5">
        <button v-for="tool in tools" :key="tool.id" @click="store.currentTool = tool.id"
          :title="tool.label + (tool.id === 'pen' ? ' (B)' : tool.id === 'line' ? ' (L)' : tool.id === 'rect' ? ' (R)' : tool.id === 'fill' ? ' (G)' : tool.id === 'eyedropper' ? ' (I)' : '')"
          :class="[
            'flex items-center gap-1 px-2 py-1.5 text-xs rounded transition-colors text-left',
            store.currentTool === tool.id
              ? 'bg-blue-600 text-white'
              : 'v-theme-text2',
          ]">
          <span class="w-4 text-center text-sm">{{ tool.icon }}</span>
          <span class="truncate">{{ tool.label }}</span>
        </button>
      </div>
    </div>

    <!-- Brush Size -->
    <div class="p-2" style="border-bottom: 1px solid var(--bd)">
      <div class="flex justify-between text-[10px] v-theme-text3 uppercase tracking-wider mb-1">
        <span>画笔</span>
        <span class="text-blue-400 font-mono">{{ store.brushSize }}</span>
      </div>
      <input type="range" min="1" max="8" :value="store.brushSize"
        @input="store.brushSize = +($event.target as HTMLInputElement).value"
        class="w-full h-1 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-400" 
        style="background: var(--bd)" />
    </div>

    <!-- Snap -->
    <div class="p-2" style="border-bottom: 1px solid var(--bd)">
      <div class="text-[10px] v-theme-text3 uppercase tracking-wider mb-1">吸附</div>
      <select :value="store.snapMode"
        @change="store.snapMode = ($event.target as HTMLSelectElement).value as 'cell' | 'edge'"
        class="w-full v-theme-bg3 rounded text-xs v-theme-text px-2 py-1" style="border: 1px solid var(--bd)">
        <option value="cell">单元格中心</option>
        <option value="edge">边缘</option>
      </select>
    </div>

    <!-- Direction -->
    <div class="p-2" style="border-bottom: 1px solid var(--bd)">
      <div class="text-[10px] v-theme-text3 uppercase tracking-wider mb-1">方向</div>
      <div class="flex rounded overflow-hidden" style="border: 1px solid var(--bd)">
        <button v-for="dir in (['x', 'y', 'z'] as VoxelDirection[])" :key="dir"
          @click="store.currentDirection = dir"
          :class="[
            'flex-1 py-1.5 text-xs font-bold text-center transition-colors',
            store.currentDirection === dir ? 'bg-blue-600 text-white' : 'v-theme-bg3 v-theme-text3',
          ]">
          {{ dir.toUpperCase() }}
        </button>
      </div>
      <div class="text-[9px] v-theme-text3 mt-1">
        体素朝向：{{ store.currentDirection.toUpperCase() }}轴
      </div>
    </div>

    <!-- Symmetry -->
    <div class="p-2">
      <div class="text-[10px] v-theme-text3 uppercase tracking-wider mb-1.5">对称绘制</div>
      <div class="grid grid-cols-2 gap-x-2 gap-y-1">
        <template v-for="s in symmetries" :key="s.key">
          <!-- Toggle row -->
          <label class="flex items-center gap-1.5 text-xs v-theme-text2 cursor-pointer select-none group"
            :class="{ 'opacity-40': !s.get() }">
            <input type="checkbox" :checked="s.get()" @change="s.set(!s.get())" class="sr-only" />
            <span class="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors duration-200"
              :class="s.get() ? 'bg-blue-500' : 'v-theme-bg3'"
              style="border: 1px solid var(--bd)">
              <span class="inline-block h-2.5 w-2.5 rounded-full bg-white shadow-sm transition-transform duration-200"
                :class="s.get() ? 'translate-x-3.5' : 'translate-x-0.5'" />
            </span>
            <span class="font-mono font-semibold">{{ s.label }}</span>
          </label>
          <!-- Center value -->
          <div v-if="s.hasCenter" class="flex items-center justify-end">
            <input type="number" :value="s.centerGet!()"
              @change="s.centerSet!(+($event.target as HTMLInputElement).value)"
              :disabled="!s.get()"
              class="w-9 v-theme-bg3 rounded text-[10px] text-center font-mono v-theme-text disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-blue-500"
              style="border: 1px solid var(--bd)" />
          </div>
          <div v-else />
        </template>
      </div>
    </div>
  </div>
</template>
