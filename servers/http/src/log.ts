import { appendFileSync } from "node:fs";
import { getAuditLogPath } from "./config.js";
import { redact } from "./vars.js";

export function logInfo(msg: string, meta: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ level: "info", msg, ...meta }));
}

export function audit(entry: Record<string, unknown>, extra: string[] = []): void {
  const path = getAuditLogPath();
  if (!path) return;
  try {
    appendFileSync(path, redact(JSON.stringify({ ts: new Date().toISOString(), ...entry }), extra) + "\n");
  } catch {
    /* auditing must never break a tool call */
  }
}
