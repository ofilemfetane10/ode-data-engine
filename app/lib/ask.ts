// app/dashboard/ask.ts

type AnswerArgs = {
  q: string;
  meta: any;
  eda: any;
  kpis: any[];
  charts: any[];
  insights: Array<{ text: string; severity?: string }>;
};

/* ============================================================
   COLUMN NORMALISATION (CRITICAL)
============================================================ */

function normalizeKey(s: string) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\u00A0]/g, " ") // non-breaking space
    .replace(/\s+/g, " ")
    .replace(/[_\s]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function resolveColumn(raw: string, eda: any): string | null {
  const columns = eda?.columns ?? {};
  const rawStr = String(raw ?? "").trim();
  if (!rawStr) return null;

  const target = normalizeKey(rawStr);
  if (!target) return null;

  // exact normalize match
  for (const col of Object.keys(columns)) {
    if (normalizeKey(col) === target) return col;
  }

  // contains match (helps "order value eur" -> "order_value_EUR")
  for (const col of Object.keys(columns)) {
    const nk = normalizeKey(col);
    if (nk.includes(target) || target.includes(nk)) return col;
  }

  return null;
}

/* ============================================================
   SMALL FORMATTERS
============================================================ */

function n(v: any): number | null {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

function fmtNum(v: any) {
  const x = n(v);
  if (x === null) return "—";
  if (Math.abs(x) >= 1_000_000_000) return `${(x / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(x) >= 1_000_000) return `${(x / 1_000_000).toFixed(2)}M`;
  if (Math.abs(x) >= 1_000) return Math.round(x).toLocaleString();
  return x % 1 === 0 ? x.toLocaleString() : x.toFixed(2);
}

function fmtPct(v: any) {
  const x = n(v);
  if (x === null) return "—";
  return `${Math.round(x)}%`;
}

function firstDateColumn(columns: any): string | null {
  for (const [col, info] of Object.entries(columns ?? {}) as any[]) {
    if (info?.type === "date") return col;
  }
  return null;
}

function mainNumericFromKpis(kpis: any[]) {
  // prefer sum KPI to decide “main” numeric column, fallback to mean
  const sum = kpis.find((k) => k?.type === "sum" && k?.column);
  if (sum) return sum;
  const mean = kpis.find((k) => k?.type === "mean" && k?.column);
  return mean ?? null;
}

/* ============================================================
   INTENT HELPERS
============================================================ */

function isSummary(q: string) {
  return /(summari[sz]e|summary|overview)/i.test(q);
}

function isWhatStandsOut(q: string) {
  return /(what stands out|stand out)/i.test(q);
}

function isMainMetric(q: string) {
  return /(main metric|primary metric|key metric)/i.test(q);
}

function isTop(q: string) {
  return /^\s*top\s+/.test(q);
}

function isExplain(q: string) {
  return /^\s*explain\s+/.test(q);
}

function isDistribution(q: string) {
  return /(distribution of|distribution|dist of)\s+/i.test(q);
}

function isOutliers(q: string) {
  return /(outlier|anomal)/i.test(q);
}

function isSkew(q: string) {
  return /(skew|skewed|mean|median|average|robust)/i.test(q);
}

function isTime(q: string) {
  return /(time coverage|time range|date range|time trend|trend|time series|season)/i.test(q);
}

function isKpiGap(q: string) {
  return /(missing kpi|kpi.*missing|what kpis|kpi gaps|dashboard kpis)/i.test(q);
}

function isNextSteps(q: string) {
  return /(what would you investigate next|investigate next|next steps|what next)/i.test(q);
}

function isNotAnswerable(q: string) {
  return /(cannot answer|can't answer|not answer|limitations|what questions.*not)/i.test(q);
}

function isDataImprove(q: string) {
  return /(what data.*improve|add.*improve|improve decision|what would you add)/i.test(q);
}

function isExec(q: string) {
  return /(executive|stakeholder|highlight|warn|risk|assumption|mislead|mistake|decision)/i.test(q);
}

/* ============================================================
   ANSWER ENGINE
============================================================ */

export function answerQuestion({ q, meta, eda, kpis, charts, insights }: AnswerArgs): string {
  const query = String(q ?? "").trim();
  const queryLower = query.toLowerCase();

  const columns = eda?.columns ?? {};
  const hasDate = Object.values(columns).some((c: any) => c?.type === "date");

  const numericCols = Object.entries(columns).filter(([, c]: any) => c?.type === "numeric");
  const categoricalCols = Object.entries(columns).filter(([, c]: any) => c?.type === "categorical");

  const mainNumeric = mainNumericFromKpis(kpis);
  const outlierInsights = (insights ?? []).filter((i) => (i?.severity ?? "").toLowerCase() === "warning");

  /* =========================
     SUMMARY
  ========================= */
  if (isSummary(queryLower)) {
    const main = mainNumeric?.column ? ` The primary numeric signal appears to be "${mainNumeric.column}".` : "";
    const time = hasDate ? ", with a time dimension present." : ".";
    return `This dataset contains ${meta?.rows} rows and ${meta?.columns} columns. It includes ${numericCols.length} numeric columns and ${categoricalCols.length} categorical columns${time}${main}`;
  }

  /* =========================
     WHAT STANDS OUT
  ========================= */
  if (isWhatStandsOut(queryLower)) {
    if (!insights?.length) return "No strong anomalies or dominant patterns were detected.";
    return insights.map((i) => `• ${i.text}`).join("\n");
  }

  /* =========================
     MAIN METRIC
  ========================= */
  if (isMainMetric(queryLower)) {
    return mainNumeric?.column
      ? `The main metric appears to be "${mainNumeric.column}", based on scale and variation.`
      : "No clear primary metric could be identified without additional context.";
  }

  /* =========================
     OUTLIERS
  ========================= */
  if (isOutliers(queryLower)) {
    if (!outlierInsights.length) return "No significant outliers were detected based on basic statistical thresholds.";
    return outlierInsights.map((i) => `• ${i.text}`).join("\n");
  }

  /* =========================
     SKEW / MEAN VS MEDIAN
  ========================= */
  if (isSkew(queryLower)) {
    return outlierInsights.length
      ? "The main numeric columns appear skewed due to extreme values. Median-based analysis is recommended."
      : "The numeric distributions do not appear heavily skewed; mean-based summaries should be generally fine.";
  }

  /* =========================
     EXPLAIN COLUMN
  ========================= */
  if (isExplain(queryLower)) {
    const raw = queryLower.replace(/^explain\s+/, "").trim();
    const col = resolveColumn(raw, eda);
    if (!col) return `I couldn’t find a matching column for "${raw}". Try copying the column name from the EDA list.`;

    const info: any = columns[col];

    if (info?.type === "numeric") {
      const mean = fmtNum(info?.mean);
      const median = fmtNum(info?.median);
      return `"${col}" is a numeric column with ${info?.uniqueCount ?? "—"} unique values and ${info?.missing ?? 0} missing values. It ranges from ${fmtNum(info?.min)} to ${fmtNum(info?.max)}. Mean: ${mean}${median !== "—" ? `, Median: ${median}` : ""}.`;
    }

    if (info?.type === "categorical") {
      const top = info?.topValues?.[0];
      return `"${col}" is a categorical column with ${info?.uniqueCount ?? "—"} unique values and ${info?.missing ?? 0} missing values. The most common value is "${top?.value ?? "—"}" (${fmtPct(top?.pct)}).`;
    }

    if (info?.type === "date") {
      return `"${col}" is a date column. It spans from ${String(info?.min ?? "—")} to ${String(info?.max ?? "—")} with ${info?.uniqueCount ?? "—"} unique dates.`;
    }

    return `"${col}" exists, but its type (${String(info?.type ?? "unknown")}) isn’t supported for detailed explanation yet.`;
  }

  /* =========================
     DISTRIBUTION
  ========================= */
  if (isDistribution(queryLower)) {
    const raw = queryLower
      .replace(/distribution of/i, "")
      .replace(/dist of/i, "")
      .replace(/distribution/i, "")
      .trim();

    const col = resolveColumn(raw, eda);
    if (!col) return `I couldn’t find a matching column for "${raw}". Try: "distribution of <exact column name>".`;

    const info: any = columns[col];

    if (info?.type === "numeric") {
      const stdev = n(info?.stdev);
      const variation = stdev && stdev > 0 ? "noticeable variation" : "low variation";
      return `The distribution of "${col}" spans from ${fmtNum(info?.min)} to ${fmtNum(info?.max)}. Mean: ${fmtNum(info?.mean)}${info?.median != null ? `, Median: ${fmtNum(info?.median)}` : ""}, with ${variation}.`;
    }

    if (info?.type === "categorical") {
      const top = info?.topValues?.[0];
      return `"${col}" contains ${info?.uniqueCount ?? "—"} categories. The top category "${top?.value ?? "—"}" accounts for ${fmtPct(top?.pct)}.`;
    }

    return `"${col}" does not have a distribution suitable for analysis.`;
  }

  /* =========================
     TOP VALUES
  ========================= */
  if (isTop(queryLower)) {
    const raw = queryLower.replace(/^top\s+/, "").trim();
    const col = resolveColumn(raw, eda);
    if (!col) return `I couldn’t find a matching column for "${raw}".`;

    const info: any = columns[col];
    if (!info?.topValues?.length) return `Top values could not be determined for "${col}".`;

    return `Top values in "${col}": ${info.topValues
      .slice(0, 5)
      .map((v: any) => `${v.value} (${fmtPct(v.pct)})`)
      .join(", ")}`;
  }

  /* =========================
     TIME / COVERAGE / SEASONALITY (SAFE)
  ========================= */
  if (isTime(queryLower)) {
    if (!hasDate) return "This dataset does not contain a date column suitable for time analysis.";

    const dateCol = firstDateColumn(columns);
    if (!dateCol) return "A date column was detected, but I couldn’t resolve it reliably.";

    const info: any = columns[dateCol];
    const span = `The dataset spans from ${String(info?.min ?? "—")} to ${String(info?.max ?? "—")}.`;
    const uniq = ` With ${info?.uniqueCount ?? "—"} unique dates, basic trend analysis is feasible.`;

    // if user explicitly asks seasonality, be careful: we are NOT computing seasonal decomposition here
    if (/season/i.test(queryLower)) {
      return `${span}${uniq} To confirm seasonality, you’d typically aggregate by week/month and compare recurring peaks across periods.`;
    }

    // if user asks “what would a time trend reveal”
    if (/reveal/i.test(queryLower) || /appropriate/i.test(queryLower) || /trend analysis/i.test(queryLower)) {
      return `${span}${uniq} A sensible approach is to aggregate the main numeric metric by week/month and compare changes over time, then segment by key categories (country/device/category) to see drivers.`;
    }

    return `${span}${uniq}`;
  }

  /* =========================
     KPI GAPS
  ========================= */
  if (isKpiGap(queryLower)) {
    return `Potential KPI gaps for a decision-ready dashboard include: growth rates (MoM/YoY), targets/benchmarks, profit or margin metrics, segmentation KPIs (by key categories), and trend KPIs (rolling averages). Without these, insights remain mostly descriptive.`;
  }

  /* =========================
     NEXT STEPS
  ========================= */
  if (isNextSteps(queryLower)) {
    return `Recommended next steps: segment the main metric by key categories (e.g., country/device/category), investigate extreme values, compare mean vs median trends, analyse time trends for shifts, and identify top contributors vs the long tail.`;
  }

  /* =========================
     LIMITATIONS / NOT ANSWERABLE
  ========================= */
  if (isNotAnswerable(queryLower)) {
    return `This dataset can describe what happened (totals, distributions, segments, trends), but it cannot reliably explain causality (why it happened), intent, or performance vs targets unless you add benchmarks, campaign context, or business rules.`;
  }

  /* =========================
     WHAT TO ADD / IMPROVE DECISIONS
  ========================= */
  if (isDataImprove(queryLower)) {
    return `To improve decision-making, add: targets/quotas, product/region hierarchy, customer IDs with lifecycle info, discount/promo flags, channel/source, and a clear profit/margin field. These unlock performance vs target, attribution, and actionable segmentation.`;
  }

  /* =========================
     EXEC / STRATEGY (PAY-WORTHY)
  ========================= */
  if (isExec(queryLower)) {
    return `Key considerations based on this dataset: outliers may distort averages (use medians + segmentation), dominant categories can hide minority behaviour, time trends are descriptive not explanatory, and this dataset supports monitoring and exploration—not causal claims.`;
  }

  /* =========================
     FINAL FALLBACK (NEVER “I can only…”)
  ========================= */
  return `Based on the dataset structure and available statistics: the data supports descriptive analysis and high-level trend exploration. Outliers suggest caution when using averages, and dominant categories may hide smaller segments. If you want something specific, reference a column (e.g., "explain cost", "top country", "distribution of order_value_EUR", "time coverage").`;
}
