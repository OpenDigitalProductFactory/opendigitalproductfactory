#!/usr/bin/env node
// scripts/check-no-url-pathname-fs.mjs — no filesystem path may be derived from
// `new URL(..., import.meta.url).pathname` (BI-5CC4159D).
//
// THE FAILURE THIS PREVENTS
//
// On Windows, `new URL("./x", import.meta.url).pathname` is "/D:/repo/x". Every
// readFileSync / readdirSync / spawn built on that string fails with ENOENT on
// every Windows host, while CI (Linux) stays green because the same string IS a
// valid POSIX path there. Nothing in the test run points at the real cause: the
// failure reads like a missing file.
//
// It has now recurred three times: the pre-push hook installer never installed
// on Windows (BI-5CBDC146, #4736), workroom-stall.test.ts (2026-09-07), and the
// integration-settings-href test added by #5247, which failed the local-CI gate
// for EVERY branch on this host on 2026-09-08 — one Windows-only test failure
// blocks every PR that host tries to gate. A hand-rolled
// `.pathname.replace(/^\/([A-Za-z]:)/, "$1")` workaround had also spread to
// twenty files, each a private re-derivation of what `fileURLToPath` does
// correctly (percent-decoding included).
//
// THE RULE
//
// Any `import.meta.url).pathname` outside a comment is a finding. Both the raw
// form and the `.replace(...)` workaround match, because the workaround is the
// same defect with a patch on it. The fix is always the same one line:
//
//   import { fileURLToPath } from "node:url";
//   const here = fileURLToPath(new URL("./x", import.meta.url));
//
// Repo-wide by design (not diff-scoped): the fix branch reduced the count to
// zero, so there is no baseline to hide behind. The two allowlisted files
// mention the string only in the comment that explains this trap — a line
// comment is already skipped, and the allowlist is the belt for a block
// comment or a string that quotes it.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { isEntryModule } from "./lib/entry-module.mjs";

/** The shape, raw or with the hand-rolled drive-letter workaround bolted on. */
export const URL_PATHNAME_RE = /import\.meta\.url\s*\)\s*\.pathname\b/;

/** Files allowed to carry the string; each names the trap in prose, never in code. */
export const ALLOWLIST = Object.freeze([
  "scripts/lib/hooks-dir.mjs",
  "scripts/hooks/converge-git-hooks.mjs",
  "scripts/hooks/converge-git-hooks.test.mjs",
  "scripts/check-no-url-pathname-fs.mjs",
  "scripts/check-no-url-pathname-fs.test.mjs",
]);

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", ".next", "build", "coverage", ".turbo",
  "generated", ".pnpm-store",
]);

/**
 * Strip comments so an explanatory mention of the trap is not a finding.
 *
 * Deliberately lexical, not a parser: `//` inside a string literal is the only
 * false strip that matters here, and a string that contains both `//` and
 * `import.meta.url).pathname` on the same line is not a shape this repo has.
 * Line structure is preserved so findings report the real line number.
 */
export function stripComments(source) {
  let out = "";
  let index = 0;
  const text = String(source);
  while (index < text.length) {
    const two = text.slice(index, index + 2);
    if (two === "//") {
      while (index < text.length && text[index] !== "\n") index += 1;
      continue;
    }
    if (two === "/*") {
      const close = text.indexOf("*/", index + 2);
      const end = close === -1 ? text.length : close + 2;
      out += text.slice(index, end).replace(/[^\n]/g, " ");
      index = end;
      continue;
    }
    const char = text[index];
    if (char === '"' || char === "'" || char === "`") {
      // Copy the literal verbatim so a `//` inside it is not read as a comment.
      let cursor = index + 1;
      while (cursor < text.length) {
        if (text[cursor] === "\\") { cursor += 2; continue; }
        if (text[cursor] === char) break;
        if (char !== "`" && text[cursor] === "\n") break;
        cursor += 1;
      }
      const end = Math.min(cursor + 1, text.length);
      out += text.slice(index, end);
      index = end;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

/**
 * The whole rule, as a pure function of one file's source. Exported so the
 * guard's own test can exercise it without a repository.
 */
export function findUrlPathnameUses(source) {
  const findings = [];
  stripComments(source).split("\n").forEach((line, i) => {
    if (URL_PATHNAME_RE.test(line)) {
      findings.push({ line: i + 1, text: line.trim().slice(0, 140) });
    }
  });
  return findings;
}

/** Repo-relative with forward slashes, whichever separator the caller used. */
export function toRepoPath(value) {
  return String(value).split(/[\\/]+/).join("/");
}

export function isAllowlisted(repoRelativePath, allowlist = ALLOWLIST) {
  return allowlist.includes(toRepoPath(repoRelativePath));
}

/** Every source file under `root`, repo-relative with forward slashes. */
export function listSourceFiles(root) {
  const acc = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name));
        continue;
      }
      if (entry.isFile() && SOURCE_FILE.test(entry.name)) {
        acc.push(toRepoPath(relative(root, join(dir, entry.name))));
      }
    }
  };
  walk(root);
  return acc.sort();
}

export function scanRepository(root, { allowlist = ALLOWLIST } = {}) {
  const offenders = [];
  for (const file of listSourceFiles(root)) {
    if (isAllowlisted(file, allowlist)) continue;
    // readdirSync already answered isFile(); a second stat here is the TOCTOU
    // shape CodeQL flags and buys nothing.
    const findings = findUrlPathnameUses(readFileSync(join(root, file), "utf8"));
    if (findings.length) offenders.push({ file, findings });
  }
  return offenders;
}

function main() {
  const root = resolve(process.cwd());
  const offenders = scanRepository(root);
  if (offenders.length === 0) {
    console.log("✓ No filesystem path is derived from `import.meta.url).pathname`.");
    return;
  }
  const total = offenders.reduce((n, o) => n + o.findings.length, 0);
  console.error(
    `✗ ${total} use(s) of \`import.meta.url).pathname\` in ${offenders.length} file(s). ` +
    "On Windows that string is \"/D:/...\" and every filesystem call built on it fails " +
    "while Linux CI stays green (BI-5CC4159D).\n",
  );
  for (const o of offenders) {
    console.error(`  ${o.file}`);
    for (const f of o.findings) console.error(`    L${f.line}  ${f.text}`);
  }
  console.error("\n  Fix: fileURLToPath(new URL(\"./x\", import.meta.url)) from \"node:url\".");
  console.error("  The .replace(/^\\/([A-Za-z]:)/, \"$1\") workaround is the same defect; replace it too.");
  process.exitCode = 1;
}

if (isEntryModule(import.meta.url)) main();
