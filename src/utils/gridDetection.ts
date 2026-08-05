/**
 * Grid detection utilities using flood-fill based detection.
 */

/**
 * Bounding box of a connected region.
 */
interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Combined result with method metadata.
 */
export interface GridDimensionsResult {
  rows: number;
  cols: number;
  confidence: number;
  method: string;
  gridLineThickness: number;
}

/**
 * Convert RGBA image data to grayscale.
 */
function toGrayscale(data: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const idx = i * 4;
    gray[i] = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
  }
  return gray;
}

/**
 * Check if two grayscale pixels are "similar" (within tolerance).
 */
function isSimilar(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

/**
 * Flood-fill from a seed pixel, returning the bounding box of the connected region.
 * Uses a stack-based approach for performance.
 *
 * @param gray - grayscale image data
 * @param width - image width
 * @param height - image height
 * @param seedX - seed pixel X
 * @param seedY - seed pixel Y
 * @param tolerance - grayscale similarity tolerance (default 30)
 * @returns bounding box of the filled region
 */
function floodFillBBox(
  gray: Uint8Array,
  width: number,
  height: number,
  seedX: number,
  seedY: number,
  tolerance: number = 30
): BoundingBox {
  const visited = new Uint8Array(width * height);
  const stack: Array<[number, number]> = [[seedX, seedY]];
  const seedVal = gray[seedY * width + seedX];

  let minX = seedX, maxX = seedX, minY = seedY, maxY = seedY;

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    const idx = y * width + x;

    if (visited[idx]) continue;
    if (!isSimilar(gray[idx], seedVal, tolerance)) continue;

    visited[idx] = 1;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;

    // 4-connected neighbors
    if (x > 0) stack.push([x - 1, y]);
    if (x < width - 1) stack.push([x + 1, y]);
    if (y > 0) stack.push([x, y - 1]);
    if (y < height - 1) stack.push([x, y + 1]);
  }

  return { minX, maxX, minY, maxY };
}

/**
 * Find non-background seed pixels for flood fill.
 * Randomly samples positions and returns seeds whose grayscale is between lowThresh and highThresh.
 *
 * @param count - number of seeds to find (default 10)
 * @returns array of [x, y] seed positions
 */
function findSeeds(
  gray: Uint8Array,
  width: number,
  height: number,
  count: number = 10,
  lowThresh: number = 40,
  highThresh: number = 215
): Array<[number, number]> {
  const seeds: Array<[number, number]> = [];
  const totalPixels = width * height;
  const maxAttempts = Math.min(count * 20, 2000);

  for (let attempt = 0; attempt < maxAttempts && seeds.length < count; attempt++) {
    const idx = Math.floor(Math.random() * totalPixels);
    const val = gray[idx];
    if (val > lowThresh && val < highThresh) {
      seeds.push([idx % width, Math.floor(idx / width)]);
    }
  }

  // Fallback: scan top-left quadrant if not enough seeds
  for (let y = 10; y < Math.min(height - 10, Math.floor(height / 3)) && seeds.length < count; y++) {
    for (let x = 10; x < Math.min(width - 10, Math.floor(width / 3)) && seeds.length < count; x++) {
      const val = gray[y * width + x];
      if (val > lowThresh && val < highThresh) {
        seeds.push([x, y]);
      }
    }
  }

  return seeds;
}

/**
 * Calculate the mode (most frequent value) of a numeric array.
 * Returns the first occurring mode if there are ties.
 */
function mode(arr: number[]): number {
  if (arr.length === 0) return 0;
  const counts = new Map<number, number>();
  for (const v of arr) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let maxCount = 0;
  let maxVal = arr[0];
  for (const [val, cnt] of counts) {
    if (cnt > maxCount) {
      maxCount = cnt;
      maxVal = val;
    }
  }
  return maxVal;
}

/**
 * 剔除偏离参考值过大的异常数据，同时返回保留项在原始数组中的索引。
 * 以中位数（比众数更稳健）为参考，剔除偏差超过参考值 ratio 比例的数据。
 *
 * @param arr - 原始数据数组
 * @param ratio - 允许的最大相对偏差比例（默认 0.25，即允许 ±25%）
 * @returns { values, indices } 过滤后的值数组与对应的原始索引数组；
 *          若过滤后为空则回退到原始数据（indices 为 0..n-1）
 */
function filterOutliersWithIndices(
  arr: number[],
  ratio: number = 0.25
): { values: number[]; indices: number[] } {
  if (arr.length <= 1) {
    return { values: [...arr], indices: arr.map((_, i) => i) };
  }

  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];

  if (median <= 0) {
    return { values: [...arr], indices: arr.map((_, i) => i) };
  }

  const values: number[] = [];
  const indices: number[] = [];
  arr.forEach((v, i) => {
    if (Math.abs(v - median) <= median * ratio) {
      values.push(v);
      indices.push(i);
    }
  });

  if (values.length === 0) {
    return { values: [...arr], indices: arr.map((_, i) => i) };
  }
  return { values, indices };
}

/**
 * 剔除偏离参考值过大的异常数据。
 * 以中位数（比众数更稳健）为参考，剔除偏差超过参考值 ratio 比例的数据。
 *
 * @param arr - 原始数据数组
 * @param ratio - 允许的最大相对偏差比例（默认 0.25，即允许 ±25%）
 * @returns 过滤后的数组；若过滤后为空则回退到原始数组
 */
function filterOutliers(arr: number[], ratio: number = 0.25): number[] {
  return filterOutliersWithIndices(arr, ratio).values;
}

/**
 * Measure the grid line thickness by scanning outward from a cell boundary.
 *
 * @param gray - grayscale image data
 * @param width - image width
 * @param height - image height
 * @param bbox - bounding box of the cell to scan from
 * @param direction - 'right' for vertical lines, 'down' for horizontal lines
 * @param tolerance - grayscale similarity tolerance
 * @returns thickness in pixels, or 0 if detection fails
 */
function measureLineThickness(
  gray: Uint8Array,
  width: number,
  height: number,
  bbox: BoundingBox,
  direction: 'right' | 'down',
  tolerance: number = 30
): number {
  if (direction === 'right') {
    const startX = bbox.maxX + 1;
    const midY = Math.floor((bbox.minY + bbox.maxY) / 2);

    if (startX >= width) return 0;

    // Get the seed value (last pixel of the cell)
    const seedVal = gray[midY * width + bbox.maxX];

    // Scan right: skip pixels similar to seed (remaining cell edge)
    let gapStart = startX;
    while (gapStart < width && isSimilar(gray[midY * width + gapStart], seedVal, tolerance)) {
      gapStart++;
    }

    // Now at start of line/gap: scan until we find a new cell (different region)
    let lineEnd = gapStart;
    while (lineEnd < width && !isSimilar(gray[midY * width + lineEnd], seedVal, tolerance)) {
      lineEnd++;
    }

    // The line thickness is the gap between cells
    return lineEnd - gapStart;
  } else {
    // direction === 'down'
    const startY = bbox.maxY + 1;
    const midX = Math.floor((bbox.minX + bbox.maxX) / 2);

    if (startY >= height) return 0;

    const seedVal = gray[bbox.maxY * width + midX];

    // Scan down: skip pixels similar to seed
    let gapStart = startY;
    while (gapStart < height && isSimilar(gray[gapStart * width + midX], seedVal, tolerance)) {
      gapStart++;
    }

    // Now at start of line/gap: scan until we find a new cell
    let lineEnd = gapStart;
    while (lineEnd < height && !isSimilar(gray[lineEnd * width + midX], seedVal, tolerance)) {
      lineEnd++;
    }

    return lineEnd - gapStart;
  }
}

/**
 * Calculate cell dimensions from a bounding box.
 * Returns { cellWidth, cellHeight } or null if the box is too small.
 */
function calculateCellDimensions(bbox: BoundingBox): { cellWidth: number; cellHeight: number } | null {
  const cellWidth = bbox.maxX - bbox.minX + 1;
  const cellHeight = bbox.maxY - bbox.minY + 1;

  // Sanity check: a cell must be at least 3px in each dimension
  if (cellWidth < 3 || cellHeight < 3) return null;

  return { cellWidth, cellHeight };
}

/**
 * Infer grid dimensions from image data using flood-fill based detection.
 *
 * Algorithm:
 * 1. Convert to grayscale
 * 2. Randomly sample multiple seed pixels and flood-fill each to detect cells
 * 3. Collect cell sizes from all detected cells
 * 4. Filter out outliers, take the mode of widths/heights separately, then average
 * 5. Measure grid line thickness (merge h/v, filter outliers, take mode)
 * 6. Divide image dimensions by cell size and grid line thickness to get rows and cols
 * 7. Compute confidence from fit and consistency
 *
 * @param imageData - raw RGBA image data
 * @param sampleCount - number of random samples (default 10)
 * @returns { rows, cols, confidence, gridLineThickness }
 */
export function inferGridFromEdges(
  imageData: ImageData,
  sampleCount: number = 10
): {
  rows: number;
  cols: number;
  confidence: number;
  gridLineThickness: number;
} {
  const { width, height, data } = imageData;

  const defaultReturn = {
    rows: 0,
    cols: 0,
    confidence: 0,
    gridLineThickness: 0,
  };

  if (width < 20 || height < 20) {
    console.log(`[网格检测] 图像太小，跳过: ${width}x${height}`);
    return defaultReturn;
  }

  // Step 1: Convert to grayscale
  const gray = toGrayscale(data, width, height);

  // Step 2: Find multiple seeds and flood-fill each
  const seeds = findSeeds(gray, width, height, sampleCount);
  if (seeds.length === 0) {
    console.log(`[网格检测] 未找到种子像素`);
    return defaultReturn;
  }
  console.log(`[网格检测] 找到 ${seeds.length} 个种子点:`, seeds.map(s => `(${s[0]},${s[1]})`).join(' '));

  // Step 3: Collect cell dimensions from all detected cells
  const cellWidths: number[] = [];
  const cellHeights: number[] = [];
  const bboxes: BoundingBox[] = [];

  for (const [seedX, seedY] of seeds) {
    const bbox = floodFillBBox(gray, width, height, seedX, seedY, 30);
    const cellDims = calculateCellDimensions(bbox);
    if (cellDims) {
      cellWidths.push(cellDims.cellWidth);
      cellHeights.push(cellDims.cellHeight);
      bboxes.push(bbox);
    }
    console.log(
      `[网格检测] 种子(${seedX},${seedY}) 填充区域 bbox=[${bbox.minX},${bbox.minY}]-[${bbox.maxX},${bbox.maxY}] ` +
      `尺寸=${cellDims ? `${cellDims.cellWidth}x${cellDims.cellHeight}` : '无效(太小)'}`
    );
  }

  if (cellWidths.length === 0) {
    console.log(`[网格检测] 所有种子填充区域均无效`);
    return defaultReturn;
  }
  console.log(`[网格检测] 所有格子宽度: ${cellWidths.join(',')}`);
  console.log(`[网格检测] 所有格子高度: ${cellHeights.join(',')}`);

  // Step 4: 宽高分别剔除异常值后取众数，再取平均作为统一格子尺寸（正方形格子）
  const { values: cleanCellWidths, indices: validWidthIndices } = filterOutliersWithIndices(cellWidths);
  const { values: cleanCellHeights, indices: validHeightIndices } = filterOutliersWithIndices(cellHeights);
  const modeCellWidth = mode(cleanCellWidths);
  const modeCellHeight = mode(cleanCellHeights);
  const cellSize = Math.round((modeCellWidth + modeCellHeight) / 2);
  if (cleanCellWidths.length < cellWidths.length) {
    console.log(`[网格检测] 宽度剔除异常值: ${cellWidths.join(',')} → ${cleanCellWidths.join(',')}`);
  }
  if (cleanCellHeights.length < cellHeights.length) {
    console.log(`[网格检测] 高度剔除异常值: ${cellHeights.join(',')} → ${cleanCellHeights.join(',')}`);
  }
  console.log(`[网格检测] 宽度众数=${modeCellWidth}, 高度众数=${modeCellHeight}, 统一格子尺寸=${cellSize}`);

  // 有效格子 = 宽高均非异常的格子（其网格线测量才可信）
  const validWidthSet = new Set(validWidthIndices);
  const validCellIndices = validHeightIndices.filter(i => validWidthSet.has(i));
  console.log(`[网格检测] 有效格子 ${validCellIndices.length}/${cellWidths.length}: [${validCellIndices.join(',')}]`);

  // Step 5: Measure grid line thickness (横竖合并后剔除异常值，直接取众数)
  const hThicknesses: number[] = [];
  const vThicknesses: number[] = [];

  // 从有效格子底部向下扫描（水平网格线）
  for (let i = 0; i < Math.min(5, validCellIndices.length); i++) {
    const bbox = bboxes[validCellIndices[i]];
    const h = measureLineThickness(gray, width, height, bbox, 'down');
    if (h > 0) hThicknesses.push(h);
    console.log(`[网格检测] 水平线测量[格子${validCellIndices[i]}]: ${h}`);
  }

  // 从有效格子右侧向右扫描（垂直网格线）
  for (let i = 0; i < Math.min(5, validCellIndices.length); i++) {
    const bbox = bboxes[validCellIndices[i]];
    const v = measureLineThickness(gray, width, height, bbox, 'right');
    if (v > 0) vThicknesses.push(v);
    console.log(`[网格检测] 垂直线测量[格子${validCellIndices[i]}]: ${v}`);
  }

  // 横竖合并为一个数组，剔除异常值后直接取众数作为统一网格线厚度
  const allThicknesses = [...hThicknesses, ...vThicknesses];
  const cleanThickness = filterOutliers(allThicknesses);
  if (cleanThickness.length < allThicknesses.length) {
    console.log(`[网格检测] 网格线厚度剔除异常值: ${allThicknesses.join(',')} → ${cleanThickness.join(',')}`);
  }

  const gridLineThickness = cleanThickness.length > 0 ? mode(cleanThickness) : 0;
  console.log(`[网格检测] 网格线厚度众数=${gridLineThickness}`);

  // Step 6: Calculate grid count, accounting for grid line thickness
  // 总宽度 = cols * cellSize + (cols - 1) * gridLineThickness
  // → cols = (width + gridLineThickness) / (cellSize + gridLineThickness)
  const rawCols = gridLineThickness > 0
    ? (width + gridLineThickness) / (cellSize + gridLineThickness)
    : width / cellSize;
  const rawRows = gridLineThickness > 0
    ? (height + gridLineThickness) / (cellSize + gridLineThickness)
    : height / cellSize;

  const cols = Math.round(rawCols);
  const rows = Math.round(rawRows);

  if (rows < 2 || cols < 2) {
    console.log(`[网格检测] 网格过小: ${cols}x${rows}`);
    return defaultReturn;
  }
  console.log(`[网格检测] 原始格数: ${rawCols.toFixed(2)}x${rawRows.toFixed(2)}, 取整后: ${cols}x${rows}`);

  // Step 7: Calculate confidence based on fit and consistency
  const colRemainder = Math.abs(rawCols - cols) / cols;
  const rowRemainder = Math.abs(rawRows - rows) / rows;
  const fitScore = 1 - (colRemainder + rowRemainder) / 2;

  // Consistency: 过滤异常值后，宽高分别匹配众数的比例，取平均
  const widthConsistency = cleanCellWidths.filter(w => w === modeCellWidth).length / cleanCellWidths.length;
  const heightConsistency = cleanCellHeights.filter(h => h === modeCellHeight).length / cleanCellHeights.length;
  const consistencyScore = (widthConsistency + heightConsistency) / 2;

  // Combined confidence: fit score (60%) + consistency (40%)
  const combinedScore = fitScore * 0.6 + consistencyScore * 0.4;

  let confidence = 0;
  if (combinedScore > 0.9 && rows >= 3 && cols >= 3) {
    confidence = 0.85;
  } else if (combinedScore > 0.8 && rows >= 2 && cols >= 2) {
    confidence = 0.7;
  } else if (rows >= 2 && cols >= 2) {
    confidence = 0.5;
  }
  console.log(
    `[网格检测] 拟合度=${fitScore.toFixed(3)}, 一致性=${consistencyScore.toFixed(3)}, ` +
    `综合=${combinedScore.toFixed(3)}, 置信度=${confidence}`
  );

  return { rows, cols, confidence, gridLineThickness };
}

/**
 * Detect grid dimensions using flood-fill based edge detection only.
 */
export function detectGridDimensions(
  _ocrResult: { rows: number; cols: number },
  _ocrBoxResult: { rows: number; cols: number; confidence: number },
  edgeResult: {
    rows: number;
    cols: number;
    confidence: number;
    gridLineThickness?: number;
  }
): GridDimensionsResult {
  if (edgeResult.rows > 0 && edgeResult.cols > 0 && edgeResult.confidence > 0) {
    return {
      rows: edgeResult.rows,
      cols: edgeResult.cols,
      confidence: edgeResult.confidence,
      method: "物理检测",
      gridLineThickness: edgeResult.gridLineThickness ?? 0,
    };
  }

  return { rows: 0, cols: 0, confidence: 0, method: "手动输入", gridLineThickness: 0 };
}
