export interface ResultSet {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  notice?: string;
}

function capCell(v: unknown, maxCellBytes: number): unknown {
  if (typeof v === "string" && Buffer.byteLength(v, "utf8") > maxCellBytes) {
    return v.slice(0, maxCellBytes) + "…[truncated]";
  }
  if (Buffer.isBuffer(v)) {
    return `[${v.length} bytes]`;
  }
  return v;
}

export function capResult(
  columns: string[],
  rows: unknown[][],
  opts: { maxRows: number; maxCellBytes: number },
): ResultSet {
  const truncated = rows.length > opts.maxRows;
  const kept = truncated ? rows.slice(0, opts.maxRows) : rows;
  const capped = kept.map((row) => row.map((c) => capCell(c, opts.maxCellBytes)));
  return {
    columns,
    rows: capped,
    rowCount: capped.length,
    truncated,
    notice: truncated ? `result truncated to ${opts.maxRows} rows` : undefined,
  };
}
