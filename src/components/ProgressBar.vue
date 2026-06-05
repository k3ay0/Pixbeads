<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps({
 progressPercentage: { type: Number, default: 0 },
 recommendedCell: { type: Object, default: null },
 colorInfo: { type: Object, default: null },
})

const progressDots = computed(() => {
 return Array.from({ length: 7 }, (_, index) => {
 const threshold = (index + 1) * (100 / 7)
 return {
 filled: props.progressPercentage >= threshold,
 }
 })
})
</script>

<template>
 <div class="h-10 bg-white border-b border-black/10 px-4 py-2 flex items-center justify-between">
 <div class="flex items-center space-x-2">
 <div
 v-for="(dot, index) in progressDots"
 :key="index"
 class="w-3 h-3 rounded-full"
 :class="dot.filled ? 'bg-[#007be5]' : 'bg-black/10'"
 />
 <span class="ml-2 text-sm font-medium text-black">
 {{ progressPercentage }}%
 </span>
 </div>

 <div class="text-xs text-black/45">
 <span v-if="recommendedCell">
 下一块 → {{ recommendedCell.row + 1 }},{{ recommendedCell.col + 1 }}
 </span>
 <span v-else>已完成当前颜色</span>
 </div>
 </div>
</template>