import type { RawResponse } from "./client.js";
import { redact } from "./vars.js";
import { limits } from "./config.js";

export interface ResponseView {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  timingMs: number;
  body: string;
  truncated: boolean;
  finalUrl: string;
  redirects: string[];
}

const REDACT_HEADERS = new Set(["authorization", "cookie", "set-cookie", "x-api-key", "x-auth-token"]);

function isTextual(ct: string): boolean {
  return /^text\/|application\/(json|xml|.*\+json|.*\+xml|x-www-form-urlencoded|javascript)/.test(ct);
}

export function formatResponse(raw: RawResponse, secretValues: string[]): ResponseView {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw.headers)) {
    const val = Array.isArray(v) ? v.join(", ") : String(v);
    headers[k] = REDACT_HEADERS.has(k.toLowerCase()) ? "***" : redact(val, secretValues);
  }
  const ct = (raw.headers["content-type"] || "").toString().toLowerCase();
  const { maxResponseBytes } = limits();
  let body: string;
  let truncated = false;
  if (raw.bodyBuffer.length === 0) {
    body = "";
  } else if (isTextual(ct)) {
    let text = raw.bodyBuffer.toString("utf8");
    if (ct.includes("json")) {
      try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* leave as-is */ }
    }
    if (Buffer.byteLength(text, "utf8") > maxResponseBytes) { text = text.slice(0, maxResponseBytes) + "…[truncated]"; truncated = true; }
    body = redact(text, secretValues);
  } else {
    body = `[${raw.bodyBuffer.length} bytes, ${ct || "unknown content-type"}]`;
  }
  return {
    status: raw.status,
    statusText: raw.statusText,
    headers,
    timingMs: raw.timingMs,
    body,
    truncated,
    finalUrl: redact(raw.finalUrl, secretValues),
    redirects: raw.redirects.map((r) => redact(r, secretValues)),
  };
}
