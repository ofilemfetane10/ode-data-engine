// app/lib/charts.ts
// Fully corrected + dataset-agnostic chart generator (V3)
//  Skips ID-like numeric AND categorical (by name + uniqueness)
//  Adds fallback detection for date-like columns when EDA misclassifies
//  Adds fallback detection for numeric-like columns when EDA misclassifies
//  Robust parsing (numbers + dates)
//  Diversity rule, min 4 when possible, cap 8

/* ============================================================
   Types
============================================================ */

export type HistogramChartSpec = {
  type: "histogram";
  column: string;
  bins: number;
  edges: number[];
  counts: number[];
  min: number;
  max: number;
  total: number;
  purpose?: "distribution";
};

export type BoxChartSpec = {
  type: "box";
  column: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  iqr: number;
  outliers: number[];
  total: number;
  purpose?: "distribution";
};

export type BarChartSpec = {
  type: "bar";
  column: string;
  labels: string[];
  counts: number[];
  maxBars?: number;
  purpose?: "composition";
};

export type TimePoint = { x: string; y: number };

export type TimeChartSpec = {
  type: "time";
  column: string; // display label
  xColumn: string;
  yColumn: string;
  points: TimePoint[];
  granularity: "day" | "month";
  purpose?: "trend";
};

export type ScatterPoint = { x: number; y: number };

export type ScatterChartSpec = {
  type: "scatter";
  column: string; // display label
  xColumn: string;
  yColumn: string;
  points: ScatterPoint[];
  correlation: number | null;
  purpose?: "relationship";
};

export type CorrChartSpec = {
  type: "corr";
  column: string; // display label
  columns: string[];
  matrix: number[][];
  purpose?: "relationship";
};

export type ChartSpec =
  | HistogramChartSpec
  | BoxChartSpec
  | BarChartSpec
  | TimeChartSpec
  | ScatterChartSpec
  | CorrChartSpec;

/* ============================================================
   Helpers: missing / parsing
============================================================ */

function isMissing(v: any) {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function safeToNumberLoose(v: any): number | null {
  if (isMissing(v)) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;

  let s = String(v).trim();
  if (!s) return null;

  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1).trim();
  }

  s = s
    .replace(/[£€$₹₽¥₩₦₱₫₪₴₲₵₸₺₼₾₿]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, "")
    .replace(/%$/, "");

  if (!s) return null;

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) s = s.replace(/,/g, "");
  else if (hasComma && !hasDot) {
    const m = s.match(/,(\d{1,3})$/);
    if (m) s = s.replace(/,/g, ".");
    else s = s.replace(/,/g, "");
  }

  if (!/^[-+]?\d+(\.\d+)?(?:e[-+]?\d+)?$/i.test(s)) return null;

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

function safeToDateLoose(v: any): Date | null {
  if (isMissing(v)) return null;
  if (v instanceof Date && Number.isFinite(v.getTime())) return v;

  const s = String(v).trim();
  if (!s) return null;

  // ISO / RFC / many common formats
  const t = Date.parse(s);
  if (Number.isFinite(t)) return new Date(t);

  // dd/mm/yyyy or dd-mm-yyyy (fallback)
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]) - 1;
    let yy = Number(m[3]);
    if (yy < 100) yy += 2000;
    const dt = new Date(yy, mm, dd);
    return Number.isFinite(dt.getTime()) ? dt : null;
  }

  return null;
}

/* ============================================================
   ID-like skipping (GENERIC)
============================================================ */

function nameHintsId(col: string) {
  const n = String(col ?? "").toLowerCase();
  return /(^id$|_id$| id$|uuid|guid|hash|token|key$|^key|identifier)/.test(n);
}

function isIdLikeNumeric(col: string, info: any, rowCount: number) {
  if (nameHintsId(col)) return true;
  if (info?.inferredAs === "id") return true;

  const nn = Number(info?.nonMissingCount ?? rowCount);
  const unique = Number(info?.uniqueCount ?? 0);
  const ratio = unique / Math.max(1, nn);

  return unique >= 20 && ratio > 0.98;
}

function isIdLikeCategorical(col: string, info: any) {
  if (nameHintsId(col)) return true;
  if (!info) return false;
  if (info.inferredAs === "id") return true;

  const nonMissing = Number(info.nonMissingCount ?? 0);
  const unique = Number(info.uniqueCount ?? 0);
  if (!nonMissing) return false;

  const uniqueRatio = unique / Math.max(1, nonMissing);
  return uniqueRatio > 0.9;
}

// Heuristic: big list-like text field (names, descriptions) — not great for bar chart
function isNameListColumn(info: any) {
  if (!info) return false;
  const nonMissing = Number(info.nonMissingCount ?? 0);
  const unique = Number(info.uniqueCount ?? 0);
  const top = info?.topValues?.[0];
  const dominance = Number(top?.pct ?? 0);
  if (!nonMissing) return false;

  const uniqueRatio = unique / Math.max(1, nonMissing);
  return unique >= 50 && uniqueRatio > 0.5 && dominance < 40;
}

/* ============================================================
   Histogram + Box helpers
============================================================ */

function chooseBins(n: number) {
  if (n <= 30) return 8;
  if (n <= 200) return 10;
  if (n <= 1000) return 12;
  return 14;
}

function computeHistogram(values: number[], bins: number) {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!clean.length) return null;

  const min = clean[0];
  const max = clean[clean.length - 1];
  const span = max - min || 1;

  const edges: number[] = new Array(bins + 1);
  for (let i = 0; i <= bins; i++) edges[i] = min + (span * i) / bins;

  const counts = new Array(bins).fill(0);
  for (const v of clean) {
    const t = (v - min) / span;
    const idx = Math.min(bins - 1, Math.max(0, Math.floor(t * bins)));
    counts[idx] += 1;
  }

  return { min, max, edges, counts, total: clean.length };
}

function quantileSorted(sorted: number[], q: number) {
  const n = sorted.length;
  if (!n) return null;
  if (n === 1) return sorted[0];
  const pos = (n - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const a = sorted[base];
  const b = sorted[Math.min(n - 1, base + 1)];
  return a + (b - a) * rest;
}

function computeBox(values: number[]) {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (clean.length < 12) return null;

  const q1 = quantileSorted(clean, 0.25);
  const median = quantileSorted(clean, 0.5);
  const q3 = quantileSorted(clean, 0.75);
  if (q1 === null || median === null || q3 === null) return null;

  const iqr = q3 - q1;
  const lowFence = q1 - 1.5 * iqr;
  const highFence = q3 + 1.5 * iqr;

  const outliers: number[] = [];
  for (const v of clean) if (v < lowFence || v > highFence) outliers.push(v);

  let wMin = clean[0];
  let wMax = clean[clean.length - 1];
  for (const v of clean) {
    if (v >= lowFence) {
      wMin = v;
      break;
    }
  }
  for (let i = clean.length - 1; i >= 0; i--) {
    const v = clean[i];
    if (v <= highFence) {
      wMax = v;
      break;
    }
  }

  return { min: wMin, q1, median, q3, max: wMax, iqr, outliers, total: clean.length };
}

/* ============================================================
   Categorical helpers
============================================================ */

type TopBarItem = { label: string; count: number };

function capTopValuesWithOther(info: any, maxBars: number): TopBarItem[] {
  const topValues = Array.isArray(info?.topValues) ? (info.topValues as any[]) : [];
  const nonMissing = Number(info?.nonMissingCount ?? 0);

  const trimmed: TopBarItem[] = topValues.slice(0, maxBars).map((t: any): TopBarItem => ({
    label: String(t?.value ?? ""),
    count: Number(t?.count ?? 0),
  }));

  const shownSum = trimmed.reduce((a: number, b: TopBarItem) => a + b.count, 0);
  const other = Math.max(0, nonMissing - shownSum);
  if (other > 0) trimmed.push({ label: "Other", count: other });

  return trimmed;
}

/* ============================================================
   Time series helpers
============================================================ */

function formatDayKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatMonthKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function buildTimeSeries(data: any[], dateCol: string, numCol: string) {
  const pairs: Array<{ d: Date; y: number }> = [];

  for (const row of data) {
    const d = safeToDateLoose(row?.[dateCol]);
    const y = safeToNumberLoose(row?.[numCol]);
    if (!d || y === null) continue;
    pairs.push({ d, y });
  }

  if (pairs.length < 20) return null;
  pairs.sort((a, b) => a.d.getTime() - b.d.getTime());

  const first = pairs[0].d.getTime();
  const last = pairs[pairs.length - 1].d.getTime();
  const days = Math.max(1, Math.round((last - first) / (1000 * 60 * 60 * 24)));

  const granularity: "day" | "month" = days <= 90 ? "day" : "month";
  const keyFn = granularity === "day" ? formatDayKey : formatMonthKey;

  const agg = new Map<string, number>();
  for (const p of pairs) {
    const k = keyFn(p.d);
    agg.set(k, (agg.get(k) ?? 0) + p.y);
  }

  const points = Array.from(agg.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([x, y]) => ({ x, y }));

  if (points.length < 8) return null;
  return { points, granularity };
}

/* ============================================================
   Relationship helpers (scatter + corr)
============================================================ */

function mean(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
}

function stdev(xs: number[]) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return Math.sqrt(s / (xs.length - 1));
}

function pearson(x: number[], y: number[]) {
  if (x.length !== y.length || x.length < 8) return null;
  const mx = mean(x);
  const my = mean(y);

  let num = 0;
  let dx = 0;
  let dy = 0;

  for (let i = 0; i < x.length; i++) {
    const a = x[i] - mx;
    const b = y[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }

  const den = Math.sqrt(dx * dy);
  if (!Number.isFinite(den) || den === 0) return null;

  const r = num / den;
  return Number.isFinite(r) ? r : null;
}

function buildScatter(data: any[], xCol: string, yCol: string) {
  const xs: number[] = [];
  const ys: number[] = [];

  for (const row of data) {
    const x = safeToNumberLoose(row?.[xCol]);
    const y = safeToNumberLoose(row?.[yCol]);
    if (x === null || y === null) continue;
    xs.push(x);
    ys.push(y);
  }

  if (xs.length < 30) return null;

  const maxPts = 1200;
  const idxs =
    xs.length > maxPts
      ? Array.from({ length: maxPts }, (_, i) => Math.floor((i * xs.length) / maxPts))
      : null;

  const points: ScatterPoint[] = idxs
    ? idxs.map((i) => ({ x: xs[i], y: ys[i] }))
    : xs.map((x, i) => ({ x, y: ys[i] }));

  const r = pearson(xs, ys);
  return { points, correlation: r, n: xs.length, sx: stdev(xs), sy: stdev(ys) };
}

function buildCorrMatrix(data: any[], cols: string[]) {
  const series: Record<string, number[]> = {};
  for (const c of cols) series[c] = [];

  for (const row of data) {
    const vals: number[] = [];
    for (const c of cols) {
      const n = safeToNumberLoose(row?.[c]);
      if (n === null) {
        vals.length = 0;
        break;
      }
      vals.push(n);
    }
    if (!vals.length) continue;

    for (let i = 0; i < cols.length; i++) series[cols[i]].push(vals[i]);
  }

  const n = series[cols[0]]?.length ?? 0;
  if (n < 40) return null;

  const matrix: number[][] = [];
  for (let i = 0; i < cols.length; i++) {
    const rowArr: number[] = [];
    for (let j = 0; j < cols.length; j++) {
      const r = pearson(series[cols[i]], series[cols[j]]);
      rowArr.push(r === null ? 0 : r);
    }
    matrix.push(rowArr);
  }

  return { matrix, n };
}

/* ============================================================
   Fallback detection (when EDA misclassifies)
============================================================ */

function sampleRows(data: any[], n = 250) {
  if (data.length <= n) return data;
  const step = Math.max(1, Math.floor(data.length / n));
  const out: any[] = [];
  for (let i = 0; i < data.length && out.length < n; i += step) out.push(data[i]);
  return out;
}

function detectDateLikeColumns(data: any[], columns: string[], alreadyDateCols: Set<string>) {
  const s = sampleRows(data, 250);
  const results: Array<{ col: string; score: number }> = [];

  for (const col of columns) {
    if (alreadyDateCols.has(col)) continue;

    let seen = 0;
    let ok = 0;
    const uniq = new Set<string>();

    for (const row of s) {
      const v = row?.[col];
      if (isMissing(v)) continue;
      seen++;
      uniq.add(String(v));
      if (safeToDateLoose(v)) ok++;
    }

    if (seen < 15) continue;

    const ratio = ok / Math.max(1, seen);
    const uniqRatio = uniq.size / Math.max(1, seen);

    // We want: many parsable dates, and not “almost all unique random strings”
    // but dates are often high-unique too; we just gate lightly.
    const score = ratio * 100 + Math.min(20, uniqRatio * 20);

    if (ratio >= 0.7) results.push({ col, score });
  }

  results.sort((a, b) => b.score - a.score);
  return results.map((r) => r.col);
}

function detectNumericLikeColumns(data: any[], columns: string[], alreadyNumeric: Set<string>) {
  const s = sampleRows(data, 250);
  const results: Array<{ col: string; score: number }> = [];

  for (const col of columns) {
    if (alreadyNumeric.has(col)) continue;

    let seen = 0;
    let ok = 0;
    const uniq = new Set<string>();

    for (const row of s) {
      const v = row?.[col];
      if (isMissing(v)) continue;
      seen++;
      uniq.add(String(v));
      if (safeToNumberLoose(v) !== null) ok++;
    }

    if (seen < 15) continue;

    const ratio = ok / Math.max(1, seen);
    const uniqRatio = uniq.size / Math.max(1, seen);

    // Numeric-like columns should parse well; uniqueness alone isn't enough.
    const score = ratio * 100 + Math.min(10, uniqRatio * 10);

    if (ratio >= 0.85) results.push({ col, score });
  }

  results.sort((a, b) => b.score - a.score);
  return results.map((r) => r.col);
}

/* ============================================================
   Chart selection (diversity rule)
============================================================ */

type Candidate = { spec: ChartSpec; score: number; purpose: string };

function pickDiverse(cands: Candidate[], min = 4, max = 8): ChartSpec[] {
  const sorted = [...cands].sort((a, b) => b.score - a.score);
  const picks: ChartSpec[] = [];
  const purposeCount = new Map<string, number>();
  const typeCount = new Map<string, number>();

  const canTake = (c: Candidate) => {
    const p = c.purpose;
    const t = (c.spec as any).type as string;

    const pMax: Record<string, number> = {
      trend: 2,
      relationship: 2,
      distribution: 2,
      composition: 2,
    };

    const tMax: Record<string, number> = {
      histogram: 2,
      bar: 2,
      box: 1,
      time: 2,
      scatter: 1,
      corr: 1,
    };

    const pc = purposeCount.get(p) ?? 0;
    const tc = typeCount.get(t) ?? 0;

    if (pc >= (pMax[p] ?? 2)) return false;
    if (tc >= (tMax[t] ?? 2)) return false;
    return true;
  };

  for (const c of sorted) {
    if (picks.length >= max) break;
    if (!canTake(c)) continue;

    picks.push(c.spec);
    const p = c.purpose;
    const t = (c.spec as any).type as string;

    purposeCount.set(p, (purposeCount.get(p) ?? 0) + 1);
    typeCount.set(t, (typeCount.get(t) ?? 0) + 1);
  }

  // Ensure min charts if we can
  if (picks.length < min) {
    for (const c of sorted) {
      if (picks.length >= min) break;
      if (picks.includes(c.spec)) continue;
      picks.push(c.spec);
    }
  }

  return picks.slice(0, max);
}

/* ============================================================
   Main
============================================================ */

export function generateCharts(data: any[], eda: any): ChartSpec[] {
  const candidates: Candidate[] = [];

  if (!Array.isArray(data) || data.length === 0) return [];
  if (!eda?.columns) return [];

  const rowCount = data.length;
  const entries = Object.entries<any>(eda.columns);

  // All column names in dataset (EDA should have them, but be safe)
  const allCols = entries.map(([c]) => c);

  // numeric columns but EXCLUDE id-like numeric
  const numericColsFromEDA = entries
    .filter(([, info]) => info?.type === "numeric")
    .map(([c, info]) => ({ c, info }))
    .filter(({ c, info }) => !isIdLikeNumeric(c, info, rowCount))
    .map(({ c }) => c);

  const numericSet = new Set(numericColsFromEDA);

  // date columns from EDA
  const dateColsFromEDA = entries
    .filter(([, info]) => info?.type === "date" || info?.type === "datetime")
    .map(([c]) => c);

  const dateSet = new Set(dateColsFromEDA);

  // categorical columns (we will still filter id-like/name-list later)
  const catColsFromEDA = entries.filter(([, info]) => info?.type === "categorical").map(([c]) => c);

  // --- Fallback detection (THIS is what fixes "only 2 charts" when date was mis-typed) ---
  const inferredDateCols = detectDateLikeColumns(data, allCols, dateSet);
  for (const c of inferredDateCols) dateSet.add(c);

  const inferredNumericCols = detectNumericLikeColumns(data, allCols, numericSet);
  for (const c of inferredNumericCols) numericSet.add(c);

  const numericCols = Array.from(numericSet);
  const dateCols = Array.from(dateSet);

  // Categorical: EDA categorical + anything not numeric/date (fallback)
  const catFallback = allCols.filter((c) => !numericSet.has(c) && !dateSet.has(c));
  const catCols = Array.from(new Set([...catColsFromEDA, ...catFallback]));

  /* ========================= NUMERIC -> HISTOGRAM + BOX ========================= */
  for (const col of numericCols) {
    const info = eda.columns?.[col];
    if (isIdLikeNumeric(col, info, rowCount)) continue;

    const values: number[] = [];
    for (const row of data) {
      const n = safeToNumberLoose(row?.[col]);
      if (n !== null) values.push(n);
    }
    if (values.length < 12) continue;

    const bins = chooseBins(values.length);
    const computed = computeHistogram(values, bins);
    if (computed) {
      const spreadScore = Math.log10(computed.max - computed.min + 1) * 10;
      const densityScore = Math.log10(computed.total + 1) * 10;
      const score = densityScore + spreadScore;

      candidates.push({
        spec: {
          type: "histogram",
          column: col,
          bins,
          edges: computed.edges,
          counts: computed.counts,
          min: computed.min,
          max: computed.max,
          total: computed.total,
          purpose: "distribution",
        },
        score,
        purpose: "distribution",
      });
    }

    const box = computeBox(values);
    if (box) {
      const outlierRate = box.outliers.length / Math.max(1, box.total);
      const iqr = Math.abs(box.iqr);
      const score =
        Math.log10(box.total + 1) * 10 +
        Math.log10(iqr + 1) * 12 +
        Math.min(25, outlierRate * 120);

      candidates.push({
        spec: {
          type: "box",
          column: col,
          min: box.min,
          q1: box.q1,
          median: box.median,
          q3: box.q3,
          max: box.max,
          iqr: box.iqr,
          outliers: box.outliers.slice(0, 200),
          total: box.total,
          purpose: "distribution",
        },
        score,
        purpose: "distribution",
      });
    }
  }

  /* ========================= CATEGORICAL -> BAR ========================= */
  for (const col of catCols) {
    const info = eda.columns?.[col];

    // Skip if it's actually numeric/date (fallback collisions)
    if (numericSet.has(col) || dateSet.has(col)) continue;

    // ID/name-list filters (even if EDA didn't have info)
    if (isIdLikeCategorical(col, info)) continue;
    if (info && isNameListColumn(info)) continue;

    const maxBars = 10;

    if (Array.isArray(info?.topValues) && info.topValues.length) {
      const capped = capTopValuesWithOther(info, maxBars);
      if (capped.length) {
        const total = capped.reduce((a: number, b: TopBarItem) => a + b.count, 0) || 1;
        const top = capped[0]?.count ?? 0;
        const dominance = top / total;

        const score = Math.log10(total + 1) * 10 + dominance * 60;

        candidates.push({
          spec: {
            type: "bar",
            column: col,
            labels: capped.map((x) => x.label),
            counts: capped.map((x) => x.count),
            maxBars,
            purpose: "composition",
          },
          score,
          purpose: "composition",
        });
      }
      continue;
    }

    // fallback frequency
    const freq = new Map<string, number>();
    let nonMissing = 0;
    for (const row of data) {
      const v = row?.[col];
      if (isMissing(v)) continue;
      nonMissing++;
      const key = String(v);
      freq.set(key, (freq.get(key) ?? 0) + 1);
    }
    if (!freq.size) continue;

    const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
    const top: TopBarItem[] = sorted.slice(0, maxBars).map(([label, count]) => ({
      label: String(label),
      count: Number(count),
    }));

    const shownSum = top.reduce((a: number, b: TopBarItem) => a + b.count, 0);
    const other = Math.max(0, nonMissing - shownSum);
    if (other > 0) top.push({ label: "Other", count: other });

    const total = top.reduce((a: number, b: TopBarItem) => a + b.count, 0) || 1;
    const dominance = (top[0]?.count ?? 0) / total;
    const score = Math.log10(total + 1) * 10 + dominance * 60;

    candidates.push({
      spec: {
        type: "bar",
        column: col,
        labels: top.map((x) => x.label),
        counts: top.map((x) => x.count),
        maxBars,
        purpose: "composition",
      },
      score,
      purpose: "composition",
    });
  }

  /* ========================= DATE + NUMERIC -> TIME ========================= */
  for (const dcol of dateCols) {
    if (nameHintsId(dcol)) continue;

    for (const ncol of numericCols) {
      const built = buildTimeSeries(data, dcol, ncol);
      if (!built) continue;

      const ys = built.points.map((p) => p.y);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const range = Math.abs(maxY - minY);

      const score = built.points.length * 2 + Math.log10(range + 1) * 12;

      candidates.push({
        spec: {
          type: "time",
          column: `${ncol} over ${dcol}`,
          xColumn: dcol,
          yColumn: ncol,
          points: built.points,
          granularity: built.granularity,
          purpose: "trend",
        },
        score,
        purpose: "trend",
      });
    }
  }

  /* ========================= NUMERIC + NUMERIC -> SCATTER (best 1) ========================= */
  const scatterCandidates: Candidate[] = [];
  for (let i = 0; i < numericCols.length; i++) {
    for (let j = i + 1; j < numericCols.length; j++) {
      const xCol = numericCols[i];
      const yCol = numericCols[j];

      const built = buildScatter(data, xCol, yCol);
      if (!built) continue;

      const rAbs = Math.abs(built.correlation ?? 0);
      const varScore = Math.log10(built.sx + built.sy + 1) * 10;

      const score = built.n * 0.02 + rAbs * 80 + varScore;

      scatterCandidates.push({
        spec: {
          type: "scatter",
          column: `${yCol} vs ${xCol}`,
          xColumn: xCol,
          yColumn: yCol,
          points: built.points,
          correlation: built.correlation,
          purpose: "relationship",
        },
        score,
        purpose: "relationship",
      });
    }
  }

  scatterCandidates.sort((a, b) => b.score - a.score);
  if (scatterCandidates[0]) candidates.push(scatterCandidates[0]);

  /* ========================= CORR HEATMAP ========================= */
  if (numericCols.length >= 4) {
    const ranked = numericCols
      .map((c) => {
        const info = eda.columns?.[c];
        const sd = Number(info?.stdev ?? 0);
        const uniq = Number(info?.uniqueCount ?? 0);
        return { c, score: Math.log10(sd + 1) * 10 + Math.log10(uniq + 1) * 2 };
      })
      .sort((a, b) => b.score - a.score)
      .map((x) => x.c)
      .slice(0, 10);

    if (ranked.length >= 4) {
      const built = buildCorrMatrix(data, ranked);
      if (built) {
        let maxOff = 0;
        for (let i = 0; i < ranked.length; i++) {
          for (let j = 0; j < ranked.length; j++) {
            if (i === j) continue;
            maxOff = Math.max(maxOff, Math.abs(built.matrix[i][j]));
          }
        }

        const score = ranked.length * 10 + built.n * 0.03 + maxOff * 120;

        candidates.push({
          spec: {
            type: "corr",
            column: "Correlation (numeric)",
            columns: ranked,
            matrix: built.matrix,
            purpose: "relationship",
          },
          score,
          purpose: "relationship",
        });
      }
    }
  }

  return pickDiverse(candidates, 4, 8);
}
