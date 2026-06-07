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
    function animate() {
      marchingAntsOffset.value = (marchingAntsOffset.value + 0.5) % 20
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
