import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCurl, toCurl } from "../dist/curl.js";

test("parseCurl basic GET with header", () => {
  const def = parseCurl(`curl -H 'Accept: application/json' https://api.x/users`);
  assert.equal(def.method, "GET");
  assert.equal(def.url, "https://api.x/users");
  assert.equal(def.headers.Accept, "application/json");
});

test("parseCurl POST with data infers method", () => {
  const def = parseCurl(`curl -X POST --data '{"a":1}' https://api.x/create`);
  assert.equal(def.method, "POST");
  assert.equal(def.body, '{"a":1}');
});

test("toCurl masks secrets", () => {
  const s = toCurl({ method: "GET", url: "https://api.x?k=${secret.tok}" }, { maskSecrets: true });
  assert.ok(!s.includes("secret.tok"));
  assert.ok(s.includes("***"));
});
