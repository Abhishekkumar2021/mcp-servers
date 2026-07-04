import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";

const SERVER = fileURLToPath(new URL("../dist/index.js", import.meta.url));

async function makeDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run("CREATE TABLE author (id INTEGER PRIMARY KEY, name TEXT NOT NULL); INSERT INTO author VALUES (1,'Ada');");
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "sqlmcp-srv-"));
  const file = path.join(dir, "app.db");
  await fsp.writeFile(file, Buffer.from(db.export()));
  db.close();
  return file;
}

function client(env) {
  const proc = spawn("node", [SERVER], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "ignore"] });
  const rl = readline.createInterface({ input: proc.stdout });
  const pending = new Map();
  let id = 0;
  rl.on("line", (l) => { let m; try { m = JSON.parse(l); } catch { return; } if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params) => new Promise((res) => { const msgId = ++id; pending.set(msgId, res); proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: msgId, method, params }) + "\n"); });
  const notify = (method, params) => proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  return { send, notify, kill: () => proc.kill() };
}

async function connect(env) {
  const c = client(env);
  await c.send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  c.notify("notifications/initialized", {});
  return c;
}

test("read tools work over stdio", async () => {
  const file = await makeDb();
  const c = await connect({ DB_CONN_local: `sqlite:${file}` });
  const list = await c.send("tools/list", {});
  const names = list.result.tools.map((t) => t.name);
  assert.ok(names.includes("query") && names.includes("describe_table"));
  assert.ok(!names.includes("execute"), "execute absent without DB_WRITABLE");

  const q = await c.send("tools/call", { name: "query", arguments: { connection: "local", sql: "SELECT name FROM author WHERE id = ?", params: [1] } });
  assert.match(q.result.content[0].text, /Ada/);

  const bad = await c.send("tools/call", { name: "query", arguments: { connection: "local", sql: "DELETE FROM author" } });
  assert.match(bad.result.content[0].text, /read-only/);
  c.kill();
});
