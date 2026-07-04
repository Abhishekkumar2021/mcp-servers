/** Env + limits in one place. Keep VERSION in lockstep with package.json. */
export const VERSION = "0.1.0";

/** Writes enabled only when DB_WRITABLE is 1/true. */
export function isWritable(): boolean {
  const v = process.env.DB_WRITABLE?.trim().toLowerCase();
  return v === "1" || v === "true";
}

function intEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function limits() {
  return {
    maxRows: intEnv("DB_MAX_ROWS", 1000),
    maxCellBytes: intEnv("DB_MAX_CELL_BYTES", 8192),
    statementTimeoutMs: intEnv("DB_STATEMENT_TIMEOUT_MS", 15000),
    sqliteMaxBytes: intEnv("DB_SQLITE_MAX_BYTES", 536870912),
  };
}

/** Optional JSON-lines audit log path for executed statements. */
export function getAuditLogPath(): string | undefined {
  return process.env.SQL_AUDIT_LOG?.trim() || undefined;
}
