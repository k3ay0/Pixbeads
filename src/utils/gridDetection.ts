/**
 * Grid detection utilities for OCR table extraction.
 * Provides median calculation, IQR outlier filtering, gap-based clustering,
 * and spacing statistics.
 */

/**
 * Calculate the median of a numeric array.
 * Returns 0 for empty arrays.
 */
export function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Filter values using IQR (Interquartile Range) outlier detection.
 * Returns values within [Q1 - 1.5*IQR, Q3 + 1.5*IQR].
 * Returns empty array for empty input.
 */
export function iqrFilter(values: number[]): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const len = sorted.length;

  // Q1 = 25th percentile, Q3 = 75th percentile
  const q1Idx = Math.floor(len * 0.25);
  const q3Idx = Math.floor(len * 0.75);
  const q1 = sorted[q1Idx];
  const q3 = sorted[q3Idx];
  const iqr = q3 - q1;

  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  return values.filter((v) => v >= lower && v <= upper);
}

/**
 * Cluster centers by gaps between them.
 * A gap larger than medianGap * multiplier starts a new cluster.
 * Returns empty array for empty input.
 */
export function clusterByGaps(centers: number[], multiplier: number = 2.5): number[][] {
  if (centers.length === 0) return [];
  const sorted = [...centers].sort((a, b) => a - b);
  if (sorted.length === 1) return [sorted];

  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(sorted[i] - sorted[i - 1]);
  }

  const medianGap = median(gaps);
  const threshold = medianGap * multiplier;

  const clusters: number[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > threshold) {
      clusters.push([sorted[i]]);
    } else {
      clusters[clusters.length - 1].push(sorted[i]);
    }
  }

  return clusters;
}

/**
 * Type for OCR line objects with bounding box points.
 */
interface OcrBoxLine {
  box: {
    points: Array<{ x: number; y: number }>;
  };
}

/**
 * Infer grid dimensions (rows, cols) from OCR bounding box centers.
 * Extracts the center of each text box, clusters X coordinates for columns
 * and Y coordinates for rows using gap-based clustering.
 *
 * @param lines - OCR result lines, each with box.points (4 corner coordinates)
 * @returns { rows, cols, confidence } where confidence is 0.8 if clusters are
 *          meaningful (≥2 clusters with ≥2 points each), otherwise 0
 */
export function inferGridFromOcrBoxes(
  lines: OcrBoxLine[]
): { rows: number; cols: number; confidence: number } {
  if (lines.length < 4) {
    return { rows: 0, cols: 0, confidence: 0 };
  }

  // Extract center points from each OCR box
  const xCenters: number[] = [];
  const yCenters: number[] = [];

  for (const line of lines) {
    const pts = line.box.points;
    if (!pts || pts.length < 4) continue;
    const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
    const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
    xCenters.push(cx);
    yCenters.push(cy);
  }

  if (xCenters.length < 4) {
    return { rows: 0, cols: 0, confidence: 0 };
  }

  // Cluster X centers → columns, Y centers → rows
  const colClusters = clusterByGaps(xCenters);
  const rowClusters = clusterByGaps(yCenters);

  // Confidence: meaningful if ≥2 clusters each with ≥2 points
  let confidence = 0;
  if (colClusters.length >= 2 && rowClusters.length >= 2) {
    const colSufficient = colClusters.every((c) => c.length >= 2);
    const rowSufficient = rowClusters.every((c) => c.length >= 2);
    if (colSufficient && rowSufficient) {
      confidence = 0.8;
    }
  }

  return {
    rows: rowClusters.length,
    cols: colClusters.length,
    confidence,
  };
}

/**
 * Infer grid dimensions from edge signals using Sobel operator and autocorrelation.
 * Computes per-row and per-column edge strength, then uses autocorrelation
 * to detect the fundamental period (grid cell size). Returns rows, cols, and
 * a confidence score (0.7 when both axes have strong periodic signals, 0 otherwise).
 */
export function inferGridFromEdges(imageData: ImageData): { rows: number; cols: number; confidence: number } {
  const { width, height, data } = imageData;

  if (width < 10 || height < 10) {
    return { rows: 0, cols: 0, confidence: 0 };
  }

  // Step 1: Convert to grayscale
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const idx = i * 4;
    gray[i] = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
  }

  // Step 2: Horizontal edge signal — sum |SobelY| per row
  const edgeY = new Float64Array(height);
  for (let y = 1; y < height - 1; y++) {
    let sum = 0;
    for (let x = 1; x < width - 1; x++) {
      const sobelY =
        -gray[(y - 1) * width + x - 1] - 2 * gray[(y - 1) * width + x] - gray[(y - 1) * width + x + 1]
        + gray[(y + 1) * width + x - 1] + 2 * gray[(y + 1) * width + x] + gray[(y + 1) * width + x + 1];
      sum += Math.abs(sobelY);
    }
    edgeY[y] = sum;
  }

  // Step 3: Vertical edge signal — sum |SobelX| per column
  const edgeX = new Float64Array(width);
  for (let x = 1; x < width - 1; x++) {
    let sum = 0;
    for (let y = 1; y < height - 1; y++) {
      const sobelX =
        -gray[(y - 1) * width + x - 1] - 2 * gray[y * width + x - 1] - gray[(y + 1) * width + x - 1]
        + gray[(y - 1) * width + x + 1] + 2 * gray[y * width + x + 1] + gray[(y + 1) * width + x + 1];
      sum += Math.abs(sobelX);
    }
    edgeX[x] = sum;
  }

  // Step 4: Autocorrelation-based period detection
  function findPeriod(signal: Float64Array): { period: number; strength: number } {
    const n = signal.length;
    if (n < 10) return { period: 0, strength: 0 };

    const minPeriod = Math.max(3, Math.floor(n / 40));
    const maxLag = Math.floor(n / 2);

    // Compute normalized autocorrelation r[k] for k = 0..maxLag
    const r = new Float64Array(maxLag + 1);
    for (let k = 0; k <= maxLag; k++) {
      let sum = 0;
      for (let i = 0; i < n - k; i++) {
        sum += signal[i] * signal[i + k];
      }
      r[k] = sum;
    }

    const dc = r[0];
    if (dc === 0) return { period: 0, strength: 0 };

    // Find first peak after DC that exceeds 15% of DC value
    for (let k = minPeriod; k < maxLag; k++) {
      if (r[k] > r[k - 1] && r[k] >= r[k + 1] && r[k] > 0.15 * dc) {
        return { period: k, strength: r[k] / dc };
      }
    }

    return { period: 0, strength: 0 };
  }

  const periodY = findPeriod(edgeY); // row signal → vertical period → rows count
  const periodX = findPeriod(edgeX); // col signal → horizontal period → cols count

  // Step 5: Grid dimensions
  const cols = periodX.period > 0 ? Math.round(width / periodX.period) : 0;
  const rows = periodY.period > 0 ? Math.round(height / periodY.period) : 0;

  // Step 6: Confidence — binary: 0.7 when both axes are periodic, 0 otherwise
  const confidence = (periodX.strength > 0.15 && periodY.strength > 0.15) ? 0.7 : 0;

  return { rows, cols, confidence };
}

/**
 * Combined result with voting metadata.
 */
export interface GridDimensionsResult {
  rows: number;
  cols: number;
  confidence: number;
  method: string;
}

/**
 * Combine three detection methods via majority voting.
 *
 * 1. All three agree → confidence 0.95, method "三重验证"
 * 2. Two agree → confidence 0.8, method "双重验证"
 * 3. Only one valid → use that method's own confidence
 * 4. None valid → confidence 0, method "手动输入"
 *
 * A result is "valid" when rows > 0 and cols > 0. For ocrBoxResult and
 * edgeResult confidence > 0 is additionally required. Two results "agree"
 * when both rows and cols match.
 */
export function detectGridDimensions(
  ocrResult: { rows: number; cols: number },
  ocrBoxResult: { rows: number; cols: number; confidence: number },
  edgeResult: { rows: number; cols: number; confidence: number }
): GridDimensionsResult {
  const METHOD_LABELS: Record<string, string> = {
    ocr: "OCR间距",
    box: "OCR框聚类",
    edge: "边缘检测",
  };
  const DEFAULT_OCR_CONFIDENCE = 0.75;

  // Collect valid results
  const valid: Array<{ key: string; rows: number; cols: number; confidence: number }> = [];

  if (ocrResult.rows > 0 && ocrResult.cols > 0) {
    valid.push({ key: "ocr", rows: ocrResult.rows, cols: ocrResult.cols, confidence: DEFAULT_OCR_CONFIDENCE });
  }
  if (ocrBoxResult.rows > 0 && ocrBoxResult.cols > 0 && ocrBoxResult.confidence > 0) {
    valid.push({ key: "box", ...ocrBoxResult });
  }
  if (edgeResult.rows > 0 && edgeResult.cols > 0 && edgeResult.confidence > 0) {
    valid.push({ key: "edge", ...edgeResult });
  }

  if (valid.length === 0) {
    return { rows: 0, cols: 0, confidence: 0, method: "手动输入" };
  }

  if (valid.length === 1) {
    return {
      rows: valid[0].rows,
      cols: valid[0].cols,
      confidence: valid[0].confidence,
      method: METHOD_LABELS[valid[0].key],
    };
  }

  // Group by (rows, cols) signature to find agreement
  const groups = new Map<string, Array<{ key: string; confidence: number }>>();
  for (const r of valid) {
    const sig = `${r.rows}x${r.cols}`;
    const g = groups.get(sig) ?? [];
    g.push({ key: r.key, confidence: r.confidence });
    groups.set(sig, g);
  }

  // Find the largest agreement group
  let bestSig = "";
  let bestCount = 0;
  for (const [sig, g] of groups) {
    if (g.length > bestCount) {
      bestCount = g.length;
      bestSig = sig;
    }
  }

  const bestGroup = groups.get(bestSig)!;
  const [finalRows, finalCols] = bestSig.split("x").map(Number);

  if (bestCount === 3) {
    return { rows: finalRows, cols: finalCols, confidence: 0.95, method: "三重验证" };
  }

  if (bestCount === 2) {
    const names = bestGroup.map((r) => METHOD_LABELS[r.key]).join("+");
    return { rows: finalRows, cols: finalCols, confidence: 0.8, method: `双重验证(${names})` };
  }

  // bestCount === 1 but valid.length > 1 → all differ, use highest confidence
  const sorted = [...valid].sort((a, b) => b.confidence - a.confidence);
  return {
    rows: sorted[0].rows,
    cols: sorted[0].cols,
    confidence: sorted[0].confidence,
    method: METHOD_LABELS[sorted[0].key],
  };
}

/**
 * Calculate spacing statistics between sorted entries.
 * Returns average and median of dx and dy differences.
 * Returns all zeros for empty input.
 */
export function calculateSpacing(
  sortedEntries: { x: number; y: number }[]
): { avgX: number; avgY: number; medX: number; medY: number } {
  if (sortedEntries.length < 2) {
    return { avgX: 0, avgY: 0, medX: 0, medY: 0 };
  }

  const dxs: number[] = [];
  const dys: number[] = [];
  for (let i = 1; i < sortedEntries.length; i++) {
    dxs.push(sortedEntries[i].x - sortedEntries[i - 1].x);
    dys.push(sortedEntries[i].y - sortedEntries[i - 1].y);
  }

  const avgX = dxs.reduce((s, v) => s + v, 0) / dxs.length;
  const avgY = dys.reduce((s, v) => s + v, 0) / dys.length;

  return {
    avgX,
    avgY,
    medX: median(dxs),
    medY: median(dys),
  };
}
