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

test("formatResponse pretty-prints JSON + redacts", async () => {
  const { formatResponse } = await import(`../dist/format.js?${Date.now()}`);
  const raw = { status: 200, statusText: "OK", headers: { authorization: "Bearer xyz", "content-type": "application/json" }, bodyBuffer: Buffer.from('{"a":1}'), timingMs: 1, finalUrl: "http://x", redirects: [] };
  const v = formatResponse(raw, []);
  assert.match(v.body, /"a": 1/);
  assert.equal(v.headers.authorization, "***");
});
