import { test } from "node:test";
import assert from "node:assert/strict";
import { allowHosts, hasAllowHosts, isWritable, allowPrivate, limits, secret } from "../dist/config.js";

test("allowHosts parses + lowercases", () => {
  process.env.HTTP_ALLOW_HOSTS = "API.github.com, *.example.com";
  assert.deepEqual(allowHosts(), ["api.github.com", "*.example.com"]);
  assert.equal(hasAllowHosts(), true);
  delete process.env.HTTP_ALLOW_HOSTS;
  assert.equal(hasAllowHosts(), false);
});

test("flags + limits defaults", () => {
  delete process.env.HTTP_WRITABLE; delete process.env.HTTP_ALLOW_PRIVATE;
  assert.equal(isWritable(), false);
  assert.equal(allowPrivate(), false);
  const l = limits();
  assert.equal(l.maxResponseBytes, 1048576);
  assert.equal(l.timeoutMs, 30000);
  assert.equal(l.maxRedirects, 5);
});

test("secret reads HTTP_SECRET_<name>", () => {
  process.env.HTTP_SECRET_tok = "abc";
  assert.equal(secret("tok"), "abc");
  delete process.env.HTTP_SECRET_tok;
});
