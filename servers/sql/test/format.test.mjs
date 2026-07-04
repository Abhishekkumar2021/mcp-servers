import { test } from "node:test";
import assert from "node:assert/strict";
import { capResult } from "../dist/format.js";

test("caps row count and flags truncation", () => {
  const rows = [[1], [2], [3]];
  const r = capResult(["n"], rows, { maxRows: 2, maxCellBytes: 100 });
  assert.equal(r.rows.length, 2);
  assert.equal(r.truncated, true);
  assert.match(r.notice ?? "", /2/);
});

test("truncates oversized string cells", () => {
  const big = "x".repeat(50);
  const r = capResult(["s"], [[big]], { maxRows: 10, maxCellBytes: 10 });
  assert.ok(String(r.rows[0][0]).length < 50);
  assert.match(String(r.rows[0][0]), /truncated/);
});

test("passes small values through unchanged", () => {
  const r = capResult(["a", "b"], [[1, "ok"]], { maxRows: 10, maxCellBytes: 100 });
  assert.deepEqual(r.rows, [[1, "ok"]]);
  assert.equal(r.truncated, false);
});
