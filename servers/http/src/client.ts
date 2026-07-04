import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import net from "node:net";
import { limits, allowPrivate } from "./config.js";
import { assertHostAllowed, makeLookup, classifyIp } from "./ssrf.js";
import { PrivateAddressBlocked, RequestTimeout, TooManyRedirects, UnsupportedScheme } from "./errors.js";

export interface RawResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyBuffer: Buffer;
  timingMs: number;
  finalUrl: string;
  redirects: string[];
}

interface Input {
  method: string;
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: string;
}

function withQuery(url: string, query?: Record<string, string>): string {
  if (!query || Object.keys(query).length === 0) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  return u.toString();
}

function decode(buf: Buffer, encoding: string | undefined, max: number): Buffer {
  try {
    // Cap decompressed output at maxResponseBytes so a small compressed body
    // can't expand into a decompression bomb (GBs → OOM). zlib throws on
    // overflow, which the catch below turns into a raw-buffer fallback.
    if (encoding === "gzip") return zlib.gunzipSync(buf, { maxOutputLength: max });
    if (encoding === "deflate") return zlib.inflateSync(buf, { maxOutputLength: max });
    if (encoding === "br") return zlib.brotliDecompressSync(buf, { maxOutputLength: max });
  } catch {
    return buf; // partial/truncated/over-limit — return raw
  }
  return buf;
}

export async function fetchSafe(input: Input): Promise<RawResponse> {
  const { maxResponseBytes, timeoutMs, maxRedirects } = limits();
  const start = Date.now();
  const redirects: string[] = [];
  let current = withQuery(input.url, input.query);
  let headers = input.headers;

  for (let hop = 0; ; hop++) {
    if (hop > maxRedirects) throw new TooManyRedirects(maxRedirects);
    const u = new URL(current);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new UnsupportedScheme(u.protocol.replace(":", ""));
    assertHostAllowed(u.hostname);
    // node's net.connect skips the custom `lookup` for literal IP hosts, so a
    // literal private/loopback IP would bypass makeLookup's classification.
    // Re-run the same check here to keep the SSRF guard airtight per hop.
    // URL.hostname keeps brackets on IPv6 literals ("[::1]"), which net.isIP
    // rejects — strip them so the literal is actually validated.
    const ipLiteral = u.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(ipLiteral)) {
      const reason = classifyIp(ipLiteral);
      if (reason && !allowPrivate()) throw new PrivateAddressBlocked(u.hostname, [ipLiteral]);
    }

    const mod = u.protocol === "https:" ? https : http;
    const res = await new Promise<{ statusCode: number; statusMessage: string; headers: Record<string, string>; body: Buffer }>((resolve, reject) => {
      const req = mod.request(
        u,
        { method: input.method, headers, lookup: makeLookup() as any },
        (r) => {
          const chunks: Buffer[] = [];
          let total = 0;
          let truncated = false;
          r.on("data", (c: Buffer) => {
            total += c.length;
            if (total <= maxResponseBytes) chunks.push(c);
            else if (!truncated) { truncated = true; chunks.push(c.subarray(0, Math.max(0, maxResponseBytes - (total - c.length)))); r.destroy(); }
          });
          r.on("error", reject);
          r.on("end", () => resolve({ statusCode: r.statusCode ?? 0, statusMessage: r.statusMessage ?? "", headers: r.headers as Record<string, string>, body: Buffer.concat(chunks) }));
          r.on("close", () => resolve({ statusCode: r.statusCode ?? 0, statusMessage: r.statusMessage ?? "", headers: r.headers as Record<string, string>, body: Buffer.concat(chunks) }));
        },
      );
      req.setTimeout(timeoutMs, () => { req.destroy(new RequestTimeout(timeoutMs)); });
      req.on("error", reject);
      if (input.body) req.write(input.body);
      req.end();
    });

    // Redirect?
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      redirects.push(current);
      current = new URL(res.headers.location, u).toString();
      // Cross-origin redirect: drop credential headers so Authorization/Cookie
      // aren't replayed to a different host. Work on a copy since input.headers
      // is reused across hops.
      if (headers && new URL(current).host.toLowerCase() !== u.host.toLowerCase()) {
        headers = Object.fromEntries(
          Object.entries(headers).filter(([k]) => {
            const lk = k.toLowerCase();
            return lk !== "authorization" && lk !== "cookie";
          }),
        );
      }
      continue;
    }

    const decoded = decode(res.body, (res.headers["content-encoding"] || "").toString().toLowerCase(), maxResponseBytes);
    return {
      status: res.statusCode,
      statusText: res.statusMessage,
      headers: res.headers,
      bodyBuffer: decoded,
      timingMs: Date.now() - start,
      finalUrl: current,
      redirects,
    };
  }
}
