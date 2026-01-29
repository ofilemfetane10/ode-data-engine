// app/lib/kpis.ts
import type { EDAResult } from "../context/DatasetContext";

export type KPI = {
  column?: string;
  label: string;
  value: number | string;
  type: "sum" | "mean" | "min" | "max" | "count" | "rate" | "range" | "span" | "top";
};

/* ============================================================
   Helpers
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

function fmtPct(x: number) {
  const v = Number.isFinite(x) ? x : 0;
  return `${Math.round(v)}%`;
}

function fmtCompact(n: number) {
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${Math.round(n).toLocaleString()}`;
  return n % 1 === 0 ? n.toLocaleString() : n.toFixed(2);
}

/** ID-like detection (NEVER use these for KPIs) */
function isIdLikeColumn(col: string, info: any, rowCount: number) {
  const name = String(col ?? "").toLowerCase();
  if (/(^id$|_id$| id$|uuid|guid|hash|token|key$|^key|identifier)/.test(name)) return true;
  if (info?.inferredAs === "id") return true;

  const unique = Number(info?.uniqueCount ?? 0);
  const nn = Number(info?.nonMissingCount ?? rowCount);
  const ratio = unique / Math.max(1, nn);

  // strong signal: almost all unique
  return unique >= 20 && ratio > 0.98;
}

/** Numeric column score for KPI relevance. Higher is better. */
function scoreNumericCol(col: string, info: any, rowCount: number) {
  if (!info) return 0;
  if (isIdLikeColumn(col, info, rowCount)) return 0;

  const nn = Number(info?.nonMissingCount ?? 0);
  const min = typeof info?.min === "number" ? info.min : null;
  const max = typeof info?.max === "number" ? info.max : null;
  const stdev = typeof info?.stdev === "number" ? info.stdev : null;

  if (nn < 25) return 0;
  if (min === null || max === null) return 0;

  const range = Math.abs(max - min);
  if (range === 0) return 1;

  const spread = stdev ?? range; // prefer real variation
  return Math.log10(nn + 1) * 12 + Math.log10(spread + 1) * 10;
}

function pickBestCategorical(eda: EDAResult, rowCountHint: number) {
  const entries = Object.entries(eda.columns ?? {});
  const cats = entries.filter(([, info]: any) => info?.type === "categorical") as Array<[string, any]>;

  let best: { col: string; top: any; score: number } | null = null;

  for (const [col, info] of cats) {
    if (!info) continue;
    if (isIdLikeColumn(col, info, rowCountHint)) continue;

    const unique = Number(info?.uniqueCount ?? 0);
    const nn = Number(info?.nonMissingCount ?? 0) || rowCountHint;
    const top = info?.topValues?.[0];
    if (!top) continue;

    const dominance = Number(top.pct ?? 0);
    const uniqueRatio = nn > 0 ? unique / nn : 0;

    // skip "name lists"
    const looksNameList = unique >= 50 && uniqueRatio > 0.5 && dominance < 40;
    if (looksNameList) continue;

    const score =
      dominance * 2 +
      (unique <= 12 ? 30 : unique <= 25 ? 15 : 0) +
      (uniqueRatio < 0.4 ? 10 : 0);

    if (!best || score > best.score) best = { col, top, score };
  }

  return best;
}

function pickBestDate(eda: EDAResult) {
  const entries = Object.entries(eda.columns ?? {});
  const dates = entries.filter(([, info]: any) => info?.type === "date") as Array<[string, any]>;
  if (!dates.length) return null;

  let best: { col: string; min: string; max: string; days: number } | null = null;

  for (const [col, info] of dates) {
    const min = info?.min;
    const max = info?.max;
    if (!min || !max) continue;

    const a = Date.parse(String(min));
    const b = Date.parse(String(max));
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;

    const days = Math.abs(b - a) / (1000 * 60 * 60 * 24);
    if (!best || days > best.days) best = { col, min: String(min), max: String(max), days };
  }

  return best;
}

/* ============================================================
   Main
============================================================ */

export function generateKPIs(data: any[], eda?: EDAResult | null): KPI[] {
  if (!Array.isArray(data) || data.length === 0) return [];

  const rowCount = data.length;
  const kpis: KPI[] = [];

  // Always show rows
  kpis.push({ label: "Rows", value: rowCount.toLocaleString(), type: "count" });

  if (eda) {
    // duplicates
    const duplicates = Number(eda.duplicates ?? 0);
    if (duplicates > 0) kpis.push({ label: "Duplicates", value: duplicates.toLocaleString(), type: "count" });

    // missing rate
    let totalMissing = 0;
    let totalCells = 0;

    for (const info of Object.values(eda.columns ?? {}) as any[]) {
      const missing = Number(info?.missing ?? 0);
      const nnRaw = info?.nonMissingCount;
      const nn =
        typeof nnRaw === "number" && Number.isFinite(nnRaw) ? nnRaw : Math.max(0, rowCount - missing);
      totalMissing += missing;
      totalCells += missing + nn;
    }

    if (totalCells > 0) {
      const missRate = (totalMissing / totalCells) * 100;
      kpis.push({ label: "Missing rate", value: fmtPct(missRate), type: "rate" });
    }

    // numeric story set (exclude ID-like, exclude score=0)
    const numericCandidates = Object.entries(eda.columns ?? {})
      .filter(([, info]: any) => info?.type === "numeric")
      .map(([col, info]: any) => ({
        col,
        info,
        score: scoreNumericCol(col, info, rowCount),
      }))
      .filter((x) => x.score > 0) //  IMPORTANT: never pick “zero-score” numeric (usually IDs/flat)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    for (const item of numericCandidates) {
      const col = item.col;
      const nums: number[] = [];

      for (const row of data) {
        const n = safeToNumberLoose(row?.[col]);
        if (n !== null) nums.push(n);
      }

      if (nums.length < 25) continue;

      const sum = nums.reduce((a, b) => a + b, 0);
      const mean = sum / nums.length;
      const min = Math.min(...nums);
      const max = Math.max(...nums);

      kpis.push(
        { column: col, label: `Total ${col}`, value: fmtCompact(sum), type: "sum" },
        { column: col, label: `Average ${col}`, value: fmtCompact(mean), type: "mean" },
        { column: col, label: `${col} range`, value: `${fmtCompact(min)} → ${fmtCompact(max)}`, type: "range" }
      );

      break; // keep strip clean
    }

    // categorical
    const bestCat = pickBestCategorical(eda, rowCount);
    if (bestCat) {
      kpis.push({
        column: bestCat.col,
        label: `Top ${bestCat.col}`,
        value: `${String(bestCat.top.value)} (${Math.round(Number(bestCat.top.pct ?? 0))}%)`,
        type: "top",
      });
    }

    // date span
    const bestDate = pickBestDate(eda);
    if (bestDate) {
      kpis.push({
        column: bestDate.col,
        label: `Date span (${bestDate.col})`,
        value: `${bestDate.min.slice(0, 10)} → ${bestDate.max.slice(0, 10)}`,
        type: "span",
      });
    }
  }

  // cap
  return kpis.slice(0, 6);
}
