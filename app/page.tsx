"use client";

import React, { useState } from "react";
import { Upload, FileSpreadsheet } from "lucide-react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import ExcelJS from "exceljs";

import { useDataset } from "./context/DatasetContext";
import { runEDA } from "./lib/eda";
import { generateKPIs } from "./lib/kpis";
import { generateCharts } from "./lib/charts";

/** Turn ExcelJS cell values into safe JS primitives */
function normalizeExcelValue(v: any) {
  if (v === null || v === undefined) return null;

  // ExcelJS sometimes returns objects like { richText: [...] } or { formula, result }
  if (typeof v === "object") {
    // formula cell
    if ("result" in v) return normalizeExcelValue((v as any).result);

    // richText cell
    if ("richText" in v && Array.isArray((v as any).richText)) {
      return (v as any).richText.map((t: any) => t?.text ?? "").join("");
    }

    // hyperlink cell
    if ("text" in v && typeof (v as any).text === "string") return (v as any).text;

    // Date object
    if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString();

    // Fallback: stringify unknown objects safely
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }

  return v;
}

export default function Home() {
  const router = useRouter();
  const { setDataset } = useDataset();
  const [loading, setLoading] = useState(false);

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // allow re-uploading same filename
    e.target.value = "";

    setLoading(true);

    try {
      let data: any[] = [];
      let sheetName: string | undefined;

      const fileType = file.name.toLowerCase().endsWith(".csv") ? "csv" : "excel";

      /* =====================
         CSV
      ===================== */
      if (fileType === "csv") {
        const text = await file.text();
        const parsed = Papa.parse(text, {
          header: true,
          skipEmptyLines: true,
          dynamicTyping: true,
        });

        if (parsed.errors?.length) {
          console.error("CSV parse errors:", parsed.errors);
          throw new Error("CSV parsing failed. Check console for details.");
        }

        data = (parsed.data as any[]).filter((r) => r && Object.keys(r).length > 0);
      }

      /* =====================
         EXCEL (xlsx)
      ===================== */
      if (fileType === "excel") {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(await file.arrayBuffer());

        const sheet = workbook.worksheets[0];
        if (!sheet) throw new Error("No worksheet found in Excel file.");

        sheetName = sheet.name;

        const headers: string[] = [];
        sheet.getRow(1).eachCell((cell) => {
          headers.push(String(normalizeExcelValue(cell.value) ?? "").trim());
        });

        sheet.eachRow((row, idx) => {
          if (idx === 1) return;

          const rowData: any = {};
          row.eachCell((cell, col) => {
            const key = headers[col - 1] || `Column ${col}`;
            rowData[key] = normalizeExcelValue(cell.value);
          });

          const hasValue = Object.values(rowData).some(
            (v) => v !== null && v !== undefined && String(v).trim() !== ""
          );

          if (hasValue) data.push(rowData);
        });
      }

      if (!data.length) throw new Error("No usable rows found in this file.");

      /* =====================
         META
      ===================== */
      const columns = Object.keys(data[0] ?? {});
      let missingValues = 0;

      for (const row of data) {
        for (const c of columns) {
          const v = row[c];
          if (
            v === null ||
            v === undefined ||
            (typeof v === "string" && v.trim() === "")
          ) {
            missingValues += 1;
          }
        }
      }

      /* =====================
         ENGINE
      ===================== */
      const eda = runEDA(data);
      const kpis = generateKPIs(data);
      const charts = generateCharts(data, eda);

      console.log("SETTING DATASET", {
        file: file.name,
        rows: data.length,
        cols: columns.length,
        sample: data[0],
        kpis: kpis.length,
        charts: charts.length,
      });

      setDataset(
        data,
        {
          fileName: file.name,
          fileType,
          sheetName,
          rows: data.length,
          columns: columns.length,
          missingValues,
        },
        eda,
        kpis,
        charts
      );

      // Navigate reliably
      router.push("/dashboard");
    } catch (err: any) {
      console.error("UPLOAD FAILED:", err);
      alert(err?.message ?? "Upload failed. Check the console.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="h-screen w-screen bg-white">
      <input
        id="file-upload"
        type="file"
        accept=".csv,.xlsx"
        className="sr-only"
        onChange={onFileChange}
      />

      <div className="h-full px-12 pt-10 pb-10">
        <header className="mb-10">
          <h1 className="text-6xl font-bold">ODE</h1>
          <div className="mt-2 h-[3px] w-24 bg-red-500" />
          <p className="mt-3 text-sm text-neutral-500">Instant insight. Zero setup.</p>
        </header>

        <section className="max-w-[1400px] grid gap-6">
          <div className="rounded-2xl border bg-neutral-50 px-8 py-6 flex items-center gap-6">
            <div className="h-12 w-12 rounded-xl bg-red-500/10 flex items-center justify-center">
              <Upload className="text-red-500" />
            </div>

            <div className="flex-1">
              <h2 className="font-semibold">Upload CSV or Excel</h2>
              <p className="text-sm text-neutral-500">
                {loading ? "Processing file..." : "Drop file or click to browse"}
              </p>
            </div>

            <label
              htmlFor="file-upload"
              className={`cursor-pointer rounded-md px-6 py-2.5 text-sm text-white ${
                loading ? "bg-red-300 cursor-not-allowed" : "bg-red-500 hover:bg-red-600"
              }`}
            >
              {loading ? "Loading..." : "Choose File"}
            </label>
          </div>

          <div className="rounded-2xl border p-10 text-center">
            <FileSpreadsheet size={44} className="mx-auto mb-4 text-red-500" />
            <h3 className="text-3xl font-semibold mb-3">
              Upload a file to generate insights
            </h3>
            <p className="text-neutral-500">ODE analyzes your data automatically.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
