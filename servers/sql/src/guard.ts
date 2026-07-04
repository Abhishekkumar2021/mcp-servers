export class ReadOnlyViolation extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ReadOnlyViolation";
  }
}

/** Strip `--` line comments and block comments, then trim. */
function stripComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .trim();
}

/** Split into statements on top-level `;`, ignoring quotes and comments. */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === "-" && sql[i + 1] === "-") { while (i < sql.length && sql[i] !== "\n") i++; continue; }
    if (ch === "/" && sql[i + 1] === "*") { i += 2; while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++; i++; continue; }
    if (ch === ";") { if (cur.trim()) out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const READ_LEADERS = /^(select|with|values)\b/i;

/** Throw unless `sql` is a single SELECT-family statement. */
export function assertReadOnly(sql: string): void {
  const stmts = splitStatements(sql);
  if (stmts.length > 1) {
    throw new ReadOnlyViolation("multiple statements are not allowed in a read-only query");
  }
  const body = stripComments(stmts[0] ?? "");
  if (!READ_LEADERS.test(body)) {
    throw new ReadOnlyViolation(
      "this is a read-only query tool; only SELECT/WITH/VALUES are allowed (set DB_WRITABLE=1 and use execute for writes)",
    );
  }
}
