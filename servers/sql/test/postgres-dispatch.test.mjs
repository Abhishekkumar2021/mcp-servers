import { test } from "node:test";
import assert from "node:assert/strict";
import { PostgresAdapter } from "../dist/adapters/postgres.js";

test("PostgresAdapter class is constructable and shaped", () => {
  // We do not connect (no live server in CI); just verify the module + surface.
  assert.equal(typeof PostgresAdapter, "function");
  const methods = ["listSchemas", "listTables", "describeTable", "listIndexes", "relationships", "query", "explain", "sample", "execute", "executeScript", "close"];
  for (const m of methods) assert.equal(typeof PostgresAdapter.prototype[m], "function", m);
});
