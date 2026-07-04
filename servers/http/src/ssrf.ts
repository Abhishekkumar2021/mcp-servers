import dns from "node:dns";
import net from "node:net";
import { allowHosts, allowPrivate } from "./config.js";
import { HostNotAllowed, PrivateAddressBlocked } from "./errors.js";

export function hostAllowed(host: string): boolean {
  const h = host.toLowerCase();
  for (const pat of allowHosts()) {
    if (pat.startsWith("*.")) {
      const suffix = pat.slice(1); // ".example.com"
      if (h.endsWith(suffix) && h.length > suffix.length) return true;
    } else if (h === pat) {
      return true;
    }
  }
  return false;
}

export function assertHostAllowed(host: string): void {
  if (!hostAllowed(host)) throw new HostNotAllowed(host);
}

/** Return a reason string if `ip` is in a blocked range, else null. */
export function classifyIp(ip: string): string | null {
  const fam = net.isIP(ip);
  if (fam === 4) return classifyV4(ip);
  if (fam === 6) return classifyV6(ip.toLowerCase());
  return "unrecognized address";
}

function classifyV4(ip: string): string | null {
  const p = ip.split(".").map(Number);
  const [a, b] = p;
  if (a === 0) return "unspecified";
  if (a === 127) return "loopback";
  if (a === 10) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 169 && b === 254) return "link-local/metadata";
  if (a === 100 && b >= 64 && b <= 127) return "carrier-grade NAT";
  return null;
}

function classifyV6(ip: string): string | null {
  if (ip === "::1") return "loopback";
  if (ip === "::" ) return "unspecified";
  // IPv4-mapped (::ffff:a.b.c.d) — classify the embedded v4.
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return classifyV4(mapped[1]);
  if (/^fe[89ab]/.test(ip)) return "link-local";
  if (ip.startsWith("fc") || ip.startsWith("fd")) return "unique-local";
  return null;
}

/** A node:http `lookup` that only ever yields validated IPs (pinned). */
export function makeLookup() {
  return (hostname: string, options: any, cb: any) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) return cb(err);
      const list = Array.isArray(addresses) ? addresses : [addresses];
      const ok = allowPrivate() ? list : list.filter((a: any) => classifyIp(a.address) === null);
      if (ok.length === 0) {
        return cb(new PrivateAddressBlocked(hostname, list.map((a: any) => a.address)));
      }
      if (options && options.all) return cb(null, ok);
      cb(null, ok[0].address, ok[0].family);
    });
  };
}
