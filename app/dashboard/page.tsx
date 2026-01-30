"use client";

/**
 * app/dashboard/page.tsx
 * Hooks-safe Dashboard + Clear works
 * - No early return before hooks
 * - Removed redundant "Dataset Overview" section
 * - Added compact meta line under filename
 * - Removed "Upload another" (redundant)
 * - Renamed Clear -> New dataset
 *
 * IMPORTANT FIX:
 * - Stop using stale context charts
 * - Recompute charts from (data + eda) using generateCharts()
 * - Do NOT filter to histogram/bar only
 * - FINAL SAFETY: filter out ID-like columns (transaction_id etc)
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useDataset } from "../context/DatasetContext";
import { generateCharts, type ChartSpec } from "../lib/charts";
import { generateInsights, type Insight } from "../lib/insights";
import { ChartCard, type ChartSelection } from "./_components/InteractiveCharts";
import { generateKPIs, type KPI } from "../lib/kpis";
import { answerQuestion } from "../lib/ask";
import InstallButton from "./_components/InstallButton";
import FeedbackButton from "./_components/FeedbackButton";

type ChatMsg = { role: "user" | "ode"; text: string };

export default function Dashboard() {
  const router = useRouter();

  // charts removed — compute charts locally so it always reflects latest generator
  const { data, meta, eda, clearDataset } = useDataset();

  // NOTE: require data + meta + eda to show dashboard
  const hasDataset = Boolean(data && meta && eda);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  /* =========================
     EDA UI
  ========================= */
  const [showEDA, setShowEDA] = useState(false);
  const [q, setQ] = useState("");

  /* =========================
     Ask ODE UI
  ========================= */
  const [askInput, setAskInput] = useState("");
  const [chat, setChat] = useState<ChatMsg[]>([
    {
      role: "ode",
      text:
        'Try:\n' +
        '• "trend" / "what stands out"\n' +
        '• "top <column>" (e.g. "top country")\n' +
        '• "explain <column>"\n' +
        '• "distribution of <column>"\n' +
        '• "any outliers?"\n' +
        '• "time trend" (if you have a date column)\n' +
        '• "missing by column"\n',
    },
  ]);

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat]);

  /* =========================
      KPI STRIP (compute from data+eda)
  ========================= */
  const visibleKpis: KPI[] = useMemo(() => {
    if (!hasDataset) return [];
    return generateKPIs(data!, eda!).slice(0, 6);
  }, [hasDataset, data, eda]);

  /* =========================
     Insights
  ========================= */
  const insightsAll: Insight[] = useMemo(() => {
    if (!hasDataset) return [];
    return generateInsights(eda!, visibleKpis);
  }, [hasDataset, eda, visibleKpis]);

  const insights = useMemo(() => {
    const order: Record<string, number> = { warning: 0, info: 1, positive: 2 };
    const sorted = [...(insightsAll ?? [])].sort(
      (a, b) =>
        (order[a.severity ?? "info"] ?? 1) - (order[b.severity ?? "info"] ?? 1)
    );

    const top = sorted.slice(0, 6);
    if (top.length) return top;

    return [
      {
        id: "fallback-1",
        severity: "info",
        text: 'No major anomalies detected. Try asking "trend" or "top <column>".',
      },
    ] as Insight[];
  }, [insightsAll]);

  /* =========================
     Column list (EDA cards)
  ========================= */
  const columns = useMemo(() => {
    if (!hasDataset) return [];
    return Object.keys(eda!.columns ?? {});
  }, [hasDataset, eda]);

  const filteredCols = useMemo(() => {
    const s = q.toLowerCase().trim();
    return s ? columns.filter((c) => c.toLowerCase().includes(s)) : columns;
  }, [q, columns]);

  /* =========================
      Chart filtering helpers (ID-safe)
  ========================= */

  const isIdLikeColumn = useCallback(
    (col: string) => {
      if (!hasDataset) return false;

      const c = String(col ?? "");
      const lower = c.toLowerCase().trim();

      // name hints
      const nameHint =
        /(^id$|_id$| id$|uuid|guid|hash|token|key$|^key|identifier)/.test(lower);
      if (nameHint) return true;

      const info: any = eda!.columns?.[c];
      if (!info) return false;

      if (info.inferredAs === "id") return true;

      const nonMissing = Number(info.nonMissingCount ?? 0);
      const unique = Number(info.uniqueCount ?? 0);
      if (!nonMissing) return false;

      const ratio = unique / Math.max(1, nonMissing);

      // strong "id-ness": almost all unique & enough volume
      return unique >= 20 && ratio > 0.98;
    },
    [hasDataset, eda]
  );

  const chartUsesId = useCallback(
    (ch: any) => {
      if (!ch) return true;

      // chart.column
      if (typeof ch.column === "string" && isIdLikeColumn(ch.column)) return true;

      // x/y columns
      if (typeof ch.xColumn === "string" && isIdLikeColumn(ch.xColumn)) return true;
      if (typeof ch.yColumn === "string" && isIdLikeColumn(ch.yColumn)) return true;

      // time charts sometimes have dateColumn / valueColumn
      if (typeof ch.dateColumn === "string" && isIdLikeColumn(ch.dateColumn))
        return true;
      if (typeof ch.valueColumn === "string" && isIdLikeColumn(ch.valueColumn))
        return true;

      // corr columns[]
      if (
        Array.isArray(ch.columns) &&
        ch.columns.some((c: any) => isIdLikeColumn(String(c)))
      )
        return true;

      return false;
    },
    [isIdLikeColumn]
  );

  /* =========================
      CHART SELECTION (curated)
     - Recompute from latest generator
     - Filter out ID-like columns for all chart types
     - Keep diversity; min 4 when possible
  ========================= */
  const chosenCharts: ChartSpec[] = useMemo(() => {
    if (!hasDataset) return [];

    // 1) recompute
    const raw = generateCharts(data!, eda!);
    const all = Array.isArray(raw) ? raw : [];

    // 2) remove any charts driven by IDs (transaction_id etc)
    const clean = all.filter((c: any) => !chartUsesId(c));

    const byType = (t: string) => clean.filter((c: any) => c?.type === t);

    const pick: any[] = [];
    const seen = new Set<string>();

    const keyOf = (c: any) =>
      `${String(c?.type)}::${String(c?.column ?? "")}::${String(
        c?.xColumn ?? c?.dateColumn ?? ""
      )}::${String(c?.yColumn ?? c?.valueColumn ?? "")}`;

    const push = (c: any) => {
      if (!c) return false;
      const k = keyOf(c);
      if (seen.has(k)) return false;
      pick.push(c);
      seen.add(k);
      return true;
    };

    // prefer a balanced set
    push(byType("time")[0]);
    push(byType("scatter")[0] ?? byType("corr")[0]);
    push(byType("histogram")[0] ?? byType("box")[0]);
    push(byType("bar")[0]);

    // fill up to 8 with remaining charts
    for (const c of clean) {
      if (pick.length >= 8) break;
      push(c);
    }

    // guarantee min 4 when possible
    if (pick.length < 4) {
      for (const c of clean) {
        if (pick.length >= 4) break;
        push(c);
      }
    }

    if (pick.length) return pick.slice(0, 8);

    // if generator gave nothing useful after filtering, fallback (better than blank)
    return clean.length ? clean.slice(0, 8) : all.slice(0, 8);
  }, [hasDataset, data, eda, chartUsesId]);

  /* =========================
     Chart drill-down selection state
  ========================= */
  const [selection, setSelection] = useState<ChartSelection | null>(null);

  const onChartSelect = (sel: ChartSelection) => {
    setSelection(sel);

    if (sel.kind === "bar") setAskInput(`explain ${sel.column}`);
    else if (sel.kind === "time") setAskInput(`trend ${sel.yColumn}`);
    else if (sel.kind === "scatter")
      setAskInput(`explain relationship between ${sel.xColumn} and ${sel.yColumn}`);
    else if (sel.kind === "corr") setAskInput("explain correlation");
    else setAskInput(`distribution of ${sel.column}`);
  };

  /* =========================
     Header meta line
  ========================= */
  const overviewLine = useMemo(() => {
    if (!hasDataset) return "";
    const rows = meta!.rows ?? data!.length ?? 0;
    const cols = meta!.columns ?? Object.keys(data![0] ?? {}).length ?? 0;
    const miss = meta!.missingValues ?? 0;
    const type = (meta!.fileType ?? "").toString().toUpperCase() || "DATA";
    return `${Number(rows).toLocaleString()} rows • ${Number(
      cols
    ).toLocaleString()} columns • ${type} • ${Number(miss).toLocaleString()} missing`;
  }, [hasDataset, meta, data]);

  /* =========================
     Ask ODE actions (SAFE)
  ========================= */
  const onAsk = (custom?: string) => {
    const text = (custom ?? askInput).trim();
    if (!text || !hasDataset) return;

    let reply = "";
    try {
      reply = answerQuestion({
        q: text,
        meta: meta!,
        eda: eda!,
        kpis: visibleKpis,
        charts: chosenCharts,
        insights: insightsAll ?? [],
      });
    } catch (err) {
      console.error("Ask ODE crashed:", err);
      reply =
        "Ask ODE hit an error. Open the console and paste the error here. " +
        'Try: "top <column>", "explain <column>", "time trend".';
    }

    setChat((prev) => [
      ...prev,
      { role: "user", text },
      { role: "ode", text: reply },
    ]);
    setAskInput("");
  };

  const onClearChat = () =>
    setChat([
      {
        role: "ode",
        text:
          'Try:\n' +
          '• "trend" / "what stands out"\n' +
          '• "top <column>"\n' +
          '• "explain <column>"\n' +
          '• "distribution of <column>"\n' +
          '• "any outliers?"\n' +
          '• "time trend"\n' +
          '• "missing by column"',
      },
    ]);

  /* =========================
      NOW it is safe to early return
  ========================= */
  if (!hasDataset) {
    return (
      <main className="p-12">
        <h2 className="text-xl font-semibold">No dataset loaded</h2>
        <button
          onClick={() => router.push("/")}
          className="mt-4 bg-red-500 text-white px-5 py-2 rounded-md"
        >
          Upload file
        </button>
      </main>
    );
  }

  return (
    <main
      className="h-screen overflow-y-auto px-12 pt-10 pb-14 bg-white"
      style={{ scrollbarGutter: "stable" }}
    >
      {/* Header */}
      <header className="mb-10 flex justify-between items-start">
        <div>
          <h1 className="text-5xl font-bold">ODE</h1>
          <div className="mt-2 h-[3px] w-24 bg-red-500" />
          <p className="mt-2 text-sm text-neutral-500">{meta!.fileName}</p>
          <p className="mt-1 text-xs text-neutral-400">{overviewLine}</p>
        </div>

        <div className="flex gap-2 items-center">
          <InstallButton />
          <FeedbackButton />

          <button
            onClick={() => {
              clearDataset();
              router.push("/");
            }}
            className="bg-red-500 text-white px-4 py-2 rounded-md"
          >
            New dataset
          </button>
        </div>
      </header>

      {/* KPI CARDS */}
      {visibleKpis.length > 0 && (
        <section className="mb-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {visibleKpis.map((k, i) => (
            <div
              key={`${k.label}-${k.column ?? "na"}-${k.type}-${i}`}
              className="border rounded-xl p-6"
            >
              <p className="text-sm text-neutral-500">{k.label}</p>
              <p className="text-3xl font-semibold">{formatKPI(k.value)}</p>
              <p className="mt-2 text-xs text-neutral-400">
                {k.column ? `Column: ${k.column}` : "Dataset insight"}
              </p>
            </div>
          ))}
        </section>
      )}

      {/* MAIN GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8">
        {/* LEFT */}
        <div>
          {/* CHARTS */}
          {chosenCharts.length > 0 && (
            <section className="mb-10 border rounded-2xl p-8">
              <div className="flex items-end justify-between mb-4">
                <div>
                  <h2 className="text-xl font-semibold">Charts</h2>
                  <p className="text-sm text-neutral-500">
                    Curated visuals (min 4 when possible)
                  </p>
                </div>
                <p className="text-xs text-neutral-400">
                  picked by data type + strongest signal
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {chosenCharts.map((ch: any, idx) => (
                  <ChartCard
                    key={`${String(ch?.type)}-${String(
                      ch?.column ?? ch?.xColumn ?? ch?.dateColumn ?? "x"
                    )}-${String(ch?.yColumn ?? ch?.valueColumn ?? "y")}-${idx}`}
                    chart={ch}
                    selection={selection}
                    onSelect={onChartSelect}
                  />
                ))}
              </div>

              <div className="mt-6 text-xs text-neutral-500">
                Tip: click a bar/bin/point to drill down. Ask ODE like:{" "}
                <span className="font-medium">
                  {chosenCharts?.[0]?.column
                    ? `explain ${chosenCharts[0].column}`
                    : "trend"}
                </span>
              </div>
            </section>
          )}

          {/* EDA — OPTIONAL */}
          <section className="border rounded-2xl p-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">Exploratory Analysis</h2>
                <p className="text-sm text-neutral-500">
                  Optional. This is what Ask ODE + Insights use behind the scenes.
                </p>
              </div>

              <div className="flex gap-2 items-center">
                <button
                  onClick={() => setShowEDA((v) => !v)}
                  className="border px-3 py-2 rounded-md text-sm"
                >
                  {showEDA ? "Hide" : "Show"}
                </button>

                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search columns…"
                  className="border px-3 py-2 rounded-md text-sm w-[220px]"
                  disabled={!showEDA}
                />
              </div>
            </div>

            {showEDA && (
              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                {filteredCols.map((col) => {
                  const info: any = eda!.columns[col];
                  if (!info) return null;

                  return (
                    <div key={col} className="border rounded-xl p-5">
                      <div className="flex items-start justify-between gap-4">
                        <h3 className="font-semibold mb-2">{col}</h3>

                        <div className="flex gap-2">
                          <button
                            className="text-xs border rounded-md px-2 py-1"
                            onClick={() => onAsk(`explain ${col}`)}
                          >
                            Explain
                          </button>
                          <button
                            className="text-xs border rounded-md px-2 py-1"
                            onClick={() => onAsk(`top ${col}`)}
                          >
                            Top
                          </button>
                          <button
                            className="text-xs border rounded-md px-2 py-1"
                            onClick={() => onAsk(`distribution of ${col}`)}
                          >
                            Dist
                          </button>
                        </div>
                      </div>

                      <p className="text-sm">Type: {info.type}</p>
                      <p className="text-sm">Missing: {info.missing}</p>
                      <p className="text-sm">Unique: {info.uniqueCount}</p>

                      {info.type === "numeric" && (
                        <div className="grid grid-cols-2 gap-2 pt-3">
                          <Mini label="Min" value={fmt(info.min)} />
                          <Mini label="Max" value={fmt(info.max)} />
                          <Mini label="Mean" value={fmt(round(info.mean))} />
                          <Mini label="Median" value={fmt(round(info.median))} />
                        </div>
                      )}

                      {info.type === "categorical" && info.topValues?.length ? (
                        <div className="mt-3 text-xs text-neutral-500">
                          Top:{" "}
                          <span className="font-medium">
                            {String(info.topValues?.[0]?.value ?? "")}
                          </span>{" "}
                          ({Math.round(Number(info.topValues?.[0]?.pct ?? 0))}%)
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* RIGHT RAIL */}
        <aside className="space-y-6 lg:sticky lg:top-8 h-fit">
          {/* AI INSIGHTS */}
          <div className="border rounded-2xl p-6">
            <h3 className="text-lg font-semibold mb-1">AI Insights</h3>
            <p className="text-sm text-neutral-500 mb-4">
              What stands out most (warnings first)
            </p>

            <div className="space-y-3">
              {insights.length ? (
                insights.map((ins) => (
                  <div key={ins.id} className="rounded-xl border p-4 text-sm">
                    <p className="font-medium">{ins.text}</p>

                    <div className="mt-2 flex items-center justify-between">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${
                          ins.severity === "warning"
                            ? "border-red-200 text-red-600"
                            : ins.severity === "positive"
                            ? "border-green-200 text-green-700"
                            : "border-neutral-200 text-neutral-600"
                        }`}
                      >
                        {(ins.severity ?? "info").toUpperCase()}
                      </span>

                      <span className="text-[11px] text-neutral-400">
                        {ins.severity === "warning"
                          ? "check outliers / quality"
                          : ins.severity === "positive"
                          ? "good signal"
                          : "notable pattern"}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-neutral-500">No insights yet.</p>
              )}
            </div>
          </div>

          {/* ASK ODE */}
          <div className="border rounded-2xl p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold">Ask ODE</h3>
              <button
                onClick={onClearChat}
                className="text-xs text-neutral-500 underline"
              >
                Clear chat
              </button>
            </div>

            <p className="text-sm text-neutral-500 mb-4">
              Ask trend, standout patterns, distributions, or a column.
            </p>

            <div className="space-y-3 mb-4 max-h-[360px] overflow-auto pr-1">
              {chat.map((m, i) => (
                <div
                  key={`${m.role}-${i}`}
                  className={`rounded-xl border p-3 text-sm whitespace-pre-line ${
                    m.role === "user" ? "bg-neutral-50" : "bg-white"
                  }`}
                >
                  <p className="text-xs text-neutral-500 mb-1">
                    {m.role === "user" ? "You" : "ODE"}
                  </p>
                  {m.text}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            <div className="flex gap-2">
              <input
                value={askInput}
                onChange={(e) => setAskInput(e.target.value)}
                placeholder='Try: "trend" or "what stands out"'
                className="flex-1 border px-3 py-2 rounded-md text-sm"
                onKeyDown={(e) => e.key === "Enter" && onAsk()}
              />
              <button
                onClick={() => onAsk()}
                className="bg-red-500 text-white px-4 py-2 rounded-md text-sm"
              >
                Ask
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <QuickAsk label="Trend" onClick={() => onAsk("trend")} />
              <QuickAsk label="Outliers" onClick={() => onAsk("any outliers?")} />
              <QuickAsk
                label="What stands out"
                onClick={() => onAsk("what stands out")}
              />
              <QuickAsk label="Time trend" onClick={() => onAsk("time trend")} />
              <QuickAsk
                label="Missing by column"
                onClick={() => onAsk("missing by column")}
              />
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

/* ============================================================
   UI helpers
============================================================ */

function Mini({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-lg bg-neutral-50 border p-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="text-sm font-semibold">{value ?? "—"}</p>
    </div>
  );
}

function QuickAsk({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-xs border rounded-full px-3 py-1 hover:bg-neutral-50"
    >
      {label}
    </button>
  );
}

function fmt(v: any) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return v.toLocaleString();
  return String(v);
}

function round(v: any) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : "—";
}

function formatKPI(v: number | string) {
  return typeof v === "number" ? v.toLocaleString() : v;
}
