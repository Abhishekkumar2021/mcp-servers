import { homedir } from "node:os";
import path from "node:path";

export const VERSION = "0.1.0";

export function allowHosts(): string[] {
  return (process.env.HTTP_ALLOW_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}
export function hasAllowHosts(): boolean {
  return allowHosts().length > 0;
}

function flag(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "1" || v === "true";
}
export function isWritable(): boolean { return flag("HTTP_WRITABLE"); }
export function allowPrivate(): boolean { return flag("HTTP_ALLOW_PRIVATE"); }

export function storeDir(): string {
  return process.env.HTTP_DIR?.trim() || path.join(homedir(), ".mcp-http");
}

export function secret(name: string): string | undefined {
  return process.env[`HTTP_SECRET_${name}`];
}

function intEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
export function limits() {
  return {
    maxResponseBytes: intEnv("HTTP_MAX_RESPONSE_BYTES", 1048576),
    timeoutMs: intEnv("HTTP_TIMEOUT_MS", 30000),
    maxRedirects: intEnv("HTTP_MAX_REDIRECTS", 5),
  };
}
export function getAuditLogPath(): string | undefined {
  return process.env.HTTP_AUDIT_LOG?.trim() || undefined;
}
