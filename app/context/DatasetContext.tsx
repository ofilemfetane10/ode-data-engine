"use client";

import React, { createContext, useContext, useMemo, useState } from "react";
import type { ChartSpec } from "../lib/charts";
import { runEDA } from "../lib/eda";
import { generateKPIs, type KPI } from "../lib/kpis"; // ✅ single source of truth
import { generateCharts } from "../lib/charts";

/* =========================
   TYPES
========================= */

export type Meta = {
  fileName?: string;
  fileType?: "csv" | "excel";
  sheetName?: string;
  rows: number;
  columns: number;
  missingValues: number;
};

type BaseEDA = {
  missing: number;
  uniqueCount: number;

  // Optional extra metadata (safe + useful)
  nonMissingCount?: number;
  inferredAs?: "id";
};

export type NumericEDA = BaseEDA & {
  type: "numeric";
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  stdev: number | null;
  zeros: number;
  negatives: number;
};

export type CategoricalEDA = BaseEDA & {
  type: "categorical";
  topValues: Array<{
    value: string;
    count: number;
    pct: number;
  }>;
};

export type DateEDA = BaseEDA & {
  type: "date";
  min: string | null;
  max: string | null;
};

export type ColumnEDA = NumericEDA | CategoricalEDA | DateEDA;

export type EDAResult = {
  duplicates: number;
  emptyColumns: string[];
  constantColumns: string[];
  columns: Record<string, ColumnEDA>;
};

export type DatasetState = {
  data: any[] | null;
  meta: Meta | null;
  eda: EDAResult | null;
  kpis: KPI[];
  charts: ChartSpec[];

  /**
   * SAFE SETTER:
   * You can call this with ONLY data + meta, and it will compute EDA/KPIs/Charts.
   * Still supports old calls where you pass eda/kpis/charts explicitly.
   */
  setDataset: (
    data: any[],
    meta: Meta,
    eda?: EDAResult | null,
    kpis?: KPI[] | null,
    charts?: ChartSpec[] | null
  ) => void;

  clearDataset: () => void;
};

/* =========================
   HELPERS
========================= */

function safeArray<T = any>(v: any): T[] {
  return Array.isArray(v) ? v : [];
}

function computeMissingValues(data: any[]): number {
  if (!data?.length) return 0;

  // gather all keys (not just first row) to be stable
  const keys = new Set<string>();
  for (const row of data) Object.keys(row ?? {}).forEach((k) => keys.add(k));

  let missing = 0;
  for (const row of data) {
    for (const k of keys) {
      const v = row?.[k];
      if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) {
        missing += 1;
      }
    }
  }
  return missing;
}

function computeColumnsCount(data: any[]): number {
  const keys = new Set<string>();
  for (const row of data) Object.keys(row ?? {}).forEach((k) => keys.add(k));
  return keys.size;
}

/* =========================
   CONTEXT
========================= */

const DatasetContext = createContext<DatasetState | null>(null);

export function DatasetProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<any[] | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [eda, setEda] = useState<EDAResult | null>(null);
  const [kpis, setKpis] = useState<KPI[]>([]);
  const [charts, setCharts] = useState<ChartSpec[]>([]);

  const setDataset: DatasetState["setDataset"] = (d, m, e, k, ch) => {
    const rows = safeArray(d);

    // Meta sanity — keep generic + correct, no hardcoding
    const metaSafe: Meta = {
      ...m,
      rows: Number(m?.rows ?? rows.length ?? 0),
      columns: Number(m?.columns ?? computeColumnsCount(rows) ?? 0),
      missingValues: Number(m?.missingValues ?? computeMissingValues(rows) ?? 0),
    };

    // If caller didn't pass EDA/KPIs/Charts, compute them HERE
    const edaSafe = (e && typeof e === "object" ? e : runEDA(rows)) as EDAResult;

    const kpisSafe =
      safeArray<KPI>(k).length > 0 ? safeArray<KPI>(k) : generateKPIs(rows, edaSafe);

    const chartsSafe =
      safeArray<ChartSpec>(ch).length > 0 ? safeArray<ChartSpec>(ch) : generateCharts(rows, edaSafe);

    setData(rows);
    setMeta(metaSafe);
    setEda(edaSafe);
    setKpis(kpisSafe);
    setCharts(chartsSafe);
  };

  const clearDataset = () => {
    setData(null);
    setMeta(null);
    setEda(null);
    setKpis([]);
    setCharts([]);
  };

  const value = useMemo<DatasetState>(
    () => ({
      data,
      meta,
      eda,
      kpis,
      charts,
      setDataset,
      clearDataset,
    }),
    [data, meta, eda, kpis, charts]
  );

  return <DatasetContext.Provider value={value}>{children}</DatasetContext.Provider>;
}

export function useDataset() {
  const ctx = useContext(DatasetContext);
  if (!ctx) throw new Error("useDataset must be used inside <DatasetProvider />");
  return ctx;
}
