import { test } from "node:test";
import assert from "node:assert/strict";
import { substitute, redact } from "../dist/vars.js";

test("substitute expands vars and secrets", () => {
  process.env.HTTP_SECRET_tok = "s3cr3t";
  const out = substitute("${base}/users?key=${secret.tok}", { base: "https://api.x" });
  assert.equal(out, "https://api.x/users?key=s3cr3t");
  delete process.env.HTTP_SECRET_tok;
});

test("substitute throws on missing reference", () => {
  assert.throws(() => substitute("${nope}", {}), /MissingVariable/);
  assert.throws(() => substitute("${secret.absent}", {}), /MissingVariable/);
});

test("redact masks secret values and auth", () => {
  const out = redact("Authorization: Bearer s3cr3t\nx=s3cr3t", ["s3cr3t"]);
  assert.ok(!out.includes("s3cr3t"));
});
