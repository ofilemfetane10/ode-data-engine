// app/lib/typeInference.ts

export type InferredType = "numeric" | "date" | "categorical" | "text" | "id";

function isMissing(v: any) {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function safeString(v: any) {
  return String(v ?? "").trim();
}

/**
 * Numeric-like detector for strings.
 * Accepts currency, commas, spaces, parentheses negatives, %.
 * Rejects mixed alphanum IDs like "A12", "12A", "AB-12".
 */
function looksNumeric(raw: string) {
  let s = String(raw ?? "").trim();
  if (!s) return false;

  // (123.45) -> -123.45
  const parenNeg = /^\((.*)\)$/.exec(s);
  if (parenNeg) s = "-" + parenNeg[1];

  // remove common currency symbols + NBSP + spaces
  s = s
    .replace(/[£€$₹₽¥₩₦₱₫₪₴₲₵₸₺₼₾₿]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, "")
    .trim();

  // percent
  s = s.replace(/%$/g, "");
  if (!s) return false;

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  if (hasComma && hasDot) {
    // "1,234.56" -> 1234.56
    s = s.replace(/,/g, "");
  } else if (hasComma && !hasDot) {
    // "1234,56" -> 1234.56 OR "1,234" -> 1234
    const m = s.match(/,(\d{1,3})$/);
    if (m) s = s.replace(/,/g, ".");
    else s = s.replace(/,/g, "");
  }

  // reject mixed tokens (IDs)
  // allow scientific notation
  if (!/^[-+]?(?:\d+\.?\d*|\d*\.?\d+)(?:e[-+]?\d+)?$/i.test(s)) return false;

  const n = Number(s);
  return Number.isFinite(n);
}

function looksDate(raw: string) {
  const s = String(raw ?? "").trim();
  if (!s) return false;
  return Number.isFinite(Date.parse(s));
}

/**
 * ID heuristic:
 * - very high uniqueness
 * - tokeny (letters/numbers/_/-)
 * - NOT mostly numeric-like (amounts are often unique!)
 * - NOT mostly date-like
 */
export function isLikelyID(values: any[]): boolean {
  const nonNull = values.filter((v) => !isMissing(v));
  if (nonNull.length < 20) return false;

  const asStr = nonNull.map((v) => safeString(v)).filter(Boolean);
  if (asStr.length < 20) return false;

  const unique = new Set(asStr).size;
  const uniqRatio = unique / asStr.length;

  // critical guardrails:
  const numericLike = asStr.filter((x) => looksNumeric(x)).length / asStr.length;
  if (numericLike >= 0.85) return false;

  const dateLike = asStr.filter((x) => looksDate(x)).length / asStr.length;
  if (dateLike >= 0.85) return false;

  const avgLen = asStr.reduce((a, b) => a + b.length, 0) / asStr.length;

  const tokeny = asStr.filter((x) => /^[A-Za-z0-9\-_]+$/.test(x)).length / asStr.length;
  const longAlphaNum =
    asStr.filter((x) => /^[A-Za-z0-9\-_]+$/.test(x) && x.length >= 6).length / asStr.length;

  // strict: high uniqueness + tokeny + compact-ish
  return uniqRatio > 0.9 && tokeny > 0.6 && (avgLen <= 24 || longAlphaNum > 0.6);
}

export function inferColumnType(values: any[]): InferredType {
  const nonNull = values.filter((v) => !isMissing(v));
  if (nonNull.length === 0) return "categorical";

  const cleaned = nonNull.map((v) => safeString(v)).filter(Boolean);
  const sample = cleaned.slice(0, 250);

  if (isLikelyID(sample)) return "id";

  const numericCount = sample.filter((v) => looksNumeric(v)).length;
  if (numericCount / sample.length >= 0.8) return "numeric";

  const dateCount = sample.filter((v) => looksDate(v)).length;
  if (dateCount / sample.length >= 0.8) return "date";

  const avgLength = sample.reduce((a, b) => a + b.length, 0) / sample.length;
  if (avgLength > 30) return "text";

  return "categorical";
}
