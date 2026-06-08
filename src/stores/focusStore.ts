import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { MappedPixel, ColorCounts } from '@/types'
import {
  getConnectedRegion,
  getAllConnectedRegions,
  isRegionCompleted,
  getRegionCenter,
  sortRegionsByDistance,
  sortRegionsBySize,
} from '@/utils/floodFillUtils'
import { getColorKeyByHex } from '@/utils/colorSystemUtils'
import type { ColorSystem } from '@/types'
import { useBeadStore } from './beadStore'

export const useFocusStore = defineStore('focus', () => {
  // ========== 状态 ==========
  const currentColor = ref('')
  const selectedCell = ref<{ row: number; col: number } | null>(null)
  const canvasScale = ref(1)
  const canvasOffset = ref({ x: 0, y: 0 })
  const completedCells = ref<Set<string>>(new Set())
  const colorProgress = ref<Record<string, { completed: number; total: number }>>({})
  const recommendedRegion = ref<Array<{ row: number; col: number }> | null>(null)
  const recommendedCell = ref<{ row: number; col: number } | null>(null)
  const guidanceMode = ref<'nearest' | 'largest' | 'edge-first'>('nearest')
  const showColorPanel = ref(false)
  const isPaused = ref(true)
  const totalElapsedTime = ref(0)
  const lastResumeTime = ref(Date.now())
  const gridSectionInterval = ref(10)
  const showSectionLines = ref(true)
  const sectionLineColor = ref('#007acc')
  const availableColors = ref<Array<{ color: string; name: string; total: number; completed: number }>>([])
  const showSettings = ref(false)
  const showConfetti = ref(true)
  const showCelebration = ref(false)
  const celebrationData = ref<{ colorName: string; colorHex: string; completed: number; total: number } | null>(null)

  // ========== Stores ==========
  const beadStore = useBeadStore()

  // ========== 计时器 ==========
  let timerInterval: ReturnType<typeof setInterval> | null = null

  // ========== Getters ==========

  const currentColorInfo = computed(() => {
    return availableColors.value.find(c => c.color === currentColor.value)
  })

  const progressPercentage = computed(() => {
    return currentColorInfo.value
      ? Math.round((currentColorInfo.value.completed / currentColorInfo.value.total) * 100)
      : 0
  })

  const elapsedTime = computed(() => formatTime(totalElapsedTime.value))

  const guidanceModeLabel = computed(() => {
    const labels: Record<string, string> = {
      nearest: '最近优先',
      largest: '最大优先',
      'edge-first': '边缘优先'
    }
    return labels[guidanceMode.value] || guidanceMode.value
  })

  // ========== Actions ==========

  function initFocusMode(mappedPixelData: MappedPixel[][] | null, colorCounts: ColorCounts | null, selectedColorSystem: ColorSystem) {
    if (!mappedPixelData || !colorCounts) return

    const colors = Object.entries(colorCounts).map(([, data]) => ({
      color: data.color,
      name: getColorKeyByHex(data.color, selectedColorSystem),
      total: data.count,
      completed: 0,
    }))

    availableColors.value = colors
    if (colors.length > 0) {
      currentColor.value = colors[0].color
      const progress: Record<string, { completed: number; total: number }> = {}
      colors.forEach(c => { progress[c.color] = { completed: 0, total: c.total } })
      colorProgress.value = progress
    }

    completedCells.value = new Set()
    selectedCell.value = null
    canvasScale.value = 1
    canvasOffset.value = { x: 0, y: 0 }
    startTimer()
    
    // 计算初始引导区域
    calculateRecommendedRegion(mappedPixelData)
  }

  function startTimer() {
    stopTimer()
    isPaused.value = false
    lastResumeTime.value = Date.now()
    totalElapsedTime.value = 0
    timerInterval = setInterval(() => {
      if (!isPaused.value) {
        const now = Date.now()
        const elapsed = Math.floor((now - lastResumeTime.value) / 1000)
        if (elapsed > 0) {
          totalElapsedTime.value += elapsed
          lastResumeTime.value = now
        }
      }
    }, 1000)
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval)
      timerInterval = null
    }
  }

  function handlePauseToggle() {
    if (isPaused.value) {
      isPaused.value = false
      lastResumeTime.value = Date.now()
    } else {
      const now = Date.now()
      totalElapsedTime.value += Math.floor((now - lastResumeTime.value) / 1000)
      isPaused.value = true
    }
  }

  function formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60
    if (hours > 0) return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    return `${minutes}:${secs.toString().padStart(2, '0')}`
  }

  function cycleGuidanceMode() {
    const modes = ['nearest', 'largest', 'edge-first'] as const
    guidanceMode.value = modes[(modes.indexOf(guidanceMode.value) + 1) % modes.length]
  }

  function calculateRecommendedRegion(mappedPixelData: MappedPixel[][] | null) {
    if (!mappedPixelData || !currentColor.value) {
      recommendedRegion.value = null
      recommendedCell.value = null
      return
    }

    const allRegions = getAllConnectedRegions(mappedPixelData, currentColor.value)
    const incomplete = allRegions.filter(r => !isRegionCompleted(r, completedCells.value))

    if (incomplete.length === 0) {
      recommendedRegion.value = null
      recommendedCell.value = null
      return
    }

    let selected: Array<{ row: number; col: number }>
    switch (guidanceMode.value) {
      case 'nearest': {
        const ref = selectedCell.value ?? {
          row: Math.floor(mappedPixelData.length / 2),
          col: Math.floor(mappedPixelData[0].length / 2)
        }
        selected = sortRegionsByDistance(incomplete, ref)[0]
        break
      }
      case 'largest':
        selected = sortRegionsBySize(incomplete)[0]
        break
      case 'edge-first': {
        const M = mappedPixelData.length
        const N = mappedPixelData[0].length
        const edge = incomplete.filter(r =>
          r.some(c => c.row === 0 || c.row === M - 1 || c.col === 0 || c.col === N - 1)
        )
        selected = edge.length > 0 ? edge[0] : incomplete[0]
        break
      }
      default:
        selected = incomplete[0]
    }

    recommendedRegion.value = selected
    recommendedCell.value = getRegionCenter(selected)
  }

  function handleCellClick(row: number, col: number, mappedPixelData: MappedPixel[][] | null) {
    if (!mappedPixelData) return
    const cellColor = mappedPixelData[row][col].color
    if (cellColor !== currentColor.value) return

    const region = getConnectedRegion(mappedPixelData, row, col, currentColor.value)
    if (region.length === 0) return

    const newSet = new Set(completedCells.value)
    const done = isRegionCompleted(region, completedCells.value)
    region.forEach(({ row: r, col: c }) => {
      const key = `${r},${c}`
      done ? newSet.delete(key) : newSet.add(key)
    })

    const newProgress = { ...colorProgress.value }
    if (newProgress[currentColor.value]) {
      newProgress[currentColor.value] = {
        ...newProgress[currentColor.value],
        completed: Array.from(newSet).filter(k => {
          const [r, c] = k.split(',').map(Number)
          return mappedPixelData[r]?.[c]?.color === currentColor.value
        }).length,
      }
    }

    completedCells.value = newSet
    selectedCell.value = { row, col }
    colorProgress.value = newProgress
    availableColors.value = availableColors.value.map(c =>
      c.color === currentColor.value
        ? { ...c, completed: newProgress[currentColor.value]?.completed || 0 }
        : c
    )

    if (newProgress[currentColor.value]?.completed >= newProgress[currentColor.value]?.total) {
      // 触发庆祝动画
      if (showConfetti.value) {
        const colorInfo = availableColors.value.find(c => c.color === currentColor.value)
        if (colorInfo) {
          celebrationData.value = {
            colorName: colorInfo.name,
            colorHex: colorInfo.color,
            completed: colorInfo.completed,
            total: colorInfo.total,
          }
          showCelebration.value = true
        }
      }
      switchToNextIncompleteColor()
    }
  }

  function switchToNextIncompleteColor() {
    const idx = availableColors.value.findIndex(c => c.color === currentColor.value)
    if (idx === -1) return
    for (let i = 1; i <= availableColors.value.length; i++) {
      const next = availableColors.value[(idx + i) % availableColors.value.length]
      if (next.completed < next.total) {
        currentColor.value = next.color
        // 重新计算推荐区域
        calculateRecommendedRegion(beadStore.mappedPixelData)
        return
      }
    }
  }

  function handleFocusColorChange(color: string) {
    currentColor.value = color
    showColorPanel.value = false
  }

  function handleLocateRecommended(gridDimensions: { N: number; M: number } | null) {
    if (!recommendedCell.value || !gridDimensions) return
    const { row, col } = recommendedCell.value
    const cellSize = Math.max(15, Math.min(40, 300 / Math.max(gridDimensions.N, gridDimensions.M)))
    const cx = (col + 0.5) * cellSize
    const cy = (row + 0.5) * cellSize
    canvasOffset.value = {
      x: gridDimensions.N * cellSize / 2 - cx,
      y: gridDimensions.M * cellSize / 2 - cy
    }
  }

  function markCurrentColorComplete(mappedPixelData: MappedPixel[][] | null) {
    if (!mappedPixelData || !currentColor.value || !recommendedRegion.value) return
    
    const newSet = new Set(completedCells.value)
    const newProgress = { ...colorProgress.value }
    
    // 只标记当前推荐区域为完成
    recommendedRegion.value.forEach(({ row, col }) => {
      newSet.add(`${row},${col}`)
    })
    
    // 更新当前颜色的进度
    if (newProgress[currentColor.value]) {
      const completedCount = Array.from(newSet).filter(k => {
        const [r, c] = k.split(',').map(Number)
        return mappedPixelData[r]?.[c]?.color === currentColor.value
      }).length
      
      newProgress[currentColor.value] = {
        ...newProgress[currentColor.value],
        completed: completedCount,
      }
    }
    
    completedCells.value = newSet
    colorProgress.value = newProgress
    
    // 更新 availableColors
    availableColors.value = availableColors.value.map(c =>
      c.color === currentColor.value
        ? { ...c, completed: newProgress[currentColor.value]?.completed || 0 }
        : c
    )
    
    // 检查是否完成该颜色
    if (newProgress[currentColor.value]?.completed >= newProgress[currentColor.value]?.total) {
      // 触发庆祝动画
      if (showConfetti.value) {
        const colorInfo = availableColors.value.find(c => c.color === currentColor.value)
        if (colorInfo) {
          celebrationData.value = {
            colorName: colorInfo.name,
            colorHex: colorInfo.color,
            completed: colorInfo.completed,
            total: colorInfo.total,
          }
          showCelebration.value = true
        }
      }
    }
    
    // 重新计算推荐区域
    calculateRecommendedRegion(mappedPixelData)
    
    // 如果当前颜色已完成，切换到下一个
    if (newProgress[currentColor.value]?.completed >= newProgress[currentColor.value]?.total) {
      switchToNextIncompleteColor()
    }
  }

  function closeCelebration() {
    showCelebration.value = false
    celebrationData.value = null
  }

  return {
    // State
    currentColor,
    selectedCell,
    canvasScale,
    canvasOffset,
    completedCells,
    colorProgress,
    recommendedRegion,
    recommendedCell,
    guidanceMode,
    showColorPanel,
    isPaused,
    totalElapsedTime,
    lastResumeTime,
    gridSectionInterval,
    showSectionLines,
    sectionLineColor,
    availableColors,
    showSettings,
    showConfetti,
    showCelebration,
    celebrationData,
    // Getters
    currentColorInfo,
    progressPercentage,
    elapsedTime,
    guidanceModeLabel,
    // Actions
    initFocusMode,
    startTimer,
    stopTimer,
    handlePauseToggle,
    formatTime,
    cycleGuidanceMode,
    calculateRecommendedRegion,
    handleCellClick,
    switchToNextIncompleteColor,
    handleFocusColorChange,
    handleLocateRecommended,
    markCurrentColorComplete,
    closeCelebration,
  }
})
