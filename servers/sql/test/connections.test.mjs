import { test } from "node:test";
import assert from "node:assert/strict";
import { listConnections, getConnection, redact, ConnectionNotFound } from "../dist/connections.js";

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(process.env)) if (k.startsWith("DB_CONN_")) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, vars);
  try { return fn(); } finally {
    for (const k of Object.keys(vars)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

test("parses postgres and sqlite connections by scheme", () => {
  withEnv({ DB_CONN_analytics: "postgres://u:p@host:5432/db", DB_CONN_local: "sqlite:/tmp/app.db" }, () => {
    const conns = listConnections();
    assert.equal(conns.length, 2);
    assert.deepEqual(conns.map((c) => c.name).sort(), ["analytics", "local"]);
    assert.equal(getConnection("analytics").type, "postgres");
    assert.equal(getConnection("local").type, "sqlite");
  });
});

test("getConnection throws ConnectionNotFound for unknown name", () => {
  withEnv({}, () => {
    assert.throws(() => getConnection("nope"), ConnectionNotFound);
  });
});

test("redact hides credentials", () => {
  const out = redact("connect postgres://user:secret@db:5432/x failed");
  assert.ok(!out.includes("secret"));
  assert.ok(out.includes("postgres://"));
});
