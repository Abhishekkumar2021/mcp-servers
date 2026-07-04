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

test("write tools appear + persist only when DB_WRITABLE", async () => {
  const file = await makeDb();
  const c = await connect({ DB_CONN_local: `sqlite:${file}`, DB_WRITABLE: "1" });
  const list = await c.send("tools/list", {});
  assert.ok(list.result.tools.map((t) => t.name).includes("execute"));

  const ins = await c.send("tools/call", { name: "execute", arguments: { connection: "local", sql: "INSERT INTO author (id, name) VALUES (2, 'Grace')" } });
  assert.match(ins.result.content[0].text, /rowsAffected/);

  const count = await c.send("tools/call", { name: "query", arguments: { connection: "local", sql: "SELECT COUNT(*) AS n FROM author" } });
  assert.match(count.result.content[0].text, /2/);
  c.kill();
});
