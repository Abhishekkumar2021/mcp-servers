import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";

async function startServer(handler) {
  const srv = http.createServer(handler);
  srv.listen(0, "127.0.0.1");
  await once(srv, "listening");
  return { srv, port: srv.address().port };
}

test("fetchSafe GET returns body (private allowed for test)", async () => {
  process.env.HTTP_ALLOW_HOSTS = "127.0.0.1";
  process.env.HTTP_ALLOW_PRIVATE = "1";
  const { srv, port } = await startServer((req, res) => { res.setHeader("content-type", "application/json"); res.end('{"ok":true}'); });
  const { fetchSafe } = await import(`../dist/client.js?${Date.now()}`);
  const r = await fetchSafe({ method: "GET", url: `http://127.0.0.1:${port}/x` });
  assert.equal(r.status, 200);
  assert.match(r.bodyBuffer.toString(), /ok/);
  srv.close();
  delete process.env.HTTP_ALLOW_HOSTS; delete process.env.HTTP_ALLOW_PRIVATE;
});

test("fetchSafe rejects non-allowlisted host", async () => {
  process.env.HTTP_ALLOW_HOSTS = "example.com";
  const { fetchSafe } = await import(`../dist/client.js?${Date.now()}`);
  await assert.rejects(fetchSafe({ method: "GET", url: "http://127.0.0.1:1/x" }), /HostNotAllowed/);
  delete process.env.HTTP_ALLOW_HOSTS;
});

test("fetchSafe blocks private IP without HTTP_ALLOW_PRIVATE", async () => {
  process.env.HTTP_ALLOW_HOSTS = "127.0.0.1";
  delete process.env.HTTP_ALLOW_PRIVATE;
  const { fetchSafe } = await import(`../dist/client.js?${Date.now()}`);
  await assert.rejects(fetchSafe({ method: "GET", url: "http://127.0.0.1:1/x" }), /PrivateAddressBlocked/);
  delete process.env.HTTP_ALLOW_HOSTS;
});

test("fetchSafe blocks IPv6 literal loopback (bracketed host)", async () => {
  process.env.HTTP_ALLOW_HOSTS = "[::1]";
  delete process.env.HTTP_ALLOW_PRIVATE;
  const { fetchSafe } = await import(`../dist/client.js?${Date.now()}`);
  await assert.rejects(fetchSafe({ method: "GET", url: "http://[::1]:1/x" }), /PrivateAddressBlocked/);
  delete process.env.HTTP_ALLOW_HOSTS;
});

test("audit redacts secret values passed as extra (FIX 1)", async () => {
  const { mkdtempSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const file = join(mkdtempSync(join(tmpdir(), "http-audit-")), "audit.log");
  process.env.HTTP_AUDIT_LOG = file;
  const { audit } = await import(`../dist/log.js?${Date.now()}`);
  audit({ url: "https://x/AAABBBCCC/y" }, ["AAABBBCCC"]);
  const contents = readFileSync(file, "utf8");
  assert.doesNotMatch(contents, /AAABBBCCC/);
  assert.match(contents, /\*\*\*/);
  delete process.env.HTTP_AUDIT_LOG;
});

test("cross-origin redirect strips Authorization header (FIX 3)", async () => {
  process.env.HTTP_ALLOW_HOSTS = "127.0.0.1";
  process.env.HTTP_ALLOW_PRIVATE = "1";
  const b = await startServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ auth: req.headers.authorization ?? null }));
  });
  const a = await startServer((_req, res) => {
    res.statusCode = 302;
    res.setHeader("location", `http://127.0.0.1:${b.port}/echo`);
    res.end();
  });
  const { fetchSafe } = await import(`../dist/client.js?${Date.now()}`);
  const r = await fetchSafe({ method: "GET", url: `http://127.0.0.1:${a.port}/start`, headers: { authorization: "Bearer topsecret" } });
  assert.equal(r.status, 200);
  const echoed = JSON.parse(r.bodyBuffer.toString());
  assert.equal(echoed.auth, null);
  a.srv.close(); b.srv.close();
  delete process.env.HTTP_ALLOW_HOSTS; delete process.env.HTTP_ALLOW_PRIVATE;
});

test("formatResponse pretty-prints JSON + redacts", async () => {
  const { formatResponse } = await import(`../dist/format.js?${Date.now()}`);
  const raw = { status: 200, statusText: "OK", headers: { authorization: "Bearer xyz", "content-type": "application/json" }, bodyBuffer: Buffer.from('{"a":1}'), timingMs: 1, finalUrl: "http://x", redirects: [] };
  const v = formatResponse(raw, []);
  assert.match(v.body, /"a": 1/);
  assert.equal(v.headers.authorization, "***");
});
