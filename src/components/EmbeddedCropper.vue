<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import { getDominantColorByArea } from "../utils/pixelation";
import { findClosestPaletteColor } from "../utils/colorUtils";
import { usePaletteStore } from "../stores/paletteStore";
import { useOcrRecognition } from "../composables/useOcrRecognition";
import { median, iqrFilter, inferGridFromOcrBoxes, inferGridFromEdges, detectGridDimensions, type GridDimensionsResult } from "../utils/gridDetection";
import colorSystemMappingJson from "../data/colorSystemMapping.json";

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
const autoGridCols = ref(0)
const inferredGrid = ref<{ rows: number; cols: number; confidence: number }>({ rows: 0, cols: 0, confidence: 0 })
const autoGridRows = ref(0)
const detectionConfidence = ref<GridDimensionsResult>({ rows: 0, cols: 0, confidence: 0, method: "手动输入" })

// Editable grid override for auto-detected dimensions
const isEditingGrid = ref(autoGridCols.value === 0 && autoGridRows.value === 0)
const editGridCols = ref(autoGridCols.value)
const editGridRows = ref(autoGridRows.value)

function startEditGrid() {
  editGridCols.value = autoGridCols.value || 1
  editGridRows.value = autoGridRows.value || 1
  isEditingGrid.value = true
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
  crop.value = {
    x: 0,
    y: 0,
    width: displayWidth.value,
    height: displayHeight.value,
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

  // 两个模式都应用拖动和缩放
  ctx.save();
  ctx.translate(canvasTranslateX.value, canvasTranslateY.value);
  ctx.scale(canvasScale.value, canvasScale.value);

  // 绘制图片
  ctx.save();
  applyTransforms(ctx, displayWidth.value, displayHeight.value);
  ctx.drawImage(img.value, 0, 0, displayWidth.value, displayHeight.value);
  ctx.restore();

  // Pattern-crop: show grid overlay regardless of mode
  if (ocrEnabled.value && ocrStep.value === 'pattern-crop') {
    renderGridOverlay(ctx);
  } else if (ocrEnabled.value && ocrStep.value === 'ocr-verify') {
    // Draw legend canvas image centered in the canvas area
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

      ctx.drawImage(lc, offsetX, offsetY, drawW, drawH);

      // Draw bounding box overlays for each legend entry
      for (const [, entry] of legendData.value) {
        const bx = offsetX + entry.bbox.x * drawScale;
        const by = offsetY + entry.bbox.y * drawScale;
        const bw = entry.bbox.width * drawScale;
        const bh = entry.bbox.height * drawScale;

        // Green box for entries with both code and quantity parsed
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2;
        ctx.strokeRect(bx, by, bw, bh);

        // Draw extracted code and quantity text
        ctx.fillStyle = '#22c55e';
        ctx.font = `bold ${Math.max(11, 12 * drawScale)}px sans-serif`;
        ctx.textBaseline = 'bottom';
        const label = `${entry.code} ×${entry.expectedCount}`;
        ctx.fillText(label, bx, by - 2);
      }
    } else {
      // Legend canvas not ready yet — show loading text
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('正在识别图例...', canvas.width / 2, canvas.height / 2);
      ctx.textAlign = 'start';
    }
  } else if (ocrEnabled.value && ocrStep.value === 'diff-view') {
    // Draw pattern grid with matched colors OR slice gallery
    if (colorSlices.value.length > 0 && selectedDiffColor.value) {
      // === Slice Gallery Mode ===
      const slices = colorSlices.value
      const code = selectedDiffColor.value
      const hex = getColorHex(code)

      // Background
      ctx.fillStyle = '#fafafa'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // Title
      ctx.fillStyle = '#111827'
      ctx.font = 'bold 16px sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(`色块切片: ${code}`, 24, 20)

      // Subtitle with count
      ctx.fillStyle = '#6b7280'
      ctx.font = '12px sans-serif'
      ctx.fillText(`共 ${slices.length} 个切片`, 24, 44)

      // Calculate thumbnail grid layout
      const thumbSize = 100
      const gap = 12
      const labelHeight = 20
      const cellTotalH = thumbSize + labelHeight + gap
      const padding = 24
      const availableW = canvas.width - padding * 2
      const cols = Math.max(1, Math.floor(availableW / (thumbSize + gap)))
      const startY = 70

      // Create offscreen canvas to render ImageData
      const tmpCanvas = document.createElement('canvas')
      const tmpCtx = tmpCanvas.getContext('2d')!

      for (let i = 0; i < slices.length; i++) {
        const slice = slices[i]
        const gridCol = i % cols
        const gridRow = Math.floor(i / cols)
        const x = padding + gridCol * (thumbSize + gap)
        const y = startY + gridRow * cellTotalH

        // Card background
        const isSelected = selectedSlice.value?.row === slice.row && selectedSlice.value?.col === slice.col
        ctx.fillStyle = isSelected ? '#eff6ff' : '#ffffff'
        ctx.strokeStyle = isSelected ? '#3b82f6' : '#e5e7eb'
        ctx.lineWidth = isSelected ? 2 : 1
        roundRect(ctx, x, y, thumbSize, thumbSize + labelHeight, 6)
        ctx.fill()
        ctx.stroke()

        // Draw the cell image data as thumbnail
        tmpCanvas.width = slice.imageData.width
        tmpCanvas.height = slice.imageData.height
        tmpCtx.putImageData(slice.imageData, 0, 0)

        // Scale to fit thumbnail
        const imgScale = Math.min(thumbSize / tmpCanvas.width, thumbSize / tmpCanvas.height)
        const drawW = tmpCanvas.width * imgScale
        const drawH = tmpCanvas.height * imgScale
        const drawX = x + (thumbSize - drawW) / 2
        const drawY = y + (thumbSize - drawH) / 2
        ctx.drawImage(tmpCanvas, drawX, drawY, drawW, drawH)

        // Label: row,col and color code
        ctx.fillStyle = '#374151'
        ctx.font = '10px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillText(`R${slice.row} C${slice.col}`, x + thumbSize / 2, y + thumbSize + 2)

        // Color dot
        ctx.beginPath()
        ctx.arc(x + thumbSize / 2 - 14, y + thumbSize + 12, 4, 0, Math.PI * 2)
        ctx.fillStyle = hex
        ctx.fill()
        ctx.strokeStyle = '#d1d5db'
        ctx.lineWidth = 0.5
        ctx.stroke()
      }

      // Reset text alignment
      ctx.textAlign = 'start'
    } else if (patternColorData.value.length > 0) {
      const cols = autoGridCols.value || gridCols.value
      const rows = autoGridRows.value || gridRows.value
      
      // Calculate grid area to center in canvas
      const maxW = canvas.width
      const maxH = canvas.height
      const padding = 40
      const availableW = maxW - padding * 2
      const availableH = maxH - padding * 2
      const cellSize = Math.floor(Math.min(availableW / cols, availableH / rows))
      const gridW = cellSize * cols
      const gridH = cellSize * rows
      const offsetX = (maxW - gridW) / 2
      const offsetY = (maxH - gridH) / 2

      // Draw cells with matched colors
      for (const cell of patternColorData.value) {
        const x = offsetX + cell.col * cellSize
        const y = offsetY + cell.row * cellSize
        
        // Fill with matched hex color
        ctx.fillStyle = cell.hex
        ctx.fillRect(x, y, cellSize, cellSize)
        
        // Highlight selected diff color
        if (selectedDiffColor.value && cell.code === selectedDiffColor.value) {
          ctx.strokeStyle = '#3b82f6'
          ctx.lineWidth = 2
          ctx.strokeRect(x, y, cellSize, cellSize)
        }
      }

      // Draw grid lines
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)'
      ctx.lineWidth = 1
      for (let i = 0; i <= cols; i++) {
        ctx.beginPath()
        ctx.moveTo(offsetX + i * cellSize, offsetY)
        ctx.lineTo(offsetX + i * cellSize, offsetY + gridH)
        ctx.stroke()
      }
      for (let i = 0; i <= rows; i++) {
        ctx.beginPath()
        ctx.moveTo(offsetX, offsetY + i * cellSize)
        ctx.lineTo(offsetX + gridW, offsetY + i * cellSize)
        ctx.stroke()
      }

      // Draw outer border
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)'
      ctx.lineWidth = 2
      ctx.strokeRect(offsetX, offsetY, gridW, gridH)
    } else {
      // No pattern data yet
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('正在提取颜色...', canvas.width / 2, canvas.height / 2);
      ctx.textAlign = 'start';
    }
  } else if (mode.value === "crop") {
    if (ocrEnabled.value && ocrStep.value === 'legend-crop') {
      renderLegendCropOverlay(ctx);
    } else {
      renderDetectedEdges(ctx); // 显示检测到的边缘
      renderCropOverlay(ctx);
    }
  } else {
    renderGridOverlay(ctx);
  }

  ctx.restore();
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

  const useGridMode = mode.value === "grid" || (ocrEnabled.value && ocrStep.value === 'pattern-crop');
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

  const useGridMode = mode.value === "grid" || (ocrEnabled.value && ocrStep.value === 'pattern-crop');
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
        break;
      case "sw":
        newX = Math.max(0, Math.min(c.x + c.width - MIN_CROP_SIZE, c.x + dx));
        newW = c.x + c.width - newX;
        newH = Math.max(MIN_CROP_SIZE, Math.min(maxH - c.y, c.height + dy));
        // 智能吸附
        newX = snapToEdge(newX);
        newW = c.x + c.width - newX;
        break;
      case "se":
        newW = Math.max(MIN_CROP_SIZE, Math.min(maxW - c.x, c.width + dx));
        newH = Math.max(MIN_CROP_SIZE, Math.min(maxH - c.y, c.height + dy));
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
        break;
    }
    // Update the correct crop based on mode
    if (ocrEnabled.value && ocrStep.value === 'legend-crop') {
      legendCrop.value = { x: newX, y: newY, width: newW, height: newH };
      console.log('[OCR] 图例裁剪区域更新:', legendCrop.value);
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
          break;
        case "sw":
          newX = Math.max(0, Math.min(c.x + c.width - MIN_CROP_SIZE, c.x + dx));
          newW = c.x + c.width - newX;
          newH = Math.max(MIN_CROP_SIZE, Math.min(displayHeight.value - c.y, c.height + dy));
          // 智能吸附
          newX = snapToEdge(newX);
          newW = c.x + c.width - newX;
          break;
        case "se":
          newW = Math.max(MIN_CROP_SIZE, Math.min(displayWidth.value - c.x, c.width + dx));
          newH = Math.max(MIN_CROP_SIZE, Math.min(displayHeight.value - c.y, c.height + dy));
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
const stepOrder: OcrStep[] = ['legend-crop', 'pattern-crop', 'ocr-verify', 'diff-view']
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
  ocrStep.value = 'pattern-crop';
  isLegendCrop.value = false;
  initGridCrop(); // Reset grid crop to upper-center square when entering step 2
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
  
  // Show fullscreen overlay and start OCR processing
  showProcessingOverlay.value = true;
  processingMessage.value = '正在识别图例...';
  processingProgress.value = { phase: 'loading', percent: 0 };
  
  console.log('[OCR] 图纸裁剪完成，开始OCR处理流程')
  
  // Start OCR parsing with overlay progress
  nextTick(async () => {
    try {
      await parseLegendWithOcrWithOverlay();
      await extractPatternColorsWithOverlay();
      console.log('[OCR] 全部处理完成')
    } catch (err) {
      console.error('[OCR] 处理失败:', err)
      processingMessage.value = '处理失败，请重试'
    } finally {
      setTimeout(() => {
        showProcessingOverlay.value = false;
        ocrStep.value = 'ocr-verify';
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

  // Dynamic row-threshold: 0.5% of image height, minimum 10px
  const rowThreshold = Math.max(10, (legendCanvas.value?.height || 200) * 0.005)

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

  // Use core parsing function
  legendData.value = _parseLegendCore(result.lines, legendCanvas.value.height)
  const entries = legendData.value

  // Auto-detect grid cell size from text spacing
  if (entries.size >= 2) {
    const sortedEntries = Array.from(entries.values()).sort((a, b) => {
      // Sort by y position first (row), then x (column)
      if (Math.abs(a.bbox.y - b.bbox.y) > rowThreshold) return a.bbox.y - b.bbox.y
      return a.bbox.x - b.bbox.x
    })

    // Calculate spacing using median with IQR outlier filtering
    const dxValues: number[] = []
    const dyValues: number[] = []

    for (let i = 1; i < sortedEntries.length; i++) {
      const prev = sortedEntries[i - 1]
      const curr = sortedEntries[i]
      const dx = curr.bbox.x - prev.bbox.x
      const dy = curr.bbox.y - prev.bbox.y

      if (Math.abs(dy) < rowThreshold && dx > 0) {
        dxValues.push(dx)
      } else if (dy > 0) {
        dyValues.push(dy)
      }
    }

    const filteredDx = iqrFilter(dxValues)
    const filteredDy = iqrFilter(dyValues)
    const medianXSpacing = filteredDx.length > 0 ? median(filteredDx) : 0
    const medianYSpacing = filteredDy.length > 0 ? median(filteredDy) : 0

    // Use pattern canvas dimensions to calculate grid size
    if (patternCanvas.value && medianXSpacing > 0 && medianYSpacing > 0) {
      autoGridCols.value = Math.round(patternCanvas.value.width / medianXSpacing)
      autoGridRows.value = Math.round(patternCanvas.value.height / medianYSpacing)
      console.log(`[OCR] 自动检测网格: ${autoGridCols.value} x ${autoGridRows.value} (中位数间距: ${medianXSpacing.toFixed(1)} x ${medianYSpacing.toFixed(1)}, 过滤前: x=${dxValues.length} y=${dyValues.length}, 过滤后: x=${filteredDx.length} y=${filteredDy.length})`)
    }
  }

  ocrProgress.value = null
}

// Core legend parsing logic shared by both parseLegendWithOcr and parseLegendWithOcrWithOverlay
function _parseLegendCore(
  ocrLines: readonly { text: string, box: { points: readonly {x:number,y:number}[] } }[],
  canvasHeight: number
): Map<string, LegendEntry> {
  // Step 1: Brand auto-detection
  const brandIndex = buildBrandCodeIndex()
  const brandScores = new Map<string, number>()
  for (const brand of brandIndex.keys()) {
    brandScores.set(brand, 0)
  }

  for (const line of ocrLines) {
    const text = line.text.trim().toUpperCase()
    for (const [brand, codes] of brandIndex) {
      if (codes.has(text)) {
        brandScores.set(brand, (brandScores.get(brand) || 0) + 1)
      }
    }
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

  console.log(`[OCR] Brand detection: ${detectedBrand} (${maxScore} codes matched)`)

  if (!detectedBrand || maxScore === 0) {
    console.warn('[OCR] No brand codes detected, legend parsing failed')
    return new Map()
  }

  const brandCodes = brandIndex.get(detectedBrand)!

  // Step 2: Build OcrToken array
  const tokens: OcrToken[] = []
  const discarded: string[] = []

  for (const line of ocrLines) {
    const text = line.text.trim()
    const upperText = text.toUpperCase()
    const pts = line.box.points

    const centerX = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4
    const centerY = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4
    const bbox = {
      x: pts[0].x,
      y: pts[0].y,
      width: pts[1].x - pts[0].x,
      height: pts[2].y - pts[0].y,
    }

    if (brandCodes.has(upperText)) {
      // Exact match against known color codes
      tokens.push({ text, bbox, centerX, centerY, isCode: true })
    } else if (/^\d+$/.test(text)) {
      // Pure number → likely a quantity
      tokens.push({ text, bbox, centerX, centerY, isCode: false })
    } else {
      // Not a code or number → discard
      discarded.push(text)
    }
  }

  if (discarded.length > 0) {
    console.log(`[OCR] Discarded non-code text: ${discarded.join(', ')}`)
  }

  // Step 3: Spatial pairing
  const codeTokens = tokens.filter(t => t.isCode)

  if (codeTokens.length === 0) {
    console.warn('[OCR] No valid color codes recognized')
    return new Map()
  }

  // Compute median code-to-code distance for pairing threshold
  let maxDistance = 100 // default
  if (codeTokens.length >= 2) {
    const sortedByX = [...codeTokens].sort((a, b) => a.centerX - b.centerX)
    const dxValues: number[] = []
    for (let i = 1; i < sortedByX.length; i++) {
      const dx = sortedByX[i].centerX - sortedByX[i-1].centerX
      if (dx > 0) dxValues.push(dx)
    }
    const sortedByY = [...codeTokens].sort((a, b) => a.centerY - b.centerY)
    const dyValues: number[] = []
    for (let i = 1; i < sortedByY.length; i++) {
      const dy = sortedByY[i].centerY - sortedByY[i-1].centerY
      if (dy > 0) dyValues.push(dy)
    }

    // Use 0.6× median spacing as max pairing distance
    const medianDx = dxValues.length > 0 ? median(iqrFilter(dxValues)) : 100
    const medianDy = dyValues.length > 0 ? median(iqrFilter(dyValues)) : 100
    maxDistance = Math.max(30, Math.min(medianDx, medianDy) * 0.6)
    console.log(`[OCR] Median spacing: dx=${medianDx.toFixed(1)}, dy=${medianDy.toFixed(1)}, maxPairDistance=${maxDistance.toFixed(1)}`)
  }

  const paired = pairCodeQuantityByProximity(tokens, maxDistance)

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

  // Dynamic row-threshold: 0.5% of image height, minimum 10px
  const rowThreshold = Math.max(10, (legendCanvas.value?.height || 200) * 0.005)
  
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

  // Use core parsing function
  legendData.value = _parseLegendCore(result.lines, legendCanvas.value.height)
  const entries = legendData.value

  // Auto-detect grid cell size from text spacing
  if (entries.size >= 2) {
    const sortedEntries = Array.from(entries.values()).sort((a, b) => {
      if (Math.abs(a.bbox.y - b.bbox.y) > rowThreshold) return a.bbox.y - b.bbox.y
      return a.bbox.x - b.bbox.x
    })

    // Calculate spacing using median with IQR outlier filtering
    const dxValues: number[] = []
    const dyValues: number[] = []

    for (let i = 1; i < sortedEntries.length; i++) {
      const prev = sortedEntries[i - 1]
      const curr = sortedEntries[i]
      const dx = curr.bbox.x - prev.bbox.x
      const dy = curr.bbox.y - prev.bbox.y

      if (Math.abs(dy) < rowThreshold && dx > 0) {
        dxValues.push(dx)
      } else if (dy > 0) {
        dyValues.push(dy)
      }
    }

    const filteredDx = iqrFilter(dxValues)
    const filteredDy = iqrFilter(dyValues)
    const medianXSpacing = filteredDx.length > 0 ? median(filteredDx) : 0
    const medianYSpacing = filteredDy.length > 0 ? median(filteredDy) : 0

    if (patternCanvas.value && medianXSpacing > 0 && medianYSpacing > 0) {
      autoGridCols.value = Math.round(patternCanvas.value.width / medianXSpacing)
      autoGridRows.value = Math.round(patternCanvas.value.height / medianYSpacing)
      console.log(`[OCR] 自动检测网格: ${autoGridCols.value} x ${autoGridRows.value} (中位数间距: ${medianXSpacing.toFixed(1)} x ${medianYSpacing.toFixed(1)}, 过滤前: x=${dxValues.length} y=${dyValues.length}, 过滤后: x=${filteredDx.length} y=${filteredDy.length})`)
    }
  }

  // Infer grid from OCR box centers for additional validation
  if (result.lines.length >= 4) {
    const inferred = inferGridFromOcrBoxes(result.lines as unknown as { box: { points: {x:number,y:number}[] } }[])
    inferredGrid.value = inferred
    console.log(`[OCR] OCR框聚类推断网格: ${inferred.cols} x ${inferred.rows} (置信度: ${inferred.confidence})`)
  }

  // Infer grid from edge signals for additional voting input
  let edgeResult = { rows: 0, cols: 0, confidence: 0 }
  if (patternCanvas.value) {
    const pCtx = patternCanvas.value.getContext('2d')
    if (pCtx) {
      const edgeImageData = pCtx.getImageData(0, 0, patternCanvas.value.width, patternCanvas.value.height)
      edgeResult = inferGridFromEdges(edgeImageData)
      if (edgeResult.confidence > 0 && edgeResult.cols > 0 && edgeResult.rows > 0) {
        console.log(`[OCR] 边缘自相关检测网格: ${edgeResult.cols} x ${edgeResult.rows} (置信度: ${edgeResult.confidence})`)
      }
    }
  }

  // Combine all detection results via majority voting
  const ocrResult = { rows: autoGridRows.value, cols: autoGridCols.value }
  const ocrBoxResult = inferredGrid.value
  const combined = detectGridDimensions(ocrResult, ocrBoxResult, edgeResult)
  detectionConfidence.value = combined

  // Update final auto grid values from combined result
  if (combined.rows > 0 && combined.cols > 0) {
    autoGridRows.value = combined.rows
    autoGridCols.value = combined.cols
    console.log(`[OCR] 最终检测结果: ${combined.cols}x${combined.rows} (方法: ${combined.method}, 置信度: ${combined.confidence})`)
  } else {
    console.log(`[OCR] 最终检测结果: 所有自动检测方法均失败 (OCR间距: ${ocrResult.cols}x${ocrResult.rows}, OCR框聚类: ${ocrBoxResult.cols}x${ocrBoxResult.rows}, 边缘检测: ${edgeResult.cols}x${edgeResult.rows}), 请手动输入网格尺寸`)
  }
}

// Pattern color extraction with overlay progress
async function extractPatternColorsWithOverlay() {
  if (!patternCanvas.value) return
  
  // Validate canvas has valid dimensions
  if (patternCanvas.value.width <= 0 || patternCanvas.value.height <= 0) {
    console.error('[OCR] 图案画布尺寸无效:', patternCanvas.value.width, 'x', patternCanvas.value.height);
    processingMessage.value = '错误：图案裁剪区域无效，请重新裁剪';
    showProcessingOverlay.value = false;
    return;
  }

  console.log('[OCR] 开始图纸颜色提取')
  processingMessage.value = '正在提取图纸颜色...'
  processingProgress.value = { phase: 'extracting', percent: 0 }

  const canvas = patternCanvas.value
  const ctx = canvas.getContext('2d')!
  const cols = autoGridCols.value || gridCols.value
  const rows = autoGridRows.value || gridRows.value
  const cellW = canvas.width / cols
  const cellH = canvas.height / rows
  const borderTrim = Math.max(1, Math.min(cellW, cellH) * 0.1)

  console.log(`[OCR] 图纸尺寸: ${canvas.width} x ${canvas.height}, 网格: ${cols} x ${rows}, 格子: ${cellW.toFixed(1)} x ${cellH.toFixed(1)}`)

  const cells: PatternCell[] = []
  const colorCounts = new Map<string, { count: number, cells: Array<{ row: number, col: number }> }>()
  const palette = paletteStore.activeBeadPalette

  const totalCells = rows * cols
  let processedCells = 0

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = Math.round(col * cellW)
      const y = Math.round(row * cellH)
      const w = Math.round(cellW)
      const h = Math.round(cellH)

      const imageData = ctx.getImageData(x, y, w, h)
      const dominantColor = getDominantColorByArea(imageData, borderTrim, { step: gridStep.value })

      const match = dominantColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
      if (!match) continue

      const r = parseInt(match[1], 10)
      const g = parseInt(match[2], 10)
      const b = parseInt(match[3], 10)

      const closest = findClosestPaletteColor({ r, g, b }, palette)
      const hex = closest.hex
      const code = closest.key || '?'

      cells.push({ row, col, rgb: dominantColor, hex, code })

      const existing = colorCounts.get(code)
      if (existing) {
        existing.count++
        existing.cells.push({ row, col })
      } else {
        colorCounts.set(code, { count: 1, cells: [{ row, col }] })
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

  console.log('[OCR] 图纸颜色提取完成，共', cells.length, '个格子，', colorCounts.size, '种颜色')
  patternColorData.value = cells

  // Build diff data
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
    if (!legendData.value.has(code)) {
      diff.push({
        code,
        expectedCount: 0,
        actualCount: data.count,
        diff: data.count,
        cells: data.cells
      })
    }
  }

  diff.sort((a, b) => {
    const aMismatch = Math.abs(a.diff)
    const bMismatch = Math.abs(b.diff)
    if (aMismatch > 0 && bMismatch === 0) return -1
    if (aMismatch === 0 && bMismatch > 0) return 1
    return bMismatch - aMismatch
  })

  diffData.value = diff
  console.log('[OCR] 差异对比完成，共', diff.length, '个颜色')
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
  // Find hex for this code from patternColorData
  const cell = patternColorData.value.find(c => c.code === code)
  return cell?.hex || '#e5e7eb'
}

function extractColorSlices(code: string) {
  if (!patternCanvas.value) return

  const canvas = patternCanvas.value
  const ctx = canvas.getContext('2d')!
  const cols = autoGridCols.value || gridCols.value
  const rows = autoGridRows.value || gridRows.value
  const cellW = canvas.width / cols
  const cellH = canvas.height / rows

  const slices: ColorSlice[] = []

  // Find all cells with this code
  const entry = diffData.value.find(d => d.code === code)
  if (!entry) return

  for (const cell of entry.cells) {
    const x = Math.round(cell.col * cellW)
    const y = Math.round(cell.row * cellH)
    const w = Math.round(cellW)
    const h = Math.round(cellH)
    const imageData = ctx.getImageData(x, y, w, h)
    slices.push({ row: cell.row, col: cell.col, imageData })
  }

  colorSlices.value = slices
  selectedSlice.value = null
}

function handleSliceClick(row: number, col: number) {
  if (selectedSlice.value?.row === row && selectedSlice.value?.col === col) {
    selectedSlice.value = null
  } else {
    selectedSlice.value = { row, col }
  }
}

function handleBackToDiffList() {
  selectedDiffColor.value = null
  colorSlices.value = []
  selectedSlice.value = null
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
    if (!legendData.value.has(code)) {
      diff.push({
        code,
        expectedCount: 0,
        actualCount: data.count,
        diff: data.count,
        cells: data.cells
      })
    }
  }

  diff.sort((a, b) => {
    const aMismatch = Math.abs(a.diff)
    const bMismatch = Math.abs(b.diff)
    if (aMismatch > 0 && bMismatch === 0) return -1
    if (aMismatch === 0 && bMismatch > 0) return 1
    return bMismatch - aMismatch
  })

  diffData.value = diff
}

function handleBackToVerify() {
  ocrStep.value = 'ocr-verify'
  selectedDiffColor.value = null
}

function handleOcrComplete() {
  // Emit gridConfirm with the extracted data
  if (!patternCanvas.value) return
  const cols = autoGridCols.value || gridCols.value
  const rows = autoGridRows.value || gridRows.value
  
  // Build pixelColors from patternColorData
  const pixelColors: string[][] = []
  for (let row = 0; row < rows; row++) {
    const rowColors: string[] = []
    for (let col = 0; col < cols; col++) {
      const cell = patternColorData.value.find(c => c.row === row && c.col === col)
      rowColors.push(cell?.rgb || 'rgb(0, 0, 0)')
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
  // Show overlay and start color extraction
  showProcessingOverlay.value = true;
  processingMessage.value = '正在提取图纸颜色...';
  processingProgress.value = { phase: 'extracting', percent: 0 };
  
  console.log('[OCR] 确认识别结果，开始提取图纸颜色')
  
  nextTick(async () => {
    try {
      await extractPatternColorsWithOverlay();
      console.log('[OCR] 图纸颜色提取完成')
    } catch (err) {
      console.error('[OCR] 图纸颜色提取失败:', err)
      processingMessage.value = '提取失败，请重试'
    } finally {
      setTimeout(() => {
        showProcessingOverlay.value = false;
        ocrStep.value = 'diff-view';
      }, 500)
    }
  });
}

interface OcrToken {
  text: string
  bbox: { x: number, y: number, width: number, height: number }
  centerX: number
  centerY: number
  isCode: boolean
}

function pairCodeQuantityByProximity(
  tokens: OcrToken[],
  maxDistance: number
): Map<string, { code: string, count: number, codeBbox: { x: number, y: number, width: number, height: number }, countBbox: { x: number, y: number, width: number, height: number } }> {
  // Split tokens into code candidates and number candidates
  const codeTokens = tokens.filter(t => t.isCode)
  const numberTokens = tokens.filter(t => !t.isCode && /^\d+$/.test(t.text.trim()))

  console.log(`[pairCodeQuantity] codeTokens: ${codeTokens.length}, numberTokens: ${numberTokens.length}`)

  // For each codeToken, compute distance to every numberToken
  // Each entry: { codeIdx, numIdx, distance }
  const candidates: { codeIdx: number, numIdx: number, distance: number }[] = []

  for (let ci = 0; ci < codeTokens.length; ci++) {
    const ct = codeTokens[ci]
    for (let ni = 0; ni < numberTokens.length; ni++) {
      const nt = numberTokens[ni]
      const dx = ct.centerX - nt.centerX
      const dy = ct.centerY - nt.centerY
      const distance = Math.sqrt(dx * dx + dy * dy)
      if (distance < maxDistance) {
        candidates.push({ codeIdx: ci, numIdx: ni, distance })
      }
    }
  }

  // Sort by distance ascending so closest pairs are matched first
  candidates.sort((a, b) => a.distance - b.distance)

  const pairedNumbers = new Set<number>()
  const result = new Map<string, { code: string, count: number, codeBbox: { x: number, y: number, width: number, height: number }, countBbox: { x: number, y: number, width: number, height: number } }>()

  for (const cand of candidates) {
    // Skip if this number token is already paired
    if (pairedNumbers.has(cand.numIdx)) continue

    const codeText = codeTokens[cand.codeIdx].text.trim().toUpperCase()
    // Skip if this code is already paired (take the closest match)
    if (result.has(codeText)) continue

    const count = parseInt(numberTokens[cand.numIdx].text.trim(), 10)
    if (isNaN(count)) continue

    pairedNumbers.add(cand.numIdx)
    result.set(codeText, {
      code: codeText,
      count,
      codeBbox: codeTokens[cand.codeIdx].bbox,
      countBbox: numberTokens[cand.numIdx].bbox,
    })

    console.log(`[pairCodeQuantity] paired "${codeText}" (dist=${cand.distance.toFixed(1)}) -> count=${count}`)
  }

  console.log(`[pairCodeQuantity] total pairs: ${result.size}/${codeTokens.length} codes`)
  return result
}

function getColorForCode(code: string): string {
  // Search colorSystemMapping for a hex key whose entry contains this code
  // The mapping is { hex -> { MARD?, COCO?, ... } }
  // We need a reverse lookup: code -> hex
  try {
    const mapping = (colorSystemMappingJson as Record<string, Record<string, string>>)
    for (const [hex, systems] of Object.entries(mapping)) {
      if (Object.values(systems).some(v => v === code)) {
        return hex.startsWith('#') ? hex : `#${hex}`
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
  for (const brand of brands) {
    console.log(`[buildBrandCodeIndex] ${brand}: ${index.get(brand)!.size} codes`)
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

function extractPatternColors() {
  if (!patternCanvas.value) return

  const canvas = patternCanvas.value
  const ctx = canvas.getContext('2d')!
  const cols = autoGridCols.value || gridCols.value
  const rows = autoGridRows.value || gridRows.value

  const cellW = canvas.width / cols
  const cellH = canvas.height / rows
  const borderTrim = Math.max(1, Math.min(cellW, cellH) * 0.1)

  const cells: PatternCell[] = []
  const colorCounts = new Map<string, { count: number, cells: Array<{ row: number, col: number }> }>()

  // Get the active palette for color matching
  const palette = paletteStore.activeBeadPalette

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = Math.round(col * cellW)
      const y = Math.round(row * cellH)
      const w = Math.round(cellW)
      const h = Math.round(cellH)

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
    if (!legendData.value.has(code)) {
      diff.push({
        code,
        expectedCount: 0,
        actualCount: data.count,
        diff: data.count,
        cells: data.cells
      })
    }
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

  const cellW = imgGridArea.width / cols;
  const cellH = imgGridArea.height / rows;
  const pixelColors: string[][] = [];
  const borderTrim = Math.max(1, Math.min(cellW, cellH) * 0.1);

  for (let row = 0; row < rows; row++) {
    const rowColors: string[] = [];
    for (let col = 0; col < cols; col++) {
      const x = Math.round(col * cellW);
      const y = Math.round(row * cellH);
      const w = Math.round(cellW);
      const h = Math.round(cellH);
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
  render();
});

// OCR 预加载
watch(ocrEnabled, async (enabled) => {
  if (!enabled) {
    // 关闭开关时重置状态
    ocrProgress.value = null;
    ocrLoading.value = false;
    return;
  }
  // OCR 启用时重置步骤状态
  ocrStep.value = 'legend-crop'
  isLegendCrop.value = true
  initLegendCrop()
  patternCrop.value = { x: 0, y: 0, width: 0, height: 0 }
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

onMounted(() => {
  window.addEventListener("resize", onResize);
});
onUnmounted(() => {
  window.removeEventListener("resize", onResize);
});
</script>

<template>
  <div ref="containerRef" class="flex bg-white rounded-xl overflow-hidden" style="min-height: 500px;">
    <!-- 左侧工具栏 -->
    <div class="w-[200px] flex flex-col border-r border-black/10 bg-black/[0.02]">
      <!-- 顶部操作 -->
      <div class="flex items-center justify-between px-3 py-3 border-b border-black/10">
        <button
          @click="handleCancel"
          class="h-7 px-2 text-xs rounded-md text-black/60 hover:text-black hover:bg-black/[0.04] transition-colors"
        >
          取消
        </button>
        <button
          v-if="ocrEnabled && ocrStep === 'legend-crop'"
          @click="handleLegendConfirm()"
          class="h-7 px-3 text-xs rounded-md bg-blue-500 text-white hover:bg-blue-600 transition-colors font-medium"
        >
          确认图例
        </button>
        <button
          v-else-if="ocrEnabled && ocrStep === 'pattern-crop'"
          @click="handlePatternConfirm()"
          class="h-7 px-3 text-xs rounded-md bg-emerald-500 text-white hover:bg-emerald-600 transition-colors font-medium"
        >
          确认图纸
        </button>
        <button
          v-else-if="ocrEnabled && ocrStep === 'ocr-verify'"
          @click="handleConfirmOcrVerify()"
          class="h-7 px-3 text-xs rounded-md bg-violet-500 text-white hover:bg-violet-600 transition-colors font-medium"
        >
          确认识别
        </button>
        <button
          v-else-if="ocrEnabled && ocrStep === 'diff-view'"
          @click="handleOcrComplete()"
          class="h-7 px-3 text-xs rounded-md bg-green-500 text-white hover:bg-green-600 transition-colors font-medium"
        >
          完成
        </button>
        <button
          v-else
          @click="mode === 'crop' ? handleConfirm() : handleGridConfirm()"
          class="h-7 px-3 text-xs rounded-md bg-black text-white hover:bg-black/80 transition-colors font-medium"
        >
          确认
        </button>
      </div>

      <!-- 模式切换 (always visible) -->
      <div class="px-3 py-2.5 border-b border-black/10">
        <div class="flex items-center gap-1 p-0.5 rounded-lg bg-black/[0.04] border border-black/[0.08]">
          <button
            @click="mode = 'crop'"
            class="flex-1 px-2 h-7 text-xs rounded-md font-medium transition-colors"
            :class="mode === 'crop' ? 'bg-black text-white shadow-sm' : 'text-black/45 hover:text-black'"
          >
            图纸生成
          </button>
          <button
            @click="mode = 'grid'"
            class="flex-1 px-2 h-7 text-xs rounded-md font-medium transition-colors"
            :class="mode === 'grid' ? 'bg-black text-white shadow-sm' : 'text-black/45 hover:text-black'"
          >
            图纸识别
          </button>
        </div>
      </div>

      <!-- Legend crop tools (OCR step 1) -->
      <div v-if="ocrEnabled && ocrStep === 'legend-crop'" class="flex-1 px-3 py-3 space-y-3 overflow-y-auto">
        <!-- OCR 开关 -->
        <div class="space-y-2">
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-xs text-black/60 select-none">智能识别（OCR）</span>
            <button
              @click="ocrEnabled = !ocrEnabled"
              :disabled="ocrLoading"
              :class="[
                'relative w-9 h-5 rounded-full transition-colors',
                ocrLoading ? 'opacity-50 cursor-not-allowed' : '',
                ocrEnabled ? 'bg-black' : 'bg-black/20'
              ]"
            >
              <span
                :class="[
                  'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                  ocrEnabled ? 'translate-x-4' : 'translate-x-0'
                ]"
              />
            </button>
          </label>
          <!-- OCR 加载状态 -->
          <div v-if="ocrProgress" class="mt-2">
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
        </div>

        <div>
          <p class="text-xs font-medium text-black/80 mb-1">裁剪图例区域</p>
          <p class="text-[10px] text-black/40 leading-relaxed">框选图例区域（包含色号和数量）</p>
        </div>

        <div class="border-t border-black/10 pt-3">
          <p class="text-[10px] text-black/40 uppercase tracking-wider mb-3">缩放</p>
          <div class="flex items-center gap-2">
            <button
              @click="handleZoomOut"
              :disabled="canvasScale <= 0.1"
              class="flex-1 h-8 rounded-lg bg-black/[0.04] text-black/60 hover:bg-black/[0.08] flex items-center justify-center text-sm font-bold disabled:opacity-30"
            >
              −
            </button>
            <span class="text-black/60 text-xs w-10 text-center tabular-nums">{{ canvasScale.toFixed(1) }}x</span>
            <button
              @click="handleZoomIn"
              :disabled="canvasScale >= 10"
              class="flex-1 h-8 rounded-lg bg-black/[0.04] text-black/60 hover:bg-black/[0.08] flex items-center justify-center text-sm font-bold disabled:opacity-30"
            >
              +
            </button>
          </div>
          <button @click="handleResetView" class="w-full h-8 mt-2 rounded-lg bg-black/[0.04] text-black/60 hover:bg-black/[0.08] text-xs">
            重置视图
          </button>
        </div>

        <p class="text-[10px] text-black/40 leading-relaxed">
          拖动蓝色框调整图例区域 · 滚轮缩放
        </p>
      </div>

      <!-- Pattern crop tools (OCR step 2) -->
      <div v-else-if="ocrEnabled && ocrStep === 'pattern-crop'" class="flex-1 px-3 py-3 space-y-3 overflow-y-auto">
        <!-- OCR 开关 -->
        <div class="space-y-2">
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-xs text-black/60 select-none">智能识别（OCR）</span>
            <button
              @click="ocrEnabled = !ocrEnabled"
              :disabled="ocrLoading"
              :class="[
                'relative w-9 h-5 rounded-full transition-colors',
                ocrLoading ? 'opacity-50 cursor-not-allowed' : '',
                ocrEnabled ? 'bg-black' : 'bg-black/20'
              ]"
            >
              <span
                :class="[
                  'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                  ocrEnabled ? 'translate-x-4' : 'translate-x-0'
                ]"
              />
            </button>
          </label>
          <!-- OCR 加载状态 -->
          <div v-if="ocrProgress" class="mt-2">
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
        </div>

        <div>
          <p class="text-xs font-medium text-black/80 mb-1">裁剪图纸区域</p>
          <p class="text-[10px] text-black/40 leading-relaxed">框选图纸区域（包含色块网格）</p>
        </div>

        <div class="border-t border-black/10 pt-3">
          <p class="text-[10px] text-black/40 uppercase tracking-wider mb-3">缩放</p>
          <div class="flex items-center gap-2">
            <button
              @click="handleZoomOut"
              :disabled="canvasScale <= 0.1"
              class="flex-1 h-8 rounded-lg bg-black/[0.04] text-black/60 hover:bg-black/[0.08] flex items-center justify-center text-sm font-bold disabled:opacity-30"
            >
              −
            </button>
            <span class="text-black/60 text-xs w-10 text-center tabular-nums">{{ canvasScale.toFixed(1) }}x</span>
            <button
              @click="handleZoomIn"
              :disabled="canvasScale >= 10"
              class="flex-1 h-8 rounded-lg bg-black/[0.04] text-black/60 hover:bg-black/[0.08] flex items-center justify-center text-sm font-bold disabled:opacity-30"
            >
              +
            </button>
          </div>
          <button @click="handleResetView" class="w-full h-8 mt-2 rounded-lg bg-black/[0.04] text-black/60 hover:bg-black/[0.08] text-xs">
            重置视图
          </button>
        </div>

        <button @click="handleBackToLegend()" class="w-full h-8 rounded-lg bg-black/[0.04] text-black/60 hover:bg-black/[0.08] text-xs transition-colors">
          ← 上一步
        </button>

        <p class="text-[10px] text-black/40 leading-relaxed">
          拖动红框调整图纸区域 · 滚轮缩放
        </p>
      </div>

      <!-- OCR verify tools (Step 3) -->
      <div v-else-if="ocrEnabled && ocrStep === 'ocr-verify'" class="flex-1 px-3 py-3 space-y-3 overflow-y-auto">
        <!-- OCR 开关 -->
        <div class="space-y-2">
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-xs text-black/60 select-none">智能识别（OCR）</span>
            <button
              @click="ocrEnabled = !ocrEnabled"
              :disabled="ocrLoading"
              :class="[
                'relative w-9 h-5 rounded-full transition-colors',
                ocrLoading ? 'opacity-50 cursor-not-allowed' : '',
                ocrEnabled ? 'bg-black' : 'bg-black/20'
              ]"
            >
              <span
                :class="[
                  'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                  ocrEnabled ? 'translate-x-4' : 'translate-x-0'
                ]"
              />
            </button>
          </label>
          <!-- OCR 加载状态 -->
          <div v-if="ocrProgress" class="mt-2">
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
        </div>

        <div>
          <p class="text-xs font-medium text-black/80 mb-1">识别核对</p>
          <p class="text-[10px] text-black/40 leading-relaxed">检查OCR识别结果，修正错误</p>
        </div>

        <!-- Legend entries list -->
        <div class="border-t border-black/10 pt-3">
          <p class="text-[10px] text-black/40 uppercase tracking-wider mb-3">识别结果 ({{ legendData.size }})</p>
          <div class="space-y-2 max-h-60 overflow-y-auto">
            <div v-for="[code, entry] in legendData" :key="code" 
              class="flex items-center gap-2 p-2 rounded-lg bg-black/[0.04]">
              <div class="w-6 h-6 rounded border border-black/10" :style="{ backgroundColor: getColorForCode(code) }"></div>
              <div class="flex-1 min-w-0">
                <p class="text-xs font-medium text-black/80">{{ code }}</p>
              </div>
              <div class="flex items-center gap-1">
                <input
                  type="number"
                  :value="entry.expectedCount"
                  @input="updateLegendCount(code, $event)"
                  class="w-14 px-1.5 py-0.5 bg-white text-black text-center text-xs rounded border border-black/10 focus:border-black/30 focus:outline-none"
                  min="0"
                />
                <button @click="deleteLegendEntry(code)" class="text-red-500 hover:text-red-700 text-xs">×</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Navigation buttons -->
        <div class="border-t border-black/10 pt-3 space-y-2">
          <button @click="handleConfirmOcrVerify()" class="w-full h-8 rounded-lg bg-black text-white hover:bg-black/80 text-xs font-medium transition-colors">
            确认识别
          </button>
          <button @click="handleBackToPattern()" class="w-full h-8 rounded-lg bg-black/[0.04] text-black/60 hover:bg-black/[0.08] text-xs transition-colors">
            ← 上一步
          </button>
        </div>
      </div>

      <!-- Diff view tools (Step 4) -->
      <div v-else-if="ocrEnabled && ocrStep === 'diff-view'" class="flex-1 px-3 py-3 space-y-3 overflow-y-auto">
        <!-- OCR 开关 -->
        <div class="space-y-2">
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-xs text-black/60 select-none">智能识别（OCR）</span>
            <button
              @click="ocrEnabled = !ocrEnabled"
              :disabled="ocrLoading"
              :class="[
                'relative w-9 h-5 rounded-full transition-colors',
                ocrLoading ? 'opacity-50 cursor-not-allowed' : '',
                ocrEnabled ? 'bg-black' : 'bg-black/20'
              ]"
            >
              <span
                :class="[
                  'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                  ocrEnabled ? 'translate-x-4' : 'translate-x-0'
                ]"
              />
            </button>
          </label>
          <!-- OCR 加载状态 -->
          <div v-if="ocrProgress" class="mt-2">
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
        </div>

        <!-- Slice gallery mode -->
        <template v-if="selectedDiffColor && colorSlices.length > 0">
          <div>
            <div class="flex items-center gap-2 mb-1">
              <div class="w-4 h-4 rounded border border-black/10" :style="{ backgroundColor: getColorHex(selectedDiffColor) }"></div>
              <p class="text-xs font-medium text-black/80">色块切片: {{ selectedDiffColor }}</p>
            </div>
            <p class="text-[10px] text-black/40 leading-relaxed">共 {{ colorSlices.length }} 个切片</p>
          </div>

          <!-- Slice list -->
          <div class="border-t border-black/10 pt-3">
            <p class="text-[10px] text-black/40 uppercase tracking-wider mb-3">切片列表</p>
            <div class="space-y-1.5 max-h-60 overflow-y-auto">
              <div v-for="(slice, idx) in colorSlices" :key="idx"
                @click="handleSliceClick(slice.row, slice.col)"
                class="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors text-xs"
                :class="selectedSlice?.row === slice.row && selectedSlice?.col === slice.col ? 'bg-blue-50 border border-blue-200' : 'bg-black/[0.04] hover:bg-black/[0.06]'"
              >
                <div class="w-4 h-4 rounded border border-black/10" :style="{ backgroundColor: getColorHex(selectedDiffColor) }"></div>
                <span class="text-black/70">R{{ slice.row }} C{{ slice.col }}</span>
              </div>
            </div>
          </div>

          <!-- Color picker for selected slice -->
          <div v-if="selectedSlice" class="border-t border-black/10 pt-3">
            <p class="text-[10px] text-black/40 uppercase tracking-wider mb-2">修改颜色</p>
            <p class="text-xs text-black/60 mb-2">R{{ selectedSlice.row }} C{{ selectedSlice.col }}</p>
            <div class="grid grid-cols-6 gap-1.5">
              <button v-for="code in availableColorCodes" :key="code"
                @click="changeSliceColor(selectedSlice.row, selectedSlice.col, code)"
                class="w-6 h-6 rounded border transition-colors"
                :class="code === selectedDiffColor ? 'border-blue-400 ring-1 ring-blue-200' : 'border-black/10 hover:border-black/30'"
                :style="{ backgroundColor: getColorHex(code) }"
                :title="code"
              />
            </div>
          </div>

          <!-- Navigation -->
          <div class="border-t border-black/10 pt-3 space-y-2">
            <button @click="handleBackToDiffList()" class="w-full h-8 rounded-lg bg-black/[0.04] text-black/60 hover:bg-black/[0.08] text-xs transition-colors">
              ← 返回图纸
            </button>
          </div>
        </template>

        <!-- Normal diff list mode -->
        <template v-else>
          <div>
            <p class="text-xs font-medium text-black/80 mb-1">差异对比</p>
            <p class="text-[10px] text-black/40 leading-relaxed">对比图例期望数量与实际数量</p>
          </div>

          <!-- Summary -->
          <div class="border-t border-black/10 pt-3">
            <div class="flex items-center justify-between text-xs">
              <span class="text-black/60">总颜色数</span>
              <span class="font-medium text-black/80">{{ diffData.length }}</span>
            </div>
            <div class="flex items-center justify-between text-xs mt-1">
              <span class="text-black/60">一致</span>
              <span class="font-medium text-green-600">{{ diffData.filter(d => d.diff === 0).length }}</span>
            </div>
            <div class="flex items-center justify-between text-xs mt-1">
              <span class="text-black/60">不一致</span>
              <span class="font-medium text-red-600">{{ diffData.filter(d => d.diff !== 0).length }}</span>
            </div>
          </div>

          <!-- Diff entries list -->
          <div class="border-t border-black/10 pt-3">
            <p class="text-[10px] text-black/40 uppercase tracking-wider mb-3">颜色列表</p>
            <div class="space-y-2 max-h-80 overflow-y-auto">
              <div v-for="entry in diffData" :key="entry.code"
                @click="selectedDiffColor = entry.code; extractColorSlices(entry.code)"
                class="flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors"
                :class="selectedDiffColor === entry.code ? 'bg-black/10' : 'bg-black/[0.04] hover:bg-black/[0.06]'"
              >
                <div class="w-6 h-6 rounded border border-black/10" :style="{ backgroundColor: getColorHex(entry.code) }"></div>
                <div class="flex-1 min-w-0">
                  <p class="text-xs font-medium text-black/80">{{ entry.code }}</p>
                  <p class="text-[10px] text-black/40">期望: {{ entry.expectedCount }} | 实际: {{ entry.actualCount }}</p>
                </div>
                <div class="text-right">
                  <span v-if="entry.diff === 0" class="text-[10px] text-green-600 font-medium">一致</span>
                  <span v-else-if="entry.diff > 0" class="text-[10px] text-orange-500 font-medium">多 {{ entry.diff }}</span>
                  <span v-else class="text-[10px] text-red-500 font-medium">少 {{ Math.abs(entry.diff) }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Navigation buttons -->
          <div class="border-t border-black/10 pt-3 space-y-2">
            <button @click="handleOcrComplete()" class="w-full h-8 rounded-lg bg-black text-white hover:bg-black/80 text-xs font-medium transition-colors">
              完成
            </button>
            <button @click="handleBackToVerify()" class="w-full h-8 rounded-lg bg-black/[0.04] text-black/60 hover:bg-black/[0.08] text-xs transition-colors">
              ← 上一步
            </button>
          </div>
        </template>
      </div>

      <!-- 裁剪工具 -->
      <div v-else-if="mode === 'crop'" class="flex-1 px-3 py-3 space-y-2 overflow-y-auto">
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
        
        <div class="border-t border-black/10 pt-3">
          <p class="text-[10px] text-black/40 uppercase tracking-wider mb-3">缩放</p>
          <div class="flex items-center gap-2">
            <button
              @click="handleZoomOut"
              :disabled="canvasScale <= 0.1"
              class="flex-1 h-8 rounded-lg bg-black/[0.04] text-black/60 hover:bg-black/[0.08] flex items-center justify-center text-sm font-bold disabled:opacity-30"
            >
              −
            </button>
            <span class="text-black/60 text-xs w-10 text-center tabular-nums">{{ canvasScale.toFixed(1) }}x</span>
            <button
              @click="handleZoomIn"
              :disabled="canvasScale >= 10"
              class="flex-1 h-8 rounded-lg bg-black/[0.04] text-black/60 hover:bg-black/[0.08] flex items-center justify-center text-sm font-bold disabled:opacity-30"
            >
              +
            </button>
          </div>
          <button @click="handleResetView" class="w-full h-8 mt-2 rounded-lg bg-black/[0.04] text-black/60 hover:bg-black/[0.08] text-xs">
            重置视图
          </button>
        </div>
      </div>

      <!-- 格子工具 -->
      <div v-else class="flex-1 px-3 py-3 space-y-3 overflow-y-auto">
        <p class="text-[10px] text-black/40 uppercase tracking-wider mb-3">网格设置</p>
        
        <!-- 智能识别（OCR） -->
        <div class="space-y-2">
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-xs text-black/60 select-none">智能识别（OCR）</span>
            <button
              @click="ocrEnabled = !ocrEnabled"
              :disabled="ocrLoading"
              :class="[
                'relative w-9 h-5 rounded-full transition-colors',
                ocrLoading ? 'opacity-50 cursor-not-allowed' : '',
                ocrEnabled ? 'bg-black' : 'bg-black/20'
              ]"
            >
              <span
                :class="[
                  'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                  ocrEnabled ? 'translate-x-4' : 'translate-x-0'
                ]"
              />
            </button>
          </label>
          <!-- OCR 加载状态 -->
          <div v-if="ocrProgress" class="mt-2">
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
        </div>

        <div class="border-t border-black/10 pt-3">
          <p class="text-[10px] text-black/40 uppercase tracking-wider mb-3">网格参数</p>
          <div class="space-y-2">
            <!-- Manual cols/rows (hidden when OCR enabled) -->
            <template v-if="!ocrEnabled">
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
            </template>
            <!-- Auto-detected dims (shown when OCR enabled) -->
            <div v-else class="flex items-center justify-between">
              <span class="text-xs text-black/60">网格尺寸</span>
              <div v-if="!isEditingGrid" class="flex items-center gap-1 cursor-pointer group" @click="startEditGrid">
                <span class="text-xs text-black/80">{{ autoGridCols }}×{{ autoGridRows }} (自动)</span>
                <span
                  v-if="detectionConfidence.confidence > 0"
                  :class="[
                    'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                    detectionConfidence.confidence >= 0.8 ? 'bg-green-100 text-green-700' :
                    detectionConfidence.confidence >= 0.5 ? 'bg-yellow-100 text-yellow-700' :
                    'bg-red-100 text-red-700'
                  ]"
                >
                  {{ detectionConfidence.confidence >= 0.8 ? '高' : detectionConfidence.confidence >= 0.5 ? '中' : '低' }}置信
                </span>
                <svg class="w-3 h-3 text-black/30 group-hover:text-black/60 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </div>
              <div v-else class="flex items-center gap-1">
                <input
                  v-model.number="editGridCols"
                  type="number"
                  min="1"
                  max="200"
                  class="w-12 px-1.5 py-0.5 bg-white text-black text-center text-xs rounded-md border border-black/10 focus:border-black/30 focus:outline-none"
                  @keydown.enter="confirmEditGrid"
                />
                <span class="text-[10px] text-black/40">×</span>
                <input
                  v-model.number="editGridRows"
                  type="number"
                  min="1"
                  max="200"
                  class="w-12 px-1.5 py-0.5 bg-white text-black text-center text-xs rounded-md border border-black/10 focus:border-black/30 focus:outline-none"
                  @keydown.enter="confirmEditGrid"
                />
                <button
                  @click="confirmEditGrid"
                  class="w-5 h-5 rounded bg-black text-white flex items-center justify-center text-[10px] hover:bg-black/80 transition-colors"
                >
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                  </svg>
                </button>
                <button
                  @click="cancelEditGrid"
                  class="w-5 h-5 rounded bg-black/10 text-black/60 flex items-center justify-center text-[10px] hover:bg-black/20 transition-colors"
                >
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <label class="flex items-center justify-between">
              <span class="text-xs text-black/60">步长</span>
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

        <div class="border-t border-black/10 pt-3">
          <p class="text-[10px] text-black/40 uppercase tracking-wider mb-3">缩放</p>
          <div class="flex items-center gap-2">
            <button
              @click="handleZoomOut"
              :disabled="canvasScale <= 0.1"
              class="flex-1 h-8 rounded-lg bg-black/[0.04] text-black/60 hover:bg-black/[0.08] flex items-center justify-center text-sm font-bold disabled:opacity-30"
            >
              −
            </button>
            <span class="text-black/60 text-xs w-10 text-center tabular-nums">{{ canvasScale.toFixed(1) }}x</span>
            <button
              @click="handleZoomIn"
              :disabled="canvasScale >= 10"
              class="flex-1 h-8 rounded-lg bg-black/[0.04] text-black/60 hover:bg-black/[0.08] flex items-center justify-center text-sm font-bold disabled:opacity-30"
            >
              +
            </button>
          </div>
          <button @click="handleGridReset" class="w-full h-8 mt-2 rounded-lg bg-black/[0.04] text-black/60 hover:bg-black/[0.08] text-xs">
            重置
          </button>
        </div>

        <p class="text-[10px] text-black/40 leading-relaxed">
          拖动空白平移 · 拖动红框调整 · 滚轮缩放
        </p>
      </div>
    </div>

    <!-- 右侧画布区域 -->
    <div class="flex-1 flex items-center justify-center p-4 overflow-hidden relative bg-black/[0.02]" style="width: 100%; height: 100%;">
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
      <!-- OCR step indicator (shown when OCR is enabled) -->
      <div
        v-if="ocrEnabled"
        class="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-sm shadow-lg border border-black/10 px-4 py-2 rounded-xl pointer-events-none"
      >
        <div class="flex items-center gap-1">
          <template v-for="(step, index) in [
            { key: 'legend-crop', label: '图例裁剪' },
            { key: 'pattern-crop', label: '图纸裁剪' },
            { key: 'ocr-verify', label: '识别核对' },
            { key: 'diff-view', label: '差异对比' }
          ]" :key="step.key">
            <!-- Step connector line -->
            <div
              v-if="index > 0"
              class="w-6 h-px mx-0.5"
              :class="getStepIndex(ocrStep) >= index ? 'bg-black/60' : 'bg-black/20'"
            />
            <!-- Step item -->
            <div class="flex items-center gap-1.5 px-2 py-1 rounded-full transition-all duration-200"
              :class="[
                ocrStep === step.key ? 'bg-black text-white' : '',
                getStepIndex(ocrStep) > index ? 'text-black/70' : '',
                getStepIndex(ocrStep) < index ? 'text-black/30' : ''
              ]"
            >
              <!-- Step number or checkmark -->
              <div
                class="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-medium"
                :class="[
                  ocrStep === step.key ? 'bg-white/20 text-white' : '',
                  getStepIndex(ocrStep) > index ? 'bg-black/10 text-black/60' : '',
                  getStepIndex(ocrStep) < index ? 'bg-black/5 text-black/20' : ''
                ]"
              >
                <span v-if="getStepIndex(ocrStep) > index">✓</span>
                <span v-else>{{ index + 1 }}</span>
              </div>
              <!-- Step label -->
              <span class="text-[11px] whitespace-nowrap">{{ step.label }}</span>
            </div>
          </template>
        </div>
      </div>
      <!-- Regular hints (shown when OCR is disabled) -->
      <div
        v-else-if="mode === 'crop'"
        class="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 text-white/80 text-xs px-3 py-1.5 rounded-full pointer-events-none"
      >
        拖动四角或边缘调整 · 滚轮缩放 · 自动吸附线条
      </div>
      <div
        v-else-if="mode === 'grid'"
        class="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 text-white/80 text-xs px-3 py-1.5 rounded-full pointer-events-none"
      >
        将红框与图纸边框对齐 · 越精准误差越小
      </div>
    </div>

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
