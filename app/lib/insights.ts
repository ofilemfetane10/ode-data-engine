// app/lib/insights.ts
import { EDAResult } from "../context/DatasetContext";
import { KPI } from "./kpis";

export type Insight = {
  id: string;
  text: string;
  severity?: "info" | "warning" | "positive";

  /** NEW: business-ready metadata (optional, won’t break existing UI) */
  column?: string; // the column this insight relates to (if any)
  action?: "investigate" | "segment" | "clean" | "monitor" | "report";
  suggestedQuestions?: string[]; // prompts you can send straight into Ask ODE
};

function num(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** normalize column keys for matching */
function normalizeKey(s: string) {
  return String(s)
    .toLowerCase()
    .trim()
    .replace(/[_\s]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function resolveColumn(raw: string, columns: Record<string, any>): string | null {
  const target = normalizeKey(raw);
  if (!target) return null;
  for (const col of Object.keys(columns ?? {})) {
    if (normalizeKey(col) === target) return col;
  }
  return null;
}

function pushUnique(into: Insight[], item: Insight) {
  if (!into.some((x) => x.id === item.id)) into.push(item);
}

function sortBusiness(insights: Insight[]) {
  const weight: Record<string, number> = { warning: 0, positive: 1, info: 2 };
  return [...insights].sort(
    (a, b) => (weight[a.severity ?? "info"] ?? 2) - (weight[b.severity ?? "info"] ?? 2)
  );
}

/** Build suggested Ask ODE prompts from a column + intent (generic) */
function suggest(col: string | null, kind: "outlier" | "dominance" | "missing" | "time" | "headline") {
  const c = col ?? "";
  const base: string[] = [];

  if (kind === "outlier") {
    base.push(
      `explain ${c}`,
      `distribution of ${c}`,
      `should i use mean or median`,
      `are there any outliers`,
      `what risks do the outliers pose`
    );
  }

  if (kind === "dominance") {
    base.push(
      `top ${c}`,
      `distribution of ${c}`,
      `what stands out`,
      `what decisions could be misleading`,
      `what would you investigate next`
    );
  }

  if (kind === "missing") {
    base.push(
      `missing by column`,
      `is this dataset clean`,
      `are there any data quality risks`,
      c ? `explain ${c}` : `summarise dataset`
    );
  }

  if (kind === "time") {
    base.push(
      `what is the time coverage of this dataset`,
      `are there enough dates to analyse trends`,
      `is this data seasonal`,
      `what would a time trend reveal here`
    );
  }

  if (kind === "headline") {
    base.push(
      `summarise dataset`,
      `what is the main metric`,
      `what stands out`,
      `what would you highlight to executives`
    );
  }

  // de-dup + trim empties
  return Array.from(new Set(base.map((s) => s.trim()).filter(Boolean)));
}

export function generateInsights(eda: EDAResult, kpis: KPI[]): Insight[] {
  const insights: Insight[] = [];

  const columns = (eda.columns ?? {}) as Record<string, any>;
  const cols = Object.entries(columns);

  /* ============================================================
     0) Pick a "main metric" from KPIs (anchors business language)
  ============================================================ */
  const mainMetric =
    kpis.find((k) => k.type === "sum" && k.column) ??
    kpis.find((k) => k.type === "mean" && k.column) ??
    null;

  const mainMetricCol = mainMetric?.column ? resolveColumn(mainMetric.column, columns) : null;

  /* ============================================================
     1) Data-quality warnings (belong in the rail)
  ============================================================ */
  const dup = Number(eda.duplicates ?? 0);
  if (dup > 0) {
    pushUnique(insights, {
      id: "duplicates",
      severity: "warning",
      action: "clean",
      text: `Dataset contains ${dup.toLocaleString()} duplicate row(s). Consider de-duplicating before analysis.`,
      suggestedQuestions: suggest(null, "missing"),
    });
  }

  if (Array.isArray(eda.emptyColumns) && eda.emptyColumns.length > 0) {
    pushUnique(insights, {
      id: "empty-cols",
      severity: "warning",
      action: "clean",
      text: `Some columns are empty (all missing): ${eda.emptyColumns
        .slice(0, 4)
        .join(", ")}${eda.emptyColumns.length > 4 ? "…" : ""}. Remove or fix them.`,
      suggestedQuestions: suggest(null, "missing"),
    });
  }

  if (Array.isArray(eda.constantColumns) && eda.constantColumns.length > 0) {
    pushUnique(insights, {
      id: "constant-cols",
      severity: "info",
      action: "clean",
      text: `Some columns are constant (no variation): ${eda.constantColumns
        .slice(0, 4)
        .join(", ")}${eda.constantColumns.length > 4 ? "…" : ""}. They won’t help explain differences.`,
      suggestedQuestions: ["summarise dataset", "what columns are most important", "what would you investigate next"],
    });
  }

  /* ============================================================
     2) Missingness (only if material)
  ============================================================ */
  for (const [col, info] of cols) {
    const missing = Number(info?.missing ?? 0);

    const nnMaybe = info?.nonMissingCount;
    const nonMissingCount =
      typeof nnMaybe === "number" && Number.isFinite(nnMaybe) ? nnMaybe : null;

    const totalApprox = nonMissingCount !== null ? missing + nonMissingCount : null;
    if (totalApprox && totalApprox > 0) {
      const missPct = (missing / totalApprox) * 100;

      if (missPct >= 25) {
        pushUnique(insights, {
          id: `${col}-missing`,
          severity: missPct >= 40 ? "warning" : "info",
          column: col,
          action: "clean",
          text: `Column "${col}" has ~${Math.round(
            missPct
          )}% missing values. Any conclusions involving this column may be biased.`,
          suggestedQuestions: suggest(col, "missing"),
        });
      }
    }
  }

  /* ============================================================
     3) Numeric: Outliers (business wording)
  ============================================================ */
  const outlierCandidates: Array<{ col: string; score: number; insight: Insight }> = [];

  for (const [col, info] of cols) {
    if (info?.type !== "numeric") continue;

    const max = num(info?.max);
    const mean = num(info?.mean);
    const median = num(info?.median);
    const min = num(info?.min);

    if (max == null || mean == null || mean === 0) continue;

    const ratio = max / Math.max(1e-9, mean);
    const meanMedianGap =
      median != null && median > 0 ? mean / Math.max(1e-9, median) : null;

    const skewHint = meanMedianGap != null ? meanMedianGap >= 1.1 : false;
    const strongOutlier = ratio >= 3;

    if (!strongOutlier) continue;

    const isMain = mainMetricCol === col;
    const metricTag = isMain ? "Main metric" : "Metric";

    const baseText =
      `${metricTag} "${col}" has extreme values that may distort averages. ` +
      `Use median/percentiles and segment (e.g., by category/country) before making decisions.`;

    const score = (isMain ? 100 : 0) + ratio * 10;

    outlierCandidates.push({
      col,
      score,
      insight: {
        id: `outlier-${normalizeKey(col)}`,
        severity: "warning",
        column: col,
        action: "investigate",
        text: baseText,
        suggestedQuestions: suggest(col, "outlier"),
      },
    });

    // Optional: if negatives exist, add a separate (lower priority) warning
    if (min != null && min < 0) {
      outlierCandidates.push({
        col,
        score: score - 20,
        insight: {
          id: `negatives-${normalizeKey(col)}`,
          severity: "info",
          column: col,
          action: "investigate",
          text: `"${col}" includes negative values. Confirm whether negatives represent refunds/credits or data errors.`,
          suggestedQuestions: [`explain ${col}`, `distribution of ${col}`, `are there any data quality risks`],
        },
      });
    }

    // Optional: skew note (info)
    if (skewHint) {
      outlierCandidates.push({
        col,
        score: score - 25,
        insight: {
          id: `skew-${normalizeKey(col)}`,
          severity: "info",
          column: col,
          action: "monitor",
          text: `"${col}" appears right-skewed (mean > median). Median-based KPIs may be more stable for reporting.`,
          suggestedQuestions: [`should i use mean or median`, `distribution of ${col}`, `are extreme values affecting averages`],
        },
      });
    }
  }

  // keep rail clean: top 2 numeric risk items max (favor main metric)
  outlierCandidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .forEach((x) => pushUnique(insights, x.insight));

  /* ============================================================
     4) Categorical: dominance / concentration (business)
  ============================================================ */
  const dominanceCandidates: Array<{ col: string; score: number; insight: Insight }> = [];

  for (const [col, info] of cols) {
    if (info?.type !== "categorical") continue;

    const top = info?.topValues?.[0];
    if (!top) continue;

    const pct = Number(top.pct ?? 0);
    const uniqueCount = Number(info.uniqueCount ?? 0);

    if (pct >= 70 && uniqueCount >= 2) {
      const score = pct * 2 - uniqueCount;
      dominanceCandidates.push({
        col,
        score,
        insight: {
          id: `dominance-${normalizeKey(col)}`,
          severity: "info",
          column: col,
          action: "segment",
          text:
            `Column "${col}" is highly concentrated: "${top.value}" accounts for ~${Math.round(pct)}%. ` +
            `This can hide smaller segments—break down key metrics by "${col}" before concluding.`,
          suggestedQuestions: suggest(col, "dominance"),
        },
      });
    }
  }

  dominanceCandidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 1)
    .forEach((x) => pushUnique(insights, x.insight));

  /* ============================================================
     5) Date coverage (business)
  ============================================================ */
  const dateCol =
    Object.entries(columns).find(([, c]: any) => c?.type === "date")?.[0] ?? null;

  if (dateCol) {
    const info = columns[dateCol];
    const min = info?.min ? String(info.min).slice(0, 10) : null;
    const max = info?.max ? String(info.max).slice(0, 10) : null;
    const uniq = Number(info?.uniqueCount ?? 0);

    if (min && max) {
      pushUnique(insights, {
        id: `${dateCol}-coverage`,
        severity: "info",
        column: dateCol,
        action: "monitor",
        text:
          `Time coverage: "${dateCol}" spans ${min} → ${max}. ` +
          (uniq >= 30
            ? `Enough granularity (${uniq} unique dates) for trend/seasonality checks via weekly/monthly aggregation.`
            : `Date coverage exists but granularity is limited (${uniq} unique dates).`),
        suggestedQuestions: suggest(dateCol, "time"),
      });
    }
  }

  /* ============================================================
     6) We intentionally DO NOT push developer-noise:
        - high-cardinality warnings
        - id-ish columns
     (These can exist in EDA, not in the business rail.)
  ============================================================ */

  /* ============================================================
     7) One positive headline (premium feel)
  ============================================================ */
  const sumKpi = kpis.find((k) => k.type === "sum" && k.column);
  const meanKpi = kpis.find((k) => k.type === "mean" && k.column);

  if (sumKpi?.column && sumKpi.value != null) {
    const col = resolveColumn(sumKpi.column, columns) ?? sumKpi.column;
    pushUnique(insights, {
      id: `headline-total-${normalizeKey(col)}`,
      severity: "positive",
      column: col,
      action: "report",
      text: `Headline: Total ${col} = ${String(sumKpi.value)} (useful for top-line reporting).`,
      suggestedQuestions: suggest(col, "headline"),
    });
  } else if (meanKpi?.column && meanKpi.value != null) {
    const col = resolveColumn(meanKpi.column, columns) ?? meanKpi.column;
    pushUnique(insights, {
      id: `headline-avg-${normalizeKey(col)}`,
      severity: "positive",
      column: col,
      action: "report",
      text: `Headline: Average ${col} = ${String(meanKpi.value)} (useful for baseline reporting).`,
      suggestedQuestions: suggest(col, "headline"),
    });
  }

  /* ============================================================
     8) Final: sort + cap (premium, not spam)
  ============================================================ */
  const ranked = sortBusiness(insights);
  return ranked.slice(0, 6);
}
