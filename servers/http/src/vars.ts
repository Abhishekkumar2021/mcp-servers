import { secret } from "./config.js";
import { MissingVariable } from "./errors.js";

const REF = /\$\{(secret\.([A-Za-z0-9_]+)|([A-Za-z0-9_]+))\}/g;

export function substitute(text: string, vars: Record<string, string>): string {
  return text.replace(REF, (_m, _whole, secretName?: string, varName?: string) => {
    if (secretName) {
      const v = secret(secretName);
      if (v === undefined) throw new MissingVariable("secret", secretName);
      return v;
    }
    const v = vars[varName as string];
    if (v === undefined) throw new MissingVariable("variable", varName as string);
    return v;
  });
}

export function collectSecretValues(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(REF)) {
    if (m[2]) {
      const v = secret(m[2]);
      if (v) out.push(v);
    }
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redact(s: string, extra: string[] = []): string {
  let out = s;
  for (const val of extra) {
    if (val && val.length >= 4) out = out.replace(new RegExp(escapeRe(val), "g"), "***");
  }
  // Header lines
  out = out.replace(/((?:authorization|cookie|set-cookie|x-api-key|x-auth-token)\s*[:=]\s*)(\S+)/gi, "$1***");
  // Query params
  out = out.replace(/([?&](?:token|key|secret|access_token|api_key)=)[^&\s]+/gi, "$1***");
  return out;
}
