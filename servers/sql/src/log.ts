import { appendFileSync } from "node:fs";
import { getAuditLogPath } from "./config.js";
import { redact } from "./connections.js";

export function logInfo(msg: string, meta: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ level: "info", msg, ...meta }));
}

export function audit(entry: Record<string, unknown>): void {
  const path = getAuditLogPath();
  if (!path) return;
  const line = redact(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
  try {
    appendFileSync(path, line + "\n");
  } catch {
    /* auditing must never break a tool call */
  }
}
