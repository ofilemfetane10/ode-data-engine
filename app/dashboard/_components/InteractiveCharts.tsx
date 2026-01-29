// app/dashboard/_components/InteractiveCharts.tsx
"use client";

import React from "react";
import type {
  ChartSpec,
  HistogramChartSpec,
  BarChartSpec,
  TimeChartSpec,
  ScatterChartSpec,
  BoxChartSpec,
  CorrChartSpec,
} from "@/app/lib/charts";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  ScatterChart,
  Scatter,
  ZAxis,
  ReferenceLine,
} from "recharts";

const RED = "#ef4444"; // tailwind red-500

export type ChartSelection =
  | { kind: "bar"; column: string; value: string }
  | { kind: "histogram"; column: string; range: [number, number] }
  | { kind: "time"; xColumn: string; yColumn: string; x: string }
  | { kind: "scatter"; xColumn: string; yColumn: string; point: { x: number; y: number } }
  | { kind: "corr"; columns: string[]; cell: { i: number; j: number; value: number } }
  | { kind: "box"; column: string; part: "q1-q3" | "median" | "whisker" | "outlier"; value?: number };

export function ChartCard({
  chart,
  selection,
  onSelect,
}: {
  chart: ChartSpec;
  selection?: ChartSelection | null;
  onSelect?: (sel: ChartSelection) => void;
}) {
  const label =
    chart.type === "histogram"
      ? "Histogram"
      : chart.type === "bar"
      ? "Bar"
      : chart.type === "time"
      ? "Time"
      : chart.type === "scatter"
      ? "Scatter"
      : chart.type === "box"
      ? "Box"
      : "Correlation";

  const title =
    chart.type === "time"
      ? chart.yColumn
      : chart.type === "scatter"
      ? chart.yColumn
      : chart.type === "corr"
      ? "Correlation"
      : chart.column;

  const subtitle =
    chart.type === "time"
      ? `${chart.yColumn} vs ${chart.xColumn} (${chart.granularity})`
      : chart.type === "scatter"
      ? `${chart.yColumn} vs ${chart.xColumn}`
      : chart.type === "corr"
      ? `${(chart.columns ?? []).length} numeric columns`
      : chart.column;

  const isSelected = isSelectionForChart(selection ?? null, chart);

  return (
    <div className="border rounded-xl p-5">
      <div className="flex items-start justify-between mb-3 gap-3">
        <div>
          <p className="text-xs text-neutral-500 uppercase tracking-wide">{label}</p>
          <h3 className="font-semibold leading-tight">{title}</h3>
          <p className="text-xs text-neutral-500 mt-1">{subtitle}</p>
        </div>

        {isSelected ? (
          <span className="text-[11px] px-2 py-1 rounded-full border text-neutral-600">Selected</span>
        ) : null}
      </div>

      <div className="rounded-lg border bg-white p-3 overflow-hidden">
        {chart.type === "histogram" ? (
          <HistogramInteractive chart={chart} selection={selection} onSelect={onSelect} />
        ) : chart.type === "bar" ? (
          <BarInteractive chart={chart} selection={selection} onSelect={onSelect} />
        ) : chart.type === "time" ? (
          <TimeInteractive chart={chart} selection={selection} onSelect={onSelect} />
        ) : chart.type === "scatter" ? (
          <ScatterInteractive chart={chart} selection={selection} onSelect={onSelect} />
        ) : chart.type === "box" ? (
          <BoxInteractive chart={chart} selection={selection} onSelect={onSelect} />
        ) : (
          <CorrInteractive chart={chart} selection={selection} onSelect={onSelect} />
        )}
      </div>

      <p className="mt-3 text-xs text-neutral-500">
        Tip: click to drill down.{" "}
        <span className="text-neutral-400">
          {chart.type === "corr"
            ? "Click a cell."
            : chart.type === "time"
            ? "Click a point."
            : chart.type === "scatter"
            ? "Click a point."
            : chart.type === "box"
            ? "Click outliers."
            : "Click a bar/bin."}
        </span>
      </p>
    </div>
  );
}

/* ============================================================
   HISTOGRAM (INTERACTIVE)
============================================================ */

function HistogramInteractive({
  chart,
  selection,
  onSelect,
}: {
  chart: HistogramChartSpec;
  selection?: ChartSelection | null;
  onSelect?: (sel: ChartSelection) => void;
}) {
  const selectedRange =
    selection && selection.kind === "histogram" && selection.column === chart.column ? selection.range : null;

  const data = React.useMemo(() => {
    const edges = chart.edges ?? [];
    const counts = chart.counts ?? [];
    const rows: Array<{
      idx: number;
      count: number;
      selectedCount: number;
      from: number;
      to: number;
      label: string;
    }> = [];

    for (let i = 0; i < counts.length; i++) {
      const a = edges[i];
      const b = edges[i + 1];
      if (typeof a !== "number" || typeof b !== "number") continue;

      const isSelected = selectedRange ? a === selectedRange[0] && b === selectedRange[1] : false;

      rows.push({
        idx: i,
        count: Number(counts[i] ?? 0),
        selectedCount: isSelected ? Number(counts[i] ?? 0) : 0,
        from: a,
        to: b,
        label: formatBinLabel(a, b),
      });
    }

    return rows;
  }, [chart.edges, chart.counts, selectedRange]);

  const rotate = data.length > 8;

  return (
    <div className="w-full h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 10, right: 10, left: 0, bottom: rotate ? 55 : 20 }}
          onClick={(state: any) => {
            const payload = state?.activePayload?.[0]?.payload;
            if (!payload) return;
            const range: [number, number] = [payload.from, payload.to];
            onSelect?.({ kind: "histogram", column: chart.column, range });
          }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            interval={0}
            height={rotate ? 55 : 20}
            angle={rotate ? -35 : 0}
            textAnchor={rotate ? "end" : "middle"}
            tickFormatter={(v) => shorten(v, 16)}
          />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip
            content={({ active, payload }: any) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload;
              return (
                <TooltipBox
                  title={chart.column}
                  lines={[`Range: ${fmtNum(p.from)} → ${fmtNum(p.to)}`, `Count: ${fmtNum(p.count)}`]}
                />
              );
            }}
          />

          <Bar dataKey="count" fill={RED} radius={[6, 6, 0, 0]} fillOpacity={selectedRange ? 0.35 : 1} />
          {selectedRange ? <Bar dataKey="selectedCount" fill={RED} radius={[6, 6, 0, 0]} /> : null}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ============================================================
   BAR (INTERACTIVE)
============================================================ */

function topNWithOther(rows: { label: string; count: number }[], n: number) {
  const sorted = [...rows].sort((a, b) => b.count - a.count);
  const top = sorted.slice(0, n);
  const rest = sorted.slice(n);
  const other = rest.reduce((acc, r) => acc + r.count, 0);
  return other > 0 ? [...top, { label: "Other", count: other }] : top;
}

function BarInteractive({
  chart,
  selection,
  onSelect,
}: {
  chart: BarChartSpec;
  selection?: ChartSelection | null;
  onSelect?: (sel: ChartSelection) => void;
}) {
  const selectedValue =
    selection && selection.kind === "bar" && selection.column === chart.column ? selection.value : null;

  const data = React.useMemo(() => {
    const labels = chart.labels ?? [];
    const counts = chart.counts ?? [];

    const rawRows = labels.map((l, i) => ({
      label: String(l),
      count: Number(counts[i] ?? 0),
    }));

    const maxBars = Math.max(5, Math.min(12, chart.maxBars ?? 10));
    const topRows = topNWithOther(rawRows, maxBars);

    return topRows.map((r) => ({
      ...r,
      selectedCount: selectedValue && r.label === selectedValue ? r.count : 0,
    }));
  }, [chart.labels, chart.counts, chart.maxBars, selectedValue]);

  const rotate = data.length > 6;

  return (
    <div className="w-full h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 10, right: 10, left: 0, bottom: rotate ? 60 : 25 }}
          onClick={(state: any) => {
            const payload = state?.activePayload?.[0]?.payload;
            if (!payload) return;
            onSelect?.({ kind: "bar", column: chart.column, value: payload.label });
          }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            interval={0}
            height={rotate ? 60 : 25}
            angle={rotate ? -35 : 0}
            textAnchor={rotate ? "end" : "middle"}
            tickFormatter={(v) => shorten(v, 14)}
          />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip
            content={({ active, payload }: any) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload;
              return <TooltipBox title={chart.column} lines={[`Value: ${p.label}`, `Count: ${fmtNum(p.count)}`]} />;
            }}
          />

          <Bar dataKey="count" fill={RED} radius={[6, 6, 0, 0]} fillOpacity={selectedValue ? 0.35 : 1} />
          {selectedValue ? <Bar dataKey="selectedCount" fill={RED} radius={[6, 6, 0, 0]} /> : null}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ============================================================
   TIME (INTERACTIVE)
============================================================ */

function TimeInteractive({
  chart,
  selection,
  onSelect,
}: {
  chart: TimeChartSpec;
  selection?: ChartSelection | null;
  onSelect?: (sel: ChartSelection) => void;
}) {
  const selectedX =
    selection &&
    selection.kind === "time" &&
    selection.xColumn === chart.xColumn &&
    selection.yColumn === chart.yColumn
      ? selection.x
      : null;

  const data = React.useMemo(() => {
    const pts = Array.isArray(chart.points) ? chart.points : [];
    return pts.map((p) => ({
      x: String(p.x),
      y: Number(p.y ?? 0),
    }));
  }, [chart.points]);

  const dataWithSel = React.useMemo(() => {
    return data.map((d) => ({
      ...d,
      selectedY: selectedX && d.x === selectedX ? d.y : null,
    }));
  }, [data, selectedX]);

  return (
    <div className="w-full h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={dataWithSel}
          margin={{ top: 10, right: 10, left: 0, bottom: 25 }}
          onClick={(state: any) => {
            const payload = state?.activePayload?.[0]?.payload;
            if (!payload?.x) return;
            onSelect?.({ kind: "time", xColumn: chart.xColumn, yColumn: chart.yColumn, x: payload.x });
          }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="x"
            tick={{ fontSize: 11 }}
            interval="preserveStartEnd"
            minTickGap={24}
            tickFormatter={(v) => shorten(v, 12)}
          />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip
            content={({ active, payload }: any) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload;
              return <TooltipBox title={`${chart.yColumn} over ${chart.xColumn}`} lines={[`x: ${p.x}`, `y: ${fmtNum(p.y)}`]} />;
            }}
          />
          <Line type="monotone" dataKey="y" stroke={RED} strokeWidth={2.5} dot={false} />
          <Line type="monotone" dataKey="selectedY" stroke={RED} strokeWidth={0} dot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ============================================================
   SCATTER (INTERACTIVE)
============================================================ */

function ScatterInteractive({
  chart,
  selection,
  onSelect,
}: {
  chart: ScatterChartSpec;
  selection?: ChartSelection | null;
  onSelect?: (sel: ChartSelection) => void;
}) {
  const selected =
    selection &&
    selection.kind === "scatter" &&
    selection.xColumn === chart.xColumn &&
    selection.yColumn === chart.yColumn
      ? selection.point
      : null;

  const data = React.useMemo(() => {
    const pts = Array.isArray(chart.points) ? chart.points : [];
    return pts
      .map((p) => ({ x: Number(p.x), y: Number(p.y) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  }, [chart.points]);

  const dataWithZ = React.useMemo(() => {
    return data.map((p) => ({
      ...p,
      z: selected && p.x === selected.x && p.y === selected.y ? 200 : 80,
    }));
  }, [data, selected]);

  return (
    <div className="w-full h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart
          margin={{ top: 10, right: 10, left: 0, bottom: 25 }}
          onClick={(state: any) => {
            const payload = state?.activePayload?.[0]?.payload;
            if (!payload) return;
            const x = Number(payload.x);
            const y = Number(payload.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return;
            onSelect?.({ kind: "scatter", xColumn: chart.xColumn, yColumn: chart.yColumn, point: { x, y } });
          }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" dataKey="x" tick={{ fontSize: 11 }} tickFormatter={(v) => fmtNum(v)} />
          <YAxis type="number" dataKey="y" tick={{ fontSize: 11 }} tickFormatter={(v) => fmtNum(v)} />
          <Tooltip
            content={({ active, payload }: any) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload;
              return (
                <TooltipBox
                  title={`${chart.yColumn} vs ${chart.xColumn}`}
                  lines={[
                    `${chart.xColumn}: ${fmtNum(p.x)}`,
                    `${chart.yColumn}: ${fmtNum(p.y)}`,
                    chart.correlation === null ? "" : `corr: ${Number(chart.correlation).toFixed(3)}`,
                  ].filter(Boolean)}
                />
              );
            }}
          />
          <ZAxis type="number" dataKey="z" range={[40, 140]} />
          <ReferenceLine x={0} strokeDasharray="3 3" />
          <ReferenceLine y={0} strokeDasharray="3 3" />
          <Scatter data={dataWithZ} fill={RED} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ============================================================
   BOX (INTERACTIVE)
============================================================ */

function BoxInteractive({
  chart,
  selection,
  onSelect,
}: {
  chart: BoxChartSpec;
  selection?: ChartSelection | null;
  onSelect?: (sel: ChartSelection) => void;
}) {
  const selectedCol = selection && selection.kind === "box" && selection.column === chart.column ? selection : null;

  const W = 520;
  const H = 240;
  const padX = 30;
  const midY = H / 2;

  const domainMin = Math.min(chart.min, ...(chart.outliers ?? []), chart.q1);
  const domainMax = Math.max(chart.max, ...(chart.outliers ?? []), chart.q3);
  const span = domainMax - domainMin || 1;

  const x = (v: number) => padX + ((v - domainMin) / span) * (W - padX * 2);

  const xMin = x(chart.min);
  const xMax = x(chart.max);
  const xQ1 = x(chart.q1);
  const xQ3 = x(chart.q3);
  const xMed = x(chart.median);

  const boxH = 64;
  const whiskH = 26;

  const outliers = (chart.outliers ?? []).slice(0, 120);

  return (
    <div className="w-full h-[240px]">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
        <line x1={padX} y1={midY} x2={W - padX} y2={midY} stroke="#e5e7eb" />

        <line x1={xMin} y1={midY} x2={xMax} y2={midY} stroke="#111827" strokeWidth={2} />
        <line x1={xMin} y1={midY - whiskH / 2} x2={xMin} y2={midY + whiskH / 2} stroke="#111827" strokeWidth={2} />
        <line x1={xMax} y1={midY - whiskH / 2} x2={xMax} y2={midY + whiskH / 2} stroke="#111827" strokeWidth={2} />

        <rect
          x={Math.min(xQ1, xQ3)}
          y={midY - boxH / 2}
          width={Math.abs(xQ3 - xQ1)}
          height={boxH}
          fill={RED}
          fillOpacity={0.18}
          stroke={RED}
          strokeWidth={2}
          rx={10}
          onClick={() => onSelect?.({ kind: "box", column: chart.column, part: "q1-q3" })}
          style={{ cursor: "pointer" }}
        />

        <line
          x1={xMed}
          y1={midY - boxH / 2}
          x2={xMed}
          y2={midY + boxH / 2}
          stroke={RED}
          strokeWidth={3}
          onClick={() => onSelect?.({ kind: "box", column: chart.column, part: "median", value: chart.median })}
          style={{ cursor: "pointer" }}
        />

        {outliers.map((v, i) => {
          const cx = x(v);
          const isSel = selectedCol?.part === "outlier" && selectedCol.value === v;
          return (
            <circle
              key={`${v}-${i}`}
              cx={cx}
              cy={midY}
              r={isSel ? 5 : 3.5}
              fill={RED}
              fillOpacity={isSel ? 0.95 : 0.55}
              onClick={() => onSelect?.({ kind: "box", column: chart.column, part: "outlier", value: v })}
              style={{ cursor: "pointer" }}
            />
          );
        })}

        <text x={padX} y={18} fontSize={12} fill="#6b7280">
          min {fmtNum(chart.min)} · q1 {fmtNum(chart.q1)} · median {fmtNum(chart.median)} · q3 {fmtNum(chart.q3)} · max{" "}
          {fmtNum(chart.max)}
        </text>
        <text x={padX} y={H - 10} fontSize={11} fill="#9ca3af">
          outliers: {fmtNum((chart.outliers ?? []).length)} · n={fmtNum(chart.total)}
        </text>
      </svg>
    </div>
  );
}

/* ============================================================
   CORRELATION (INTERACTIVE)
============================================================ */

function CorrInteractive({
  chart,
  selection,
  onSelect,
}: {
  chart: CorrChartSpec;
  selection?: ChartSelection | null;
  onSelect?: (sel: ChartSelection) => void;
}) {
  const cols = chart.columns ?? [];
  const M = chart.matrix ?? [];
  const n = cols.length;

  const selectedCell =
    selection && selection.kind === "corr" && arraysEq(selection.columns, cols) ? selection.cell : null;

  const size = 240;
  const pad = 46;
  const cell = n ? Math.max(14, Math.floor((size - 6) / n)) : 14;
  const gridW = cell * n;

  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  const colorFor = (r: number) => {
    const a = Math.abs(clamp(r));
    const alpha = 0.05 + a * 0.85;
    return `rgba(239, 68, 68, ${alpha.toFixed(3)})`;
  };

  if (!n) {
    return (
      <div className="w-full h-[240px] flex items-center justify-center text-sm text-neutral-500">
        Not enough numeric columns for correlation.
      </div>
    );
  }

  return (
    <div className="w-full h-[240px]">
      <svg viewBox={`0 0 ${pad + gridW + 8} ${pad + gridW + 26}`} className="w-full h-full">
        {cols.map((c, j) => (
          <text key={`t-${j}`} x={pad + j * cell + cell / 2} y={14} fontSize={9} fill="#6b7280" textAnchor="middle">
            {shorten(c, 7)}
          </text>
        ))}

        {cols.map((c, i) => (
          <text
            key={`l-${i}`}
            x={pad - 6}
            y={pad + i * cell + cell / 2 + 3}
            fontSize={9}
            fill="#6b7280"
            textAnchor="end"
          >
            {shorten(c, 10)}
          </text>
        ))}

        {cols.map((_, i) =>
          cols.map((__, j) => {
            const r = Number(M?.[i]?.[j] ?? 0);
            const isDiag = i === j;
            const isSel = !!selectedCell && selectedCell.i === i && selectedCell.j === j;

            return (
              <rect
                key={`${i}-${j}`}
                x={pad + j * cell}
                y={pad + i * cell}
                width={cell - 1}
                height={cell - 1}
                fill={isDiag ? "rgba(0,0,0,0.04)" : colorFor(r)}
                stroke={isSel ? RED : "rgba(0,0,0,0.05)"}
                strokeWidth={isSel ? 2 : 1}
                onClick={() =>
                  !isDiag &&
                  onSelect?.({
                    kind: "corr",
                    columns: cols,
                    cell: { i, j, value: r },
                  })
                }
                style={{ cursor: isDiag ? "default" : "pointer" }}
              />
            );
          })
        )}

        <text x={pad} y={pad + gridW + 18} fontSize={10} fill="#6b7280">
          {selectedCell
            ? `selected: ${cols[selectedCell.i]} × ${cols[selectedCell.j]}  r=${selectedCell.value.toFixed(3)}`
            : "click a cell to inspect correlation"}
        </text>
      </svg>
    </div>
  );
}

/* ============================================================
   Selection helpers
============================================================ */

function isSelectionForChart(sel: ChartSelection | null, chart: ChartSpec) {
  if (!sel) return false;

  if (chart.type === "histogram") return sel.kind === "histogram" && sel.column === chart.column;
  if (chart.type === "bar") return sel.kind === "bar" && sel.column === chart.column;
  if (chart.type === "time") return sel.kind === "time" && sel.xColumn === chart.xColumn && sel.yColumn === chart.yColumn;
  if (chart.type === "scatter") return sel.kind === "scatter" && sel.xColumn === chart.xColumn && sel.yColumn === chart.yColumn;
  if (chart.type === "box") return sel.kind === "box" && sel.column === chart.column;
  if (chart.type === "corr") return sel.kind === "corr" && arraysEq(sel.columns, chart.columns ?? []);
  return false;
}

function arraysEq(a: any[], b: any[]) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/* ============================================================
   UI HELPERS
============================================================ */

function TooltipBox({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-lg border bg-white px-3 py-2 shadow-sm">
      <div className="text-xs font-semibold text-neutral-800">{title}</div>
      <div className="mt-1 space-y-0.5">
        {lines.map((l, i) => (
          <div key={i} className="text-xs text-neutral-600">
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}

function shorten(s: any, max = 12) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function formatBinLabel(a: number, b: number) {
  return `${fmtNum(a)}–${fmtNum(b)}`;
}

function fmtNum(v: any) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (Math.abs(n) >= 1_000_000) return n.toExponential(2);
  if (Math.abs(n) >= 1_000) return Math.round(n).toLocaleString();
  if (Math.abs(n) < 1 && n !== 0) return n.toFixed(3);
  return n % 1 === 0 ? n.toLocaleString() : n.toFixed(2);
}
