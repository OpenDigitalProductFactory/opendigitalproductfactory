#!/usr/bin/env node
/**
 * BI-5E067004 (EP-8717D32C): every hand-off to the owner passes ONE seam.
 *
 * Escalation is a gate, not a trust tier: a person is engaged only when the
 * action is damaging, or when nothing recorded can steer it. The gate existed,
 * but background producers bypassed it by writing owner-attention issue
 * reports directly: 91 in 14 days, none consulted, most mechanical. The seam
 * apps/web/lib/govern/authority/route-to-human.ts now decides every one, and
 * this guard makes a bypass fail CI ("prose is not a control gate").
 *
 * Outside the seam, the report writer and tests, a source file fails when it:
 *   1. sets `selfFixClass` to "needs-human" / "needs-external-capability" or a
 *      SELF_FIX_CLASS member (the seam's output, never a producer's input);
 *   2. names the `build-stall-escalation` type AND calls
 *      createPlatformIssueReport( (an owner-attention write);
 *   3. calls notifyAttentionLive / notifyAttentionLiveOrThrow AND names the
 *      `escalation` attention source (the owner's Needs-you bell).
 *
 * Reads are fine: the inbox feed, the hygiene sweep and the stream classifier
 * query these values but never write them. Do not add an allowlist entry to
 * send work to the owner; call routeToHuman (or decideOwnerAttentionRoute +
 * fileOwnerAttentionRoute) instead.
 *
 * Run: node scripts/check-no-unrouted-owner-escalation.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The seam, and the single writer it calls. */
export const SANCTIONED = new Map([
  ["apps/web/lib/govern/authority/route-to-human.ts", "the seam: the only owner-attention writer"],
  ["apps/web/lib/quality/platform-issue-reports.ts", "the report writer: declares the selfFixClass column it stores"],
]);

export const SCAN_ROOTS = ["apps/web/lib", "apps/web/app", "packages"];

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".mjs", ".js", ".cjs"];
const SKIPPED_DIRS = new Set([
  "node_modules", ".next", "__snapshots__", "dist", "coverage",
  "generated", "__tests__", "__fixtures__", "fixtures", ".turbo",
]);

export function isExcludedFile(name) {
  if (name.endsWith(".d.ts")) return true;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name)) return true;
  return !SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

const SELF_FIX_VALUE = /selfFixClass\s*[:=]\s*(?:["'](?:needs-human|needs-external-capability)["']|SELF_FIX_CLASS\.)/;
const STALL_TYPE = /["']build-stall-escalation["']/;
const REPORT_WRITE = /\bcreatePlatformIssueReport\s*\(/;
const NOTIFY = /\bnotifyAttentionLive(?:OrThrow)?\s*\(/;
const ESCALATION_SOURCE = /source\s*:\s*["']escalation["']/;

function codeLines(body) {
  return body.split(/\r?\n/).map((text, i) => ({ line: i + 1, text })).filter(({ text }) => {
    const t = text.trim();
    return !(t.startsWith("*") || t.startsWith("//") || t.startsWith("/*"));
  });
}

/** Return every violation in one file's source text. */
export function findViolations(body) {
  const lines = codeLines(body);
  const code = lines.map((l) => l.text).join("\n");
  const hits = [];
  for (const { line, text } of lines) {
    if (SELF_FIX_VALUE.test(text)) hits.push({ line, rule: "self-fix-class", text: text.trim() });
  }
  if (REPORT_WRITE.test(code)) {
    for (const { line, text } of lines) {
      if (STALL_TYPE.test(text)) hits.push({ line, rule: "owner-report", text: text.trim() });
    }
  }
  if (NOTIFY.test(code)) {
    for (const { line, text } of lines) {
      if (ESCALATION_SOURCE.test(text)) hits.push({ line, rule: "owner-notice", text: text.trim() });
    }
  }
  return hits;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) yield* walk(full);
    else if (s.isFile() && !isExcludedFile(entry)) yield full;
  }
}

export function scanRepo(root = REPO_ROOT) {
  const violations = [];
  for (const scanRoot of SCAN_ROOTS) {
    const dir = join(root, scanRoot);
    if (!existsSync(dir)) continue;
    for (const file of walk(dir)) {
      const rel = relative(root, file).replace(/\\/g, "/");
      if (SANCTIONED.has(rel)) continue;
      let body;
      try { body = readFileSync(file, "utf8"); } catch { continue; }
      for (const v of findViolations(body)) violations.push({ file: rel, ...v });
    }
  }
  return violations;
}

function main() {
  const violations = scanRepo();
  if (violations.length > 0) {
    console.error("");
    console.error("ERROR: BI-5E067004 — work is sent to the owner without passing the escalation gate.");
    console.error("");
    console.error("Every owner hand-off goes through apps/web/lib/govern/authority/route-to-human.ts:");
    console.error("  routeToHuman({ producer, subject, blockingFacts, declarations, report, notice })");
    console.error("It sends damaging cases to a person with their reason, and routes the rest to an agent");
    console.error("or independent review. Declare damage (consequence, threshold, regulation, risk tier,");
    console.error("sensitivity, propose boundary); never set selfFixClass or notify the owner yourself.");
    console.error("");
    for (const v of violations) console.error(`  ${v.file}:${v.line}  [${v.rule}]  ${v.text}`);
    console.error("");
    process.exit(1);
  }
  console.log(`✓ Every owner-attention write goes through the routeToHuman seam (${SANCTIONED.size} sanctioned files).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
