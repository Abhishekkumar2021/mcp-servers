export type ConnType = "postgres" | "sqlite";
export interface Connection { name: string; type: ConnType; url: string }

export class ConnectionNotFound extends Error {
  constructor(name: string) {
    super(`connection '${name}' not found; configure DB_CONN_${name}=<url>`);
    this.name = "ConnectionNotFound";
  }
}

function typeFromUrl(url: string): ConnType {
  const scheme = url.slice(0, url.indexOf(":")).toLowerCase();
  if (scheme === "postgres" || scheme === "postgresql") return "postgres";
  if (scheme === "sqlite" || scheme === "file") return "sqlite";
  throw new Error(`unsupported connection scheme in '${scheme}://…' (use postgres:// or sqlite:)`);
}

export function listConnections(): Connection[] {
  const out: Connection[] = [];
  for (const [key, val] of Object.entries(process.env)) {
    if (!key.startsWith("DB_CONN_") || !val) continue;
    const name = key.slice("DB_CONN_".length);
    if (!name) continue;
    out.push({ name, type: typeFromUrl(val), url: val });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function getConnection(name: string): Connection {
  const c = listConnections().find((x) => x.name === name);
  if (!c) throw new ConnectionNotFound(name);
  return c;
}

/** Mask credentials and full connection URLs in any user-facing string. */
export function redact(s: string): string {
  return s
    .replace(/([a-z]+:\/\/)([^\s/@]+)@/gi, "$1***@")
    .replace(/([?&](?:password|pwd)=)[^&\s]+/gi, "$1***");
}
