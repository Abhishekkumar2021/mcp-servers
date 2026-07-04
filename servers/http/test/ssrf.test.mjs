import { test } from "node:test";
import assert from "node:assert/strict";
import { hostAllowed, classifyIp } from "../dist/ssrf.js";

test("hostAllowed exact + wildcard", () => {
  process.env.HTTP_ALLOW_HOSTS = "api.github.com,*.example.com";
  assert.equal(hostAllowed("api.github.com"), true);
  assert.equal(hostAllowed("API.GitHub.com"), true);
  assert.equal(hostAllowed("a.example.com"), true);
  assert.equal(hostAllowed("a.b.example.com"), true);
  assert.equal(hostAllowed("example.com"), false); // apex not matched by *.example.com
  assert.equal(hostAllowed("evil.com"), false);
  delete process.env.HTTP_ALLOW_HOSTS;
});

test("classifyIp flags dangerous ranges, allows public", () => {
  assert.equal(classifyIp("8.8.8.8"), null);
  assert.equal(classifyIp("1.1.1.1"), null);
  assert.ok(classifyIp("127.0.0.1"));
  assert.ok(classifyIp("10.0.0.5"));
  assert.ok(classifyIp("192.168.1.1"));
  assert.ok(classifyIp("172.16.0.1"));
  assert.ok(classifyIp("169.254.169.254")); // cloud metadata
  assert.ok(classifyIp("100.64.0.1"));       // CGNAT
  assert.ok(classifyIp("::1"));
  assert.ok(classifyIp("fe80::1"));
  assert.ok(classifyIp("fc00::1"));
  assert.ok(classifyIp("::ffff:127.0.0.1")); // v4-mapped loopback
});
