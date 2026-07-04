import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import readline from "node:readline";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../dist/index.js", import.meta.url));

async function startServer(handler) {
  const srv = http.createServer(handler);
  srv.listen(0, "127.0.0.1");
  await once(srv, "listening");
  return { srv, port: srv.address().port };
}
function client(env) {
  const proc = spawn("node", [SERVER], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "ignore"] });
  const rl = readline.createInterface({ input: proc.stdout });
  const pending = new Map();
  let id = 0;
  rl.on("line", (l) => { let m; try { m = JSON.parse(l); } catch { return; } if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params) => new Promise((res) => { const mid = ++id; pending.set(mid, res); proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: mid, method, params }) + "\n"); });
  const notify = (method, params) => proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  return { send, notify, kill: () => proc.kill() };
}
async function connect(env) {
  const c = client(env);
  await c.send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  c.notify("notifications/initialized", {});
  return c;
}

test("save + run a request round-trip", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "httpmcp-srv-"));
  const { srv, port } = await startServer((_req, res) => { res.setHeader("content-type", "application/json"); res.end(`{"path":"${_req.url}"}`); });
  const c = await connect({ HTTP_ALLOW_HOSTS: "127.0.0.1", HTTP_ALLOW_PRIVATE: "1", HTTP_DIR: dir });
  await c.send("tools/call", { name: "set_environment", arguments: { name: "local", vars: { base: `http://127.0.0.1:${port}` } } });
  await c.send("tools/call", { name: "save_request", arguments: { collection: "demo", name: "ping", request: { method: "GET", url: "${base}/ping" } } });
  const run = await c.send("tools/call", { name: "run_request", arguments: { collection: "demo", name: "ping", environment: "local" } });
  assert.match(run.result.content[0].text, /\/ping/);
  const list = await c.send("tools/call", { name: "list_requests", arguments: {} });
  assert.match(list.result.content[0].text, /ping/);
  c.kill(); srv.close();
});
