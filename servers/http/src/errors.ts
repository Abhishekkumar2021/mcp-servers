/** Typed errors mapped to actionable tool text in index.ts. */
export class HttpError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = code;
    this.code = code;
  }
}
export class HostNotAllowed extends HttpError {
  constructor(host: string) {
    super("HostNotAllowed", `host '${host}' is not in HTTP_ALLOW_HOSTS`);
  }
}
export class PrivateAddressBlocked extends HttpError {
  constructor(host: string, addrs: string[]) {
    super("PrivateAddressBlocked", `host '${host}' resolves to a blocked address (${addrs.join(", ")}); set HTTP_ALLOW_PRIVATE=1 to allow private/loopback targets`);
  }
}
export class NotWritable extends HttpError {
  constructor(method: string) {
    super("NotWritable", `method ${method} is disabled; set HTTP_WRITABLE=1 to enable mutating requests`);
  }
}
export class RequestTimeout extends HttpError {
  constructor(ms: number) { super("RequestTimeout", `request timed out after ${ms}ms`); }
}
export class TooManyRedirects extends HttpError {
  constructor(max: number) { super("TooManyRedirects", `exceeded HTTP_MAX_REDIRECTS (${max})`); }
}
export class RequestNotFound extends HttpError {
  constructor(c: string, n: string) { super("RequestNotFound", `no saved request '${n}' in collection '${c}'`); }
}
export class EnvironmentNotFound extends HttpError {
  constructor(n: string) { super("EnvironmentNotFound", `no environment '${n}'`); }
}
export class InvalidName extends HttpError {
  constructor(n: string) { super("InvalidName", `invalid name '${n}' (use letters, digits, dash, underscore, dot; no path separators)`); }
}
export class UnsupportedScheme extends HttpError {
  constructor(s: string) { super("UnsupportedScheme", `unsupported URL scheme '${s}' (only http/https)`); }
}
export class MissingVariable extends HttpError {
  constructor(kind: string, name: string) { super("MissingVariable", `${kind} '${name}' is not set`); }
}
