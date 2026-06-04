<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'

const props = defineProps({
  isVisible: { type: Boolean, default: false },
})

const emit = defineEmits(['complete'])

const particles = ref([])
const confetti = ref([])

let animationId = null
let timer = null

function startAnimation() {
  const celebrationEmojis = ['🎉', '🎊', '✨', '🌟', '💫', '🎈', '🎁', '🏆']
  const confettiColors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57', '#ff9ff3', '#54a0ff']

  // 创建emoji粒子
  const newParticles = []
  for (let i = 0; i < 20; i++) {
    const isFromLeft = Math.random() < 0.5
    newParticles.push({
      id: Date.now() + i,
      emoji: celebrationEmojis[Math.floor(Math.random() * celebrationEmojis.length)],
      x: isFromLeft ? -50 : window.innerWidth + 50,
      y: Math.random() * window.innerHeight * 0.6 + window.innerHeight * 0.2,
      vx: (isFromLeft ? 1 : -1) * (Math.random() * 3 + 2),
      vy: (Math.random() - 0.5) * 4,
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 10,
      scale: Math.random() * 0.5 + 0.8,
      opacity: 1,
    })
  }

  // 创建彩带粒子
  const newConfetti = []
  for (let i = 0; i < 40; i++) {
    const isFromLeft = Math.random() < 0.5
    newConfetti.push({
      id: Date.now() + i + 1000,
      x: isFromLeft ? -20 : window.innerWidth + 20,
      y: Math.random() * window.innerHeight * 0.4 + window.innerHeight * 0.1,
      vx: (isFromLeft ? 1 : -1) * (Math.random() * 4 + 3),
      vy: Math.random() * 2 - 1,
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 15,
      scale: Math.random() * 0.3 + 0.2,
      opacity: 1,
      color: confettiColors[Math.floor(Math.random() * confettiColors.length)],
    })
  }

  particles.value = newParticles
  confetti.value = newConfetti

  // 动画循环
  const animate = () => {
    particles.value = particles.value
      .map(p => ({
        ...p,
        x: p.x + p.vx,
        y: p.y + p.vy,
        rotation: p.rotation + p.rotationSpeed,
        opacity: Math.max(0, p.opacity - 0.02),
        vy: p.vy + 0.1,
      }))
      .filter(p => p.x > -100 && p.x < window.innerWidth + 100 && p.y < window.innerHeight + 100 && p.opacity > 0)

    confetti.value = confetti.value
      .map(p => ({
        ...p,
        x: p.x + p.vx,
        y: p.y + p.vy,
        rotation: p.rotation + p.rotationSpeed,
        opacity: Math.max(0, p.opacity - 0.015),
        vy: p.vy + 0.08,
      }))
      .filter(p => p.x > -50 && p.x < window.innerWidth + 50 && p.y < window.innerHeight + 50 && p.opacity > 0)

    animationId = requestAnimationFrame(animate)
  }

  animate()

  // 1.5秒后清理动画
  timer = setTimeout(() => {
    particles.value = []
    confetti.value = []
    emit('complete')
  }, 1500)
}

function stopAnimation() {
  if (animationId) {
    cancelAnimationFrame(animationId)
    animationId = null
  }
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  particles.value = []
  confetti.value = []
}

watch(() => props.isVisible, (val) => {
  if (val) {
    startAnimation()
  } else {
    stopAnimation()
  }
})

onUnmounted(() => {
  stopAnimation()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="isVisible" class="fixed inset-0 pointer-events-none z-50">
      <!-- Emoji 粒子 -->
      <div
        v-for="particle in particles"
        :key="particle.id"
        class="absolute text-2xl select-none"
        :style="{
          left: particle.x + 'px',
          top: particle.y + 'px',
          transform: `rotate(${particle.rotation}deg) scale(${particle.scale})`,
          opacity: particle.opacity,
          fontSize: '24px',
        }"
      >
        {{ particle.emoji }}
      </div>

      <!-- 彩带粒子 -->
      <div
        v-for="particle in confetti"
        :key="particle.id"
        class="absolute"
        :style="{
          left: particle.x + 'px',
          top: particle.y + 'px',
          width: '6px',
          height: '12px',
          backgroundColor: particle.color,
          transform: `rotate(${particle.rotation}deg) scale(${particle.scale})`,
          opacity: particle.opacity,
          borderRadius: '1px',
        }"
      />

      <!-- 中央庆祝文字 -->
      <div
        class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center animate-bounce"
        style="animation-duration: 0.6s; animation-timing-function: ease-out; animation-fill-mode: both"
      >
        <div class="text-4xl font-bold text-yellow-400 drop-shadow-lg animate-pulse">
          🎉完成🎉
        </div>
        <div class="text-lg text-white drop-shadow-md mt-2">
          这个颜色拼完了！
        </div>
      </div>
    </div>
  </Teleport>
</template>
