/**
 * Marching ants 动画 composable
 * 提供选区边框的流动虚线动画效果
 */

import { ref, onUnmounted } from 'vue'

export function useMarchingAnts() {
  const marchingAntsOffset = ref(0)
  let marchingAntsAnimId: number | null = null

  function startMarchingAnts(onFrame?: () => void) {
    if (marchingAntsAnimId) return
    // 参考专心模式：基于时间增量驱动，速度恒定不随帧率漂移，且不取模避免跳变
    let lastTime = performance.now()
    const speed = 10
    function animate(now: number) {
      const delta = (now - lastTime) / 1000
      lastTime = now
      marchingAntsOffset.value += speed * delta
      onFrame?.()
      marchingAntsAnimId = requestAnimationFrame(animate)
    }
    marchingAntsAnimId = requestAnimationFrame(animate)
  }

  function stopMarchingAnts() {
    if (marchingAntsAnimId) {
      cancelAnimationFrame(marchingAntsAnimId)
      marchingAntsAnimId = null
    }
    marchingAntsOffset.value = 0
  }

  // 自动清理
  onUnmounted(() => {
    stopMarchingAnts()
  })

  return {
    marchingAntsOffset,
    startMarchingAnts,
    stopMarchingAnts,
  }
}
