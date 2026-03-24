export interface QuadraticFitResult {
  a: number;
  b: number;
  c: number;
  r2: number;
}

export interface OldClassificationResult {
  label: string;
  deltaX: number;
}

export interface NewClassificationResult {
  label: string;
  angle: number;
  a: number;
  b: number;
  c: number;
  r2: number;
  slopeAtMid: number;
  trimmedN: number;
  outliers: number;
}

export interface TrajectoryClassificationResult {
  label: string;
  angle: number;
  headX: number;
  headY: number;
  tailX: number;
  tailY: number;
  dx: number;
  dy: number;
  pointsUsed: number;
}

/**
 * Least-squares fit x = a*y^2 + b*y + c via Gaussian elimination.
 */
export function quadraticFit(
  yVals: number[],
  xVals: number[]
): QuadraticFitResult {
  const n = yVals.length;
  if (n < 3) return { a: 0, b: 0, c: 0, r2: 0 };

  const S0 = n;
  let S1 = 0,
    S2 = 0,
    S3 = 0,
    S4 = 0;
  let Sx = 0,
    Sxy = 0,
    Sxy2 = 0;
  for (let i = 0; i < n; i++) {
    const y = yVals[i],
      y2 = y * y,
      x = xVals[i];
    S1 += y;
    S2 += y2;
    S3 += y2 * y;
    S4 += y2 * y2;
    Sx += x;
    Sxy += x * y;
    Sxy2 += x * y2;
  }

  const M = [
    [S4, S3, S2, Sxy2],
    [S3, S2, S1, Sxy],
    [S2, S1, S0, Sx],
  ];

  for (let col = 0; col < 3; col++) {
    let maxRow = col;
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    if (Math.abs(M[col][col]) < 1e-12) return { a: 0, b: 0, c: 0, r2: 0 };
    for (let row = col + 1; row < 3; row++) {
      const f = M[row][col] / M[col][col];
      for (let j = col; j < 4; j++) M[row][j] -= f * M[col][j];
    }
  }

  const coeffs = [0, 0, 0];
  for (let row = 2; row >= 0; row--) {
    let sum = M[row][3];
    for (let j = row + 1; j < 3; j++) sum -= M[row][j] * coeffs[j];
    coeffs[row] = sum / M[row][row];
  }
  const [a, b, c] = coeffs;

  let meanX = 0;
  for (let i = 0; i < n; i++) meanX += xVals[i];
  meanX /= n;
  let ssTot = 0,
    ssRes = 0;
  for (let i = 0; i < n; i++) {
    const predicted = a * yVals[i] * yVals[i] + b * yVals[i] + c;
    ssTot += (xVals[i] - meanX) ** 2;
    ssRes += (xVals[i] - predicted) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return { a, b, c, r2 };
}

/**
 * Three-stage outlier mask: endpoint trim, backward motion, Mahalanobis distance.
 * Returns boolean array — true = exclude.
 */
export function computeOutlierMask(xs: number[], ys: number[]): boolean[] {
  const n = xs.length;
  const mask = new Array<boolean>(n).fill(false);
  if (n <= 4) return mask;

  mask[0] = true;
  mask[n - 1] = true;

  const dirX = xs[n - 1] - xs[0];
  const dirY = ys[n - 1] - ys[0];
  const dirLen = Math.sqrt(dirX * dirX + dirY * dirY);
  if (dirLen > 0.01) {
    const udx = dirX / dirLen,
      udy = dirY / dirLen;
    for (let i = 2; i < n - 1; i++) {
      const stepX = xs[i] - xs[i - 1];
      const stepY = ys[i] - ys[i - 1];
      if (stepX * udx + stepY * udy < 0) {
        mask[i] = true;
      }
    }
  }

  const steps: { dx: number; dy: number; origIdx: number }[] = [];
  for (let i = 1; i < n; i++) {
    if (mask[i] || mask[i - 1]) continue;
    steps.push({ dx: xs[i] - xs[i - 1], dy: ys[i] - ys[i - 1], origIdx: i });
  }

  if (steps.length >= 4) {
    const meanDx = steps.reduce((s, v) => s + v.dx, 0) / steps.length;
    const meanDy = steps.reduce((s, v) => s + v.dy, 0) / steps.length;
    let sxx = 0,
      sxy = 0,
      syy = 0;
    for (const v of steps) {
      const cx = v.dx - meanDx,
        cy = v.dy - meanDy;
      sxx += cx * cx;
      sxy += cx * cy;
      syy += cy * cy;
    }
    sxx /= steps.length;
    sxy /= steps.length;
    syy /= steps.length;

    const det = sxx * syy - sxy * sxy;
    if (det > 1e-10) {
      const invSxx = syy / det,
        invSxy = -sxy / det,
        invSyy = sxx / det;
      for (const v of steps) {
        const cx = v.dx - meanDx,
          cy = v.dy - meanDy;
        const mah = Math.sqrt(
          cx * cx * invSxx + 2 * cx * cy * invSxy + cy * cy * invSyy
        );
        if (mah > 3) {
          mask[v.origIdx] = true;
        }
      }
    }
  }

  return mask;
}

export function classifyAngle(
  angleDeg: number,
  threshModerate: number,
  threshHard: number
): string {
  const abs = Math.abs(angleDeg);
  if (abs >= threshHard) return angleDeg < 0 ? "hard_left" : "hard_right";
  if (abs >= threshModerate)
    return angleDeg < 0 ? "moderate_left" : "moderate_right";
  return "straight";
}

/**
 * Classify trajectory direction from the raw trajectory points — the same
 * data that draws the trail lines on the scatter plot. Averages the first
 * and last ~30 % of points into head/tail clusters for noise resistance,
 * then computes a simple atan2 angle.
 *
 * Positive angle = right, negative = left.
 */
export function classifyTrajectory(
  trajX: number[],
  trajY: number[],
  threshModerate: number,
  threshHard: number
): TrajectoryClassificationResult {
  const empty: TrajectoryClassificationResult = {
    label: "straight",
    angle: 0,
    headX: 0, headY: 0,
    tailX: 0, tailY: 0,
    dx: 0, dy: 0,
    pointsUsed: 0,
  };
  const n = trajX.length;
  if (n < 2) return empty;

  const clusterSize = Math.max(1, Math.floor(n * 0.3));

  let headX = 0, headY = 0;
  for (let i = 0; i < clusterSize; i++) {
    headX += trajX[i];
    headY += trajY[i];
  }
  headX /= clusterSize;
  headY /= clusterSize;

  let tailX = 0, tailY = 0;
  const tailStart = n - clusterSize;
  for (let i = tailStart; i < n; i++) {
    tailX += trajX[i];
    tailY += trajY[i];
  }
  tailX /= clusterSize;
  tailY /= clusterSize;

  const dx = tailX - headX;
  const dy = tailY - headY;
  const angleDeg =
    Math.abs(dy) > 0.001
      ? Math.atan2(dx, dy) * (180 / Math.PI)
      : dx > 0 ? 90 : dx < 0 ? -90 : 0;

  return {
    label: classifyAngle(angleDeg, threshModerate, threshHard),
    angle: angleDeg,
    headX, headY,
    tailX, tailY,
    dx, dy,
    pointsUsed: n,
  };
}

/**
 * Old classification: endpoint-only delta with station correction.
 */
export function classifyOld(
  normX: number[],
  station: string
): OldClassificationResult {
  if (normX.length < 2) return { label: "straight", deltaX: 0 };
  let dx = normX[normX.length - 1] - normX[0];
  if (station === "trap-house-1-2") dx -= 3.5;
  else if (station === "trap-house-4-5") dx += 3.5;

  let label: string;
  if (dx <= -4.0) label = "hard_left";
  else if (dx <= -1.5) label = "moderate_left";
  else if (dx >= 4.0) label = "hard_right";
  else if (dx >= 1.5) label = "moderate_right";
  else label = "straight";
  return { label, deltaX: dx };
}

/**
 * New classification: parabolic fit with outlier rejection.
 * trajX and trajY should already be origin-normalized.
 */
export function classifyNew(
  trajX: number[],
  trajY: number[],
  threshModerate: number,
  threshHard: number
): NewClassificationResult {
  const empty: NewClassificationResult = {
    label: "straight",
    angle: 0,
    a: 0,
    b: 0,
    c: 0,
    r2: 0,
    slopeAtMid: 0,
    trimmedN: 0,
    outliers: 0,
  };
  if (trajX.length < 2) return empty;

  const mask = computeOutlierMask(trajX, trajY);
  const xs = trajX.filter((_, i) => !mask[i]);
  const ys = trajY.filter((_, i) => !mask[i]);
  const outliers = mask.filter((m) => m).length;

  if (xs.length < 3) {
    const fallbackFit = quadraticFit(trajY, trajX);
    if (trajY.length < 3) {
      const deltaX = trajX[trajX.length - 1] - trajX[0];
      const dy = trajY[trajY.length - 1] - trajY[0];
      const angle =
        dy !== 0 ? Math.atan2(deltaX, dy) * (180 / Math.PI) : 0;
      return {
        ...empty,
        label: classifyAngle(angle, threshModerate, threshHard),
        angle,
        ...fallbackFit,
        trimmedN: trajX.length,
      };
    }
    const yMid = (trajY[0] + trajY[trajY.length - 1]) / 2;
    const slope = 2 * fallbackFit.a * yMid + fallbackFit.b;
    const angle = Math.atan(slope) * (180 / Math.PI);
    return {
      label: classifyAngle(angle, threshModerate, threshHard),
      angle,
      ...fallbackFit,
      slopeAtMid: slope,
      trimmedN: trajX.length,
      outliers: 0,
    };
  }

  const fit = quadraticFit(ys, xs);
  const yMid = (ys[0] + ys[ys.length - 1]) / 2;
  const slopeAtMid = 2 * fit.a * yMid + fit.b;
  const angleDeg = Math.atan(slopeAtMid) * (180 / Math.PI);

  return {
    label: classifyAngle(angleDeg, threshModerate, threshHard),
    angle: angleDeg,
    ...fit,
    slopeAtMid,
    trimmedN: xs.length,
    outliers,
  };
}

/**
 * Detect natural breaks in angle distribution for auto-thresholding.
 * Returns [moderateThreshold, hardThreshold].
 */
export function autoDetectThresholds(angles: number[]): [number, number] {
  if (angles.length < 5) return [8, 30];

  const absAngles = angles.map(Math.abs).sort((a, b) => a - b);
  const gaps: { gap: number; value: number }[] = [];
  for (let i = 1; i < absAngles.length; i++) {
    gaps.push({ gap: absAngles[i] - absAngles[i - 1], value: (absAngles[i] + absAngles[i - 1]) / 2 });
  }
  gaps.sort((a, b) => b.gap - a.gap);

  const candidates = gaps.slice(0, 5).map((g) => g.value).sort((a, b) => a - b);

  let moderate = 8,
    hard = 30;
  if (candidates.length >= 2) {
    moderate = Math.max(2, Math.min(30, Math.round(candidates[0])));
    hard = Math.max(moderate + 1, Math.min(60, Math.round(candidates[1])));
  } else if (candidates.length === 1) {
    moderate = Math.max(2, Math.min(30, Math.round(candidates[0] * 0.4)));
    hard = Math.max(moderate + 1, Math.min(60, Math.round(candidates[0])));
  }

  return [moderate, hard];
}

export const CLASS_COLORS: Record<string, string> = {
  hard_left: "#ef5350",
  moderate_left: "#ff9800",
  straight: "#66bb6a",
  moderate_right: "#42a5f5",
  hard_right: "#7e57c2",
};

export const CLASS_SHADES: Record<string, string[]> = {
  hard_left: ["#ef5350", "#e53935", "#c62828", "#ff8a80", "#d32f2f", "#ff5252"],
  moderate_left: ["#ff9800", "#fb8c00", "#ef6c00", "#ffb74d", "#f57c00", "#ffa726"],
  straight: ["#66bb6a", "#4caf50", "#388e3c", "#81c784", "#43a047", "#a5d6a7"],
  moderate_right: ["#42a5f5", "#2196f3", "#1976d2", "#64b5f6", "#1e88e5", "#90caf9"],
  hard_right: ["#7e57c2", "#673ab7", "#512da8", "#9575cd", "#5e35b1", "#b39ddb"],
};

export const DIRECTION_LABELS: string[] = [
  "hard_left",
  "moderate_left",
  "straight",
  "moderate_right",
  "hard_right",
];
