<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps<{
  colorName: string
  colorHex: string
  completed: number
  total: number
  totalCompleted: number
  totalAll: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

// 粒子颜色（使用当前颜色和一些配色）
const particleColors = computed(() => [
  props.colorHex,
  adjustColor(props.colorHex, 30),
  adjustColor(props.colorHex, -30),
  '#fbbd23', // 金色
  '#fcd573', // 浅金色
  '#dce8d6', // 浅绿色
  '#d0d8d4', // 灰绿色
  '#c7d1cf', // 灰色
])

// 调整颜色亮度
function adjustColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16)
  const r = Math.min(255, Math.max(0, (num >> 16) + amount))
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amount))
  const b = Math.min(255, Math.max(0, (num & 0x0000FF) + amount))
  return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`
}

// 生成粒子
interface Particle {
  id: number
  left: number
  width: number
  height: number
  color: string
  borderRadius: string
  animationDuration: number
  animationDelay: number
  drift: number
  rotateEnd: number
}

const particles = ref<Particle[]>([])
const showCard = ref(false)
let autoCloseTimer: ReturnType<typeof setTimeout> | null = null

onMounted(() => {
  // 生成 50 个随机粒子
  const count = 50
  const newParticles: Particle[] = []
  
  for (let i = 0; i < count; i++) {
    const isCircle = Math.random() > 0.6
    const size = 4 + Math.random() * 8
    
    newParticles.push({
      id: i,
      left: Math.random() * 100,
      width: size,
      height: isCircle ? size : size * (1 + Math.random() * 0.8),
      color: particleColors.value[Math.floor(Math.random() * particleColors.value.length)],
      borderRadius: isCircle ? '50%' : '1.5px',
      animationDuration: 1.5 + Math.random() * 1.5,
      animationDelay: Math.random() * 0.5,
      drift: (Math.random() - 0.5) * 60,
      rotateEnd: 360 + Math.random() * 720,
    })
  }
  
  particles.value = newParticles
  
  // 延迟显示卡片
  setTimeout(() => {
    showCard.value = true
  }, 100)
  
  // 自动关闭
  autoCloseTimer = setTimeout(() => {
    emit('close')
  }, 4000)
})

onUnmounted(() => {
  if (autoCloseTimer) {
    clearTimeout(autoCloseTimer)
  }
})

function handleClose() {
  emit('close')
}

// 计算总体进度百分比
const totalProgressPercent = computed(() => 
  props.totalAll > 0 ? Math.round((props.totalCompleted / props.totalAll) * 100) : 0
)
</script>

<template>
  <div class="fixed inset-0 z-50 pointer-events-none overflow-hidden" @click="handleClose">
    <!-- 粒子 -->
    <div
      v-for="particle in particles"
      :key="particle.id"
      class="absolute -top-3"
      :style="{
        left: `${particle.left}%`,
        width: `${particle.width}px`,
        height: `${particle.height}px`,
        backgroundColor: particle.color,
        borderRadius: particle.borderRadius,
        animation: `${particle.animationDuration}s cubic-bezier(0.25, 0.46, 0.45, 0.94) ${particle.animationDelay}s 1 normal forwards running celebration-fall`,
        '--drift': `${particle.drift}px`,
        '--rotate-end': `${particle.rotateEnd}deg`,
      }"
    />

    <!-- 完成卡片 -->
    <Transition name="celebration-card">
      <div
        v-if="showCard"
        class="absolute top-1/2 left-1/2 flex flex-col items-center pointer-events-auto"
        style="transform: translate(-50%, -50%);"
        @click.stop
      >
        <!-- 完成图标 -->
        <div
          class="relative w-20 h-20 rounded-full flex items-center justify-center shadow-lg"
          :style="{
            backgroundColor: colorHex,
            boxShadow: `0 8px 32px ${colorHex}66, 0 0 0 4px rgba(255,255,255,0.3)`,
          }"
        >
          <svg class="w-10 h-10 text-white drop-shadow-md" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M5 13l4 4L19 7"
              class="celebration-check-path"
            />
          </svg>
        </div>

        <!-- 文字 -->
        <div class="mt-4 text-2xl font-bold text-white drop-shadow-lg" style="text-shadow: 0 2px 12px rgba(0,0,0,0.4);">
          太棒了！
        </div>

        <!-- 颜色信息 -->
        <div class="mt-1.5 px-3 py-1 rounded-full bg-black/30 backdrop-blur-sm">
          <span class="text-sm text-white/90 font-medium">{{ colorName }} 已完成</span>
        </div>

        <!-- 总体进度 -->
        <div class="mt-3 flex flex-col items-center gap-1.5">
          <div class="w-32 h-1.5 rounded-full bg-white/20 overflow-hidden">
            <div
              class="h-full rounded-full bg-white/80 celebration-progress-bar"
              :style="{ width: `${totalProgressPercent}%` }"
            />
          </div>
          <span class="text-xs text-white/70 font-medium tabular-nums">
            {{ totalCompleted }} / {{ totalAll }}
          </span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
@keyframes celebration-fall {
  0% {
    transform: translateY(0) translateX(0) rotate(0deg);
    opacity: 1;
  }
  75% {
    opacity: 0.8;
  }
  100% {
    transform: translateY(100vh) translateX(var(--drift)) rotate(var(--rotate-end));
    opacity: 0;
  }
}

.celebration-check-path {
  stroke-dasharray: 24;
  stroke-dashoffset: 24;
  animation: celebration-check 0.4s ease-out 0.3s 1 normal forwards;
}

@keyframes celebration-check {
  to {
    stroke-dashoffset: 0;
  }
}

.celebration-progress-bar {
  transform-origin: left center;
  animation: celebration-progress 0.8s ease-out 0.4s 1 normal forwards;
  transform: scaleX(0);
}

@keyframes celebration-progress {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}

.celebration-card-enter-active {
  animation: celebration-card-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

.celebration-card-leave-active {
  animation: celebration-card-out 0.3s ease-in forwards;
}

@keyframes celebration-card-in {
  0% {
    transform: translate(-50%, -50%) scale(0.3);
    opacity: 0;
  }
  100% {
    transform: translate(-50%, -50%) scale(1);
    opacity: 1;
  }
}

@keyframes celebration-card-out {
  0% {
    transform: translate(-50%, -50%) scale(1);
    opacity: 1;
  }
  100% {
    transform: translate(-50%, -50%) scale(0.8);
    opacity: 0;
  }
}
</style>
