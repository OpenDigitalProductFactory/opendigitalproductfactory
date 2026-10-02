#!/usr/bin/env node
/**
 * BI-1FF67B91: only apps/web/lib/security/client-address.ts may read X-Forwarded-For.
 *
 * Proxies such as Caddy and cloudflared APPEND to X-Forwarded-For, so its leftmost
 * entry is whatever the client sent and is attacker-controlled. Keying a rate limit
 * or a requester record on it lets a caller bypass per-requester limits by rotating
 * a forged header. Before #5835 (BI-88FCDA4C) two routes did exactly that.
 * clientAddressKey takes the entry the nearest trusted proxy appended (the
 * rightmost), and it is the only sanctioned way to derive a requester key.
 *
 * This guard fails when any non-test source under apps/ or packages/, other than
 * client-address.ts, names the header. There is no allowlist: a new reader goes
 * through clientAddressKey.
 *
 * Run: node scripts/check-xff-single-reader.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The one sanctioned reader of the header. */
export const CANONICAL = "apps/web/lib/security/client-address.ts";

const HEADER_PATTERN = /x-forwarded-for/i;
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".mjs", ".js", ".cjs", ".jsx"];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage", "fixtures", "__fixtures__", "__tests__"]);

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

function isTestFile(path) {
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path) || /\.test-support\.[cm]?[jt]sx?$/.test(path);
}

/** 1-based line numbers + text of every non-comment line naming the header. */
export function findXffReads(body) {
  const hits = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (isCommentLine(lines[i])) continue;
    if (HEADER_PATTERN.test(lines[i])) hits.push({ line: i + 1, text: lines[i].trim() });
  }
  return hits;
}

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) yield* walk(full);
    else if (s.isFile() && EXTENSIONS.some((ext) => full.endsWith(ext)) && !isTestFile(full)) yield full;
  }
}

/** Header reads outside the canonical reader. */
export function scanRepo(root = REPO_ROOT) {
  const violations = [];
  for (const top of ["apps", "packages"]) {
    for (const file of walk(join(root, top))) {
      const rel = relative(root, file).replace(/\\/g, "/");
      if (rel === CANONICAL) continue;
      for (const h of findXffReads(readFileSync(file, "utf8"))) violations.push({ file: rel, ...h });
    }
  }
  return violations;
}

function main() {
  const violations = scanRepo();
  if (violations.length > 0) {
    console.error("\nERROR: source reads X-Forwarded-For outside the one sanctioned reader.\n");
    console.error("The leftmost entry is client-supplied; derive a requester key with clientAddressKey:");
    console.error(`  ${CANONICAL}\n`);
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`);
    console.error("");
    process.exit(1);
  }
  console.log(`✓ Only ${CANONICAL} reads X-Forwarded-For.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
