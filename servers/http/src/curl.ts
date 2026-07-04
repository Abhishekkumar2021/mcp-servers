import type { RequestDef } from "./store.js";

/** Tokenize a shell-ish curl string honoring single/double quotes. */
function tokenize(cmd: string): string[] {
  const out: string[] = [];
  const re = /'([^']*)'|"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cmd))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

export function parseCurl(cmd: string): RequestDef {
  const toks = tokenize(cmd.trim());
  if (toks[0] === "curl") toks.shift();
  let method: string | undefined;
  let url: string | undefined;
  const headers: Record<string, string> = {};
  let body: string | undefined;
  let get = false;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t === "-X" || t === "--request") { method = toks[++i]?.toUpperCase(); }
    else if (t === "-H" || t === "--header") {
      const h = toks[++i] ?? "";
      const idx = h.indexOf(":");
      if (idx > 0) headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
    } else if (t === "-d" || t === "--data" || t === "--data-raw" || t === "--data-binary") {
      body = toks[++i];
    } else if (t === "-G" || t === "--get") { get = true; }
    else if (t === "--url") { url = toks[++i]; }
    else if (!t.startsWith("-")) { url = t; }
  }
  if (!method) method = body && !get ? "POST" : "GET";
  return { method, url: url ?? "", ...(Object.keys(headers).length ? { headers } : {}), ...(body ? { body } : {}) };
}

export function toCurl(def: RequestDef, opts: { maskSecrets?: boolean } = {}): string {
  const mask = (s: string) => (opts.maskSecrets ? s.replace(/\$\{secret\.[A-Za-z0-9_]+\}/g, "***") : s);
  const parts = ["curl"];
  if (def.method && def.method !== "GET") parts.push("-X", def.method);
  for (const [k, v] of Object.entries(def.headers ?? {})) parts.push("-H", `'${mask(`${k}: ${v}`)}'`);
  if (def.body) parts.push("--data", `'${mask(def.body)}'`);
  parts.push(`'${mask(def.url)}'`);
  return parts.join(" ");
}
