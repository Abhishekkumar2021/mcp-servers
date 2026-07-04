import { test } from "node:test";
import assert from "node:assert/strict";
import { assertReadOnly, ReadOnlyViolation, splitStatements } from "../dist/guard.js";

test("allows SELECT / WITH / VALUES", () => {
  assertReadOnly("SELECT 1");
  assertReadOnly("  -- c\n WITH x AS (SELECT 1) SELECT * FROM x");
  assertReadOnly("VALUES (1),(2)");
});

test("rejects writes and DDL", () => {
  for (const sql of ["INSERT INTO t VALUES (1)", "update t set a=1", "DELETE FROM t", "DROP TABLE t", "CREATE TABLE t(a int)"]) {
    assert.throws(() => assertReadOnly(sql), ReadOnlyViolation, sql);
  }
});

test("rejects multiple statements for read", () => {
  assert.throws(() => assertReadOnly("SELECT 1; DROP TABLE t"), ReadOnlyViolation);
});

test("splitStatements ignores semicolons in strings", () => {
  const parts = splitStatements("INSERT INTO t VALUES (';'); SELECT 1;");
  assert.equal(parts.length, 2);
});
