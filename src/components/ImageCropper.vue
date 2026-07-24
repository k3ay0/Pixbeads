<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import { getDominantColorByArea } from "../utils/pixelation";
import { useOcrRecognition } from "../composables/useOcrRecognition";

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
  skip: [];
}>();

// OCR
const ocrRecognition = useOcrRecognition();
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

// Canvas view transform (for grid mode panning and zooming)
const canvasTranslateX = ref(0);
const canvasTranslateY = ref(0);
const canvasScale = ref(1);

// Grid crop rect (in display coordinates, relative to transformed image)
const gridCrop = ref({ x: 0, y: 0, width: 0, height: 0 });

// Drag state for grid mode
type GridDragMode =
  | "move"
  | "nw"
  | "ne"
  | "sw"
  | "se"
  | "n"
  | "s"
  | "e"
  | "w"
  | "pan"
  | null;
const gridDragMode = ref<GridDragMode>(null);
const gridDragStart = ref({ x: 0, y: 0 });
const gridCropStart = ref({ x: 0, y: 0, width: 0, height: 0 });
const canvasTranslateStart = ref({ x: 0, y: 0 });

// Drag state for crop mode
type CropDragMode =
  | "move"
  | "nw"
  | "ne"
  | "sw"
  | "se"
  | "n"
  | "s"
  | "e"
  | "w"
  | "pan"
  | null;
const dragMode = ref<CropDragMode>(null);
const dragStart = ref({ x: 0, y: 0 });
const cropStart = ref({ x: 0, y: 0, width: 0, height: 0 });

const HANDLE_SIZE = 12;
const MIN_CROP_SIZE = 20;
const SNAP_THRESHOLD = 15; // 吸附阈值（像素）

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
      const idx = y * width + x;
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
      const idx = y * width + x;
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

// Load image
onMounted(() => {
  const image = new Image();
  image.onload = () => {
    img.value = image;
    imgLoaded.value = true;
    fitImageToContainer();
    initCrop();
    initGridCrop();
    detectEdges(); // 检测图片边缘
    render();
  };
  image.src = props.imageSrc;
});

onUnmounted(() => {
  // Cleanup
});

function fitImageToContainer() {
  if (!img.value || !containerRef.value) return;
  const container = containerRef.value;
  const maxW = container.clientWidth - 32;
  const maxH = container.clientHeight - 32;

  // Get effective dimensions after rotation
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
  // Swap dimensions for 90/270 rotation
  if (rotation.value === 90 || rotation.value === 270) {
    return { width: h, height: w };
  }
  return { width: w, height: h };
}

function initCrop() {
  // Default crop: full image size
  crop.value = {
    x: 0,
    y: 0,
    width: displayWidth.value,
    height: displayHeight.value,
  };
}

function initGridCrop() {
  // Default grid crop: 80% of display size, centered
  const margin = 0.1;
  gridCrop.value = {
    x: displayWidth.value * margin,
    y: displayHeight.value * margin,
    width: displayWidth.value * (1 - 2 * margin),
    height: displayHeight.value * (1 - 2 * margin),
  };
  // Reset canvas transform
  canvasTranslateX.value = 0;
  canvasTranslateY.value = 0;
  canvasScale.value = 1;
}

// Convert display coords to image coords (accounting for transforms)
function displayToImage(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  const s = scale.value;
  return {
    x: Math.round(rect.x / s),
    y: Math.round(rect.y / s),
    width: Math.round(rect.width / s),
    height: Math.round(rect.height / s),
  };
}

// Apply transforms to canvas context
function applyTransforms(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
) {
  ctx.translate(width / 2, height / 2);

  // Apply rotation
  ctx.rotate((rotation.value * Math.PI) / 180);

  // Apply flips
  const scaleX = flipHorizontal.value ? -1 : 1;
  const scaleY = flipVertical.value ? -1 : 1;
  ctx.scale(scaleX, scaleY);

  ctx.translate(-width / 2, -height / 2);
}

// Render
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

  if (mode.value === "crop") {
    renderDetectedEdges(ctx); // 显示检测到的边缘
    renderCropOverlay(ctx);
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
  // Dark overlay outside crop
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  // Top
  ctx.fillRect(0, 0, displayWidth.value, crop.value.y);
  // Bottom
  ctx.fillRect(
    0,
    crop.value.y + crop.value.height,
    displayWidth.value,
    displayHeight.value - crop.value.y - crop.value.height
  );
  // Left
  ctx.fillRect(0, crop.value.y, crop.value.x, crop.value.height);
  // Right
  ctx.fillRect(
    crop.value.x + crop.value.width,
    crop.value.y,
    displayWidth.value - crop.value.x - crop.value.width,
    crop.value.height
  );

  // Crop border
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.strokeRect(
    crop.value.x,
    crop.value.y,
    crop.value.width,
    crop.value.height
  );

  // Corner handles
  const hs = HANDLE_SIZE;
  ctx.fillStyle = "#ffffff";
  // NW
  ctx.fillRect(crop.value.x - hs / 2, crop.value.y - hs / 2, hs, hs);
  // NE
  ctx.fillRect(
    crop.value.x + crop.value.width - hs / 2,
    crop.value.y - hs / 2,
    hs,
    hs
  );
  // SW
  ctx.fillRect(
    crop.value.x - hs / 2,
    crop.value.y + crop.value.height - hs / 2,
    hs,
    hs
  );
  // SE
  ctx.fillRect(
    crop.value.x + crop.value.width - hs / 2,
    crop.value.y + crop.value.height - hs / 2,
    hs,
    hs
  );

  // Edge handles (centered on each edge)
  const ehs = 8;
  // N
  ctx.fillRect(
    crop.value.x + crop.value.width / 2 - ehs,
    crop.value.y - ehs / 2,
    ehs * 2,
    ehs
  );
  // S
  ctx.fillRect(
    crop.value.x + crop.value.width / 2 - ehs,
    crop.value.y + crop.value.height - ehs / 2,
    ehs * 2,
    ehs
  );
  // W
  ctx.fillRect(
    crop.value.x - ehs / 2,
    crop.value.y + crop.value.height / 2 - ehs,
    ehs,
    ehs * 2
  );
  // E
  ctx.fillRect(
    crop.value.x + crop.value.width - ehs / 2,
    crop.value.y + crop.value.height / 2 - ehs,
    ehs,
    ehs * 2
  );

  // Grid lines (rule of thirds)
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.lineWidth = 0.5;
  const thirdW = crop.value.width / 3;
  const thirdH = crop.value.height / 3;
  for (let i = 1; i <= 2; i++) {
    // Vertical
    ctx.beginPath();
    ctx.moveTo(crop.value.x + thirdW * i, crop.value.y);
    ctx.lineTo(crop.value.x + thirdW * i, crop.value.y + crop.value.height);
    ctx.stroke();
    // Horizontal
    ctx.beginPath();
    ctx.moveTo(crop.value.x, crop.value.y + thirdH * i);
    ctx.lineTo(crop.value.x + crop.value.width, crop.value.y + thirdH * i);
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

  // Dark overlay outside grid area
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  // Top
  ctx.fillRect(-10000, -10000, 20000, 10000 + gridAreaY);
  // Bottom
  ctx.fillRect(-10000, gridAreaY + gridAreaH, 20000, 10000);
  // Left
  ctx.fillRect(-10000, gridAreaY, 10000 + gridAreaX, gridAreaH);
  // Right
  ctx.fillRect(gridAreaX + gridAreaW, gridAreaY, 10000, gridAreaH);

  // Grid border (red)
  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 2 / canvasScale.value;
  ctx.strokeRect(gridAreaX, gridAreaY, gridAreaW, gridAreaH);

  // Grid lines
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.lineWidth = 0.5 / canvasScale.value;

  // Vertical lines
  for (let i = 1; i < cols; i++) {
    ctx.beginPath();
    ctx.moveTo(gridAreaX + cellW * i, gridAreaY);
    ctx.lineTo(gridAreaX + cellW * i, gridAreaY + gridAreaH);
    ctx.stroke();
  }

  // Horizontal lines
  for (let i = 1; i < rows; i++) {
    ctx.beginPath();
    ctx.moveTo(gridAreaX, gridAreaY + cellH * i);
    ctx.lineTo(gridAreaX + gridAreaW, gridAreaY + cellH * i);
    ctx.stroke();
  }

  // Corner handles
  const hs = HANDLE_SIZE / canvasScale.value;
  ctx.fillStyle = "#ef4444";
  // NW
  ctx.fillRect(gridAreaX - hs / 2, gridAreaY - hs / 2, hs, hs);
  // NE
  ctx.fillRect(gridAreaX + gridAreaW - hs / 2, gridAreaY - hs / 2, hs, hs);
  // SW
  ctx.fillRect(gridAreaX - hs / 2, gridAreaY + gridAreaH - hs / 2, hs, hs);
  // SE
  ctx.fillRect(
    gridAreaX + gridAreaW - hs / 2,
    gridAreaY + gridAreaH - hs / 2,
    hs,
    hs
  );

  // Edge handles
  const ehs = 8 / canvasScale.value;
  ctx.fillStyle = "#ef4444";
  // N
  ctx.fillRect(
    gridAreaX + gridAreaW / 2 - ehs,
    gridAreaY - ehs / 2,
    ehs * 2,
    ehs
  );
  // S
  ctx.fillRect(
    gridAreaX + gridAreaW / 2 - ehs,
    gridAreaY + gridAreaH - ehs / 2,
    ehs * 2,
    ehs
  );
  // W
  ctx.fillRect(
    gridAreaX - ehs / 2,
    gridAreaY + gridAreaH / 2 - ehs,
    ehs,
    ehs * 2
  );
  // E
  ctx.fillRect(
    gridAreaX + gridAreaW - ehs / 2,
    gridAreaY + gridAreaH / 2 - ehs,
    ehs,
    ehs * 2
  );
}

// Hit test for crop drag mode
function getCropHitMode(x: number, y: number): CropDragMode {
  // 将屏幕坐标转换为画布坐标
  const tx = (x - canvasTranslateX.value) / canvasScale.value;
  const ty = (y - canvasTranslateY.value) / canvasScale.value;
  const c = crop.value;
  const hs = HANDLE_SIZE / canvasScale.value;

  // Check corners first
  if (Math.abs(tx - c.x) < hs && Math.abs(ty - c.y) < hs) return "nw";
  if (Math.abs(tx - (c.x + c.width)) < hs && Math.abs(ty - c.y) < hs) return "ne";
  if (Math.abs(tx - c.x) < hs && Math.abs(ty - (c.y + c.height)) < hs)
    return "sw";
  if (Math.abs(tx - (c.x + c.width)) < hs && Math.abs(ty - (c.y + c.height)) < hs)
    return "se";

  // Check edges
  if (Math.abs(ty - c.y) < hs && tx > c.x && tx < c.x + c.width) return "n";
  if (Math.abs(ty - (c.y + c.height)) < hs && tx > c.x && tx < c.x + c.width)
    return "s";
  if (Math.abs(tx - c.x) < hs && ty > c.y && ty < c.y + c.height) return "w";
  if (Math.abs(tx - (c.x + c.width)) < hs && ty > c.y && ty < c.y + c.height)
    return "e";

  // Check inside crop (move)
  if (tx > c.x && tx < c.x + c.width && ty > c.y && ty < c.y + c.height)
    return "move";

  return "pan";
}

// Hit test for grid mode
function getGridHitMode(x: number, y: number): GridDragMode {
  // Convert screen coords to transformed coords
  const tx = (x - canvasTranslateX.value) / canvasScale.value;
  const ty = (y - canvasTranslateY.value) / canvasScale.value;

  const c = gridCrop.value;
  const hs = HANDLE_SIZE / canvasScale.value;

  // Check corners first
  if (Math.abs(tx - c.x) < hs && Math.abs(ty - c.y) < hs) return "nw";
  if (Math.abs(tx - (c.x + c.width)) < hs && Math.abs(ty - c.y) < hs)
    return "ne";
  if (Math.abs(tx - c.x) < hs && Math.abs(ty - (c.y + c.height)) < hs)
    return "sw";
  if (
    Math.abs(tx - (c.x + c.width)) < hs &&
    Math.abs(ty - (c.y + c.height)) < hs
  )
    return "se";

  // Check edges
  if (Math.abs(ty - c.y) < hs && tx > c.x && tx < c.x + c.width) return "n";
  if (Math.abs(ty - (c.y + c.height)) < hs && tx > c.x && tx < c.x + c.width)
    return "s";
  if (Math.abs(tx - c.x) < hs && ty > c.y && ty < c.y + c.height) return "w";
  if (Math.abs(tx - (c.x + c.width)) < hs && ty > c.y && ty < c.y + c.height)
    return "e";

  // Check inside grid crop (move)
  if (tx > c.x && tx < c.x + c.width && ty > c.y && ty < c.y + c.height)
    return "move";

  // Outside grid crop - pan
  return "pan";
}

// Get cursor for drag mode
function getCropCursor(mode: CropDragMode): string {
  switch (mode) {
    case "nw":
    case "se":
      return "nwse-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    case "n":
    case "s":
      return "ns-resize";
    case "e":
    case "w":
      return "ew-resize";
    case "move":
      return "move";
    case "pan":
      return "grab";
    default:
      return "default";
  }
}

function getGridCursor(mode: GridDragMode): string {
  switch (mode) {
    case "nw":
    case "se":
      return "nwse-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    case "n":
    case "s":
      return "ns-resize";
    case "e":
    case "w":
      return "ew-resize";
    case "move":
      return "move";
    case "pan":
      return "grab";
    default:
      return "default";
  }
}

// Mouse/touch handlers
function onPointerDown(e: MouseEvent | TouchEvent) {
  const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
  const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
  const canvas = canvasRef.value!;
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left) * (canvas.width / rect.width);
  const y = (clientY - rect.top) * (canvas.height / rect.height);

  if (mode.value === "crop") {
    const hitMode = getCropHitMode(x, y);
    dragMode.value = hitMode;
    dragStart.value = { x: clientX, y: clientY };
    cropStart.value = { ...crop.value };
    canvasTranslateStart.value = { x: canvasTranslateX.value, y: canvasTranslateY.value };
  } else {
    const hitMode = getGridHitMode(x, y);
    if (!hitMode) return;
    gridDragMode.value = hitMode;
    gridDragStart.value = { x: clientX, y: clientY };
    gridCropStart.value = { ...gridCrop.value };
    canvasTranslateStart.value = {
      x: canvasTranslateX.value,
      y: canvasTranslateY.value,
    };
  }

  if ("touches" in e) e.preventDefault();
}

function onPointerMove(e: MouseEvent | TouchEvent) {
  const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
  const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
  const canvas = canvasRef.value!;
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left) * (canvas.width / rect.width);
  const y = (clientY - rect.top) * (canvas.height / rect.height);

  if (mode.value === "crop") {
    // Update cursor on hover
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
      if ("touches" in e) e.preventDefault();
      return;
    }

    const dx = (clientX - dragStart.value.x) / canvasScale.value;
    const dy = (clientY - dragStart.value.y) / canvasScale.value;
    const c = cropStart.value;
    const maxW = displayWidth.value;
    const maxH = displayHeight.value;

    let newX = c.x;
    let newY = c.y;
    let newW = c.width;
    let newH = c.height;

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
        newW = snapToEdge(newW);
        newH = c.y + c.height - newY;
        break;
      case "sw":
        newX = Math.max(0, Math.min(c.x + c.width - MIN_CROP_SIZE, c.x + dx));
        newW = c.x + c.width - newX;
        newH = Math.max(MIN_CROP_SIZE, Math.min(maxH - c.y, c.height + dy));
        // 智能吸附
        newX = snapToEdge(newX);
        newH = snapToEdge(newH);
        newW = c.x + c.width - newX;
        break;
      case "se":
        newW = Math.max(MIN_CROP_SIZE, Math.min(maxW - c.x, c.width + dx));
        newH = Math.max(MIN_CROP_SIZE, Math.min(maxH - c.y, c.height + dy));
        // 智能吸附
        newW = snapToEdge(newW);
        newH = snapToEdge(newH);
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
        newH = snapToEdge(newH);
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
        newW = snapToEdge(newW);
        break;
    }

    crop.value = { x: newX, y: newY, width: newW, height: newH };
  } else {
    // Grid mode
    if (!gridDragMode.value) {
      const hitMode = getGridHitMode(x, y);
      canvas.style.cursor = getGridCursor(hitMode);
      return;
    }

    const dx = (clientX - gridDragStart.value.x) / canvasScale.value;
    const dy = (clientY - gridDragStart.value.y) / canvasScale.value;
    const c = gridCropStart.value;

    if (gridDragMode.value === "pan") {
      // Pan the canvas
      canvasTranslateX.value =
        canvasTranslateStart.value.x + (clientX - gridDragStart.value.x);
      canvasTranslateY.value =
        canvasTranslateStart.value.y + (clientY - gridDragStart.value.y);
    } else {
      // Adjust grid crop in display coordinates
      let newX = c.x;
      let newY = c.y;
      let newW = c.width;
      let newH = c.height;

      switch (gridDragMode.value) {
        case "move":
          newX = Math.max(0, Math.min(displayWidth.value - c.width, c.x + dx));
          newY = Math.max(
            0,
            Math.min(displayHeight.value - c.height, c.y + dy)
          );
          // 智能吸附
          newX = snapToEdge(newX);
          newY = snapToEdge(newY);
          break;
        case "nw":
          newX = Math.max(0, Math.min(c.x + c.width - MIN_CROP_SIZE, c.x + dx));
          newY = Math.max(
            0,
            Math.min(c.y + c.height - MIN_CROP_SIZE, c.y + dy)
          );
          newW = c.x + c.width - newX;
          newH = c.y + c.height - newY;
          // 智能吸附
          newX = snapToEdge(newX);
          newY = snapToEdge(newY);
          newW = c.x + c.width - newX;
          newH = c.y + c.height - newY;
          break;
        case "ne":
          newY = Math.max(
            0,
            Math.min(c.y + c.height - MIN_CROP_SIZE, c.y + dy)
          );
          newW = Math.max(
            MIN_CROP_SIZE,
            Math.min(displayWidth.value - c.x, c.width + dx)
          );
          newH = c.y + c.height - newY;
          // 智能吸附
          newY = snapToEdge(newY);
          newW = snapToEdge(newW);
          newH = c.y + c.height - newY;
          break;
        case "sw":
          newX = Math.max(0, Math.min(c.x + c.width - MIN_CROP_SIZE, c.x + dx));
          newW = c.x + c.width - newX;
          newH = Math.max(
            MIN_CROP_SIZE,
            Math.min(displayHeight.value - c.y, c.height + dy)
          );
          // 智能吸附
          newX = snapToEdge(newX);
          newH = snapToEdge(newH);
          newW = c.x + c.width - newX;
          break;
        case "se":
          newW = Math.max(
            MIN_CROP_SIZE,
            Math.min(displayWidth.value - c.x, c.width + dx)
          );
          newH = Math.max(
            MIN_CROP_SIZE,
            Math.min(displayHeight.value - c.y, c.height + dy)
          );
          // 智能吸附
          newW = snapToEdge(newW);
          newH = snapToEdge(newH);
          break;
        case "n":
          newY = Math.max(
            0,
            Math.min(c.y + c.height - MIN_CROP_SIZE, c.y + dy)
          );
          newH = c.y + c.height - newY;
          // 智能吸附
          newY = snapToEdge(newY);
          newH = c.y + c.height - newY;
          break;
        case "s":
          newH = Math.max(
            MIN_CROP_SIZE,
            Math.min(displayHeight.value - c.y, c.height + dy)
          );
          // 智能吸附
          newH = snapToEdge(newH);
          break;
        case "w":
          newX = Math.max(0, Math.min(c.x + c.width - MIN_CROP_SIZE, c.x + dx));
          newW = c.x + c.width - newX;
          // 智能吸附
          newX = snapToEdge(newX);
          newW = c.x + c.width - newX;
          break;
        case "e":
          newW = Math.max(
            MIN_CROP_SIZE,
            Math.min(displayWidth.value - c.x, c.width + dx)
          );
          // 智能吸附
          newW = snapToEdge(newW);
          break;
      }

      gridCrop.value = { x: newX, y: newY, width: newW, height: newH };
    }
  }

  render();

  if ("touches" in e) e.preventDefault();
}

function onPointerUp() {
  dragMode.value = null;
  gridDragMode.value = null;
}

// Mouse wheel for zooming (both modes)
function onWheel(e: WheelEvent) {
  // 两个模式都支持缩放
  e.preventDefault();

  const canvas = canvasRef.value!;
  const rect = canvas.getBoundingClientRect();

  // Get mouse position relative to canvas
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  // Calculate zoom factor
  const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
  const newScale = Math.max(0.1, Math.min(10, canvasScale.value * zoomFactor));

  // Zoom centered on mouse position
  const scaleRatio = newScale / canvasScale.value;
  canvasTranslateX.value =
    mouseX - (mouseX - canvasTranslateX.value) * scaleRatio;
  canvasTranslateY.value =
    mouseY - (mouseY - canvasTranslateY.value) * scaleRatio;
  canvasScale.value = newScale;

  render();
}

// Transform functions
function handleRotate() {
  rotation.value = ((rotation.value + 90) % 360) as 0 | 90 | 180 | 270;
  fitImageToContainer();
  initCrop();
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
  initGridCrop();
  render();
}

// Grid zoom controls
function handleZoomIn() {
  const newScale = Math.min(10, canvasScale.value * 1.2);
  // Zoom centered on canvas center
  const canvas = canvasRef.value!;
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const scaleRatio = newScale / canvasScale.value;
  canvasTranslateX.value =
    centerX - (centerX - canvasTranslateX.value) * scaleRatio;
  canvasTranslateY.value =
    centerY - (centerY - canvasTranslateY.value) * scaleRatio;
  canvasScale.value = newScale;
  render();
}

function handleZoomOut() {
  const newScale = Math.max(0.1, canvasScale.value / 1.2);
  // Zoom centered on canvas center
  const canvas = canvasRef.value!;
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const scaleRatio = newScale / canvasScale.value;
  canvasTranslateX.value =
    centerX - (centerX - canvasTranslateX.value) * scaleRatio;
  canvasTranslateY.value =
    centerY - (centerY - canvasTranslateY.value) * scaleRatio;
  canvasScale.value = newScale;
  render();
}

function handleGridReset() {
  initGridCrop();
  handleResetView();
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

// Confirm crop
function handleConfirm() {
  if (!img.value) return;

  // Get the crop area in display coordinates
  const imgRect = displayToImage(crop.value);

  // Create a temporary canvas with the transformed image
  const { width: effW, height: effH } = getEffectiveDimensions();
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = effW;
  tempCanvas.height = effH;
  const tempCtx = tempCanvas.getContext("2d")!;

  // Apply transforms to temp canvas
  tempCtx.save();
  applyTransforms(tempCtx, effW, effH);
  tempCtx.drawImage(img.value, 0, 0, effW, effH);
  tempCtx.restore();

  // Now crop from the transformed image
  const resultCanvas = document.createElement("canvas");
  resultCanvas.width = imgRect.width;
  resultCanvas.height = imgRect.height;
  const resultCtx = resultCanvas.getContext("2d")!;

  resultCtx.drawImage(
    tempCanvas,
    imgRect.x,
    imgRect.y,
    imgRect.width,
    imgRect.height,
    0,
    0,
    imgRect.width,
    imgRect.height
  );

  emit("confirm", resultCanvas);
}

// Confirm grid alignment
function handleGridConfirm() {
  if (!img.value) return;

  const cols = gridCols.value;
  const rows = gridRows.value;

  // Convert grid crop from display coords to image coords
  const imgGridArea = displayToImage(gridCrop.value);

  // Create a temporary canvas with the transformed image
  const { width: effW, height: effH } = getEffectiveDimensions();
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = effW;
  tempCanvas.height = effH;
  const tempCtx = tempCanvas.getContext("2d")!;

  // Apply transforms to temp canvas
  tempCtx.save();
  applyTransforms(tempCtx, effW, effH);
  tempCtx.drawImage(img.value, 0, 0, effW, effH);
  tempCtx.restore();

  // Create result canvas with the grid area
  const resultCanvas = document.createElement("canvas");
  resultCanvas.width = imgGridArea.width;
  resultCanvas.height = imgGridArea.height;
  const resultCtx = resultCanvas.getContext("2d")!;

  resultCtx.drawImage(
    tempCanvas,
    imgGridArea.x,
    imgGridArea.y,
    imgGridArea.width,
    imgGridArea.height,
    0,
    0,
    imgGridArea.width,
    imgGridArea.height
  );

  // Calculate pixel colors for each cell
  const cellW = imgGridArea.width / cols;
  const cellH = imgGridArea.height / rows;
  const pixelColors: string[][] = [];

  // Border trim amount (10% of cell size, at least 1 pixel)
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

// Skip crop (use original)
function handleSkip() {
  emit("skip");
}

// Window resize
function onResize() {
  fitImageToContainer();
  initCrop();
  render();
}

// Watch for mode changes
watch(mode, () => {
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
  <div
    class="fixed inset-0 bg-gray-950/95 z-[60] flex flex-col"
    style="touch-action: none"
  >
    <!-- Header -->
    <div class="flex items-center justify-between px-5 py-3 bg-gray-900/80">
      <button
        @click="handleSkip"
        class="min-h-[44px] min-w-[60px] px-3 text-white/70 active:text-white text-sm"
      >
        取消
      </button>
      <span class="text-white/50 text-sm">{{
        mode === "crop" ? "图纸生成" : "图纸识别"
      }}</span>
      <button
        @click="mode === 'crop' ? handleConfirm() : handleGridConfirm()"
        class="min-h-[44px] min-w-[60px] px-3 text-brand-500 active:text-brand-400 text-sm font-semibold"
      >
        完成
      </button>
    </div>

    <!-- Mode tabs -->
    <div class="flex justify-center gap-3 py-2.5 bg-gray-900/60">
      <button
        @click="mode = 'crop'"
        class="min-h-[44px] px-6 rounded-full text-sm transition-colors"
        :class="
          mode === 'crop'
            ? 'bg-gray-50 text-gray-900'
            : 'bg-white/10 text-white/70 active:bg-white/20'
        "
      >
        图纸生成
      </button>
      <button
        @click="mode = 'grid'"
        class="min-h-[44px] px-6 rounded-full text-sm transition-colors"
        :class="
          mode === 'grid'
            ? 'bg-brand-500 text-white'
            : 'bg-white/10 text-white/70 active:bg-white/20'
        "
      >
        图纸识别
      </button>
    </div>

    <!-- Grid info (only in grid mode) -->
    <div v-if="mode === 'grid'" class="text-center py-2 bg-gray-900/60">
      <!-- 智能识别（OCR） -->
      <div class="flex items-center justify-center gap-2 mb-2">
        <span class="text-white/60 text-sm select-none">智能识别（OCR）</span>
        <button
          @click="ocrEnabled = !ocrEnabled"
          :disabled="ocrLoading"
          :class="[
            'relative w-10 h-6 rounded-full transition-colors',
            ocrLoading ? 'opacity-50 cursor-not-allowed' : '',
            ocrEnabled ? 'bg-brand-500' : 'bg-gray-600'
          ]"
        >
          <span
            :class="[
              'absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform',
              ocrEnabled ? 'translate-x-4' : 'translate-x-0'
            ]"
          />
        </button>
      </div>
      <!-- OCR 加载状态 -->
      <div v-if="ocrProgress" class="mb-2">
        <div class="flex items-center justify-center gap-2">
          <div v-if="ocrProgress.phase !== 'ready' && ocrProgress.phase !== 'error'" class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          <svg v-else-if="ocrProgress.phase === 'ready'" class="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
          <svg v-else class="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
          <span class="text-xs text-white/60">
            {{ ocrProgress.phaseLabel }}
          </span>
        </div>
        <!-- 加载中显示进度条 -->
        <div v-if="ocrProgress.percent != null" class="mt-2 w-full bg-white/10 rounded-full h-1.5">
          <div
            class="bg-brand-500 h-1.5 rounded-full transition-all duration-300"
            :style="{ width: `${Math.min(100, Math.max(0, ocrProgress.percent))}%` }"
          />
        </div>
      </div>

      <!-- 网格参数 -->
      <div class="flex items-center justify-center gap-4">
        <label class="flex items-center gap-2">
          <span class="text-white/60 text-sm">横向</span>
          <input
            v-model.number="gridCols"
            type="number"
            min="1"
            max="100"
            class="w-16 px-2 py-1 bg-gray-800 text-white text-center rounded border border-gray-600 focus:border-brand-500 focus:outline-none"
          />
          <span class="text-white/60 text-sm">格</span>
        </label>
        <label class="flex items-center gap-2">
          <span class="text-white/60 text-sm">纵向</span>
          <input
            v-model.number="gridRows"
            type="number"
            min="1"
            max="100"
            class="w-16 px-2 py-1 bg-gray-800 text-white text-center rounded border border-gray-600 focus:border-brand-500 focus:outline-none"
          />
          <span class="text-white/60 text-sm">格</span>
        </label>
        <label class="flex items-center gap-2">
          <span class="text-white/60 text-sm">步长</span>
          <input
            v-model.number="gridStep"
            type="number"
            min="1"
            max="64"
            class="w-16 px-2 py-1 bg-gray-800 text-white text-center rounded border border-gray-600 focus:border-brand-500 focus:outline-none"
          />
          <span class="text-white/60 text-sm w-3"></span>
        </label>
      </div>
    </div>

    <!-- Canvas area -->
    <div
      ref="containerRef"
      class="flex-1 flex items-center justify-center p-4 overflow-hidden relative"
      style="width: 100%; height: 100%;"
    >
      <canvas
        ref="canvasRef"
        class="cursor-move"
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
      <div
        v-if="mode === 'crop'"
        class="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/60 text-white/80 text-xs px-4 py-2 rounded-full pointer-events-none animate-pulse"
      >
        拖动四角或边缘调整 · 滚轮缩放 · 自动吸附线条
      </div>
      <div
        v-if="mode === 'grid'"
        class="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/60 text-white/80 text-xs px-4 py-2 rounded-full pointer-events-none animate-pulse"
      >
        将红框与图纸边框对齐 · 越精准误差越小
      </div>
    </div>

    <!-- Bottom toolbar -->
    <div
      class="px-4 py-4 bg-gray-900/80"
      style="padding-bottom: max(16px, env(safe-area-inset-bottom))"
    >
      <template v-if="mode === 'crop'">
        <div class="flex flex-col items-center gap-3">
          <div class="flex justify-center gap-6">
            <!-- Rotate -->
            <button
              @click="handleRotate"
              class="flex flex-col items-center gap-1 min-w-[56px] min-h-[56px] justify-center text-white/70 active:text-white"
            >
              <svg
                class="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                ></path>
            </svg>
            <span class="text-[11px]">旋转</span>
          </button>

          <!-- Flip Horizontal -->
          <button
            @click="handleFlipHorizontal"
            class="flex flex-col items-center gap-1 min-w-[56px] min-h-[56px] justify-center text-white/70 active:text-white"
          >
            <svg
              class="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
              ></path>
            </svg>
            <span class="text-[11px]">水平翻转</span>
          </button>

          <!-- Flip Vertical -->
          <button
            @click="handleFlipVertical"
            class="flex flex-col items-center gap-1 min-w-[56px] min-h-[56px] justify-center text-white/70 active:text-white"
          >
            <svg
              class="w-6 h-6 rotate-90"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
              ></path>
            </svg>
            <span class="text-[11px]">垂直翻转</span>
          </button>

          <!-- Reset -->
          <button
            @click="handleReset"
            class="flex flex-col items-center gap-1 min-w-[56px] min-h-[56px] justify-center text-white/70 active:text-white"
          >
            <svg
              class="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4 4v5h.582m0 0a8.001 8.001 0 0115.356 2M4.582 9H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              ></path>
            </svg>
            <span class="text-[11px]">重置</span>
          </button>
          </div>
          <div class="flex items-center justify-center gap-5">
            <button
              @click="handleZoomOut"
              :disabled="canvasScale <= 0.1"
              class="min-h-[48px] min-w-[48px] rounded-full bg-white/10 text-white/70 active:bg-white/20 flex items-center justify-center text-xl font-bold disabled:opacity-30"
            >
              −
            </button>
            <span class="text-white/60 text-sm w-14 text-center tabular-nums"
              >{{ canvasScale.toFixed(1) }}x</span
            >
            <button
              @click="handleZoomIn"
              :disabled="canvasScale >= 10"
              class="min-h-[48px] min-w-[48px] rounded-full bg-white/10 text-white/70 active:bg-white/20 flex items-center justify-center text-xl font-bold disabled:opacity-30"
            >
              +
            </button>
            <button
              @click="handleResetView"
              class="min-h-[44px] px-4 rounded-full bg-white/10 text-white/70 active:bg-white/20 text-sm"
            >
              重置视图
            </button>
          </div>
        </div>
      </template>
      <template v-else>
        <div class="flex flex-col items-center gap-2">
          <div class="flex items-center justify-center gap-5">
            <button
              @click="handleZoomOut"
              :disabled="canvasScale <= 0.1"
              class="min-h-[48px] min-w-[48px] rounded-full bg-white/10 text-white/70 active:bg-white/20 flex items-center justify-center text-xl font-bold disabled:opacity-30"
            >
              −
            </button>
            <span class="text-white/60 text-sm w-14 text-center tabular-nums"
              >{{ canvasScale.toFixed(1) }}x</span
            >
            <button
              @click="handleZoomIn"
              :disabled="canvasScale >= 10"
              class="min-h-[48px] min-w-[48px] rounded-full bg-white/10 text-white/70 active:bg-white/20 flex items-center justify-center text-xl font-bold disabled:opacity-30"
            >
              +
            </button>
            <button
              @click="handleGridReset"
              class="min-h-[44px] px-4 rounded-full bg-white/10 text-white/70 active:bg-white/20 text-sm"
            >
              重置
            </button>
          </div>
          <p class="text-white/40 text-xs">
            拖动空白平移 · 拖动红框调整 · 双指/滚轮缩放
          </p>
        </div>
      </template>
    </div>
  </div>
</template>