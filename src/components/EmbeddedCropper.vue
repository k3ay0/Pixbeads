<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import { getDominantColorByArea } from "../utils/pixelation";
import { findClosestPaletteColor } from "../utils/colorUtils";
import { usePaletteStore } from "../stores/paletteStore";
import { useOcrRecognition, type GridCellResult } from "../composables/useOcrRecognition";
import { inferGridFromEdges, detectGridDimensions, type GridDimensionsResult } from "../utils/gridDetection";
import colorSystemMappingJson from "../data/colorSystemMapping.json";
import { TRANSPARENT_KEY } from "../types";

const props = defineProps<{
  imageSrc: string;
}>();

const emit = defineEmits<{
  confirm: [canvas: HTMLCanvasElement];
  gridConfirm: [
    data: {
      canvas: HTMLCanvasElement;
      cols: number;
      rows: number;
      pixelColors: string[][];
      ocrEnabled: boolean;
    }
  ];
  cancel: [];
}>();

// OCR
const ocrRecognition = useOcrRecognition();
const paletteStore = usePaletteStore();
const ocrLoading = ref(false);
const ocrProgress = ref<{ phase: string; phaseLabel: string; percent?: number } | null>(null);

// Canvas refs
const containerRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);

// Image
const img = ref<HTMLImageElement | null>(null);
const imgLoaded = ref(false);

// Display dimensions (scaled to fit container)
const displayWidth = ref(0);
const displayHeight = ref(0);
const scale = ref(1);

// Crop rect in display coordinates
const crop = ref({ x: 0, y: 0, width: 0, height: 0 });

// Transform state
const rotation = ref<0 | 90 | 180 | 270>(0);
const flipHorizontal = ref(false);
const flipVertical = ref(false);

// Mode: 'crop' or 'grid'
const mode = ref<"crop" | "grid">("crop");

// Grid alignment state
const gridCols = ref(10);
const gridRows = ref(10);
const gridStep = ref(16); // 颜色量化步长
const showStepTooltip = ref(false);
const tooltipX = ref(0);
const tooltipY = ref(0);

function updateTooltipPos(e: MouseEvent) {
  tooltipX.value = e.clientX + 12;
  tooltipY.value = e.clientY + 12;
}
const ocrEnabled = ref(false);

// OCR smart workflow state
type OcrStep = 'legend-crop' | 'pattern-crop' | 'ocr-verify' | 'diff-view'
const ocrStep = ref<OcrStep>('legend-crop')
const legendCrop = ref({ x: 0, y: 0, width: 0, height: 0 })
const patternCrop = ref({ x: 0, y: 0, width: 0, height: 0 })
const legendCanvas = ref<HTMLCanvasElement | null>(null)
const patternCanvas = ref<HTMLCanvasElement | null>(null)
const isLegendCrop = ref(true)

// Legend parsing results
interface LegendEntry {
  code: string
  expectedCount: number
  rawText: string
  bbox: { x: number, y: number, width: number, height: number }
}
const legendData = ref<Map<string, LegendEntry>>(new Map())
const detectedLegendBrand = ref<string>('')  // 检测到的图例品牌，用于 getColorForCode 精确匹配
const autoGridCols = ref(0)
const autoGridRows = ref(0)
const detectionConfidence = ref<GridDimensionsResult>({ rows: 0, cols: 0, confidence: 0, method: "手动输入", gridLineThickness: 0 })
const ocrCellResults = ref<GridCellResult[]>([])  // 图纸 OCR 逐格识别结果，供网格检测+颜色匹配共用

// Editable grid override for auto-detected dimensions
const isEditingGrid = ref(autoGridCols.value === 0 && autoGridRows.value === 0)
const editGridCols = ref(autoGridCols.value)
const editGridRows = ref(autoGridRows.value)

function startEditGrid() {
  editGridCols.value = autoGridCols.value || 1
  editGridRows.value = autoGridRows.value || 1
  isEditingGrid.value = true
}

/**
 * 计算格子尺寸（正方形格子，长宽合并为一个值）。
 * 纯按行数列数均分画布,不计网格线厚度。
 */
function calcCellSize(
  totalWidth: number,
  totalHeight: number,
  cols: number,
  rows: number,
  _thickness: number
): number {
  const cellW = totalWidth / cols
  const cellH = totalHeight / rows
  // 正方形格子：取两个方向的平均作为统一格子尺寸
  return (cellW + cellH) / 2
}

function confirmEditGrid() {
  const cols = Math.max(1, Math.round(editGridCols.value))
  const rows = Math.max(1, Math.round(editGridRows.value))
  editGridCols.value = cols
  editGridRows.value = rows
  autoGridCols.value = cols
  autoGridRows.value = rows
  isEditingGrid.value = false
}

// 校正网格后重算差异:确认行列 → 重跑 OCR 识别 → 重跑颜色提取 → 重算差异
function confirmEditGridAndRecompute() {
  confirmEditGrid()
  if (!patternCanvas.value) return
  showProcessingOverlay.value = true
  processingMessage.value = '正在按校正网格重新识别...'
  processingProgress.value = { phase: 'recomputing', percent: 0 }
  nextTick(async () => {
    try {
      const canvas = patternCanvas.value!
      const cols = autoGridCols.value || gridCols.value
      const rows = autoGridRows.value || gridRows.value
      // 重跑 OCR 识别(用新网格尺寸)
      const legendCodes = Array.from(legendData.value.keys())
      ocrCellResults.value = []
      try {
        processingMessage.value = '正在识别图纸格子色号...'
        ocrCellResults.value = await ocrRecognition.recognizeGrid(canvas, cols, rows, (progress) => {
          let percent: number | undefined
          if (progress.percent != null) percent = progress.percent
          processingMessage.value = `正在识别图纸格子色号... ${percent != null ? percent + '%' : ''}`
          processingProgress.value = { phase: progress.phase, percent }
        }, legendCodes)
        console.log(`[OCR] 校正后重识别完成, 识别到 ${ocrCellResults.value.length} 个格子有文字`)
      } catch (err) {
        console.error('[OCR] 校正后重识别失败:', err)
        ocrCellResults.value = []
      }
      // 重跑颜色提取
      processingMessage.value = '正在提取图纸颜色...'
      processingProgress.value = { phase: 'extracting', percent: 0 }
      await extractPatternColorsWithOverlay()
      console.log('[OCR] 校正后重算差异完成')
    } catch (err) {
      console.error('[OCR] 校正后重算失败:', err)
      processingMessage.value = '重算失败,请重试'
    } finally {
      setTimeout(() => {
        showProcessingOverlay.value = false
      }, 500)
    }
  })
}

function cancelEditGrid() {
  isEditingGrid.value = false
}

// Sync edit values when OCR detection updates auto values
watch([autoGridCols, autoGridRows], ([cols, rows]) => {
  editGridCols.value = cols
  editGridRows.value = rows
  if (cols > 0 || rows > 0) {
    isEditingGrid.value = false
  }
})

// Pattern color extraction results
interface PatternCell {
  row: number
  col: number
  rgb: string
  hex: string
  code: string
}
const patternColorData = ref<PatternCell[]>([])

// Diff comparison results
interface DiffEntry {
  code: string
  expectedCount: number
  actualCount: number
  diff: number
  cells: Array<{ row: number, col: number }>
}
const diffData = ref<DiffEntry[]>([])
const selectedDiffColor = ref<string | null>(null)

// Color slice gallery state
interface ColorSlice {
  row: number
  col: number
  imageData: ImageData
}
const colorSlices = ref<ColorSlice[]>([])
const selectedSlice = ref<{ row: number; col: number } | null>(null)
const selectedSlices = ref<{ row: number; col: number }[]>([])

// Slice canvas refs for small canvas rendering
const sliceCanvasRefs = ref<(HTMLCanvasElement | null)[]>([])

function renderSliceCanvases() {
  nextTick(() => {
    const slices = colorSlices.value
    for (let i = 0; i < slices.length; i++) {
      const canvas = sliceCanvasRefs.value[i]
      if (!canvas) continue
      const slice = slices[i]
      canvas.width = slice.imageData.width
      canvas.height = slice.imageData.height
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.putImageData(slice.imageData, 0, 0)
      }
    }
  })
}

// Palette colors: all legend colors + transparent at the end
const paletteColors = computed(() => {
  const colors: { code: string; hex: string }[] = []
  for (const [code] of legendData.value) {
    colors.push({ code, hex: getColorHex(code) })
  }
  // Add transparent at the end if it's not already in legendData
  if (!legendData.value.has(TRANSPARENT_KEY)) {
    colors.push({ code: TRANSPARENT_KEY, hex: '#fafafa' })
  }
  return colors
})

// Diff summary stats
const diffStats = computed(() => {
  const total = diffData.value.length
  const matchCount = diffData.value.filter(d => d.diff === 0).length
  const mismatchCount = total - matchCount
  return { total, matchCount, mismatchCount }
})

// Fullscreen overlay state for OCR processing
const showProcessingOverlay = ref(false)
const processingMessage = ref('')
const processingProgress = ref<{ phase: string; percent?: number } | null>(null)

// Canvas view transform (for grid mode panning and zooming)
const canvasTranslateX = ref(0);
const canvasTranslateY = ref(0);
const canvasScale = ref(1);

// Grid crop rect
const gridCrop = ref({ x: 0, y: 0, width: 0, height: 0 });

// Drag state for grid mode
type GridDragMode = "move" | "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w" | "pan" | null;
const gridDragMode = ref<GridDragMode>(null);
const gridDragStart = ref({ x: 0, y: 0 });
const gridCropStart = ref({ x: 0, y: 0, width: 0, height: 0 });
const canvasTranslateStart = ref({ x: 0, y: 0 });

// Drag state for crop mode
type CropDragMode = "move" | "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w" | "pan" | null;
const dragMode = ref<CropDragMode>(null);
const dragStart = ref({ x: 0, y: 0 });
const cropStart = ref({ x: 0, y: 0, width: 0, height: 0 });

const HANDLE_SIZE = 12;
const MIN_CROP_SIZE = 20;
const SNAP_THRESHOLD = 5; // 吸附阈值（像素）

// 检测到的边缘位置（用于智能吸附）
const detectedEdgesX = ref<number[]>([]);
const detectedEdgesY = ref<number[]>([]);

// 智能吸附函数 - 检测值是否接近检测到的边缘
function snapToEdge(value: number): number {
  // 放大比例 > 300% 时取消吸附
  if (canvasScale.value > 3) return value;
  // 检查检测到的线条边缘
  for (const edge of detectedEdgesX.value) {
    if (Math.abs(value - edge) < SNAP_THRESHOLD) {
      return edge;
    }
  }
  for (const edge of detectedEdgesY.value) {
    if (Math.abs(value - edge) < SNAP_THRESHOLD) {
      return edge;
    }
  }
  return value;
}

// 检测图片中的边缘线条
function detectEdges() {
  if (!img.value) return;
  
  const tempCanvas = document.createElement('canvas');
  const ctx = tempCanvas.getContext('2d')!;
  const { width, height } = getEffectiveDimensions();
  tempCanvas.width = width;
  tempCanvas.height = height;
  
  // 绘制图片
  ctx.save();
  applyTransforms(ctx, width, height);
  ctx.drawImage(img.value, 0, 0, width, height);
  ctx.restore();
  
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  
  // 转换为灰度并检测边缘
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const idx = i * 4;
    gray[i] = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
  }
  
  // 使用 Sobel 算子检测边缘
  const edgesX = new Set<number>();
  const edgesY = new Set<number>();
  
  // 检测水平线条（y方向变化大）
  for (let y = 1; y < height - 1; y++) {
    let edgeStrength = 0;
    for (let x = 1; x < width - 1; x++) {
      const sobelY = -gray[(y-1)*width + x-1] - 2*gray[(y-1)*width + x] - gray[(y-1)*width + x+1]
                    +gray[(y+1)*width + x-1] + 2*gray[(y+1)*width + x] + gray[(y+1)*width + x+1];
      edgeStrength += Math.abs(sobelY);
    }
    edgeStrength /= width;
    if (edgeStrength > 50) { // 阈值
      edgesY.add(y);
    }
  }
  
  // 检测垂直线条（x方向变化大）
  for (let x = 1; x < width - 1; x++) {
    let edgeStrength = 0;
    for (let y = 1; y < height - 1; y++) {
      const sobelX = -gray[(y-1)*width + x-1] - 2*gray[y*width + x-1] - gray[(y+1)*width + x-1]
                    +gray[(y-1)*width + x+1] + 2*gray[y*width + x+1] + gray[(y+1)*width + x+1];
      edgeStrength += Math.abs(sobelX);
    }
    edgeStrength /= height;
    if (edgeStrength > 50) { // 阈值
      edgesX.add(x);
    }
  }
  
  // 合并相近的边缘（减少冗余）
  const mergeThreshold = 5;
  const mergedEdgesX = mergeNearbyEdges([...edgesX], mergeThreshold);
  const mergedEdgesY = mergeNearbyEdges([...edgesY], mergeThreshold);
  
  // 转换为显示坐标
  const s = scale.value;
  detectedEdgesX.value = mergedEdgesX.map(e => Math.round(e * s));
  detectedEdgesY.value = mergedEdgesY.map(e => Math.round(e * s));
}

// 合并相近的边缘
function mergeNearbyEdges(edges: number[], threshold: number): number[] {
  if (edges.length === 0) return [];
  edges.sort((a, b) => a - b);
  const merged: number[] = [edges[0]];
  for (let i = 1; i < edges.length; i++) {
    if (edges[i] - merged[merged.length - 1] > threshold) {
      merged.push(edges[i]);
    }
  }
  return merged;
}

/**
 * 从源图片推断网格尺寸（色块识别模式使用）
 * 在切换到色块识别模式时调用，作为默认网格值
 */
function inferGridFromSourceImage() {
  if (!img.value) return;
  
  const tempCanvas = document.createElement('canvas');
  const { width, height } = getEffectiveDimensions();
  tempCanvas.width = width;
  tempCanvas.height = height;
  
  const ctx = tempCanvas.getContext('2d')!;
  ctx.save();
  applyTransforms(ctx, width, height);
  ctx.drawImage(img.value, 0, 0, width, height);
  ctx.restore();
  
  const imageData = ctx.getImageData(0, 0, width, height);
  console.log(`[色块识别] 开始网格检测，源图尺寸: ${width}x${height}`);
  const edgeResult = inferGridFromEdges(imageData);
  
  if (edgeResult.confidence > 0 && edgeResult.rows > 0 && edgeResult.cols > 0) {
    console.log(`[色块识别] 边缘检测网格: ${edgeResult.cols}x${edgeResult.rows} (置信度: ${edgeResult.confidence}, 线厚: ${edgeResult.gridLineThickness})`);
    autoGridCols.value = edgeResult.cols;
    autoGridRows.value = edgeResult.rows;
    gridCols.value = edgeResult.cols;
    gridRows.value = edgeResult.rows;
    detectionConfidence.value = {
      rows: edgeResult.rows,
      cols: edgeResult.cols,
      confidence: edgeResult.confidence,
      method: "边缘检测",
      gridLineThickness: edgeResult.gridLineThickness,
    };
  } else {
    console.log(`[色块识别] 网格检测失败，置信度=${edgeResult.confidence}`);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

// Load image
onMounted(() => {
  const image = new Image();
  image.onload = () => {
    img.value = image;
    imgLoaded.value = true;
    nextTick(() => {
      fitImageToContainer();
      initCrop();
      initLegendCrop();
      initGridCrop();
      detectEdges(); // 检测图片边缘
      render();
    });
  };
  image.src = props.imageSrc;
});

function fitImageToContainer() {
  if (!img.value || !containerRef.value) return;
  const container = containerRef.value;
  const maxW = container.clientWidth - 32;
  const maxH = container.clientHeight - 32;
  const { width: effW, height: effH } = getEffectiveDimensions();
  const scaleX = maxW / effW;
  const scaleY = maxH / effH;
  scale.value = Math.min(scaleX, scaleY, 1);
  displayWidth.value = Math.round(effW * scale.value);
  displayHeight.value = Math.round(effH * scale.value);
}

function getEffectiveDimensions() {
  if (!img.value) return { width: 0, height: 0 };
  const w = img.value.width;
  const h = img.value.height;
  if (rotation.value === 90 || rotation.value === 270) {
    return { width: h, height: w };
  }
  return { width: w, height: h };
}

function initCrop() {
  const padding = displayWidth.value * 0.025; // 2.5% padding each side = 5% total
  crop.value = {
    x: padding,
    y: padding,
    width: displayWidth.value * 0.95,
    height: displayHeight.value * 0.95,
  };
}

function initLegendCrop() {
  // Legend is typically at the bottom of drawings — default crop covers lower portion
  const w = displayWidth.value
  const h = displayHeight.value
  const cropH = Math.min(h * 0.5, w * 0.3)  // rectangular, wider than tall
  legendCrop.value = {
    x: 0,
    y: h - cropH,
    width: w,
    height: cropH,
  };
}

function initGridCrop() {
  // Square crop at the upper-center of the image
  const side = Math.min(displayWidth.value, displayHeight.value) * 0.8
  gridCrop.value = {
    x: (displayWidth.value - side) / 2,
    y: 0,
    width: side,
    height: side,
  };
  canvasTranslateX.value = 0;
  canvasTranslateY.value = 0;
  canvasScale.value = 1;
}

function displayToImage(rect: { x: number; y: number; width: number; height: number }) {
  const s = scale.value;
  return {
    x: Math.round(rect.x / s),
    y: Math.round(rect.y / s),
    width: Math.round(rect.width / s),
    height: Math.round(rect.height / s),
  };
}

function applyTransforms(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.translate(width / 2, height / 2);
  ctx.rotate((rotation.value * Math.PI) / 180);
  const scaleX = flipHorizontal.value ? -1 : 1;
  const scaleY = flipVertical.value ? -1 : 1;
  ctx.scale(scaleX, scaleY);
  ctx.translate(-width / 2, -height / 2);
}

function render() {
  const canvas = canvasRef.value;
  if (!canvas || !img.value) return;
  
  // 设置canvas大小为父容器大小
  const parent = canvas.parentElement;
  if (parent) {
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;
  } else {
    canvas.width = displayWidth.value;
    canvas.height = displayHeight.value;
  }
  
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Non-ocr-verify/diff-view: draw background image + overlays with canvas transform
  if (!(ocrEnabled.value && (ocrStep.value === 'ocr-verify' || ocrStep.value === 'diff-view'))) {
    ctx.save();
    ctx.translate(canvasTranslateX.value, canvasTranslateY.value);
    ctx.scale(canvasScale.value, canvasScale.value);

    // 绘制图片
    ctx.save();
    applyTransforms(ctx, displayWidth.value, displayHeight.value);
    ctx.drawImage(img.value, 0, 0, displayWidth.value, displayHeight.value);
    ctx.restore();

    // Pattern-crop: show grid overlay
    if (ocrEnabled.value && ocrStep.value === 'pattern-crop') {
      renderGridOverlay(ctx);
    } else if (ocrEnabled.value && ocrStep.value === 'legend-crop') {
      renderLegendCropOverlay(ctx);
    } else if (mode.value === "crop") {
      renderCropOverlay(ctx);
    } else {
      renderGridOverlay(ctx);
    }

    ctx.restore();
  }

  // ocr-verify: draw legend canvas directly (outside transform, raw canvas coords)
  if (ocrEnabled.value && ocrStep.value === 'ocr-verify') {
    if (legendCanvas.value) {
      const lc = legendCanvas.value;
      // Scale legend image to fit within canvas, preserving aspect ratio
      const maxW = canvas.width;
      const maxH = canvas.height;
      const drawScale = Math.min(maxW / lc.width, maxH / lc.height, 1);
      const drawW = lc.width * drawScale;
      const drawH = lc.height * drawScale;
      const offsetX = (maxW - drawW) / 2;
      const offsetY = (maxH - drawH) / 2;

      ctx.save();
      ctx.translate(canvasTranslateX.value, canvasTranslateY.value);
      ctx.scale(canvasScale.value, canvasScale.value);
      ctx.drawImage(lc, offsetX, offsetY, drawW, drawH);

      // Draw bounding box overlays for each legend entry
      for (const [, entry] of legendData.value) {
        const bx = offsetX + entry.bbox.x * drawScale;
        const by = offsetY + entry.bbox.y * drawScale;
        const bw = entry.bbox.width * drawScale;
        const bh = entry.bbox.height * drawScale;

        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2;
        ctx.strokeRect(bx, by, bw, bh);

        ctx.fillStyle = '#22c55e';
        ctx.font = `bold ${Math.max(11, 12 * drawScale)}px sans-serif`;
        ctx.textBaseline = 'bottom';
        const label = `${entry.code} ×${entry.expectedCount}`;
        ctx.fillText(label, bx, by - 2);
      }
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('正在识别图例...', canvas.width / 2, canvas.height / 2);
      ctx.textAlign = 'start';
    }
  }

  // diff-view: no canvas rendering needed — HTML layout handles it
}

// 渲染检测到的边缘线
function renderDetectedEdges(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = "rgba(99, 102, 241, 0.5)"; // 紫色半透明
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]); // 虚线
  
  // 绘制垂直边缘线
  for (const x of detectedEdgesX.value) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, displayHeight.value);
    ctx.stroke();
  }
  
  // 绘制水平边缘线
  for (const y of detectedEdgesY.value) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(displayWidth.value, y);
    ctx.stroke();
  }
  
  ctx.setLineDash([]); // 重置虚线
}

function renderCropOverlay(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(0, 0, displayWidth.value, crop.value.y);
  ctx.fillRect(0, crop.value.y + crop.value.height, displayWidth.value, displayHeight.value - crop.value.y - crop.value.height);
  ctx.fillRect(0, crop.value.y, crop.value.x, crop.value.height);
  ctx.fillRect(crop.value.x + crop.value.width, crop.value.y, displayWidth.value - crop.value.x - crop.value.width, crop.value.height);

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.strokeRect(crop.value.x, crop.value.y, crop.value.width, crop.value.height);

  const hs = HANDLE_SIZE;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(crop.value.x - hs / 2, crop.value.y - hs / 2, hs, hs);
  ctx.fillRect(crop.value.x + crop.value.width - hs / 2, crop.value.y - hs / 2, hs, hs);
  ctx.fillRect(crop.value.x - hs / 2, crop.value.y + crop.value.height - hs / 2, hs, hs);
  ctx.fillRect(crop.value.x + crop.value.width - hs / 2, crop.value.y + crop.value.height - hs / 2, hs, hs);

  const ehs = 8;
  ctx.fillRect(crop.value.x + crop.value.width / 2 - ehs, crop.value.y - ehs / 2, ehs * 2, ehs);
  ctx.fillRect(crop.value.x + crop.value.width / 2 - ehs, crop.value.y + crop.value.height - ehs / 2, ehs * 2, ehs);
  ctx.fillRect(crop.value.x - ehs / 2, crop.value.y + crop.value.height / 2 - ehs, ehs, ehs * 2);
  ctx.fillRect(crop.value.x + crop.value.width - ehs / 2, crop.value.y + crop.value.height / 2 - ehs, ehs, ehs * 2);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.lineWidth = 0.5;
  const thirdW = crop.value.width / 3;
  const thirdH = crop.value.height / 3;
  for (let i = 1; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(crop.value.x + thirdW * i, crop.value.y);
    ctx.lineTo(crop.value.x + thirdW * i, crop.value.y + crop.value.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(crop.value.x, crop.value.y + thirdH * i);
    ctx.lineTo(crop.value.x + crop.value.width, crop.value.y + thirdH * i);
    ctx.stroke();
  }
}

function renderLegendCropOverlay(ctx: CanvasRenderingContext2D) {
  const c = legendCrop.value;

  // Dark overlay outside crop area
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(0, 0, displayWidth.value, c.y);
  ctx.fillRect(0, c.y + c.height, displayWidth.value, displayHeight.value - c.y - c.height);
  ctx.fillRect(0, c.y, c.x, c.height);
  ctx.fillRect(c.x + c.width, c.y, displayWidth.value - c.x - c.width, c.height);

  // Blue border
  ctx.strokeStyle = "#3b82f6";
  ctx.lineWidth = 2;
  ctx.strokeRect(c.x, c.y, c.width, c.height);

  // Corner handles (blue)
  const hs = HANDLE_SIZE;
  ctx.fillStyle = "#3b82f6";
  ctx.fillRect(c.x - hs / 2, c.y - hs / 2, hs, hs);
  ctx.fillRect(c.x + c.width - hs / 2, c.y - hs / 2, hs, hs);
  ctx.fillRect(c.x - hs / 2, c.y + c.height - hs / 2, hs, hs);
  ctx.fillRect(c.x + c.width - hs / 2, c.y + c.height - hs / 2, hs, hs);

  // Edge handles (blue)
  const ehs = 8;
  ctx.fillRect(c.x + c.width / 2 - ehs, c.y - ehs / 2, ehs * 2, ehs);
  ctx.fillRect(c.x + c.width / 2 - ehs, c.y + c.height - ehs / 2, ehs * 2, ehs);
  ctx.fillRect(c.x - ehs / 2, c.y + c.height / 2 - ehs, ehs, ehs * 2);
  ctx.fillRect(c.x + c.width - ehs / 2, c.y + c.height / 2 - ehs, ehs, ehs * 2);

  // Rule of thirds lines
  ctx.strokeStyle = "rgba(59, 130, 246, 0.3)";
  ctx.lineWidth = 0.5;
  const thirdW = c.width / 3;
  const thirdH = c.height / 3;
  for (let i = 1; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(c.x + thirdW * i, c.y);
    ctx.lineTo(c.x + thirdW * i, c.y + c.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c.x, c.y + thirdH * i);
    ctx.lineTo(c.x + c.width, c.y + thirdH * i);
    ctx.stroke();
  }
}

function renderGridOverlay(ctx: CanvasRenderingContext2D) {
  const cols = gridCols.value;
  const rows = gridRows.value;
  const gridAreaX = gridCrop.value.x;
  const gridAreaY = gridCrop.value.y;
  const gridAreaW = gridCrop.value.width;
  const gridAreaH = gridCrop.value.height;
  const cellW = gridAreaW / cols;
  const cellH = gridAreaH / rows;

  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(-10000, -10000, 20000, 10000 + gridAreaY);
  ctx.fillRect(-10000, gridAreaY + gridAreaH, 20000, 10000);
  ctx.fillRect(-10000, gridAreaY, 10000 + gridAreaX, gridAreaH);
  ctx.fillRect(gridAreaX + gridAreaW, gridAreaY, 10000, gridAreaH);

  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 2 / canvasScale.value;
  ctx.strokeRect(gridAreaX, gridAreaY, gridAreaW, gridAreaH);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.lineWidth = 0.5 / canvasScale.value;
  for (let i = 1; i < cols; i++) {
    ctx.beginPath();
    ctx.moveTo(gridAreaX + cellW * i, gridAreaY);
    ctx.lineTo(gridAreaX + cellW * i, gridAreaY + gridAreaH);
    ctx.stroke();
  }
  for (let i = 1; i < rows; i++) {
    ctx.beginPath();
    ctx.moveTo(gridAreaX, gridAreaY + cellH * i);
    ctx.lineTo(gridAreaX + gridAreaW, gridAreaY + cellH * i);
    ctx.stroke();
  }

  const hs = HANDLE_SIZE / canvasScale.value;
  ctx.fillStyle = "#ef4444";
  ctx.fillRect(gridAreaX - hs / 2, gridAreaY - hs / 2, hs, hs);
  ctx.fillRect(gridAreaX + gridAreaW - hs / 2, gridAreaY - hs / 2, hs, hs);
  ctx.fillRect(gridAreaX - hs / 2, gridAreaY + gridAreaH - hs / 2, hs, hs);
  ctx.fillRect(gridAreaX + gridAreaW - hs / 2, gridAreaY + gridAreaH - hs / 2, hs, hs);

  const ehs = 8 / canvasScale.value;
  ctx.fillStyle = "#ef4444";
  ctx.fillRect(gridAreaX + gridAreaW / 2 - ehs, gridAreaY - ehs / 2, ehs * 2, ehs);
  ctx.fillRect(gridAreaX + gridAreaW / 2 - ehs, gridAreaY + gridAreaH - ehs / 2, ehs * 2, ehs);
  ctx.fillRect(gridAreaX - ehs / 2, gridAreaY + gridAreaH / 2 - ehs, ehs, ehs * 2);
  ctx.fillRect(gridAreaX + gridAreaW - ehs / 2, gridAreaY + gridAreaH / 2 - ehs, ehs, ehs * 2);
}

function getCropHitMode(x: number, y: number): CropDragMode {
  // 将屏幕坐标转换为画布坐标
  const tx = (x - canvasTranslateX.value) / canvasScale.value;
  const ty = (y - canvasTranslateY.value) / canvasScale.value;
  // Use legendCrop when in legend-crop step
  const c = (ocrEnabled.value && ocrStep.value === 'legend-crop') ? legendCrop.value : crop.value;
  const hs = HANDLE_SIZE / canvasScale.value;
  if (Math.abs(tx - c.x) < hs && Math.abs(ty - c.y) < hs) return "nw";
  if (Math.abs(tx - (c.x + c.width)) < hs && Math.abs(ty - c.y) < hs) return "ne";
  if (Math.abs(tx - c.x) < hs && Math.abs(ty - (c.y + c.height)) < hs) return "sw";
  if (Math.abs(tx - (c.x + c.width)) < hs && Math.abs(ty - (c.y + c.height)) < hs) return "se";
  if (Math.abs(ty - c.y) < hs && tx > c.x && tx < c.x + c.width) return "n";
  if (Math.abs(ty - (c.y + c.height)) < hs && tx > c.x && tx < c.x + c.width) return "s";
  if (Math.abs(tx - c.x) < hs && ty > c.y && ty < c.y + c.height) return "w";
  if (Math.abs(tx - (c.x + c.width)) < hs && ty > c.y && ty < c.y + c.height) return "e";
  if (tx > c.x && tx < c.x + c.width && ty > c.y && ty < c.y + c.height) return "move";
  return "pan";
}

function getGridHitMode(x: number, y: number): GridDragMode {
  const tx = (x - canvasTranslateX.value) / canvasScale.value;
  const ty = (y - canvasTranslateY.value) / canvasScale.value;
  const c = gridCrop.value;
  const hs = HANDLE_SIZE / canvasScale.value;
  if (Math.abs(tx - c.x) < hs && Math.abs(ty - c.y) < hs) return "nw";
  if (Math.abs(tx - (c.x + c.width)) < hs && Math.abs(ty - c.y) < hs) return "ne";
  if (Math.abs(tx - c.x) < hs && Math.abs(ty - (c.y + c.height)) < hs) return "sw";
  if (Math.abs(tx - (c.x + c.width)) < hs && Math.abs(ty - (c.y + c.height)) < hs) return "se";
  if (Math.abs(ty - c.y) < hs && tx > c.x && tx < c.x + c.width) return "n";
  if (Math.abs(ty - (c.y + c.height)) < hs && tx > c.x && tx < c.x + c.width) return "s";
  if (Math.abs(tx - c.x) < hs && ty > c.y && ty < c.y + c.height) return "w";
  if (Math.abs(tx - (c.x + c.width)) < hs && ty > c.y && ty < c.y + c.height) return "e";
  if (tx > c.x && tx < c.x + c.width && ty > c.y && ty < c.y + c.height) return "move";
  return "pan";
}

function getCropCursor(mode: CropDragMode): string {
  switch (mode) {
    case "nw": case "se": return "nwse-resize";
    case "ne": case "sw": return "nesw-resize";
    case "n": case "s": return "ns-resize";
    case "e": case "w": return "ew-resize";
    case "move": return "move";
    case "pan": return "grab";
    default: return "default";
  }
}

function getGridCursor(mode: GridDragMode): string {
  switch (mode) {
    case "nw": case "se": return "nwse-resize";
    case "ne": case "sw": return "nesw-resize";
    case "n": case "s": return "ns-resize";
    case "e": case "w": return "ew-resize";
    case "move": return "move";
    case "pan": return "grab";
    default: return "default";
  }
}

function onPointerDown(e: MouseEvent | TouchEvent) {
  const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
  const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
  const canvas = canvasRef.value!;
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left) * (canvas.width / rect.width);
  const y = (clientY - rect.top) * (canvas.height / rect.height);

  // ocr-verify / diff-view: only pan, no crop box
  if (ocrEnabled.value && (ocrStep.value === 'ocr-verify' || ocrStep.value === 'diff-view')) {
    dragMode.value = "pan";
    dragStart.value = { x: clientX, y: clientY };
    canvasTranslateStart.value = { x: canvasTranslateX.value, y: canvasTranslateY.value };
    e.preventDefault();
    return;
  }

  const useGridMode = (mode.value === "grid" && !ocrEnabled.value) || (ocrEnabled.value && ocrStep.value === 'pattern-crop');
  if (!useGridMode) {
    const hitMode = getCropHitMode(x, y);
    dragMode.value = hitMode;
    dragStart.value = { x: clientX, y: clientY };
    // Save the correct crop start based on mode
    if (ocrEnabled.value && ocrStep.value === 'legend-crop') {
      cropStart.value = { ...legendCrop.value };
    } else {
      cropStart.value = { ...crop.value };
    }
    canvasTranslateStart.value = { x: canvasTranslateX.value, y: canvasTranslateY.value };
  } else {
    const hitMode = getGridHitMode(x, y);
    if (!hitMode) return;
    gridDragMode.value = hitMode;
    gridDragStart.value = { x: clientX, y: clientY };
    gridCropStart.value = { ...gridCrop.value };
    canvasTranslateStart.value = { x: canvasTranslateX.value, y: canvasTranslateY.value };
  }
  e.preventDefault();
}

function onPointerMove(e: MouseEvent | TouchEvent) {
  const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
  const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
  const canvas = canvasRef.value!;
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left) * (canvas.width / rect.width);
  const y = (clientY - rect.top) * (canvas.height / rect.height);

  // ocr-verify / diff-view: only pan
  if (ocrEnabled.value && (ocrStep.value === 'ocr-verify' || ocrStep.value === 'diff-view')) {
    if (!dragMode.value) {
      canvas.style.cursor = "grab";
      return;
    }
    if (dragMode.value === "pan") {
      canvasTranslateX.value = canvasTranslateStart.value.x + (clientX - dragStart.value.x);
      canvasTranslateY.value = canvasTranslateStart.value.y + (clientY - dragStart.value.y);
      render();
      e.preventDefault();
    }
    return;
  }

  const useGridMode = (mode.value === "grid" && !ocrEnabled.value) || (ocrEnabled.value && ocrStep.value === 'pattern-crop');
  if (!useGridMode) {
    if (!dragMode.value) {
      const hitMode = getCropHitMode(x, y);
      canvas.style.cursor = getCropCursor(hitMode);
      return;
    }
    
    // 处理拖动空白区域（平移画布）
    if (dragMode.value === "pan") {
      canvasTranslateX.value = canvasTranslateStart.value.x + (clientX - dragStart.value.x);
      canvasTranslateY.value = canvasTranslateStart.value.y + (clientY - dragStart.value.y);
      render();
      e.preventDefault();
      return;
    }
    
    const dx = (clientX - dragStart.value.x) / canvasScale.value;
    const dy = (clientY - dragStart.value.y) / canvasScale.value;
    const c = cropStart.value;
    const maxW = displayWidth.value;
    const maxH = displayHeight.value;
    let newX = c.x, newY = c.y, newW = c.width, newH = c.height;

    switch (dragMode.value) {
      case "move":
        newX = Math.max(0, Math.min(maxW - c.width, c.x + dx));
        newY = Math.max(0, Math.min(maxH - c.height, c.y + dy));
        // 智能吸附
        newX = snapToEdge(newX);
        newY = snapToEdge(newY);
        break;
      case "nw":
        newX = Math.max(0, Math.min(c.x + c.width - MIN_CROP_SIZE, c.x + dx));
        newY = Math.max(0, Math.min(c.y + c.height - MIN_CROP_SIZE, c.y + dy));
        newW = c.x + c.width - newX;
        newH = c.y + c.height - newY;
        // 智能吸附
        newX = snapToEdge(newX);
        newY = snapToEdge(newY);
        newW = c.x + c.width - newX;
        newH = c.y + c.height - newY;
        break;
      case "ne":
        newY = Math.max(0, Math.min(c.y + c.height - MIN_CROP_SIZE, c.y + dy));
        newW = Math.max(MIN_CROP_SIZE, Math.min(maxW - c.x, c.width + dx));
        newH = c.y + c.height - newY;
        // 智能吸附
        newY = snapToEdge(newY);
        newH = c.y + c.height - newY;
        newW = snapToEdge(c.x + newW) - c.x;
        break;
      case "sw":
        newX = Math.max(0, Math.min(c.x + c.width - MIN_CROP_SIZE, c.x + dx));
        newW = c.x + c.width - newX;
        newH = Math.max(MIN_CROP_SIZE, Math.min(maxH - c.y, c.height + dy));
        // 智能吸附
        newX = snapToEdge(newX);
        newW = c.x + c.width - newX;
        newH = snapToEdge(c.y + newH) - c.y;
        break;
      case "se":
        newW = Math.max(MIN_CROP_SIZE, Math.min(maxW - c.x, c.width + dx));
        newH = Math.max(MIN_CROP_SIZE, Math.min(maxH - c.y, c.height + dy));
        // 智能吸附
        newW = snapToEdge(c.x + newW) - c.x;
        newH = snapToEdge(c.y + newH) - c.y;
        break;
      case "n":
        newY = Math.max(0, Math.min(c.y + c.height - MIN_CROP_SIZE, c.y + dy));
        newH = c.y + c.height - newY;
        // 智能吸附
        newY = snapToEdge(newY);
        newH = c.y + c.height - newY;
        break;
      case "s":
        newH = Math.max(MIN_CROP_SIZE, Math.min(maxH - c.y, c.height + dy));
        // 智能吸附
        newH = snapToEdge(c.y + newH) - c.y;
        break;
      case "w":
        newX = Math.max(0, Math.min(c.x + c.width - MIN_CROP_SIZE, c.x + dx));
        newW = c.x + c.width - newX;
        // 智能吸附
        newX = snapToEdge(newX);
        newW = c.x + c.width - newX;
        break;
      case "e":
        newW = Math.max(MIN_CROP_SIZE, Math.min(maxW - c.x, c.width + dx));
        // 智能吸附
        newW = snapToEdge(c.x + newW) - c.x;
        break;
    }
    // Update the correct crop based on mode
    if (ocrEnabled.value && ocrStep.value === 'legend-crop') {
      legendCrop.value = { x: newX, y: newY, width: newW, height: newH };
    } else {
      crop.value = { x: newX, y: newY, width: newW, height: newH };
    }
  } else {
    if (!gridDragMode.value) {
      const hitMode = getGridHitMode(x, y);
      canvas.style.cursor = getGridCursor(hitMode);
      return;
    }
    const dx = (clientX - gridDragStart.value.x) / canvasScale.value;
    const dy = (clientY - gridDragStart.value.y) / canvasScale.value;
    const c = gridCropStart.value;

    if (gridDragMode.value === "pan") {
      canvasTranslateX.value = canvasTranslateStart.value.x + (clientX - gridDragStart.value.x);
      canvasTranslateY.value = canvasTranslateStart.value.y + (clientY - gridDragStart.value.y);
    } else {
      let newX = c.x, newY = c.y, newW = c.width, newH = c.height;
      switch (gridDragMode.value) {
        case "move":
          newX = Math.max(0, Math.min(displayWidth.value - c.width, c.x + dx));
          newY = Math.max(0, Math.min(displayHeight.value - c.height, c.y + dy));
          // 智能吸附
          newX = snapToEdge(newX);
          newY = snapToEdge(newY);
          break;
        case "nw":
          newX = Math.max(0, Math.min(c.x + c.width - MIN_CROP_SIZE, c.x + dx));
          newY = Math.max(0, Math.min(c.y + c.height - MIN_CROP_SIZE, c.y + dy));
          newW = c.x + c.width - newX;
          newH = c.y + c.height - newY;
          // 智能吸附
          newX = snapToEdge(newX);
          newY = snapToEdge(newY);
          newW = c.x + c.width - newX;
          newH = c.y + c.height - newY;
          break;
        case "ne":
          newY = Math.max(0, Math.min(c.y + c.height - MIN_CROP_SIZE, c.y + dy));
          newW = Math.max(MIN_CROP_SIZE, Math.min(displayWidth.value - c.x, c.width + dx));
          newH = c.y + c.height - newY;
          // 智能吸附
          newY = snapToEdge(newY);
          newH = c.y + c.height - newY;
          newW = snapToEdge(c.x + newW) - c.x;
          break;
        case "sw":
          newX = Math.max(0, Math.min(c.x + c.width - MIN_CROP_SIZE, c.x + dx));
          newW = c.x + c.width - newX;
          newH = Math.max(MIN_CROP_SIZE, Math.min(displayHeight.value - c.y, c.height + dy));
          // 智能吸附
          newX = snapToEdge(newX);
          newW = c.x + c.width - newX;
          newH = snapToEdge(c.y + newH) - c.y;
          break;
        case "se":
          newW = Math.max(MIN_CROP_SIZE, Math.min(displayWidth.value - c.x, c.width + dx));
          newH = Math.max(MIN_CROP_SIZE, Math.min(displayHeight.value - c.y, c.height + dy));
          // 智能吸附
          newW = snapToEdge(c.x + newW) - c.x;
          newH = snapToEdge(c.y + newH) - c.y;
          break;
        case "n":
          newY = Math.max(0, Math.min(c.y + c.height - MIN_CROP_SIZE, c.y + dy));
          newH = c.y + c.height - newY;
          // 智能吸附
          newY = snapToEdge(newY);
          newH = c.y + c.height - newY;
          break;
        case "s":
          newH = Math.max(MIN_CROP_SIZE, Math.min(displayHeight.value - c.y, c.height + dy));
          // 智能吸附
          newH = snapToEdge(c.y + newH) - c.y;
          break;
        case "w":
          newX = Math.max(0, Math.min(c.x + c.width - MIN_CROP_SIZE, c.x + dx));
          newW = c.x + c.width - newX;
          // 智能吸附
          newX = snapToEdge(newX);
          newW = c.x + c.width - newX;
          break;
        case "e":
          newW = Math.max(MIN_CROP_SIZE, Math.min(displayWidth.value - c.x, c.width + dx));
          // 智能吸附
          newW = snapToEdge(c.x + newW) - c.x;
          break;
      }
      gridCrop.value = { x: newX, y: newY, width: newW, height: newH };
    }
  }
  render();
  e.preventDefault();
}

function onPointerUp() {
  dragMode.value = null;
  gridDragMode.value = null;
}

function onWheel(e: WheelEvent) {
  // 两个模式都支持缩放
  e.preventDefault();
  const canvas = canvasRef.value!;
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
  const newScale = Math.max(0.1, Math.min(10, canvasScale.value * zoomFactor));
  const scaleRatio = newScale / canvasScale.value;
  canvasTranslateX.value = mouseX - (mouseX - canvasTranslateX.value) * scaleRatio;
  canvasTranslateY.value = mouseY - (mouseY - canvasTranslateY.value) * scaleRatio;
  canvasScale.value = newScale;
  render();
}

function handleRotate() {
  rotation.value = ((rotation.value + 90) % 360) as 0 | 90 | 180 | 270;
  fitImageToContainer();
  initCrop();
  initLegendCrop();
  initGridCrop();
  render();
}

function handleFlipHorizontal() {
  flipHorizontal.value = !flipHorizontal.value;
  render();
}

function handleFlipVertical() {
  flipVertical.value = !flipVertical.value;
  render();
}

function handleReset() {
  rotation.value = 0;
  flipHorizontal.value = false;
  flipVertical.value = false;
  fitImageToContainer();
  initCrop();
  initLegendCrop();
  initGridCrop();
  render();
}

function handleZoomIn() {
  const newScale = Math.min(10, canvasScale.value * 1.2);
  const canvas = canvasRef.value!;
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const scaleRatio = newScale / canvasScale.value;
  canvasTranslateX.value = centerX - (centerX - canvasTranslateX.value) * scaleRatio;
  canvasTranslateY.value = centerY - (centerY - canvasTranslateY.value) * scaleRatio;
  canvasScale.value = newScale;
  render();
}

function handleZoomOut() {
  const newScale = Math.max(0.1, canvasScale.value / 1.2);
  const canvas = canvasRef.value!;
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const scaleRatio = newScale / canvasScale.value;
  canvasTranslateX.value = centerX - (centerX - canvasTranslateX.value) * scaleRatio;
  canvasTranslateY.value = centerY - (centerY - canvasTranslateY.value) * scaleRatio;
  canvasScale.value = newScale;
  render();
}

function handleGridReset() {
  initGridCrop();
  handleResetView();
}

// Get step index for comparison
const stepOrder: OcrStep[] = ['legend-crop', 'ocr-verify', 'pattern-crop', 'diff-view']
function getStepIndex(step: OcrStep): number {
  return stepOrder.indexOf(step)
}

function handleResetView() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  // 将视图重置到正中央
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  canvasTranslateX.value = centerX - (displayWidth.value / 2);
  canvasTranslateY.value = centerY - (displayHeight.value / 2);
  canvasScale.value = 1;
  render();
}

function handleConfirm() {
  if (!img.value) return;
  const imgRect = displayToImage(crop.value);
  const { width: effW, height: effH } = getEffectiveDimensions();
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = effW;
  tempCanvas.height = effH;
  const tempCtx = tempCanvas.getContext("2d")!;
  tempCtx.save();
  applyTransforms(tempCtx, effW, effH);
  tempCtx.drawImage(img.value, 0, 0, effW, effH);
  tempCtx.restore();

  const resultCanvas = document.createElement("canvas");
  resultCanvas.width = imgRect.width;
  resultCanvas.height = imgRect.height;
  const resultCtx = resultCanvas.getContext("2d")!;
  resultCtx.drawImage(tempCanvas, imgRect.x, imgRect.y, imgRect.width, imgRect.height, 0, 0, imgRect.width, imgRect.height);
  emit("confirm", resultCanvas);
}

function handleLegendConfirm() {
  if (!img.value) return;
  console.log('[OCR] 图例裁剪确认，legendCrop:', legendCrop.value);
  const imgRect = displayToImage(legendCrop.value);
  console.log('[OCR] 转换后的图像坐标:', imgRect);
  
  // Validate crop area has valid dimensions
  if (imgRect.width <= 0 || imgRect.height <= 0) {
    console.warn('[OCR] 图例裁剪区域无效，宽度或高度为0');
    return;
  }
  
  const { width: effW, height: effH } = getEffectiveDimensions();
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = effW;
  tempCanvas.height = effH;
  const tempCtx = tempCanvas.getContext('2d')!;
  tempCtx.save();
  applyTransforms(tempCtx, effW, effH);
  tempCtx.drawImage(img.value, 0, 0, effW, effH);
  tempCtx.restore();

  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = imgRect.width;
  resultCanvas.height = imgRect.height;
  const resultCtx = resultCanvas.getContext('2d')!;
  resultCtx.drawImage(tempCanvas, imgRect.x, imgRect.y, imgRect.width, imgRect.height, 0, 0, imgRect.width, imgRect.height);
  legendCanvas.value = resultCanvas;
  console.log('[OCR] 图例裁剪完成，画布尺寸:', resultCanvas.width, 'x', resultCanvas.height);
  
  // Show overlay and run OCR immediately
  showProcessingOverlay.value = true;
  processingMessage.value = '正在识别图例...';
  processingProgress.value = { phase: 'loading', percent: 0 };
  
  nextTick(async () => {
    try {
      await parseLegendWithOcrWithOverlay();
      console.log('[OCR] 图例识别完成')
    } catch (err) {
      console.error('[OCR] 图例识别失败:', err)
      processingMessage.value = '识别失败，请重试'
    } finally {
      setTimeout(() => {
        showProcessingOverlay.value = false;
        ocrStep.value = 'ocr-verify';
        isLegendCrop.value = false;
        // 重置canvas变换，居中显示
        canvasScale.value = 1;
        canvasTranslateX.value = 0;
        canvasTranslateY.value = 0;
        nextTick(() => render());
      }, 500)
    }
  });
}

function handlePatternConfirm() {
  if (!img.value) return;
  const imgRect = displayToImage(gridCrop.value);
  
  // Validate crop area has valid dimensions
  if (imgRect.width <= 0 || imgRect.height <= 0) {
    console.warn('[OCR] 图案裁剪区域无效，宽度或高度为0');
    return;
  }
  
  const { width: effW, height: effH } = getEffectiveDimensions();
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = effW;
  tempCanvas.height = effH;
  const tempCtx = tempCanvas.getContext('2d')!;
  tempCtx.save();
  applyTransforms(tempCtx, effW, effH);
  tempCtx.drawImage(img.value, 0, 0, effW, effH);
  tempCtx.restore();

  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = imgRect.width;
  resultCanvas.height = imgRect.height;
  const resultCtx = resultCanvas.getContext('2d')!;
  resultCtx.drawImage(tempCanvas, imgRect.x, imgRect.y, imgRect.width, imgRect.height, 0, 0, imgRect.width, imgRect.height);
  patternCanvas.value = resultCanvas;
  
  // Show fullscreen overlay and start color extraction only (OCR already done)
  showProcessingOverlay.value = true;
  processingMessage.value = '正在提取图纸颜色...';
  processingProgress.value = { phase: 'extracting', percent: 0 };
  
  console.log('[OCR] 图纸裁剪完成，开始颜色提取')
  console.log(`[OCR] 图案画布: ${patternCanvas.value.width}x${patternCanvas.value.height}, 图纸画布: ${legendCanvas.value!.width}x${legendCanvas.value!.height}`)
  
  // Start color extraction with overlay progress
  nextTick(async () => {
    try {
      // Step 1: 网格检测（基于图纸像素边缘检测）
      runGridDetection()

      // Step 2: 图纸 OCR 逐格识别（使用检测到的网格）
      const canvas = patternCanvas.value!
      const cols = autoGridCols.value || gridCols.value
      const rows = autoGridRows.value || gridRows.value
      ocrCellResults.value = []
      try {
        // 构建图例色号列表作为OCR字符白名单
        const legendCodes = Array.from(legendData.value.keys())
        ocrCellResults.value = await ocrRecognition.recognizeGrid(canvas, cols, rows, (progress) => {
          let percent: number | undefined
          if (progress.percent != null) percent = progress.percent
          processingMessage.value = `正在识别图纸格子色号... ${percent != null ? percent + '%' : ''}`
          processingProgress.value = { phase: progress.phase, percent }
        }, legendCodes)
        console.log(`[OCR] 格子OCR完成，识别到 ${ocrCellResults.value.length} 个格子有文字（白名单过滤已启用，${legendCodes.length} 个色号）`)
      } catch (err) {
        console.error('[OCR] 格子OCR识别失败:', err)
        ocrCellResults.value = []
      }

      // Step 2.5: 用 OCR 格子坐标验证网格（仅日志，不自动修正以避免坐标不一致）
      if (ocrCellResults.value.length >= 4) {
        const cells = ocrCellResults.value
        const ocrRows = Math.max(...cells.map(c => c.row)) + 1
        const ocrCols = Math.max(...cells.map(c => c.col)) + 1
        const edgeRows = autoGridRows.value
        const edgeCols = autoGridCols.value
        if (ocrRows !== edgeRows || ocrCols !== edgeCols) {
          console.log(`[OCR] ⚠ OCR坐标验证: ${ocrCols}x${ocrRows}，与边缘检测 ${edgeCols}x${edgeRows} 不一致，以边缘检测为准`)
        } else {
          console.log(`[OCR] ✓ OCR坐标与边缘检测一致: ${ocrCols}x${ocrRows}`)
        }
      }

      // Step 3: 颜色提取
      await extractPatternColorsWithOverlay();
      console.log('[OCR] 颜色提取完成')
    } catch (err) {
      console.error('[OCR] 提取失败:', err)
      processingMessage.value = '提取失败，请重试'
    } finally {
      setTimeout(() => {
        showProcessingOverlay.value = false;
        ocrStep.value = 'diff-view';
      }, 500)
    }
  });
}

/** Local phase label helper (mirrors composable's internal mapping) */
function getOcrPhaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    'loading': '加载模型中',
    'downloading': '下载模型中',
    'initializing': '初始化中',
    'ready': '准备就绪',
    'recognizing': '识别中',
    'loading_dictionary': '加载字典中',
    'loading_detection_model': '加载检测模型中',
    'loading_recognition_model': '加载识别模型中',
    'warmup': '预热模型中',
  }
  return labels[phase] || phase
}

async function parseLegendWithOcr() {
  if (!legendCanvas.value) return

  // Ensure OCR is initialized
  if (!ocrRecognition.isReady()) {
    await ocrRecognition.preload((progress) => {
      ocrProgress.value = {
        phase: progress.phase,
        phaseLabel: getOcrPhaseLabel(progress.phase),
        percent: progress.percent,
      }
    })
  }

  const ocr = ocrRecognition.getOrCreateInstance()

  // Run OCR on legend canvas to get raw text lines with bounding boxes
  const result = await ocr.ocr(legendCanvas.value, {
    onProgress: (progress) => {
      let percent: number | undefined
      if (progress.loaded != null && progress.totalBytes != null && progress.totalBytes > 0) {
        percent = Math.round((progress.loaded / progress.totalBytes) * 100)
      }
      ocrProgress.value = {
        phase: progress.phase,
        phaseLabel: getOcrPhaseLabel(progress.phase),
        percent,
      }
    },
  })

  console.log('[OCR:legacy] 图例识别完成，识别到', result.lines.length, '行文本')
  console.log(`[OCR:legacy] 原始识别内容:\n${result.lines.map((l: { text: string, score: number }) => `  "${l.text}" (${(l.score * 100).toFixed(0)}%)`).join('\n')}`)

  // Use core parsing function
  legendData.value = _parseLegendCore(result.lines, legendCanvas.value.height)
  ocrProgress.value = null
}

/**
 * Normalize OCR text to handle common OCR errors (e.g., missing leading zeros).
 * Returns an array of candidate strings to try matching against brand codes.
 * e.g., "H7" → ["H7", "H07"]
 */
function normalizeOcrText(text: string): string[] {
  const upper = text.toUpperCase()
  const candidates: string[] = [upper]

  // Pattern: single letter + single digit → pad to 2 digits (OCR often drops leading zero)
  // e.g., "H7" → "H07", "D1" → "D01", "A8" → "A08"
  const m = /^([A-Z])(\d)$/.exec(upper)
  if (m) {
    candidates.push(m[1] + '0' + m[2])
  }

  // Pattern: single letter + 2 digits already padded → also try unpadded
  // e.g., "H07" → also try "H7"
  const m2 = /^([A-Z])0(\d)$/.exec(upper)
  if (m2) {
    candidates.push(m2[1] + m2[2])
  }

  return candidates
}

/**
 * Resolve OCR text to the actual brand code.
 * e.g., OCR reads "H7" → brand has "H07" → returns "H07"
 */
function resolveCodeFromOcr(ocrText: string, brandCodes: Set<string>): string {
  const candidates = normalizeOcrText(ocrText)
  for (const cand of candidates) {
    if (brandCodes.has(cand)) return cand
  }
  return ocrText.toUpperCase()
}

// Core legend parsing logic shared by both parseLegendWithOcr and parseLegendWithOcrWithOverlay
function _parseLegendCore(
  ocrLines: readonly { text: string, box: { points: readonly {x:number,y:number}[] } }[],
  canvasHeight: number
): Map<string, LegendEntry> {
  // Step 1: Brand auto-detection (with OCR text normalization)
  const brandIndex = buildBrandCodeIndex()
  const brandScores = new Map<string, number>()
  for (const brand of brandIndex.keys()) {
    brandScores.set(brand, 0)
  }

  // Numeric-only brands: their codes are pure numbers that collide with quantity values
  const NUMERIC_BRANDS = new Set(['盼盼', '咪小窝'])

  const brandMatches = new Map<string, string[]>() // brand → matched OCR texts, for debug log

  for (const line of ocrLines) {
    const text = line.text.trim().toUpperCase()
    const candidates = normalizeOcrText(text)

    for (const [brand, codes] of brandIndex) {
      let matched = false
      for (const cand of candidates) {
        if (codes.has(cand)) {
          matched = true
          break
        }
      }
      if (matched) {
        // Numeric-only brands get reduced weight (0.25x) because their codes
        // are pure numbers that often collide with quantity values in legends
        const weight = NUMERIC_BRANDS.has(brand) ? 0.25 : 1.0
        brandScores.set(brand, (brandScores.get(brand) || 0) + weight)
        // Record match for debug
        if (!brandMatches.has(brand)) brandMatches.set(brand, [])
        brandMatches.get(brand)!.push(text)
      }
    }
  }

  // Log per-brand matched texts
  for (const [brand, texts] of brandMatches) {
    console.log(`[OCR] Brand "${brand}" matched texts: ${texts.join(', ')}`)
  }

  // Select brand with highest match count
  let detectedBrand = ''
  let maxScore = 0
  for (const [brand, score] of brandScores) {
    if (score > maxScore) {
      maxScore = score
      detectedBrand = brand
    }
  }

  console.log(`[OCR] Brand scores: ${Array.from(brandScores.entries()).map(([b,s]) => `${b}=${s.toFixed(1)}`).join(', ')}`)
  console.log(`[OCR] Brand detection: ${detectedBrand} (${maxScore} codes matched)`)

  if (!detectedBrand || maxScore === 0) {
    console.warn('[OCR] No brand codes detected, legend parsing failed')
    detectedLegendBrand.value = ''
    return new Map()
  }

  detectedLegendBrand.value = detectedBrand
  const brandCodes = brandIndex.get(detectedBrand)!

  // Step 2: Build OcrToken array
  const tokens: OcrToken[] = []
  const discarded: string[] = []
  const classifiedCodes: string[] = []
  const classifiedNumbers: string[] = []

  for (const line of ocrLines) {
    const text = line.text.trim()
    const pts = line.box.points

    const centerX = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4
    const centerY = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4
    const bbox = {
      x: pts[0].x,
      y: pts[0].y,
      width: pts[1].x - pts[0].x,
      height: pts[2].y - pts[0].y,
    }

    const resolvedCode = resolveCodeFromOcr(text, brandCodes)
    if (brandCodes.has(resolvedCode)) {
      // Matches known color code — store the RESOLVED code (not raw OCR text)
      // so downstream lookups like getColorForCode() work correctly
      tokens.push({ text: resolvedCode, bbox, centerX, centerY, isCode: true })
      classifiedCodes.push(resolvedCode)
    } else {
      // 去掉各种括号后判断是否为数字
      const stripped = text.replace(/^[（(]\s*/, '').replace(/\s*[)）]$/, '').trim()
      if (/^\d+$/.test(stripped)) {
        // 数字（可能带括号）→ 作为数量
        tokens.push({ text: stripped, bbox, centerX, centerY, isCode: false })
        classifiedNumbers.push(stripped)
      } else {
        // Not a code or number → discard
        discarded.push(text)
      }
    }
  }

  console.log(`[OCR] Token分类 — 色号(${classifiedCodes.length}): ${classifiedCodes.join(', ')}`)
  console.log(`[OCR] Token分类 — 数量(${classifiedNumbers.length}): ${classifiedNumbers.join(', ')}`)
  if (discarded.length > 0) {
    console.log(`[OCR] Token分类 — 丢弃(${discarded.length}): ${discarded.join(', ')}`)
  }

  // Step 3: Spatial pairing
  const codeTokens = tokens.filter(t => t.isCode)

  if (codeTokens.length === 0) {
    console.warn('[OCR] No valid color codes recognized')
    return new Map()
  }

  const paired = pairCodeQuantityByProximity(tokens)

  // Step 4: Build legendData
  const entries = new Map<string, LegendEntry>()
  for (const [code, pair] of paired) {
    entries.set(code, {
      code: pair.code,
      expectedCount: pair.count,
      rawText: `${pair.code} ${pair.count}`,
      bbox: pair.codeBbox,
    })
  }

  // Handle unpaired codes (no quantity found → expectedCount = 0)
  for (const ct of codeTokens) {
    const code = ct.text.trim().toUpperCase()
    if (!entries.has(code)) {
      entries.set(code, {
        code,
        expectedCount: 0,
        rawText: ct.text,
        bbox: ct.bbox,
      })
      console.log(`[OCR] Code "${code}" has no paired quantity, set to 0`)
    }
  }

  console.log(`[OCR] Legend parsing complete: ${entries.size} colors, ${paired.size} paired`)
  return entries
}

// OCR parsing with fullscreen overlay progress
async function parseLegendWithOcrWithOverlay() {
  if (!legendCanvas.value) return
   
  // Validate canvas has valid dimensions
  if (legendCanvas.value.width <= 0 || legendCanvas.value.height <= 0) {
    console.error('[OCR] 图例画布尺寸无效:', legendCanvas.value.width, 'x', legendCanvas.value.height);
    processingMessage.value = '错误：图例裁剪区域无效，请重新裁剪';
    showProcessingOverlay.value = false;
    return;
  }

  console.log('[OCR] 开始图例识别流程')
  processingMessage.value = '正在加载OCR模型...'
  processingProgress.value = { phase: 'loading', percent: 0 }

  // Ensure OCR is initialized
  if (!ocrRecognition.isReady()) {
    console.log('[OCR] 模型未加载，开始预加载...')
    await ocrRecognition.preload((progress) => {
      const phaseLabel = getOcrPhaseLabel(progress.phase)
      console.log(`[OCR] 预加载进度: ${phaseLabel} ${progress.percent ?? ''}%`)
      processingMessage.value = `${phaseLabel}...`
      processingProgress.value = { phase: progress.phase, percent: progress.percent }
    })
    console.log('[OCR] 模型预加载完成')
  } else {
    console.log('[OCR] 模型已加载，跳过预加载')
  }

  console.log('[OCR] 开始识别图例...')
  processingMessage.value = '正在识别图例...'
  processingProgress.value = { phase: 'recognizing', percent: 50 }

  const ocr = ocrRecognition.getOrCreateInstance()

  // Run OCR on legend canvas
  console.log('[OCR] 调用 ocr.ocr()，画布尺寸:', legendCanvas.value.width, 'x', legendCanvas.value.height)
  const result = await ocr.ocr(legendCanvas.value, {
    onProgress: (progress) => {
      let percent: number | undefined
      if (progress.loaded != null && progress.totalBytes != null && progress.totalBytes > 0) {
        percent = Math.min(100, Math.max(0, Math.round((progress.loaded / progress.totalBytes) * 100)))
      } else if (progress.current != null && progress.total != null && progress.total > 0) {
        percent = Math.min(100, Math.max(0, Math.round((progress.current / progress.total) * 100)))
      }
      processingMessage.value = `正在识别图例... ${percent != null ? percent + '%' : ''}`
      processingProgress.value = { phase: progress.phase, percent }
    },
  })

  console.log('[OCR] 图例识别完成，识别到', result.lines.length, '行文本')
  console.log(`[OCR] 原始识别内容:\n${result.lines.map((l: { text: string, score: number }) => `  "${l.text}" (置信度:${(l.score * 100).toFixed(0)}%)`).join('\n')}`)

  // Use core parsing function
  legendData.value = _parseLegendCore(result.lines, legendCanvas.value.height)
}

/**
 * Run grid detection using current pattern canvas.
 * Must be called AFTER pattern crop is done (patternCanvas available).
 */
function runGridDetection() {
  let edgeResult = { rows: 0, cols: 0, confidence: 0, gridLineThickness: 0 }
  if (patternCanvas.value) {
    const pCtx = patternCanvas.value.getContext('2d')
    if (pCtx) {
      const edgeImageData = pCtx.getImageData(0, 0, patternCanvas.value.width, patternCanvas.value.height)
      console.log(`[OCR] 开始边缘检测，画布尺寸: ${patternCanvas.value.width} x ${patternCanvas.value.height}`)
      edgeResult = inferGridFromEdges(edgeImageData)
      console.log(`[OCR] 边缘检测结果: ${edgeResult.cols} x ${edgeResult.rows} (confidence: ${edgeResult.confidence}, 线厚: ${edgeResult.gridLineThickness})`)
    }
  }

  const combined = detectGridDimensions(
    { rows: 0, cols: 0 },
    { rows: 0, cols: 0, confidence: 0 },
    edgeResult
  )
  detectionConfidence.value = combined

  if (combined.rows > 0 && combined.cols > 0) {
    autoGridRows.value = combined.rows
    autoGridCols.value = combined.cols
    console.log(`[OCR] 最终网格: ${combined.cols}x${combined.rows} (${combined.method}, ${combined.confidence})`)
    console.log(`[OCR] 网格线厚度: ${combined.gridLineThickness}`)
  } else {
    console.log(`[OCR] 网格检测失败，使用手动输入`)
  }
}


// 从 colorCounts 构建差异数据（extractPatternColorsWithOverlay 共用）
function buildDiffFromColorCounts(
  colorCounts: Map<string, { count: number, cells: Array<{ row: number, col: number }> }>,
  totalCells: number,
) {
  const diff: DiffEntry[] = []

  for (const [code, entry] of legendData.value) {
    const actual = colorCounts.get(code)
    diff.push({
      code, expectedCount: entry.expectedCount,
      actualCount: actual?.count || 0,
      diff: (actual?.count || 0) - entry.expectedCount,
      cells: actual?.cells || []
    })
  }

  for (const [code, data] of colorCounts) {
    if (!legendData.value.has(code) && code !== TRANSPARENT_KEY) {
      diff.push({ code, expectedCount: 0, actualCount: data.count, diff: data.count, cells: data.cells })
    }
  }

  // 空格子差异
  const expectedLegendTotal = Array.from(legendData.value.values()).reduce((sum, entry) => sum + entry.expectedCount, 0)
  const expectedEmptyCount = Math.max(0, totalCells - expectedLegendTotal)
  const actualEmptyData = colorCounts.get(TRANSPARENT_KEY)
  if (expectedEmptyCount > 0 || actualEmptyData) {
    diff.push({
      code: TRANSPARENT_KEY,
      expectedCount: expectedEmptyCount,
      actualCount: actualEmptyData?.count || 0,
      diff: (actualEmptyData?.count || 0) - expectedEmptyCount,
      cells: actualEmptyData?.cells || []
    })
  }

  diff.sort((a, b) => {
    const aM = Math.abs(a.diff), bM = Math.abs(b.diff)
    if (aM > 0 && bM === 0) return -1
    if (aM === 0 && bM > 0) return 1
    return bM - aM
  })
  diffData.value = diff
}


// Pattern color extraction with overlay progress
// 核心策略：对图纸每个格子做 OCR 识别，有识别结果→匹配色号，无结果→空格子
async function extractPatternColorsWithOverlay() {
  if (!patternCanvas.value) return
  
  // Validate canvas has valid dimensions
  if (patternCanvas.value.width <= 0 || patternCanvas.value.height <= 0) {
    console.error('[OCR] 图案画布尺寸无效:', patternCanvas.value.width, 'x', patternCanvas.value.height);
    processingMessage.value = '错误：图案裁剪区域无效，请重新裁剪';
    showProcessingOverlay.value = false;
    return;
  }

  console.log('[OCR] 开始图纸颜色提取（OCR 格子识别模式）')
  processingMessage.value = '正在识别图纸格子色号...'
  processingProgress.value = { phase: 'recognizing', percent: 0 }

  const canvas = patternCanvas.value
  const ctx = canvas.getContext('2d')!
  const cols = autoGridCols.value || gridCols.value
  const rows = autoGridRows.value || gridRows.value
  const thickness = detectionConfidence.value.gridLineThickness ?? 0
  const cellSize = calcCellSize(canvas.width, canvas.height, cols, rows, thickness)
  const borderTrim = Math.max(1, cellSize * 0.1)

  console.log(`[OCR] 图纸尺寸: ${canvas.width} x ${canvas.height}, 网格: ${cols} x ${rows}, 格子: ${cellSize.toFixed(1)}, 网格线: ${thickness}`)

  // ========== Step 1: 使用 handlePatternConfirm 中预计算的 OCR 结果 ==========
  const ocrResults = ocrCellResults.value
  console.log(`[OCR] 使用预计算OCR结果，有效格子数: ${ocrResults.length}`)

  // 构建 OCR 结果映射：(row,col) → 识别文本
  const ocrCellMap = new Map<string, string>()
  for (const cell of ocrResults) {
    const key = `${cell.row},${cell.col}`
    // 同一格子取文本最长的结果（更可能是完整色号）
    const existing = ocrCellMap.get(key)
    if (!existing || cell.text.length > existing.length) {
      ocrCellMap.set(key, cell.text.trim().toUpperCase())
    }
  }
  console.log(`[OCR] 有效OCR格子数: ${ocrCellMap.size}`)

  // 品牌色号集合（用于 OCR 文本归一化匹配）
  const brandIndex = buildBrandCodeIndex()
  const brandCodes = brandIndex.get(detectedLegendBrand.value) ?? new Set<string>()

  // ========== Step 3: 遍历每个格子，按OCR结果归类 ==========
  const totalCells = rows * cols
  let processedCells = 0
  let ocrMatchedCount = 0
  let emptyCount = 0

  const cells: PatternCell[] = []
  const colorCounts = new Map<string, { count: number, cells: Array<{ row: number, col: number }> }>()

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // 纯按 cols/rows 均分画布,不计线厚:每格步长 = cellSize,起点 = col/row × cellSize
      const x = Math.round(col * cellSize)
      const y = Math.round(row * cellSize)
      const w = Math.round(cellSize)
      const h = Math.round(cellSize)

      const imageData = ctx.getImageData(x, y, w, h)
      const dominantColor = getDominantColorByArea(imageData, borderTrim, { step: gridStep.value })

      const rgbMatch = dominantColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
      
      const r = rgbMatch ? parseInt(rgbMatch[1], 10) : 0
      const gVal = rgbMatch ? parseInt(rgbMatch[2], 10) : 0
      const b = rgbMatch ? parseInt(rgbMatch[3], 10) : 0

      const ocrText = ocrCellMap.get(`${row},${col}`)
      
      let bestCode: string
      let bestHex: string

      if (ocrText) {
        // 有 OCR 识别结果 → 尝试匹配图例色号
        const resolvedCode = resolveCodeFromOcr(ocrText, brandCodes)
        if (legendData.value.has(resolvedCode)) {
          // OCR 文本匹配到图例中的色号
          bestCode = resolvedCode
          bestHex = getColorForCode(resolvedCode, detectedLegendBrand.value)
          ocrMatchedCount++
        } else {
          // OCR 有结果但不匹配图例中的色号 → 归为空格子
          bestCode = TRANSPARENT_KEY
          bestHex = ''
          emptyCount++
        }
      } else {
        // 无 OCR 识别结果 → 直接归为空格子
        bestCode = TRANSPARENT_KEY
        bestHex = ''
        emptyCount++
      }

      cells.push({ row, col, rgb: dominantColor, hex: bestHex, code: bestCode })

      const existing = colorCounts.get(bestCode)
      if (existing) {
        existing.count++
        existing.cells.push({ row, col })
      } else {
        colorCounts.set(bestCode, { count: 1, cells: [{ row, col }] })
      }

      processedCells++
      if (processedCells % 50 === 0 || processedCells === totalCells) {
        const percent = Math.round((processedCells / totalCells) * 100)
        console.log(`[OCR] 图纸颜色提取进度: ${processedCells}/${totalCells} (${percent}%)`)
        processingMessage.value = `正在提取图纸颜色... ${percent}%`
        processingProgress.value = { phase: 'extracting', percent }
      }
    }
  }

  console.log(`[OCR] 图纸颜色提取完成: 共${cells.length}格, OCR匹配=${ocrMatchedCount}, 空格=${emptyCount}`)
  console.log(`[OCR:extract] 各颜色实际数量:\n${Array.from(colorCounts.entries()).map(([code, data]) => `  ${code}: ${data.count}个`).join('\n')}`)
  patternColorData.value = cells

  // ========== Step 4: 构建差异数据（共用函数） ==========
  buildDiffFromColorCounts(colorCounts, totalCells)
  console.log('[OCR] 差异对比完成，共', diffData.value.length, '个颜色')
  for (const entry of diffData.value) {
    const status = entry.diff === 0 ? '✓一致' : (entry.diff > 0 ? `↑多${entry.diff}` : `↓少${Math.abs(entry.diff)}`)
    console.log(`[OCR:diff] ${entry.code} 期望=${entry.expectedCount} 实际=${entry.actualCount} ${status}`)
  }
  processingProgress.value = { phase: 'complete', percent: 100 }
}

function handleBackToLegend() {
  ocrStep.value = 'legend-crop';
  isLegendCrop.value = true;
}

function handleBackToPattern() {
  ocrStep.value = 'pattern-crop';
}

function getColorHex(code: string): string {
  // 空格子返回特殊颜色
  if (code === TRANSPARENT_KEY) return '#fafafa'
  // 从颜色系统映射中查找 hex（避免从 patternColorData 循环引用）
  try {
    const mapping = colorSystemMappingJson as Record<string, Record<string, string>>
    const brand = detectedLegendBrand.value
    // 优先使用检测到的品牌精确匹配,避免跨品牌色号碰撞(如 MARD:H07=#000000 vs COCO:H07=#01ACEB)
    if (brand) {
      for (const [hex, systems] of Object.entries(mapping)) {
        if (systems[brand] === code) {
          return hex.startsWith('#') ? hex : `#${hex}`
        }
      }
    }
    // 回退:全品牌搜索
    for (const [hex, systems] of Object.entries(mapping)) {
      if (Object.values(systems).some(v => v === code)) {
        return hex.startsWith('#') ? hex : `#${hex}`
      }
    }
    // 尝试标准化匹配（OCR 可能丢掉前导零）
    const candidates = normalizeOcrText(code)
    for (const cand of candidates) {
      if (cand === code.toUpperCase()) continue
      // 标准化后也优先品牌匹配
      if (brand) {
        for (const [hex, systems] of Object.entries(mapping)) {
          if (systems[brand] === cand) {
            return hex.startsWith('#') ? hex : `#${hex}`
          }
        }
      }
      for (const [hex, systems] of Object.entries(mapping)) {
        if (Object.values(systems).some(v => v === cand)) {
          return hex.startsWith('#') ? hex : `#${hex}`
        }
      }
    }
  } catch (e) {
    console.warn('[getColorHex] lookup failed:', e)
  }
  // 回退：从 patternColorData 查找
  const cell = patternColorData.value.find(c => c.code === code)
  return cell?.hex || '#e5e7eb'
}

// 判断颜色是否为浅色（用于决定文字颜色）
function isLightColor(hex: string): boolean {
  const c = hex.replace('#', '')
  const r = parseInt(c.substring(0, 2), 16)
  const g = parseInt(c.substring(2, 4), 16)
  const b = parseInt(c.substring(4, 6), 16)
  // 使用相对亮度公式
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.5
}

function getDiffEntry(code: string): DiffEntry | undefined {
  return diffData.value.find(d => d.code === code)
}

function handleDiffColorSelect(code: string) {
  if (selectedDiffColor.value === code) {
    // 点击已选中的颜色，取消选中
    selectedDiffColor.value = null
    colorSlices.value = []
    selectedSlice.value = null
    selectedSlices.value = []
  } else {
    selectedDiffColor.value = code
    extractColorSlices(code)
  }
}

function extractColorSlices(code: string) {
  if (!patternCanvas.value) return

  const canvas = patternCanvas.value
  const ctx = canvas.getContext('2d')!
  const cols = autoGridCols.value || gridCols.value
  const rows = autoGridRows.value || gridRows.value
  const thickness = detectionConfidence.value.gridLineThickness ?? 0
  const cellSize = calcCellSize(canvas.width, canvas.height, cols, rows, thickness)

  const slices: ColorSlice[] = []

  // Find all cells with this code
  const entry = diffData.value.find(d => d.code === code)
  if (!entry) return

  for (const cell of entry.cells) {
    // 纯按 cols/rows 均分画布,不计线厚
    const x = Math.round(cell.col * cellSize)
    const y = Math.round(cell.row * cellSize)
    const w = Math.round(cellSize)
    const h = Math.round(cellSize)
    const imageData = ctx.getImageData(x, y, w, h)
    slices.push({ row: cell.row, col: cell.col, imageData })
  }

  colorSlices.value = slices
  selectedSlice.value = null
}

function handleSliceClick(row: number, col: number) {
  const idx = selectedSlices.value.findIndex(s => s.row === row && s.col === col)
  if (idx >= 0) {
    // 已选中，取消选中
    selectedSlices.value.splice(idx, 1)
  } else {
    // 未选中，添加到选中列表
    selectedSlices.value.push({ row, col })
  }
  // 同步单选（保持兼容）
  selectedSlice.value = selectedSlices.value.length > 0 ? selectedSlices.value[selectedSlices.value.length - 1] : null
}

function isSliceSelected(row: number, col: number): boolean {
  return selectedSlices.value.some(s => s.row === row && s.col === col)
}

function handleBackToDiffList() {
  selectedDiffColor.value = null
  colorSlices.value = []
  selectedSlice.value = null
  selectedSlices.value = []
}

// Available color codes from pattern data for the color picker
const availableColorCodes = computed(() => {
  const codes = new Set(patternColorData.value.map(c => c.code))
  return Array.from(codes).sort()
})

function changeSliceColor(row: number, col: number, newCode: string) {
  // Update patternColorData for this cell
  const cell = patternColorData.value.find(c => c.row === row && c.col === col)
  if (!cell) return

  const newHex = getColorHex(newCode)
  cell.code = newCode
  cell.hex = newHex

  // Force reactivity
  patternColorData.value = [...patternColorData.value]

  // Re-extract slices for the current color
  if (selectedDiffColor.value) {
    extractColorSlices(selectedDiffColor.value)
  }

  // Rebuild diff data
  extractPatternColorsForDiff()

  // Clear slice selection
  selectedSlice.value = null
  selectedSlices.value = []
}

// 批量修改选中切片的颜色
function changeSelectedSlicesColor(newCode: string) {
  if (selectedSlices.value.length === 0) return
  
  const newHex = getColorHex(newCode)
  
  for (const slice of selectedSlices.value) {
    const cell = patternColorData.value.find(c => c.row === slice.row && c.col === slice.col)
    if (cell) {
      cell.code = newCode
      cell.hex = newHex
    }
  }

  // Force reactivity
  patternColorData.value = [...patternColorData.value]

  // Re-extract slices for the current color
  if (selectedDiffColor.value) {
    extractColorSlices(selectedDiffColor.value)
  }

  // Rebuild diff data
  extractPatternColorsForDiff()

  // Clear slice selection
  selectedSlice.value = null
  selectedSlices.value = []
}

function extractPatternColorsForDiff() {
  if (!patternCanvas.value) return

  const colorCounts = new Map<string, { count: number, cells: Array<{ row: number, col: number }> }>()

  for (const cell of patternColorData.value) {
    const existing = colorCounts.get(cell.code)
    if (existing) {
      existing.count++
      existing.cells.push({ row: cell.row, col: cell.col })
    } else {
      colorCounts.set(cell.code, { count: 1, cells: [{ row: cell.row, col: cell.col }] })
    }
  }

  const diff: DiffEntry[] = []

  for (const [code, entry] of legendData.value) {
    const actual = colorCounts.get(code)
    diff.push({
      code,
      expectedCount: entry.expectedCount,
      actualCount: actual?.count || 0,
      diff: (actual?.count || 0) - entry.expectedCount,
      cells: actual?.cells || []
    })
  }

  for (const [code, data] of colorCounts) {
    if (!legendData.value.has(code) && code !== TRANSPARENT_KEY) {
      diff.push({
        code,
        expectedCount: 0,
        actualCount: data.count,
        diff: data.count,
        cells: data.cells
      })
    }
  }

  // 空格子差异：总格子数 - 各图例期望数量 = 应有空格子数
  const cols = autoGridCols.value || gridCols.value
  const rows = autoGridRows.value || gridRows.value
  const totalCells = rows * cols
  const expectedLegendTotal = Array.from(legendData.value.values()).reduce((sum, entry) => sum + entry.expectedCount, 0)
  const expectedEmptyCount = Math.max(0, totalCells - expectedLegendTotal)
  const actualEmptyData = colorCounts.get(TRANSPARENT_KEY)
  const actualEmptyCount = actualEmptyData?.count || 0
  if (expectedEmptyCount > 0 || actualEmptyData) {
    diff.push({
      code: TRANSPARENT_KEY,
      expectedCount: expectedEmptyCount,
      actualCount: actualEmptyCount,
      diff: actualEmptyCount - expectedEmptyCount,
      cells: actualEmptyData?.cells || []
    })
  }

  diff.sort((a, b) => {
    const aMismatch = Math.abs(a.diff)
    const bMismatch = Math.abs(b.diff)
    if (aMismatch > 0 && bMismatch === 0) return -1
    if (aMismatch === 0 && bMismatch > 0) return 1
    return bMismatch - aMismatch
  })

  diffData.value = diff
  console.log(`[OCR:diff-recalc] 差异重算完成，共${diff.length}个颜色`)
}

function handleBackToVerify() {
  ocrStep.value = 'ocr-verify'
  selectedDiffColor.value = null
  // 重置canvas变换，居中显示
  canvasScale.value = 1;
  canvasTranslateX.value = 0;
  canvasTranslateY.value = 0;
  nextTick(() => render());
}

function handleOcrComplete() {
  // Emit gridConfirm with the extracted data
  if (!patternCanvas.value) return
  const cols = autoGridCols.value || gridCols.value
  const rows = autoGridRows.value || gridRows.value
  
  // Build pixelColors from patternColorData (already matched to legend colors)
  // 无 OCR 色号的格子（TRANSPARENT_KEY）标记为空格子
  const pixelColors: string[][] = []
  for (let row = 0; row < rows; row++) {
    const rowColors: string[] = []
    for (let col = 0; col < cols; col++) {
      const cell = patternColorData.value.find(c => c.row === row && c.col === col)
      if (cell && cell.code === TRANSPARENT_KEY) {
        rowColors.push(TRANSPARENT_KEY)
      } else {
        rowColors.push(cell?.hex || '#000000')
      }
    }
    pixelColors.push(rowColors)
  }
  
  emit('gridConfirm', {
    canvas: patternCanvas.value,
    cols,
    rows,
    pixelColors,
    ocrEnabled: true
  })
}

function handleConfirmOcrVerify() {
  console.log('[OCR] 确认识别结果，进入图纸裁剪')
  ocrStep.value = 'pattern-crop'
  initGridCrop() // Reset grid crop to upper-center square
}

interface OcrToken {
  text: string
  bbox: { x: number, y: number, width: number, height: number }
  centerX: number
  centerY: number
  isCode: boolean
}

function pairCodeQuantityByProximity(
  tokens: OcrToken[]
): Map<string, { code: string, count: number, codeBbox: { x: number, y: number, width: number, height: number }, countBbox: { x: number, y: number, width: number, height: number } }> {
  const codeTokens = tokens.filter(t => t.isCode)
  const numberTokens = tokens.filter(t => !t.isCode && /^\d+$/.test(t.text.trim()))

  console.log(`[pairCodeQuantity] codeTokens: ${codeTokens.length}, numberTokens: ${numberTokens.length}`)

  if (codeTokens.length === 0 || numberTokens.length === 0) return new Map()

  // Determine layout direction from the first code:
  // find nearest number to the right vs nearest number below.
  // The closer direction determines the layout for all codes.
  const firstCode = codeTokens[0]
  let nearestRight: { idx: number, dist: number } | null = null
  let nearestBelow: { idx: number, dist: number } | null = null

  for (let ni = 0; ni < numberTokens.length; ni++) {
    const nt = numberTokens[ni]
    const dx = nt.centerX - firstCode.centerX
    const dy = nt.centerY - firstCode.centerY

    if (dx > 0) { // number is to the right of code
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (!nearestRight || dist < nearestRight.dist) {
        nearestRight = { idx: ni, dist }
      }
    }
    if (dy > 0) { // number is below code
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (!nearestBelow || dist < nearestBelow.dist) {
        nearestBelow = { idx: ni, dist }
      }
    }
  }

  // Pick direction: horizontal (right) or vertical (below)
  let isHorizontal: boolean
  if (nearestRight && nearestBelow) {
    isHorizontal = nearestRight.dist <= nearestBelow.dist
  } else if (nearestRight) {
    isHorizontal = true
  } else if (nearestBelow) {
    isHorizontal = false
  } else {
    // No number to the right or below the first code — fallback to closest overall
    console.warn('[pairCodeQuantity] No right/below candidate found, fallback to closest overall')
    return pairCodeQuantityFallback(codeTokens, numberTokens)
  }

  console.log(`[pairCodeQuantity] Layout: ${isHorizontal ? 'horizontal (→)' : 'vertical (↓)'}`)

  // Greedy pairing: for each code, find the nearest number in the determined direction
  const usedNumbers = new Set<number>()
  const result = new Map<string, { code: string, count: number, codeBbox: { x: number, y: number, width: number, height: number }, countBbox: { x: number, y: number, width: number, height: number } }>()

  for (const ct of codeTokens) {
    let best: { idx: number, dist: number } | null = null
    for (let ni = 0; ni < numberTokens.length; ni++) {
      if (usedNumbers.has(ni)) continue
      const nt = numberTokens[ni]
      const dx = nt.centerX - ct.centerX
      const dy = nt.centerY - ct.centerY

      // Must be in the determined direction
      if (isHorizontal && dx <= 0) continue
      if (!isHorizontal && dy <= 0) continue

      const dist = Math.sqrt(dx * dx + dy * dy)
      if (!best || dist < best.dist) {
        best = { idx: ni, dist }
      }
    }

    if (best) {
      usedNumbers.add(best.idx)
      const code = ct.text.trim().toUpperCase()
      const count = parseInt(numberTokens[best.idx].text.trim(), 10)
      if (!isNaN(count)) {
        result.set(code, { code, count, codeBbox: ct.bbox, countBbox: numberTokens[best.idx].bbox })
        console.log(`[pairCodeQuantity] "${code}" → ${count} (dist=${best.dist.toFixed(0)}px)`)
      }
    } else {
      console.log(`[pairCodeQuantity] "${ct.text}" — no unpaired number ${isHorizontal ? 'to the right' : 'below'}`)
    }
  }

  console.log(`[pairCodeQuantity] total pairs: ${result.size}/${codeTokens.length} codes`)
  return result
}

/** Fallback: pair each code with the closest unpaired number (no direction constraint). */
function pairCodeQuantityFallback(
  codeTokens: OcrToken[],
  numberTokens: OcrToken[]
): Map<string, { code: string, count: number, codeBbox: { x: number, y: number, width: number, height: number }, countBbox: { x: number, y: number, width: number, height: number } }> {
  const candidates: { codeIdx: number, numIdx: number, distance: number }[] = []
  for (let ci = 0; ci < codeTokens.length; ci++) {
    for (let ni = 0; ni < numberTokens.length; ni++) {
      const dx = codeTokens[ci].centerX - numberTokens[ni].centerX
      const dy = codeTokens[ci].centerY - numberTokens[ni].centerY
      candidates.push({ codeIdx: ci, numIdx: ni, distance: Math.sqrt(dx * dx + dy * dy) })
    }
  }
  candidates.sort((a, b) => a.distance - b.distance)

  const usedCodes = new Set<string>()
  const usedNumbers = new Set<number>()
  const result = new Map<string, { code: string, count: number, codeBbox: { x: number, y: number, width: number, height: number }, countBbox: { x: number, y: number, width: number, height: number } }>()

  for (const cand of candidates) {
    if (usedNumbers.has(cand.numIdx)) continue
    const code = codeTokens[cand.codeIdx].text.trim().toUpperCase()
    if (usedCodes.has(code)) continue
    const count = parseInt(numberTokens[cand.numIdx].text.trim(), 10)
    if (isNaN(count)) continue
    usedCodes.add(code)
    usedNumbers.add(cand.numIdx)
    result.set(code, { code, count, codeBbox: codeTokens[cand.codeIdx].bbox, countBbox: numberTokens[cand.numIdx].bbox })
  }
  return result
}

function getColorForCode(code: string, brand?: string): string {
  // Search colorSystemMapping for a hex key whose entry contains this code.
  // When brand is provided, prioritize the exact brand match to avoid
  // cross-brand code collisions (e.g. MARD:H07=#000000 vs COCO:H07=#01ACEB).
  try {
    const mapping = (colorSystemMappingJson as Record<string, Record<string, string>>)
    const brandsToTry = brand
      ? [brand, ...Object.keys(mapping[Object.keys(mapping)[0]] || {}).filter(b => b !== brand)]
      : Object.keys(mapping[Object.keys(mapping)[0]] || {})

    // Try exact match with brand priority
    for (const b of brandsToTry) {
      for (const [hex, systems] of Object.entries(mapping)) {
        if (systems[b] === code) {
          return hex.startsWith('#') ? hex : `#${hex}`
        }
      }
    }
    // Fallback: try any system
    for (const [hex, systems] of Object.entries(mapping)) {
      if (Object.values(systems).some(v => v === code)) {
        return hex.startsWith('#') ? hex : `#${hex}`
      }
    }
    // Fallback: try normalized variants (OCR may have dropped leading zeros)
    const candidates = normalizeOcrText(code)
    for (const cand of candidates) {
      if (cand === code.toUpperCase()) continue // already tried above
      for (const [hex, systems] of Object.entries(mapping)) {
        if (Object.values(systems).some(v => v === cand)) {
          return hex.startsWith('#') ? hex : `#${hex}`
        }
      }
    }
  } catch (e) {
    console.warn('[OCR] color lookup failed:', e)
  }
  return '#e5e7eb'
}

function buildBrandCodeIndex(): Map<string, Set<string>> {
  const brands = ['MARD', 'COCO', '漫漫', '盼盼', '咪小窝'] as const
  const index = new Map<string, Set<string>>()
  for (const brand of brands) {
    index.set(brand, new Set<string>())
  }
  const mapping = colorSystemMappingJson as Record<string, Record<string, string>>
  for (const [, systems] of Object.entries(mapping)) {
    for (const brand of brands) {
      const code = systems[brand]
      if (code) {
        index.get(brand)!.add(code.toUpperCase())
      }
    }
  }
  return index
}

function updateLegendCount(code: string, event: Event) {
  const value = parseInt((event.target as HTMLInputElement).value, 10)
  if (!isNaN(value) && value >= 0) {
    const entry = legendData.value.get(code)
    if (entry) {
      entry.expectedCount = value
      legendData.value = new Map(legendData.value)
    }
  }
}

function deleteLegendEntry(code: string) {
  legendData.value.delete(code)
  legendData.value = new Map(legendData.value)
}

const colorPickerRefs = ref<Record<string, HTMLInputElement>>({})
const editingCodeRef = ref<Record<string, HTMLInputElement>>({})

function openColorPicker(code: string) {
  const el = colorPickerRefs.value[code]
  if (el) el.click()
}

function addLegendEntry() {
  const newKey = `_new_${Date.now()}`
  legendData.value.set(newKey, {
    code: '',
    expectedCount: 1,
    rawText: '',
    bbox: { x: 0, y: 0, width: 0, height: 0 }
  })
  legendData.value = new Map(legendData.value)
  // 自动聚焦新输入框
  nextTick(() => {
    const el = editingCodeRef.value[newKey]
    if (el) el.focus()
  })
}

function updateLegendCode(oldKey: string, newCode: string) {
  const entry = legendData.value.get(oldKey)
  if (!entry) return
  
  // 空值自动删除
  if (!newCode.trim()) {
    legendData.value.delete(oldKey)
    legendData.value = new Map(legendData.value)
    return
  }
  
  // 解析色号：标准化并检查是否在当前品牌中存在
  const { code: resolvedCode, valid } = resolveLegendCode(newCode)
  
  // 如果色号无效，显示警告但仍然允许添加
  if (!valid) {
    console.warn(`[Legend] 色号 "${newCode}" 在品牌 "${detectedLegendBrand.value}" 中不存在，已标准化为 "${resolvedCode}"`)
  }
  
  // 如果是新条目（key以_new_开头），用新code作为key
  if (oldKey.startsWith('_new_')) {
    legendData.value.delete(oldKey)
  } else {
    legendData.value.delete(oldKey)
  }
  entry.code = resolvedCode
  legendData.value.set(resolvedCode, entry)
  legendData.value = new Map(legendData.value)
}

function handleCodeKeydown(oldKey: string, event: KeyboardEvent) {
  if (event.key === 'Enter') {
    const el = event.target as HTMLInputElement
    updateLegendCode(oldKey, el.value)
  }
}

// 解析色号：标准化并检查是否在当前品牌中存在
function resolveLegendCode(input: string): { code: string; valid: boolean; normalized: string } {
  const brandIndex = buildBrandCodeIndex()
  const brand = detectedLegendBrand.value
  const brandCodes = brandIndex.get(brand) ?? new Set<string>()
  const candidates = normalizeOcrText(input)
  
  // 在当前品牌中查找
  for (const cand of candidates) {
    if (brandCodes.has(cand)) {
      return { code: cand, valid: true, normalized: cand }
    }
  }
  
  // 不在当前品牌中，返回第一个候选（标准化后的）
  const normalized = candidates[0] || input.toUpperCase()
  return { code: normalized, valid: false, normalized }
}

// 检查色号是否有效（在当前品牌中存在）
function isLegendCodeValid(code: string): boolean {
  if (!code) return true // 空值不算无效
  const brandIndex = buildBrandCodeIndex()
  const brand = detectedLegendBrand.value
  const brandCodes = brandIndex.get(brand) ?? new Set<string>()
  const candidates = normalizeOcrText(code)
  return candidates.some(c => brandCodes.has(c))
}

// 获取色号提示信息
function getLegendCodeTitle(code: string): string {
  if (isLegendCodeValid(code)) return code
  const brand = detectedLegendBrand.value || '当前品牌'
  return `⚠ 色号 "${code}" 在 ${brand} 中不存在`
}

function extractPatternColors() {
  if (!patternCanvas.value) return

  const canvas = patternCanvas.value
  const ctx = canvas.getContext('2d')!
  const cols = autoGridCols.value || gridCols.value
  const rows = autoGridRows.value || gridRows.value
  const thickness = detectionConfidence.value.gridLineThickness ?? 0

  const cellSize = calcCellSize(canvas.width, canvas.height, cols, rows, thickness)
  const borderTrim = Math.max(1, cellSize * 0.1)

  const cells: PatternCell[] = []
  const colorCounts = new Map<string, { count: number, cells: Array<{ row: number, col: number }> }>()

  // Get the active palette for color matching
  const palette = paletteStore.activeBeadPalette

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // 纯按 cols/rows 均分画布,不计线厚
      const x = Math.round(col * cellSize)
      const y = Math.round(row * cellSize)
      const w = Math.round(cellSize)
      const h = Math.round(cellSize)

      const imageData = ctx.getImageData(x, y, w, h)
      const dominantColor = getDominantColorByArea(imageData, borderTrim, { step: gridStep.value })

      // Parse RGB from "rgb(r, g, b)" string
      const match = dominantColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
      if (!match) continue

      const r = parseInt(match[1], 10)
      const g = parseInt(match[2], 10)
      const b = parseInt(match[3], 10)

      // Find closest palette color
      const closest = findClosestPaletteColor({ r, g, b }, palette)
      const hex = closest.hex
      const code = closest.key || '?'

      cells.push({ row, col, rgb: dominantColor, hex, code })

      // Count occurrences
      const existing = colorCounts.get(code)
      if (existing) {
        existing.count++
        existing.cells.push({ row, col })
      } else {
        colorCounts.set(code, { count: 1, cells: [{ row, col }] })
      }
    }
  }

  patternColorData.value = cells

  // Build diff data
  const diff: DiffEntry[] = []

  // Add entries from legend
  for (const [code, entry] of legendData.value) {
    const actual = colorCounts.get(code)
    diff.push({
      code,
      expectedCount: entry.expectedCount,
      actualCount: actual?.count || 0,
      diff: (actual?.count || 0) - entry.expectedCount,
      cells: actual?.cells || []
    })
  }

  // Add entries from pattern that are not in legend
  for (const [code, data] of colorCounts) {
    if (!legendData.value.has(code) && code !== TRANSPARENT_KEY) {
      diff.push({
        code,
        expectedCount: 0,
        actualCount: data.count,
        diff: data.count,
        cells: data.cells
      })
    }
  }

  // 空格子差异：总格子数 - 各图例期望数量 = 应有空格子数
  const totalCellsExtract = rows * cols
  const expectedLegendTotalExtract = Array.from(legendData.value.values()).reduce((sum, entry) => sum + entry.expectedCount, 0)
  const expectedEmptyCountExtract = Math.max(0, totalCellsExtract - expectedLegendTotalExtract)
  const actualEmptyDataExtract = colorCounts.get(TRANSPARENT_KEY)
  const actualEmptyCountExtract = actualEmptyDataExtract?.count || 0
  if (expectedEmptyCountExtract > 0 || actualEmptyDataExtract) {
    diff.push({
      code: TRANSPARENT_KEY,
      expectedCount: expectedEmptyCountExtract,
      actualCount: actualEmptyCountExtract,
      diff: actualEmptyCountExtract - expectedEmptyCountExtract,
      cells: actualEmptyDataExtract?.cells || []
    })
  }

  // Sort: mismatches first (largest diff first), then matches
  diff.sort((a, b) => {
    const aMismatch = Math.abs(a.diff)
    const bMismatch = Math.abs(b.diff)
    if (aMismatch > 0 && bMismatch === 0) return -1
    if (aMismatch === 0 && bMismatch > 0) return 1
    return bMismatch - aMismatch
  })

  diffData.value = diff
}

function handleGridConfirm() {
  if (!img.value) return;
  const cols = gridCols.value;
  const rows = gridRows.value;
  const thickness = detectionConfidence.value.gridLineThickness ?? 0;
  const imgGridArea = displayToImage(gridCrop.value);
  const { width: effW, height: effH } = getEffectiveDimensions();
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = effW;
  tempCanvas.height = effH;
  const tempCtx = tempCanvas.getContext("2d")!;
  tempCtx.save();
  applyTransforms(tempCtx, effW, effH);
  tempCtx.drawImage(img.value, 0, 0, effW, effH);
  tempCtx.restore();

  const resultCanvas = document.createElement("canvas");
  resultCanvas.width = imgGridArea.width;
  resultCanvas.height = imgGridArea.height;
  const resultCtx = resultCanvas.getContext("2d")!;
  resultCtx.drawImage(tempCanvas, imgGridArea.x, imgGridArea.y, imgGridArea.width, imgGridArea.height, 0, 0, imgGridArea.width, imgGridArea.height);

  const cellSize = calcCellSize(imgGridArea.width, imgGridArea.height, cols, rows, thickness);
  const pixelColors: string[][] = [];
  const borderTrim = Math.max(1, cellSize * 0.1);

  for (let row = 0; row < rows; row++) {
    const rowColors: string[] = [];
    for (let col = 0; col < cols; col++) {
      // 纯按 cols/rows 均分画布,不计线厚
      const x = Math.round(col * cellSize);
      const y = Math.round(row * cellSize);
      const w = Math.round(cellSize);
      const h = Math.round(cellSize);
      const imageData = resultCtx.getImageData(x, y, w, h);
      const dominantColor = getDominantColorByArea(imageData, borderTrim, { step: gridStep.value });
      rowColors.push(dominantColor);
    }
    pixelColors.push(rowColors);
  }
  emit("gridConfirm", { canvas: resultCanvas, cols, rows, pixelColors, ocrEnabled: ocrEnabled.value });
}

function handleCancel() {
  emit("cancel");
}

function onResize() {
  fitImageToContainer();
  initCrop();
  initLegendCrop();
  render();
}

watch(mode, (newMode) => {
  // 切换到图纸生成模式时，关闭OCR并重置状态
  if (newMode === 'crop' && ocrEnabled.value) {
    ocrEnabled.value = false;
    ocrStep.value = 'legend-crop';
    ocrProgress.value = null;
    ocrLoading.value = false;
    legendData.value = new Map();
    patternColorData.value = [];
    diffData.value = [];
    colorSlices.value = [];
    selectedDiffColor.value = null;
    selectedSlice.value = null;
    showProcessingOverlay.value = false;
  }
  // 切换到色块识别模式时，使用边缘检测计算默认网格
  if (newMode === 'grid' && !ocrEnabled.value) {
    inferGridFromSourceImage();
  }
  render();
});

// OCR 预加载
watch(ocrEnabled, async (enabled) => {
  if (!enabled) {
    ocrProgress.value = null;
    ocrLoading.value = false;
    nextTick(() => render());
    return;
  }
  // OCR 启用时重置步骤状态
  ocrStep.value = 'legend-crop'
  isLegendCrop.value = true
  initLegendCrop()
  patternCrop.value = { x: 0, y: 0, width: 0, height: 0 }
  nextTick(() => render());
  // 如果模型已加载完成，显示完成状态
  if (ocrRecognition.isReady()) {
    ocrProgress.value = { phase: 'ready', phaseLabel: '模型已加载' };
    return;
  }
  if (ocrLoading.value) return;
  ocrLoading.value = true;
  ocrProgress.value = { phase: 'loading', phaseLabel: '加载模型中', percent: 0 };
  try {
    await ocrRecognition.preload((info) => {
      ocrProgress.value = info;
    });
    // 加载完成，隐藏进度条只显示文字
    ocrProgress.value = { phase: 'ready', phaseLabel: '模型加载完成' };
    ocrLoading.value = false;
  } catch (err) {
    console.error('[OCR] preload failed:', err);
    // 失败状态，隐藏进度条只显示文字
    ocrProgress.value = { phase: 'error', phaseLabel: '模型加载失败' };
    setTimeout(() => {
      ocrProgress.value = null;
      ocrLoading.value = false;
      ocrEnabled.value = false;
    }, 2000);
  }
});

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  window.addEventListener("resize", onResize);
  // Observe canvas parent size changes (e.g. 识别结果 bar appears/disappears)
  nextTick(() => {
    const canvas = canvasRef.value
    if (canvas?.parentElement) {
      resizeObserver = new ResizeObserver(() => {
        render()
      })
      resizeObserver.observe(canvas.parentElement)
    }
  })
});

onUnmounted(() => {
  window.removeEventListener("resize", onResize);
  resizeObserver?.disconnect()
});

// Re-render when ocrStep changes (results bar shows/hides, changing canvas container size)
watch(ocrStep, () => {
  nextTick(() => render())
})

// Render slice canvases when colorSlices change
watch(colorSlices, () => {
  renderSliceCanvases()
})
</script>

<template>
  <div ref="containerRef" class="flex flex-col bg-white rounded-xl overflow-hidden" style="min-height: 500px;">
    <!-- 顶部标签栏 -->
    <div class="flex items-center justify-between px-4 py-2 border-b border-black/10 bg-black/[0.02]">
      <div class="flex items-center gap-1 p-0.5 rounded-lg bg-black/[0.04] border border-black/[0.08]">
        <button
          @click="mode = 'crop'; ocrEnabled = false"
          class="flex-1 px-3 h-7 text-xs rounded-md font-medium transition-colors"
          :class="mode === 'crop' && !ocrEnabled ? 'bg-black text-white shadow-sm' : 'text-black/45 hover:text-black'"
        >
          图纸生成
        </button>
        <button
          @click="mode = 'grid'; ocrEnabled = false"
          class="flex-1 px-3 h-7 text-xs rounded-md font-medium transition-colors"
          :class="mode === 'grid' && !ocrEnabled ? 'bg-black text-white shadow-sm' : 'text-black/45 hover:text-black'"
        >
          色块识别
        </button>
        <button
          @click="ocrEnabled = true; mode = 'grid'"
          class="flex-1 px-3 h-7 text-xs rounded-md font-medium transition-colors"
          :class="ocrEnabled ? 'bg-black text-white shadow-sm' : 'text-black/45 hover:text-black'"
        >
          图纸识别
        </button>
      </div>
      <button
        @click="handleCancel"
        class="h-7 px-2 text-xs rounded-md text-black/60 hover:text-black hover:bg-black/[0.04] transition-colors"
      >
        ✕
      </button>
    </div>

    <!-- 主体内容 -->
    <div class="flex flex-1 min-h-0">
    <!-- 左侧工具栏 -->
    <div class="w-[200px] flex flex-col border-r border-black/10 bg-black/[0.02]">

      <!-- OCR 流程指示器 (所有OCR步骤公用) -->
      <div v-if="ocrEnabled" class="px-3 py-2.5 border-b border-black/10">
        <!-- OCR 模型状态 -->
        <div v-if="ocrProgress" class="mb-3 pb-2 border-b border-black/10">
          <div class="flex items-center gap-2">
            <div v-if="ocrProgress.phase !== 'ready' && ocrProgress.phase !== 'error'" class="w-3 h-3 border-2 border-black/20 border-t-black rounded-full animate-spin" />
            <svg v-else-if="ocrProgress.phase === 'ready'" class="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
            <svg v-else class="w-3 h-3 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
            <span class="text-[10px] text-black/50">
              {{ ocrProgress.phaseLabel }}
            </span>
          </div>
          <!-- 加载中显示进度条 -->
          <div v-if="ocrProgress.percent != null" class="mt-1 w-full bg-black/10 rounded-full h-1">
            <div
              class="bg-black h-1 rounded-full transition-all duration-300"
              :style="{ width: `${Math.min(100, Math.max(0, ocrProgress.percent))}%` }"
            />
          </div>
        </div>

        <p class="text-[10px] text-black/40 uppercase tracking-wider mb-2">流程</p>
        <div class="flex flex-col gap-0.5">
          <template v-for="(step, index) in [
            { key: 'legend-crop', label: '图例裁剪' },
            { key: 'ocr-verify', label: '识别核对' },
            { key: 'pattern-crop', label: '图纸裁剪' },
            { key: 'diff-view', label: '差异对比' }
          ]" :key="step.key">
            <div class="flex items-center gap-2 px-2 py-1 rounded-md transition-all duration-200"
              :class="[
                ocrStep === step.key ? 'bg-black text-white' : '',
                getStepIndex(ocrStep) > index ? 'text-black/60' : '',
                getStepIndex(ocrStep) < index ? 'text-black/25' : ''
              ]"
            >
              <div
                class="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-medium shrink-0"
                :class="[
                  ocrStep === step.key ? 'bg-white/20 text-white' : '',
                  getStepIndex(ocrStep) > index ? 'bg-black/10 text-black/60' : '',
                  getStepIndex(ocrStep) < index ? 'bg-black/5 text-black/20' : ''
                ]"
              >
                <span v-if="getStepIndex(ocrStep) > index">✓</span>
                <span v-else>{{ index + 1 }}</span>
              </div>
              <span class="text-[11px] whitespace-nowrap">{{ step.label }}</span>
            </div>
            <div v-if="index < 3" class="w-px h-2 ml-2"
              :class="getStepIndex(ocrStep) > index ? 'bg-black/30' : 'bg-black/10'"
            />
          </template>
        </div>
      </div>

      <!-- 步长提示浮层 -->
      <Teleport to="body">
        <Transition name="tooltip">
          <span
            v-if="showStepTooltip"
            class="fixed z-[9999] w-48 px-2.5 py-1.5 bg-gray-100 text-gray-600 text-[10px] rounded shadow-sm border border-black/5 pointer-events-none"
            :style="{ left: tooltipX + 'px', top: tooltipY + 'px' }"
          >
            颜色采样间隔。值越小颜色越精细但计算越慢，值越大颜色越粗糙但速度越快
          </span>
        </Transition>
      </Teleport>

      <!-- Legend crop tools (OCR step 1) -->
      <div v-if="ocrEnabled && ocrStep === 'legend-crop'" class="flex-1 px-3 py-3 space-y-3 overflow-y-auto">
        <div>
          <p class="text-xs font-medium text-black/80 mb-1">裁剪图例区域</p>
          <p class="text-[10px] text-black/40 leading-relaxed">框选图例区域（包含色号和数量）</p>
        </div>

        <div class="border-t border-black/10 pt-3 space-y-2">
          <button @click="handleLegendConfirm()" class="w-full h-8 rounded-lg bg-black text-white hover:bg-black/80 text-xs font-medium transition-colors">
            下一步 →
          </button>
        </div>

        <p class="text-[10px] text-black/40 leading-relaxed">
          拖动蓝色框调整图例区域 · 滚轮缩放
        </p>
      </div>

      <!-- Pattern crop tools (OCR step 2) -->
      <div v-else-if="ocrEnabled && ocrStep === 'pattern-crop'" class="flex-1 px-3 py-3 space-y-3 overflow-y-auto">
        <div>
          <p class="text-xs font-medium text-black/80 mb-1">裁剪图纸区域</p>
          <p class="text-[10px] text-black/40 leading-relaxed">框选图纸区域（包含色块网格）</p>
        </div>

        <div class="border-t border-black/10 pt-3 space-y-2">
          <button @click="handlePatternConfirm()" class="w-full h-8 rounded-lg bg-black text-white hover:bg-black/80 text-xs font-medium transition-colors">
            下一步 →
          </button>
          <button @click="handleBackToVerify()" class="w-full h-8 rounded-lg bg-black/[0.04] text-black/60 hover:bg-black/[0.08] text-xs transition-colors">
            ← 上一步
          </button>
        </div>

        <p class="text-[10px] text-black/40 leading-relaxed">
          拖动红框调整图纸区域 · 滚轮缩放
        </p>
      </div>

      <!-- OCR verify tools (Step 2) -->
      <div v-else-if="ocrEnabled && ocrStep === 'ocr-verify'" class="flex-1 px-3 py-3 space-y-3 overflow-y-auto">
        <div>
          <p class="text-xs font-medium text-black/80 mb-1">识别核对</p>
          <p class="text-[10px] text-black/40 leading-relaxed">检查OCR识别结果，修正错误</p>
        </div>

        <!-- Navigation buttons -->
        <div class="border-t border-black/10 pt-3 space-y-2">
          <button @click="handleConfirmOcrVerify()" class="w-full h-8 rounded-lg bg-black text-white hover:bg-black/80 text-xs font-medium transition-colors">
            下一步 →
          </button>
          <button @click="handleBackToLegend()" class="w-full h-8 rounded-lg bg-black/[0.04] text-black/60 hover:bg-black/[0.08] text-xs transition-colors">
            ← 上一步
          </button>
        </div>
      </div>

      <!-- Diff view tools (Step 4) -->
      <div v-else-if="ocrEnabled && ocrStep === 'diff-view'" class="flex-1 px-3 py-3 space-y-3 overflow-y-auto">
        <div>
          <p class="text-xs font-medium text-black/80 mb-1">差异对比</p>
          <p class="text-[10px] text-black/40 leading-relaxed">对比图例期望数量与实际数量，点击颜色查看切片</p>
        </div>

        <!-- 识别出的行列数 + 校正入口 -->
        <div class="border-t border-black/10 pt-3">
          <p class="text-[10px] text-black/40 uppercase tracking-wider mb-2">网格尺寸</p>
          <template v-if="!isEditingGrid">
            <div class="flex items-center justify-between text-xs">
              <span class="text-black/60">识别列数</span>
              <span class="font-medium text-black/80">{{ autoGridCols }}</span>
            </div>
            <div class="flex items-center justify-between text-xs mt-1">
              <span class="text-black/60">识别行数</span>
              <span class="font-medium text-black/80">{{ autoGridRows }}</span>
            </div>
            <button @click="startEditGrid" class="mt-2 w-full px-2 py-1 rounded-md bg-black/[0.04] hover:bg-black/[0.08] text-xs text-black/60 transition-colors">
              校正网格
            </button>
          </template>
          <template v-else>
            <div class="space-y-2">
              <div class="flex items-center gap-2">
                <label class="text-xs text-black/60 w-12">列数</label>
                <input type="number" v-model.number="editGridCols" min="1" max="200"
                  class="flex-1 px-2 py-1 bg-white text-black text-xs rounded border border-black/10 focus:border-black/30 focus:outline-none" />
              </div>
              <div class="flex items-center gap-2">
                <label class="text-xs text-black/60 w-12">行数</label>
                <input type="number" v-model.number="editGridRows" min="1" max="200"
                  class="flex-1 px-2 py-1 bg-white text-black text-xs rounded border border-black/10 focus:border-black/30 focus:outline-none" />
              </div>
              <div class="flex gap-2">
                <button @click="confirmEditGridAndRecompute" class="flex-1 px-2 py-1 rounded-md bg-black/80 hover:bg-black text-xs text-white transition-colors">
                  确认并重算
                </button>
                <button @click="cancelEditGrid" class="px-2 py-1 rounded-md bg-black/[0.04] hover:bg-black/[0.08] text-xs text-black/60 transition-colors">
                  取消
                </button>
              </div>
            </div>
          </template>
        </div>

        <!-- Summary -->
        <div class="border-t border-black/10 pt-3">
          <div class="flex items-center justify-between text-xs">
            <span class="text-black/60">总颜色数</span>
            <span class="font-medium text-black/80">{{ diffStats.total }}</span>
          </div>
          <div class="flex items-center justify-between text-xs mt-1">
            <span class="text-black/60">一致</span>
            <span class="font-medium text-green-600">{{ diffStats.matchCount }}</span>
          </div>
          <div class="flex items-center justify-between text-xs mt-1">
            <span class="text-black/60">不一致</span>
            <span class="font-medium text-red-600">{{ diffStats.mismatchCount }}</span>
          </div>
        </div>

        <!-- Navigation buttons -->
        <div class="border-t border-black/10 pt-3 space-y-2">
          <button @click="handleOcrComplete()" class="w-full h-8 rounded-lg bg-black text-white hover:bg-black/80 text-xs font-medium transition-colors">
            完成
          </button>
          <button @click="handleBackToPattern()" class="w-full h-8 rounded-lg bg-black/[0.04] text-black/60 hover:bg-black/[0.08] text-xs transition-colors">
            ← 上一步
          </button>
        </div>
      </div>

      <!-- 裁剪工具 (图纸生成模式) -->
      <div v-else-if="mode === 'crop' && !ocrEnabled" class="flex-1 px-3 py-3 space-y-2 overflow-y-auto flex flex-col">
        <p class="text-[10px] text-black/40 uppercase tracking-wider mb-3">变换</p>
        <button @click="handleRotate" class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-black/60 hover:text-black hover:bg-black/[0.04] transition-colors">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span class="text-xs">旋转</span>
        </button>
        <button @click="handleFlipHorizontal" class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-black/60 hover:text-black hover:bg-black/[0.04] transition-colors">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          <span class="text-xs">水平翻转</span>
        </button>
        <button @click="handleFlipVertical" class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-black/60 hover:text-black hover:bg-black/[0.04] transition-colors">
          <svg class="w-4 h-4 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          <span class="text-xs">垂直翻转</span>
        </button>
        <button @click="handleReset" class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-black/60 hover:text-black hover:bg-black/[0.04] transition-colors">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m0 0a8.001 8.001 0 0115.356 2M4.582 9H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span class="text-xs">重置</span>
        </button>

        <!-- 确认按钮 -->
        <div class="mt-auto pt-3 border-t border-black/10">
          <button
            @click="handleConfirm()"
            class="w-full h-9 rounded-lg bg-black text-white hover:bg-black/80 text-xs font-medium transition-colors"
          >
            确认
          </button>
        </div>
      </div>

      <!-- 格子工具 (色块识别模式，无OCR) -->
      <div v-else-if="mode === 'grid' && !ocrEnabled" class="flex-1 px-3 py-3 space-y-3 overflow-y-auto flex flex-col">
        <p class="text-[10px] text-black/40 uppercase tracking-wider mb-3">网格设置</p>
        
        <div class="border-t border-black/10 pt-3">
          <p class="text-[10px] text-black/40 uppercase tracking-wider mb-3">网格参数</p>
          <div class="space-y-2">
            <label class="flex items-center justify-between">
              <span class="text-xs text-black/60">横向</span>
              <div class="flex items-center gap-1">
                <input
                  v-model.number="gridCols"
                  type="number"
                  min="1"
                  max="100"
                  class="w-14 px-2 py-1 bg-white text-black text-center text-xs rounded-md border border-black/10 focus:border-black/30 focus:outline-none"
                />
                <span class="text-[10px] text-black/40">格</span>
              </div>
            </label>
            <label class="flex items-center justify-between">
              <span class="text-xs text-black/60">纵向</span>
              <div class="flex items-center gap-1">
                <input
                  v-model.number="gridRows"
                  type="number"
                  min="1"
                  max="100"
                  class="w-14 px-2 py-1 bg-white text-black text-center text-xs rounded-md border border-black/10 focus:border-black/30 focus:outline-none"
                />
                <span class="text-[10px] text-black/40">格</span>
              </div>
            </label>
            <label class="flex items-center justify-between">
              <span class="text-xs text-black/60 flex items-center gap-1">
                步长
                <span
                  class="relative text-[10px] text-black/30 cursor-help"
                  @mouseenter="(e: MouseEvent) => { showStepTooltip = true; updateTooltipPos(e) }"
                  @mouseleave="showStepTooltip = false"
                  @mousemove="(e: MouseEvent) => updateTooltipPos(e)"
                >ⓘ</span>
              </span>
              <div class="flex items-center gap-1">
                <input
                  v-model.number="gridStep"
                  type="number"
                  min="1"
                  max="64"
                  class="w-14 px-2 py-1 bg-white text-black text-center text-xs rounded-md border border-black/10 focus:border-black/30 focus:outline-none"
                />
                <span class="text-[10px] text-black/40 w-3"></span>
              </div>
            </label>
          </div>
        </div>

        <!-- 确认按钮 -->
        <div class="mt-auto pt-3 border-t border-black/10">
          <button
            @click="handleGridConfirm()"
            class="w-full h-9 rounded-lg bg-black text-white hover:bg-black/80 text-xs font-medium transition-colors"
          >
            确认
          </button>
        </div>
      </div>
    </div>

    <!-- 右侧画布 + 识别结果区域 -->
    <div class="flex-1 flex flex-col" style="width: 100%; height: 100%;">
      <!-- diff-view: HTML layout with slice grid + palette -->
      <template v-if="ocrEnabled && ocrStep === 'diff-view'">
        <div class="flex-1 flex flex-col overflow-hidden">
          <!-- Slice preview area -->
          <div class="flex-1 overflow-auto p-4">
            <!-- No color selected -->
            <div v-if="!selectedDiffColor" class="flex items-center justify-center h-full">
              <p class="text-sm text-black/30">请从下方色板选择颜色</p>
            </div>
            <!-- No slices for this color -->
            <div v-else-if="colorSlices.length === 0" class="flex items-center justify-center h-full">
              <p class="text-sm text-black/30">该颜色无切片</p>
            </div>
            <!-- Slice grid -->
            <div v-else>
              <div class="flex items-center gap-2 mb-3">
                <div class="w-4 h-4 rounded border border-black/10" :style="{ backgroundColor: getColorHex(selectedDiffColor) }"></div>
                <p class="text-xs font-medium text-black/80">色号 {{ selectedDiffColor }} 的切片 ({{ colorSlices.length }}个)</p>
                <span v-if="selectedSlices.length > 0" class="text-[10px] text-blue-500 font-medium">已选 {{ selectedSlices.length }} 个</span>
              </div>
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="(slice, idx) in colorSlices"
                  :key="idx"
                  @click="handleSliceClick(slice.row, slice.col)"
                  class="relative w-11 h-11 rounded-lg transition-all duration-100 flex items-center justify-center flex-shrink-0"
                  :class="isSliceSelected(slice.row, slice.col)
                    ? 'border-2 border-blue-500'
                    : 'border-2 border-transparent opacity-70 hover:opacity-100 active:opacity-80'"
                >
                  <canvas
                    :ref="el => { if (el) sliceCanvasRefs[idx] = el as HTMLCanvasElement }"
                    class="w-full h-full rounded-lg block"
                    style="image-rendering: pixelated;"
                  />
                  <div
                    v-if="isSliceSelected(slice.row, slice.col)"
                    class="absolute top-0 right-0 w-3 h-3 bg-blue-500 rounded-bl-md rounded-tr-[5px] flex items-center justify-center"
                  >
                    <svg class="w-2 h-2 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="3">
                      <path d="M2 6l3 3 5-5" />
                    </svg>
                  </div>
                </button>
              </div>
            </div>
          </div>

          <!-- Color palette (horizontal scroll) -->
          <div
            class="border-t border-black/10 bg-black/[0.02] px-4 py-3"
          >
            <p class="text-[10px] text-black/40 uppercase tracking-wider mb-2">
              {{ selectedSlices.length > 0 ? `色板 — 点击替换 ${selectedSlices.length} 个切片的颜色` : '色板 — 点击颜色查看切片' }}
            </p>
            <div class="flex gap-2 overflow-x-auto pb-1 scrollbar-thin" @wheel.prevent="e => { const t = e.currentTarget as HTMLElement; if (t) t.scrollLeft += e.deltaY }">
              <div v-for="color in paletteColors" :key="color.code" class="flex flex-col items-center gap-0.5">
                <button
                  @click="selectedSlices.length > 0 ? changeSelectedSlicesColor(color.code) : handleDiffColorSelect(color.code)"
                  class="relative w-11 h-11 rounded-lg transition-all duration-100 flex items-center justify-center flex-shrink-0"
                  :class="color.code === selectedDiffColor
                    ? 'border-2 border-blue-500'
                    : 'border-2 border-transparent opacity-70 hover:opacity-100 active:opacity-80'"
                  :style="{ backgroundColor: color.hex }"
                  :title="color.code === TRANSPARENT_KEY ? '空格 (透明)' : color.code"
                >
                  <svg v-if="color.code === TRANSPARENT_KEY" class="w-4 h-4 text-black/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="4" y1="4" x2="20" y2="20" /><line x1="20" y1="4" x2="4" y2="20" />
                  </svg>
                  <span
                    v-else
                    class="text-[9px] font-bold leading-none select-none"
                    :style="{ color: isLightColor(color.hex) ? '#000' : '#fff' }"
                  >
                    {{ color.code }}
                  </span>
                  <div
                    v-if="color.code === selectedDiffColor"
                    class="absolute top-0 right-0 w-3 h-3 bg-blue-500 rounded-bl-md rounded-tr-[5px] flex items-center justify-center"
                  >
                    <svg class="w-2 h-2 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="3">
                      <path d="M2 6l3 3 5-5" />
                    </svg>
                  </div>
                </button>
                <span v-if="getDiffEntry(color.code)" class="text-[9px] font-medium"
                  :class="getDiffEntry(color.code)!.diff === 0 ? 'text-green-600' : getDiffEntry(color.code)!.diff > 0 ? 'text-orange-500' : 'text-red-500'"
                >
                  {{ getDiffEntry(color.code)!.diff === 0 ? '一致' : getDiffEntry(color.code)!.diff > 0 ? `+${getDiffEntry(color.code)!.diff}` : getDiffEntry(color.code)!.diff }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- Non-diff-view: Canvas -->
      <template v-else>
        <div
          class="flex items-center justify-center p-4 overflow-hidden relative bg-black/[0.02]"
          :class="ocrEnabled && ocrStep === 'ocr-verify' ? '' : 'flex-1'"
          :style="ocrEnabled && ocrStep === 'ocr-verify' ? { height: '30%', minHeight: '150px' } : {}"
        >
          <canvas
            ref="canvasRef"
            class="cursor-move shadow-sm rounded"
            style="touch-action: none; width: 100%; height: 100%;"
            @mousedown="onPointerDown"
            @mousemove="onPointerMove"
            @mouseup="onPointerUp"
            @mouseleave="onPointerUp"
            @wheel.prevent="onWheel"
            @touchstart.passive="onPointerDown"
            @touchmove="onPointerMove"
            @touchend="onPointerUp"
          />
          <!-- 浮动缩放工具栏 -->
          <div class="absolute bottom-4 right-4 flex items-center gap-1 bg-white/90 backdrop-blur-sm rounded-lg shadow-lg border border-black/10 px-2 py-1.5">
            <button
              @click="handleZoomOut"
              :disabled="canvasScale <= 0.1"
              class="w-7 h-7 rounded-md bg-black/[0.04] text-black/60 hover:bg-black/[0.08] flex items-center justify-center text-sm font-bold disabled:opacity-30 transition-colors"
            >
              −
            </button>
            <span class="text-black/60 text-xs w-12 text-center tabular-nums">{{ Math.round(canvasScale * 100) }}%</span>
            <button
              @click="handleZoomIn"
              :disabled="canvasScale >= 10"
              class="w-7 h-7 rounded-md bg-black/[0.04] text-black/60 hover:bg-black/[0.08] flex items-center justify-center text-sm font-bold disabled:opacity-30 transition-colors"
            >
              +
            </button>
            <div class="w-px h-4 bg-black/10 mx-0.5"></div>
            <button
              @click="handleResetView"
              class="w-7 h-7 rounded-md bg-black/[0.04] text-black/60 hover:bg-black/[0.08] flex items-center justify-center transition-colors"
              title="重置视图"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m0 0a8.001 8.001 0 0115.356 2M4.582 9H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>
        <!-- 识别结果 (shown during ocr-verify step, below canvas) -->
        <div
          v-if="ocrEnabled && ocrStep === 'ocr-verify'"
          class="border-t border-black/10 px-4 py-3 bg-white flex-1 overflow-y-auto"
        >
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2">
              <p class="text-[10px] text-black/40 uppercase tracking-wider">识别结果 ({{ legendData.size }})</p>
              <span v-if="detectedLegendBrand" class="text-[10px] px-1.5 py-0.5 rounded bg-black text-white font-medium">{{ detectedLegendBrand }}</span>
            </div>
            <button
              @click="addLegendEntry"
              class="w-6 h-6 rounded-md bg-black/[0.04] hover:bg-black/[0.08] flex items-center justify-center text-black/60 hover:text-black transition-colors"
              title="新增颜色"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
          <div class="flex flex-wrap gap-2">
            <div v-for="[code, entry] in legendData" :key="code"
              class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/[0.04]"
            >
              <div
                class="w-5 h-5 rounded border shrink-0"
                :class="isLegendCodeValid(code) ? 'border-black/10' : 'border-orange-300'"
                :style="{ backgroundColor: getColorForCode(code, detectedLegendBrand) }"
                :title="getLegendCodeTitle(code)"
              ></div>
              <input
                type="text"
                :ref="el => { if (el) editingCodeRef[code] = el as HTMLInputElement }"
                :value="code"
                @blur="updateLegendCode(code, ($event.target as HTMLInputElement)?.value ?? '')"
                @keydown="handleCodeKeydown(code, $event)"
                placeholder="色号"
                class="w-16 px-1.5 py-0.5 bg-white text-black text-xs rounded border focus:outline-none uppercase"
                :class="isLegendCodeValid(code) ? 'border-black/10 focus:border-black/30' : 'border-orange-300 focus:border-orange-400'"
                maxlength="10"
              />
              <input
                type="number"
                :value="entry.expectedCount"
                @input="updateLegendCount(code, $event)"
                class="w-14 px-1.5 py-0.5 bg-white text-black text-center text-xs rounded border border-black/10 focus:border-black/30 focus:outline-none"
                min="0"
              />
              <button @click="deleteLegendEntry(code)" class="text-red-500 hover:text-red-700 text-xs ml-1">×</button>
            </div>
          </div>
        </div>
      </template>
    </div>
    </div> <!-- /flex body wrapper -->

    <!-- Fullscreen processing overlay -->
    <div
      v-if="showProcessingOverlay"
      class="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
    >
      <div class="bg-white rounded-xl shadow-xl p-8 flex flex-col items-center gap-4 min-w-[280px]">
        <!-- Loading spinner -->
        <div class="w-12 h-12 border-4 border-black/10 border-t-black rounded-full animate-spin" />
        
        <!-- Message -->
        <p class="text-sm font-medium text-black/80">{{ processingMessage }}</p>
        
        <!-- Progress bar -->
        <div v-if="processingProgress?.percent != null" class="w-full">
          <div class="w-full bg-black/10 rounded-full h-2">
            <div
              class="bg-black h-2 rounded-full transition-all duration-300"
              :style="{ width: `${Math.min(100, Math.max(0, processingProgress.percent))}%` }"
            />
          </div>
          <p class="text-xs text-black/40 mt-2 text-center">
            {{ Math.min(100, Math.max(0, Math.round(processingProgress.percent))) }}%
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tooltip-enter-active,
.tooltip-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.tooltip-enter-from,
.tooltip-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(4px);
}
</style>
