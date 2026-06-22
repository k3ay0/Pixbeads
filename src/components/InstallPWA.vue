<template>
  <Teleport to="body">
    <button
      v-if="supportsPWA && !isInstalled"
      class="fixed bottom-6 right-6 bg-gradient-to-r from-purple-500 to-blue-500 text-white px-6 py-3 rounded-full shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2 z-50"
      @click="onClick"
      aria-label="安装应用"
    >
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" :stroke-width="2" d="M12 4v16m0 0l-4-4m4 4l4-4M5 12h14" />
      </svg>
      安装应用
    </button>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const supportsPWA = ref(false)
const promptInstall = ref<BeforeInstallPromptEvent | null>(null)
const isInstalled = ref(false)

let handler: EventListener | null = null

onMounted(() => {
  handler = (e) => {
    const event = e as BeforeInstallPromptEvent
    event.preventDefault()
    console.log('PWA 安装提示已准备')
    supportsPWA.value = true
    promptInstall.value = event
  }

  window.addEventListener('beforeinstallprompt', handler)

  // 检查是否已安装
  if (window.matchMedia('(display-mode: standalone)').matches) {
    isInstalled.value = true
  }
})

onUnmounted(() => {
  if (handler) {
    window.removeEventListener('beforeinstallprompt', handler)
  }
})

const onClick = async (evt: MouseEvent) => {
  evt.preventDefault()
  if (!promptInstall.value) {
    return
  }
  promptInstall.value.prompt()
  const { outcome } = await promptInstall.value.userChoice
  if (outcome === 'accepted') {
    promptInstall.value = null
    supportsPWA.value = false
  }
}
</script>
