#!/usr/bin/env node
/**
 * Build an MCPB bundle (.mcpb) for the sql server.
 *
 * Pipeline: tsc-build → stage `server/` (compiled dist + a clean production
 * node_modules) + manifest → `mcpb pack`. We copy real node_modules rather than
 * esbuild-bundling to keep the bundle's module resolution identical to a normal
 * install.
 *
 * Output: servers/sql/dist-mcpb/sql-<version>.mcpb  (gitignored; attach to a release)
 *
 * All command inputs below are trusted (package version + internal paths) — no
 * external/user input is interpolated.
 */
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, ".."); // servers/sql
const out = path.join(serverRoot, "dist-mcpb");
const stage = path.join(out, "pkg");
const serverDir = path.join(stage, "server");

const pkg = JSON.parse(await fs.readFile(path.join(serverRoot, "package.json"), "utf8"));
const slug = pkg.name.replace("@abhishekmcp/", "");
const npm = (args, cwd) => execFileSync("npm", args, { cwd, stdio: "inherit" });

console.error("• compiling TypeScript…");
npm(["run", "build"], serverRoot);

console.error("• staging bundle…");
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(serverDir, { recursive: true });
await fs.cp(path.join(serverRoot, "dist"), path.join(serverDir, "dist"), { recursive: true });
await fs.copyFile(path.join(serverRoot, "mcpb", "manifest.json"), path.join(stage, "manifest.json"));

// Minimal package.json so `npm install` resolves only runtime deps into the bundle.
const bundlePkg = {
  name: slug,
  version: pkg.version,
  type: "module",
  dependencies: pkg.dependencies,
};
await fs.writeFile(path.join(serverDir, "package.json"), JSON.stringify(bundlePkg, null, 2));

console.error("• installing production dependencies into the bundle…");
npm(["install", "--omit=dev", "--ignore-scripts", "--no-package-lock", "--no-audit", "--no-fund"], serverDir);

console.error("• packing .mcpb…");
const outFile = path.join(out, `${slug}-${pkg.version}.mcpb`);
execFileSync("npx", ["-y", "@anthropic-ai/mcpb", "pack", stage, outFile], { cwd: serverRoot, stdio: "inherit" });

console.error(`\n✓ built ${path.relative(process.cwd(), outFile)}`);
