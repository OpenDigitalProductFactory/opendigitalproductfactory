#!/usr/bin/env node
/**
 * BI-899122C5 — CI ratchet: no raw C0 control bytes in tracked source.
 *
 * A literal NUL (or ESC, DEL, …) inside a string or regex behaves exactly like
 * its `\x00` escape at runtime, which is why nothing caught it. But it makes
 * the file BINARY to grep and ripgrep: `grep sanitizeForLog safe-log.ts`
 * returned nothing. It also hides the pattern from readers and code scanning
 * (BI-14791111). Write the escape instead: `\x00`, `\x1b`, `\x7f`.
 *
 * Tab, LF and CR are allowed. The budget is zero.
 *
 *   node scripts/check-no-raw-control-bytes.mjs   # check (CI)
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_GLOBS = ["*.ts", "*.tsx", "*.mts", "*.cts", "*.js", "*.jsx", "*.mjs", "*.cjs"];

/** C0 controls other than tab, LF and CR, plus DEL. */
const RAW_CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

/** Each offending line in `bytes`, as { line, byte } (1-based line). */
export function findRawControlBytes(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString("latin1") : String(bytes);
  const hits = [];
  text.split("\n").forEach((line, index) => {
    const match = RAW_CONTROL.exec(line);
    if (match) hits.push({ line: index + 1, byte: `0x${match[0].charCodeAt(0).toString(16).padStart(2, "0")}` });
  });
  return hits;
}

function trackedSourceFiles() {
  return execFileSync("git", ["ls-files", "-z", "--", ...SOURCE_GLOBS], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\0")
    .filter((path) => path && !path.includes("node_modules/"));
}

export function main() {
  const failures = [];
  for (const path of trackedSourceFiles()) {
    let bytes;
    try {
      bytes = readFileSync(join(REPO_ROOT, path));
    } catch {
      continue;
    }
    for (const hit of findRawControlBytes(bytes)) failures.push(`${path}:${hit.line} raw ${hit.byte}`);
  }
  if (failures.length > 0) {
    console.error("Raw control bytes in tracked source (BI-899122C5). Write the escape (\\x00, \\x1b, \\x7f) instead:");
    for (const failure of failures) console.error(`  - ${failure}`);
    return 1;
  }
  console.log("✓ No raw control bytes in tracked source.");
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main());
