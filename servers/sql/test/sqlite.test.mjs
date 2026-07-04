import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import initSqlJs from "sql.js";
import { getAdapter } from "../dist/adapter.js";

async function makeDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE author (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE book (id INTEGER PRIMARY KEY, title TEXT, author_id INTEGER REFERENCES author(id));
    CREATE INDEX idx_book_author ON book(author_id);
    CREATE VIEW book_titles AS SELECT title FROM book;
    INSERT INTO author (id, name) VALUES (1, 'Ada');
    INSERT INTO book (id, title, author_id) VALUES (1, 'Notes', 1);
  `);
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "sqlmcp-"));
  const file = path.join(dir, "app.db");
  await fsp.writeFile(file, Buffer.from(db.export()));
  db.close();
  return file;
}

test("sqlite: introspection + read query", async () => {
  const file = await makeDb();
  const a = await getAdapter({ name: "t", type: "sqlite", url: `sqlite:${file}` });
  const tables = await a.listTables();
  const names = tables.map((t) => t.name).sort();
  assert.ok(names.includes("author") && names.includes("book"));
  assert.ok(tables.find((t) => t.name === "book_titles").kind === "view");

  const desc = await a.describeTable(undefined, "book");
  assert.deepEqual(desc.primaryKey, ["id"]);
  assert.equal(desc.foreignKeys[0].toTable, "author");

  const res = await a.query("SELECT name FROM author WHERE id = ?", [1], { maxRows: 10, maxCellBytes: 100 });
  assert.deepEqual(res.rows, [["Ada"]]);
  await a.close();
});

test("sqlite: read query rejects writes at engine level", async () => {
  const file = await makeDb();
  const a = await getAdapter({ name: "t2", type: "sqlite", url: `sqlite:${file}` });
  await assert.rejects(a.query("DELETE FROM author", [], { maxRows: 10, maxCellBytes: 100 }));
  await a.close();
});

test("sqlite: execute persists when writable", async () => {
  const file = await makeDb();
  const a = await getAdapter({ name: "t3", type: "sqlite", url: `sqlite:${file}` });
  const r = await a.execute("INSERT INTO author (id, name) VALUES (2, 'Grace')", []);
  assert.equal(r.rowsAffected, 1);
  const check = await a.query("SELECT COUNT(*) FROM author", [], { maxRows: 10, maxCellBytes: 100 });
  assert.equal(check.rows[0][0], 2);
  await a.close();
});
