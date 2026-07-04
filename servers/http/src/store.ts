import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { storeDir } from "./config.js";
import { EnvironmentNotFound, InvalidName, RequestNotFound } from "./errors.js";

export interface RequestDef {
  method: string;
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: string;
}

const NAME_RE = /^[A-Za-z0-9._-]+$/;
function validateName(name: string): string {
  if (!NAME_RE.test(name) || name === "." || name === "..") throw new InvalidName(name);
  return name;
}

function dir(kind: "collections" | "environments"): string {
  const d = path.join(storeDir(), kind);
  mkdirSync(d, { recursive: true });
  return d;
}
function fileFor(kind: "collections" | "environments", name: string): string {
  return path.join(dir(kind), `${validateName(name)}.json`);
}
function writeJson(file: string, data: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file);
}
function readJson<T>(file: string): T | undefined {
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8")) as T;
}
function listNames(kind: "collections" | "environments"): string[] {
  const d = dir(kind);
  return readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
}

type Collection = { requests: Record<string, RequestDef> };

export function saveRequest(collection: string, name: string, def: RequestDef): void {
  const file = fileFor("collections", collection);
  const col = readJson<Collection>(file) ?? { requests: {} };
  col.requests[validateName(name)] = def;
  writeJson(file, col);
}
export function getRequest(collection: string, name: string): RequestDef {
  const col = readJson<Collection>(fileFor("collections", collection));
  const def = col?.requests[name];
  if (!def) throw new RequestNotFound(collection, name);
  return def;
}
export function deleteRequest(collection: string, name: string): void {
  const file = fileFor("collections", collection);
  const col = readJson<Collection>(file);
  if (!col || !col.requests[name]) throw new RequestNotFound(collection, name);
  delete col.requests[name];
  writeJson(file, col);
}
export function listRequests(collection?: string): { collection: string; name: string; method: string; url: string }[] {
  const cols = collection ? [validateName(collection)] : listCollections();
  const out: { collection: string; name: string; method: string; url: string }[] = [];
  for (const c of cols) {
    const col = readJson<Collection>(fileFor("collections", c));
    if (!col) continue;
    for (const [name, def] of Object.entries(col.requests)) {
      out.push({ collection: c, name, method: def.method, url: def.url });
    }
  }
  return out;
}
export function listCollections(): string[] {
  return listNames("collections");
}

type Environment = { vars: Record<string, string> };

export function setEnvironment(name: string, vars: Record<string, string>): void {
  writeJson(fileFor("environments", name), { vars } satisfies Environment);
}
export function getEnvironment(name: string): Record<string, string> {
  const env = readJson<Environment>(fileFor("environments", name));
  if (!env) throw new EnvironmentNotFound(name);
  return env.vars;
}
export function deleteEnvironment(name: string): void {
  const file = fileFor("environments", name);
  if (!existsSync(file)) throw new EnvironmentNotFound(name);
  rmSync(file);
}
export function listEnvironments(): string[] {
  return listNames("environments");
}
