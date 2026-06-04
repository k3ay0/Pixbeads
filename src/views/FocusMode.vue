<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import {
  getConnectedRegion,
  getAllConnectedRegions,
  isRegionCompleted,
  getRegionCenter,
  sortRegionsByDistance,
  sortRegionsBySize,
} from '../utils/floodFillUtils'
import { getColorKeyByHex } from '../utils/colorSystemUtils'
import FocusCanvas from '../components/FocusCanvas.vue'
import ColorStatusBar from '../components/ColorStatusBar.vue'
import ProgressBar from '../components/ProgressBar.vue'
import FocusToolBar from '../components/FocusToolBar.vue'
import FocusColorPanel from '../components/FocusColorPanel.vue'

// ========== 数据加载 ==========
const mappedPixelData = ref(null)
const gridDimensions = ref(null)
const isLoading = ref(true)
const hasError = ref(false)

// ========== 专心模式状态 ==========
const currentColor = ref('')
const selectedCell = ref(null)
const canvasScale = ref(1)
const canvasOffset = ref({ x: 0, y: 0 })
const completedCells = ref(new Set())
const colorProgress = ref({})
const recommendedRegion = ref(null)
const recommendedCell = ref(null)
const guidanceMode = ref('nearest')
const showColorPanel = ref(false)
const isPaused = ref(true)

// 计时器状态
const totalElapsedTime = ref(0)
const lastResumeTime = ref(Date.now())
let timerInterval = null

// 分区设置
const gridSectionInterval = ref(10)
const showSectionLines = ref(true)
const sectionLineColor = ref('#007acc')

// 可用颜色列表
const availableColors = ref([])

// ========== 从 localStorage 加载数据 ==========
onMounted(() => {
  const savedPixelData = localStorage.getItem('focusMode_pixelData')
  const savedGridDimensions = localStorage.getItem('focusMode_gridDimensions')
  const savedColorCounts = localStorage.getItem('focusMode_colorCounts')
  const savedColorSystem = localStorage.getItem('focusMode_selectedColorSystem')

  if (savedPixelData && savedGridDimensions && savedColorCounts) {
    try {
      mappedPixelData.value = JSON.parse(savedPixelData)
      gridDimensions.value = JSON.parse(savedGridDimensions)

      const parsedColorCounts = JSON.parse(savedColorCounts)
      const colorSystem = savedColorSystem || 'MARD'

      // 计算颜色进度
      const colors = Object.entries(parsedColorCounts).map(([, colorData]) => {
        const data = colorData
        const displayKey = getColorKeyByHex(data.color, colorSystem)
        return {
          color: data.color,
          name: displayKey,
          total: data.count,
          completed: 0,
        }
      })

      availableColors.value = colors

      if (colors.length > 0) {
        currentColor.value = colors[0].color
        const progress = {}
        colors.forEach((c) => {
          progress[c.color] = { completed: 0, total: c.total }
        })
        colorProgress.value = progress
      }

      isLoading.value = false
      // 开始计时
      startTimer()
    } catch (error) {
      console.error('Failed to load focus mode data:', error)
      hasError.value = true
      isLoading.value = false
    }
  } else {
    hasError.value = true
    isLoading.value = false
  }
})

onUnmounted(() => {
  stopTimer()
})

// ========== 计时器管理 ==========
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
    // 从暂停恢复
    isPaused.value = false
    lastResumeTime.value = Date.now()
  } else {
    // 暂停
    const now = Date.now()
    const elapsed = Math.floor((now - lastResumeTime.value) / 1000)
    totalElapsedTime.value += elapsed
    isPaused.value = true
  }
}

function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

// ========== 推荐区域计算 ==========
const calculateRecommendedRegion = computed(() => {
  if (!mappedPixelData.value || !currentColor.value) {
    return { region: null, cell: null }
  }

  const allRegions = getAllConnectedRegions(mappedPixelData.value, currentColor.value)
  const incompleteRegions = allRegions.filter(
    (region) => !isRegionCompleted(region, completedCells.value)
  )

  if (incompleteRegions.length === 0) {
    return { region: null, cell: null }
  }

  let selectedRegion
  switch (guidanceMode.value) {
    case 'nearest': {
      const referencePoint = selectedCell.value ?? {
        row: Math.floor(mappedPixelData.value.length / 2),
        col: Math.floor(mappedPixelData.value[0].length / 2),
      }
      const sortedByDistance = sortRegionsByDistance(incompleteRegions, referencePoint)
      selectedRegion = sortedByDistance[0]
      break
    }
    case 'largest': {
      const sortedBySize = sortRegionsBySize(incompleteRegions)
      selectedRegion = sortedBySize[0]
      break
    }
    case 'edge-first': {
      const M = mappedPixelData.value.length
      const N = mappedPixelData.value[0].length
      const edgeRegions = incompleteRegions.filter((region) =>
        region.some(
          (cell) =>
            cell.row === 0 || cell.row === M - 1 || cell.col === 0 || cell.col === N - 1
        )
      )
      selectedRegion = edgeRegions.length > 0 ? edgeRegions[0] : incompleteRegions[0]
      break
    }
    default:
      selectedRegion = incompleteRegions[0]
  }

  const centerCell = getRegionCenter(selectedRegion)
  return { region: selectedRegion, cell: centerCell }
})

// 更新推荐区域
watch(calculateRecommendedRegion, (val) => {
  recommendedRegion.value = val.region
  recommendedCell.value = val.cell
})

// ========== 处理格子点击 ==========
function handleCellClick(row, col) {
  if (!mappedPixelData.value) return

  const cellColor = mappedPixelData.value[row][col].color

  if (cellColor === currentColor.value) {
    const region = getConnectedRegion(mappedPixelData.value, row, col, currentColor.value)
    if (region.length === 0) return

    const newCompletedCells = new Set(completedCells.value)
    const isCurrentlyCompleted = isRegionCompleted(region, completedCells.value)

    if (isCurrentlyCompleted) {
      region.forEach(({ row: r, col: c }) => {
        newCompletedCells.delete(`${r},${c}`)
      })
    } else {
      region.forEach(({ row: r, col: c }) => {
        newCompletedCells.add(`${r},${c}`)
      })
    }

    // 更新进度
    const newColorProgress = { ...colorProgress.value }
    if (newColorProgress[currentColor.value]) {
      const newCompleted = Array.from(newCompletedCells).filter((key) => {
        const [r, c] = key.split(',').map(Number)
        return mappedPixelData.value[r]?.[c]?.color === currentColor.value
      }).length

      newColorProgress[currentColor.value] = {
        ...newColorProgress[currentColor.value],
        completed: newCompleted,
      }
    }

    // 检查是否所有颜色都完成了
    const allColorsCompleted = Object.values(newColorProgress).every(
      (p) => p.completed >= p.total
    )

    completedCells.value = newCompletedCells
    selectedCell.value = { row, col }
    colorProgress.value = newColorProgress

    // 更新 availableColors 的完成数
    availableColors.value = availableColors.value.map((c) => {
      if (c.color === currentColor.value) {
        return { ...c, completed: newColorProgress[currentColor.value]?.completed || 0 }
      }
      return c
    })

    // 如果当前颜色完成，自动切换到下一个未完成颜色
    if (!allColorsCompleted) {
      const currentProgress = newColorProgress[currentColor.value]
      if (currentProgress && currentProgress.completed >= currentProgress.total) {
        switchToNextIncompleteColor()
      }
    }
  }
}

// ========== 切换到下一个未完成颜色 ==========
function switchToNextIncompleteColor() {
  const currentIndex = availableColors.value.findIndex((c) => c.color === currentColor.value)
  if (currentIndex === -1) return

  for (let i = 1; i <= availableColors.value.length; i++) {
    const nextIndex = (currentIndex + i) % availableColors.value.length
    const nextColor = availableColors.value[nextIndex]
    if (nextColor.completed < nextColor.total) {
      currentColor.value = nextColor.color
      return
    }
  }
}

// ========== 颜色切换 ==========
function handleColorChange(color) {
  currentColor.value = color
  showColorPanel.value = false
}

// ========== 定位到推荐位置 ==========
function handleLocateRecommended() {
  if (!recommendedCell.value || !gridDimensions.value) return

  const { row, col } = recommendedCell.value
  const cellSize = Math.max(
    15,
    Math.min(40, 300 / Math.max(gridDimensions.value.N, gridDimensions.value.M))
  )

  const targetX = (col + 0.5) * cellSize
  const targetY = (row + 0.5) * cellSize
  const canvasWidth = gridDimensions.value.N * cellSize
  const canvasHeight = gridDimensions.value.M * cellSize
  const canvasCenterX = canvasWidth / 2
  const canvasCenterY = canvasHeight / 2

  canvasOffset.value = {
    x: canvasCenterX - targetX,
    y: canvasCenterY - targetY,
  }
}

// ========== 计算进度 ==========
const currentColorInfo = computed(() =>
  availableColors.value.find((c) => c.color === currentColor.value)
)

const progressPercentage = computed(() =>
  currentColorInfo.value
    ? Math.round((currentColorInfo.value.completed / currentColorInfo.value.total) * 100)
    : 0
)

const elapsedTime = computed(() => formatTime(totalElapsedTime.value))

// ========== 引导模式标签 ==========
const guidanceModeLabel = computed(() => {
  const labels = { nearest: '最近优先', largest: '最大优先', 'edge-first': '边缘优先' }
  return labels[guidanceMode.value] || guidanceMode.value
})

function cycleGuidanceMode() {
  const modes = ['nearest', 'largest', 'edge-first']
  const currentIndex = modes.indexOf(guidanceMode.value)
  guidanceMode.value = modes[(currentIndex + 1) % modes.length]
}

// ========== 返回主页 ==========
function goBack() {
  window.history.back()
}
</script>

<template>
  <!-- 加载状态 -->
  <div v-if="isLoading" class="h-screen flex items-center justify-center bg-gray-50">
    <div class="text-center">
      <div
        class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"
      ></div>
      <p class="text-gray-600">加载中...</p>
    </div>
  </div>

  <!-- 错误状态 -->
  <div v-else-if="hasError" class="h-screen flex items-center justify-center bg-gray-50">
    <div class="text-center">
      <div class="text-6xl mb-4">😢</div>
      <p class="text-gray-600 mb-4">未找到专心拼豆数据</p>
      <p class="text-gray-400 text-sm mb-4">请先在主页生成像素画并进入专心模式</p>
      <button
        @click="goBack"
        class="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
      >
        返回主页
      </button>
    </div>
  </div>

  <!-- 主界面 -->
  <div v-else class="h-screen flex flex-col bg-gray-50">
    <!-- 顶部导航栏 -->
    <header
      class="h-14 bg-white shadow-sm border-b border-gray-200 px-4 py-2 flex items-center justify-between"
    >
      <button
        @click="goBack"
        class="flex items-center text-gray-600 hover:text-gray-800"
      >
        <svg class="w-6 h-6 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M15 19l-7-7 7-7"
          />
        </svg>
        返回
      </button>

      <h1 class="text-lg font-medium text-gray-800">专心拼豆</h1>

      <div class="flex items-center gap-2">
        <button
          @click="cycleGuidanceMode"
          class="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded-full text-gray-600 transition-colors"
        >
          {{ guidanceModeLabel }}
        </button>
      </div>
    </header>

    <!-- 当前颜色状态栏 -->
    <ColorStatusBar
      :current-color="currentColor"
      :color-info="currentColorInfo"
      :progress-percentage="progressPercentage"
    />

    <!-- 主画布区域 -->
    <div class="flex-1 relative overflow-hidden">
      <FocusCanvas
        :mapped-pixel-data="mappedPixelData"
        :grid-dimensions="gridDimensions"
        :current-color="currentColor"
        :completed-cells="completedCells"
        :recommended-cell="recommendedCell"
        :recommended-region="recommendedRegion"
        :canvas-scale="canvasScale"
        :canvas-offset="canvasOffset"
        :grid-section-interval="gridSectionInterval"
        :show-section-lines="showSectionLines"
        :section-line-color="sectionLineColor"
        @cell-click="handleCellClick"
        @scale-change="(s) => (canvasScale = s)"
        @offset-change="(o) => (canvasOffset = o)"
      />
    </div>

    <!-- 进度条 -->
    <ProgressBar
      :progress-percentage="progressPercentage"
      :recommended-cell="recommendedCell"
      :color-info="currentColorInfo"
    />

    <!-- 底部工具栏 -->
    <FocusToolBar
      @color-select="showColorPanel = true"
      @locate="handleLocateRecommended"
      @pause="handlePauseToggle"
      :is-paused="isPaused"
      :elapsed-time="elapsedTime"
    />

    <!-- 颜色选择面板 -->
    <FocusColorPanel
      v-if="showColorPanel"
      :colors="availableColors"
      :current-color="currentColor"
      @color-select="handleColorChange"
      @close="showColorPanel = false"
    />
  </div>
</template>
