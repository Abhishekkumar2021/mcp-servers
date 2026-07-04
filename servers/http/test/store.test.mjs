import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";

async function freshDir() {
  const d = await fsp.mkdtemp(path.join(os.tmpdir(), "httpmcp-"));
  process.env.HTTP_DIR = d;
  return d;
}

test("request CRUD round-trip", async () => {
  await freshDir();
  const store = await import(`../dist/store.js?${Date.now()}`);
  store.saveRequest("gh", "me", { method: "GET", url: "https://api.github.com/user" });
  assert.deepEqual(store.getRequest("gh", "me").url, "https://api.github.com/user");
  assert.equal(store.listRequests("gh").length, 1);
  assert.deepEqual(store.listCollections(), ["gh"]);
  store.deleteRequest("gh", "me");
  assert.equal(store.listRequests("gh").length, 0);
});

test("environment CRUD + name validation", async () => {
  await freshDir();
  const store = await import(`../dist/store.js?${Date.now()}`);
  store.setEnvironment("prod", { base: "https://api.x" });
  assert.equal(store.getEnvironment("prod").base, "https://api.x");
  assert.deepEqual(store.listEnvironments(), ["prod"]);
  assert.throws(() => store.setEnvironment("../evil", {}), /InvalidName/);
  assert.throws(() => store.getRequest("gh", "nope"), /RequestNotFound/);
});
