// app/lib/eda.ts
import type { EDAResult, ColumnEDA } from "../context/DatasetContext";
import { inferColumnType, isLikelyID } from "./typeInference";

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

function safeToDateLoose(v: any): Date | null {
  if (isMissing(v)) return null;
  if (v instanceof Date && Number.isFinite(v.getTime())) return v;

  const s = String(v).trim();
  if (!s) return null;

  const t = Date.parse(s);
  if (Number.isFinite(t)) return new Date(t);

  // dd/mm/yyyy or dd-mm-yyyy
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

function median(sorted: number[]) {
  const n = sorted.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stdev(vals: number[], mean: number) {
  const n = vals.length;
  if (n < 2) return null;
  let sumSq = 0;
  for (const v of vals) sumSq += (v - mean) ** 2;
  return Math.sqrt(sumSq / (n - 1));
}

function fingerprintRow(row: any, cols: string[]) {
  const parts = cols.map((c) => {
    const v = row?.[c];
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "object" && v !== null) return JSON.stringify(v);
    return String(v ?? "");
  });
  return parts.join("||");
}

/* ============================================================
   ID detection (GENERIC, not hardcoded)
   - catches: uuid/hash/id tokens, and also sequential numeric IDs (1..N)
============================================================ */

function nameHintsId(col: string) {
  const n = String(col ?? "").toLowerCase();
  return /(^id$|_id$| id$|uuid|guid|hash|token|key$|^key|identifier)/.test(n);
}

function isIntegerLike(n: number) {
  // tolerate "100.0"
  return Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-9;
}

function looksSequentialId(numsSorted: number[], uniqueCount: number) {
  if (uniqueCount < 30) return false;
  if (numsSorted.length !== uniqueCount) return false;

  // sample diffs (avoid O(n) heavy for huge)
  const N = numsSorted.length;
  const steps = Math.min(400, N - 1);
  const stride = Math.max(1, Math.floor((N - 1) / steps));

  let checked = 0;
  let inc1 = 0;
  let nonDecreasing = 0;

  for (let i = 0; i < N - stride; i += stride) {
    const a = numsSorted[i];
    const b = numsSorted[i + stride];
    const d = b - a;
    checked += 1;
    if (d >= 0) nonDecreasing += 1;
    // for stride>1, diff should be close to stride (if perfect sequential)
    if (Math.abs(d - stride) < 1e-6) inc1 += 1;
  }

  if (checked === 0) return false;
  const ndRatio = nonDecreasing / checked;
  const seqRatio = inc1 / checked;

  // if mostly increasing + mostly step matches -> sequential
  return ndRatio > 0.98 && seqRatio > 0.85;
}

function isIdLikeNumericColumn(col: string, nums: number[], uniqueCount: number) {
  if (nameHintsId(col)) return true;

  if (nums.length < 30) return false;
  const uniqueRatio = uniqueCount / Math.max(1, nums.length);
  if (uniqueRatio < 0.98) return false;

  // must be mostly integer-like
  let intOk = 0;
  const sampleN = Math.min(500, nums.length);
  const stride = Math.max(1, Math.floor(nums.length / sampleN));
  let checked = 0;
  for (let i = 0; i < nums.length; i += stride) {
    checked += 1;
    if (isIntegerLike(nums[i])) intOk += 1;
  }
  const intRatio = intOk / Math.max(1, checked);
  if (intRatio < 0.98) return false;

  const sortedUnique = Array.from(new Set(nums)).sort((a, b) => a - b);

  // sequential 1..N, or “almost sequential”
  if (looksSequentialId(sortedUnique, sortedUnique.length)) return true;

  // fallback: range ~ count for IDs
  const min = sortedUnique[0];
  const max = sortedUnique[sortedUnique.length - 1];
  const range = Math.abs(max - min);

  // if range is close to number of uniques, it behaves like an index/id
  if (range > 0 && range <= sortedUnique.length * 1.2) return true;

  return false;
}

/* ============================================================
   Final type decision
   - ID detection happens FIRST (incl sequential numeric)
   - numeric/date decided by density thresholds
============================================================ */

function decideType(col: string, values: any[]) {
  const nonMissing = values.filter((v) => !isMissing(v));
  if (!nonMissing.length) return { type: "categorical" as const, reason: "empty" };

  // 1) external + name-hints ID
  if (nameHintsId(col)) return { type: "id" as const, reason: "name-hint" };
  if (isLikelyID(nonMissing)) return { type: "id" as const, reason: "id-like" };

  const N = nonMissing.length;
  let numericOk = 0;
  let dateOk = 0;

  for (const v of nonMissing) {
    if (safeToNumberLoose(v) !== null) numericOk++;
    if (safeToDateLoose(v) !== null) dateOk++;
  }

  const numericRatio = numericOk / N;
  const dateRatio = dateOk / N;
  const hinted = inferColumnType(values);

  const NUMERIC_THRESHOLD = 0.85;
  const DATE_THRESHOLD = 0.85;

  // 2) if it parses numeric strongly, also check sequential ID behavior before calling it numeric
  if (numericRatio >= 0.7) {
    const nums: number[] = [];
    const uniq = new Set<number>();
    for (const v of nonMissing) {
      const n = safeToNumberLoose(v);
      if (n === null) continue;
      nums.push(n);
      uniq.add(n);
    }
    const uniqueCount = uniq.size;
    if (isIdLikeNumericColumn(col, nums, uniqueCount)) {
      return { type: "id" as const, reason: "numeric-id-pattern" };
    }
  }

  if (dateRatio >= DATE_THRESHOLD && dateRatio >= numericRatio) {
    return { type: "date" as const, reason: `dateRatio=${dateRatio.toFixed(2)}` };
  }

  if (numericRatio >= NUMERIC_THRESHOLD) {
    return { type: "numeric" as const, reason: `numericRatio=${numericRatio.toFixed(2)}` };
  }

  if (hinted === "date" && dateRatio >= 0.7) return { type: "date" as const, reason: "hint+ok" };
  if (hinted === "numeric" && numericRatio >= 0.7) return { type: "numeric" as const, reason: "hint+ok" };

  return { type: "categorical" as const, reason: "fallback" };
}

/* ============================================================
   Main
============================================================ */

export function runEDA(data: any[]): EDAResult {
  if (!Array.isArray(data) || data.length === 0) {
    return { duplicates: 0, emptyColumns: [], constantColumns: [], columns: {} };
  }

  const colSet = new Set<string>();
  for (const row of data) Object.keys(row ?? {}).forEach((k) => colSet.add(k));
  const columns = Array.from(colSet);

  const emptyColumns: string[] = [];
  for (const col of columns) {
    let allMissing = true;
    for (const row of data) {
      if (!isMissing(row?.[col])) {
        allMissing = false;
        break;
      }
    }
    if (allMissing) emptyColumns.push(col);
  }

  // duplicates (row fingerprint)
  let duplicates = 0;
  const seen = new Set<string>();
  for (const row of data) {
    const fp = fingerprintRow(row, columns);
    if (seen.has(fp)) duplicates += 1;
    else seen.add(fp);
  }

  const colEDA: Record<string, ColumnEDA> = {};
  const constantColumns: string[] = [];

  for (const col of columns) {
    let missing = 0;
    const values: any[] = [];
    for (const row of data) {
      const v = row?.[col];
      if (isMissing(v)) missing += 1;
      values.push(v);
    }

    const nonMissingCount = Math.max(0, data.length - missing);

    // uniques (string key)
    const uniques = new Map<string, number>();
    let nonMissingSeen = 0;
    for (const v of values) {
      if (isMissing(v)) continue;
      nonMissingSeen += 1;
      const key =
        v instanceof Date ? v.toISOString() : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
      uniques.set(key, (uniques.get(key) ?? 0) + 1);
    }
    const uniqueCount = uniques.size;

    if (nonMissingSeen > 0 && uniqueCount === 1) constantColumns.push(col);

    const decided = decideType(col, values);

    // ID => store as categorical + inferredAs
    if (decided.type === "id") {
      colEDA[col] = {
        type: "categorical",
        missing,
        uniqueCount,
        topValues: Array.from(uniques.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([value, count]) => ({
            value,
            count,
            pct: (count / Math.max(1, nonMissingCount)) * 100,
          })),
        // @ts-ignore
        inferredAs: "id",
        // @ts-ignore
        nonMissingCount,
        // @ts-ignore
        parseReason: decided.reason,
      } as any;
      continue;
    }

    // numeric
    if (decided.type === "numeric" && !emptyColumns.includes(col)) {
      const nums: number[] = [];
      let zeros = 0;
      let negatives = 0;

      for (const v of values) {
        const n = safeToNumberLoose(v);
        if (n === null) continue;
        nums.push(n);
        if (n === 0) zeros += 1;
        if (n < 0) negatives += 1;
      }

      nums.sort((a, b) => a - b);
      const min = nums.length ? nums[0] : null;
      const max = nums.length ? nums[nums.length - 1] : null;
      const meanVal = nums.length ? nums.reduce((acc, v) => acc + v, 0) / nums.length : null;
      const medianVal = nums.length ? median(nums) : null;
      const stdevVal = meanVal !== null ? stdev(nums, meanVal) : null;

      colEDA[col] = {
        type: "numeric",
        missing,
        uniqueCount,
        min,
        max,
        mean: meanVal,
        median: medianVal,
        stdev: stdevVal,
        zeros,
        negatives,
        // @ts-ignore
        nonMissingCount: nums.length,
        // @ts-ignore
        parseReason: decided.reason,
      } as any;
      continue;
    }

    // date
    if (decided.type === "date" && !emptyColumns.includes(col)) {
      const dates: Date[] = [];
      const seenDate = new Set<string>();

      for (const v of values) {
        const d = safeToDateLoose(v);
        if (!d) continue;
        dates.push(d);
        seenDate.add(d.toISOString());
      }

      dates.sort((a, b) => a.getTime() - b.getTime());
      const min = dates.length ? dates[0].toISOString() : null;
      const max = dates.length ? dates[dates.length - 1].toISOString() : null;

      colEDA[col] = {
        type: "date",
        missing,
        uniqueCount: seenDate.size,
        min,
        max,
        // @ts-ignore
        nonMissingCount: dates.length,
        // @ts-ignore
        parseReason: decided.reason,
      } as any;
      continue;
    }

    // categorical
    const entries = Array.from(uniques.entries()).sort((a, b) => b[1] - a[1]);
    const top = entries.slice(0, 8).map(([value, count]) => ({
      value,
      count,
      pct: (count / Math.max(1, nonMissingCount)) * 100,
    }));

    colEDA[col] = {
      type: "categorical",
      missing,
      uniqueCount,
      topValues: top,
      // @ts-ignore
      nonMissingCount,
      // @ts-ignore
      parseReason: decided.reason,
    } as any;
  }

  return { duplicates, emptyColumns, constantColumns, columns: colEDA };
}
