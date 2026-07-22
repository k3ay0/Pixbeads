<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from "vue";
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
  cancel: [];
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
const ocrEnabled = ref(false);

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

// Load image
onMounted(() => {
  const image = new Image();
  image.onload = () => {
    img.value = image;
    imgLoaded.value = true;
    nextTick(() => {
      fitImageToContainer();
      initCrop();
      initGridCrop();
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

function initGridCrop() {
  const margin = 0.1;
  gridCrop.value = {
    x: displayWidth.value * margin,
    y: displayHeight.value * margin,
    width: displayWidth.value * (1 - 2 * margin),
    height: displayHeight.value * (1 - 2 * margin),
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

  if (mode.value === "crop") {
    renderCropOverlay(ctx);
  } else {
    renderGridOverlay(ctx);
  }

  ctx.restore();
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
  const c = crop.value;
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
    canvasTranslateStart.value = { x: canvasTranslateX.value, y: canvasTranslateY.value };
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
    let newX = c.x, newY = c.y, newW = c.width, newH = c.height;

    switch (dragMode.value) {
      case "move":
        newX = Math.max(0, Math.min(maxW - c.width, c.x + dx));
        newY = Math.max(0, Math.min(maxH - c.height, c.y + dy));
        break;
      case "nw":
        newX = Math.max(0, Math.min(c.x + c.width - MIN_CROP_SIZE, c.x + dx));
        newY = Math.max(0, Math.min(c.y + c.height - MIN_CROP_SIZE, c.y + dy));
        newW = c.x + c.width - newX;
        newH = c.y + c.height - newY;
        break;
      case "ne":
        newY = Math.max(0, Math.min(c.y + c.height - MIN_CROP_SIZE, c.y + dy));
        newW = Math.max(MIN_CROP_SIZE, Math.min(maxW - c.x, c.width + dx));
        newH = c.y + c.height - newY;
        break;
      case "sw":
        newX = Math.max(0, Math.min(c.x + c.width - MIN_CROP_SIZE, c.x + dx));
        newW = c.x + c.width - newX;
        newH = Math.max(MIN_CROP_SIZE, Math.min(maxH - c.y, c.height + dy));
        break;
      case "se":
        newW = Math.max(MIN_CROP_SIZE, Math.min(maxW - c.x, c.width + dx));
        newH = Math.max(MIN_CROP_SIZE, Math.min(maxH - c.y, c.height + dy));
        break;
      case "n":
        newY = Math.max(0, Math.min(c.y + c.height - MIN_CROP_SIZE, c.y + dy));
        newH = c.y + c.height - newY;
        break;
      case "s":
        newH = Math.max(MIN_CROP_SIZE, Math.min(maxH - c.y, c.height + dy));
        break;
      case "w":
        newX = Math.max(0, Math.min(c.x + c.width - MIN_CROP_SIZE, c.x + dx));
        newW = c.x + c.width - newX;
        break;
      case "e":
        newW = Math.max(MIN_CROP_SIZE, Math.min(maxW - c.x, c.width + dx));
        break;
    }
    crop.value = { x: newX, y: newY, width: newW, height: newH };
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
          break;
        case "nw":
          newX = Math.max(0, Math.min(c.x + c.width - MIN_CROP_SIZE, c.x + dx));
          newY = Math.max(0, Math.min(c.y + c.height - MIN_CROP_SIZE, c.y + dy));
          newW = c.x + c.width - newX;
          newH = c.y + c.height - newY;
          break;
        case "ne":
          newY = Math.max(0, Math.min(c.y + c.height - MIN_CROP_SIZE, c.y + dy));
          newW = Math.max(MIN_CROP_SIZE, Math.min(displayWidth.value - c.x, c.width + dx));
          newH = c.y + c.height - newY;
          break;
        case "sw":
          newX = Math.max(0, Math.min(c.x + c.width - MIN_CROP_SIZE, c.x + dx));
          newW = c.x + c.width - newX;
          newH = Math.max(MIN_CROP_SIZE, Math.min(displayHeight.value - c.y, c.height + dy));
          break;
        case "se":
          newW = Math.max(MIN_CROP_SIZE, Math.min(displayWidth.value - c.x, c.width + dx));
          newH = Math.max(MIN_CROP_SIZE, Math.min(displayHeight.value - c.y, c.height + dy));
          break;
        case "n":
          newY = Math.max(0, Math.min(c.y + c.height - MIN_CROP_SIZE, c.y + dy));
          newH = c.y + c.height - newY;
          break;
        case "s":
          newH = Math.max(MIN_CROP_SIZE, Math.min(displayHeight.value - c.y, c.height + dy));
          break;
        case "w":
          newX = Math.max(0, Math.min(c.x + c.width - MIN_CROP_SIZE, c.x + dx));
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
  if ("touches" in e) e.preventDefault();
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
  const borderTrim = Math.max(1, Math.floor(Math.min(cellW, cellH) * 0.1));

  for (let row = 0; row < rows; row++) {
    const rowColors: string[] = [];
    for (let col = 0; col < cols; col++) {
      const x = Math.round(col * cellW);
      const y = Math.round(row * cellH);
      const w = Math.round(cellW);
      const h = Math.round(cellH);
      const imageData = resultCtx.getImageData(x, y, w, h);
      const dominantColor = getDominantColorByArea(imageData, borderTrim);
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
  render();
}

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
          @click="mode === 'crop' ? handleConfirm() : handleGridConfirm()"
          class="h-7 px-3 text-xs rounded-md bg-black text-white hover:bg-black/80 transition-colors font-medium"
        >
          确认
        </button>
      </div>

      <!-- 模式切换 -->
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

      <!-- 裁剪工具 -->
      <div v-if="mode === 'crop'" class="flex-1 px-3 py-3 space-y-2 overflow-y-auto">
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
      <div
        v-if="mode === 'crop'"
        class="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 text-white/80 text-xs px-3 py-1.5 rounded-full pointer-events-none"
      >
        拖动四角或边缘调整 · 滚轮缩放 · 拖动空白平移
      </div>
      <div
        v-if="mode === 'grid'"
        class="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 text-white/80 text-xs px-3 py-1.5 rounded-full pointer-events-none"
      >
        将红框与图纸边框对齐 · 越精准误差越小
      </div>
    </div>
  </div>
</template>
