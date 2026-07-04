import { test } from "node:test";
import assert from "node:assert/strict";
import { limits, isWritable } from "../dist/config.js";

test("limits use defaults when env unset", () => {
  delete process.env.DB_MAX_ROWS;
  const l = limits();
  assert.equal(l.maxRows, 1000);
  assert.equal(l.maxCellBytes, 8192);
  assert.equal(l.statementTimeoutMs, 15000);
  assert.equal(l.sqliteMaxBytes, 536870912);
});

test("limits read overrides from env", () => {
  process.env.DB_MAX_ROWS = "5";
  assert.equal(limits().maxRows, 5);
  delete process.env.DB_MAX_ROWS;
});

test("isWritable reflects DB_WRITABLE", () => {
  delete process.env.DB_WRITABLE;
  assert.equal(isWritable(), false);
  process.env.DB_WRITABLE = "true";
  assert.equal(isWritable(), true);
  delete process.env.DB_WRITABLE;
});
