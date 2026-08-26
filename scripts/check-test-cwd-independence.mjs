#!/usr/bin/env node
/**
 * BI-96033E25 — CI ratchet: a vitest test must not resolve a repo path from
 * process.cwd().
 *
 * THE DEFECT THIS FREEZES. `packages/db/src/skill-quality-audit.test.ts` computed
 * its repo root as `join(process.cwd(), "..", "..")`. That is only correct when
 * vitest is invoked with cwd = the package directory. `vitest run --root
 * <repo>/packages/db` is a documented, commonly-used invocation — it is how a
 * worktree-based session runs one package's tests — and it leaves process.cwd()
 * at the REPO ROOT, so the computed root landed OUTSIDE the repository:
 *
 *   ENOENT: no such file or directory, open '<outside-repo>/skills/build/start-feature.skill.md'
 *
 * That reads as a missing skill file, not as a broken test harness. The
 * misdiagnosis cost real time during BI-8AD9D018. The class is silent by
 * construction: CI happens to invoke from the package directory, so it stays
 * green while the contributor is the only one who sees it fail.
 *
 * THE RULE. Resolve from the test file's own location (`__dirname`), which is
 * invocation-independent, not from the process working directory:
 *
 *   const rootDir = join(__dirname, "..", "..", "..");   // correct
 *   const rootDir = join(process.cwd(), "..", "..");     // flagged
 *
 * SCOPE — every pnpm workspace root that runs vitest: apps/, packages/ and
 * services/ (adp, edge-node, integration-test-harness). services/ was missed on
 * the first cut, which left a third of the vitest surface unratcheted: it was
 * clean at the time, so nothing failed and the omission was invisible.
 *
 * `scripts/*.test.ts` is EXCLUDED with the same reasoning as the .mjs CLIs
 * below — those run through `tsx --test` from package.json at the repo root, not
 * through vitest, and have no --root-style invocation that moves their cwd.
 * `scripts/**\/*.test.mjs` is EXCLUDED on purpose: those are repo-root CLIs whose
 * cwd-dependence is by design (`export function scanRepo(root = process.cwd())`),
 * they are invoked only as `node --test scripts/…` from package.json with no
 * `working-directory` override anywhere in CI, and there is no supported
 * invocation that moves their cwd. Measured 2026-08-23: 31 of them do fail when
 * run from a foreign cwd, but that invocation is not supported and not reachable
 * through any CI or package.json path — latent, not live. Widening this guard to
 * cover them would force churn in working code against a hypothetical caller.
 *
 * Run: node scripts/check-test-cwd-independence.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

export const SCAN_ROOTS = ["apps", "packages", "services"];
export const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|mts|js|jsx)$/;

/**
 * Files that legitimately mention process.cwd() as ONE candidate among several
 * and verify the result before using it — cwd-independent by construction.
 * Do NOT add entries to silence a real violation; fix the resolution instead.
 */
export const ALLOWLIST = new Set([
  // Probes DPF_REPO_ROOT, then cwd, then cwd/../.., and accepts the first whose
  // skills/product-management directory actually exists. Correct from any cwd.
  "apps/web/lib/product-management/product-management-playbook-seed.test.ts",
]);

// cwd used as the BASE of a path — the defect. Tolerates newlines, because the
// original offenders wrapped the argument list across lines.
const CWD_AS_PATH_BASE = /\b(?:join|resolve)\s*\(\s*process\.cwd\(\)/;

// A bare repo-relative literal handed to fs — Node resolves it against cwd
// implicitly, which is the same defect with no process.cwd() token to grep for.
const BARE_REPO_RELATIVE_READ =
  /\b(?:readFileSync|readdirSync|existsSync|statSync|createReadStream|openSync)\s*\(\s*["'`](?:apps|packages|scripts|docs|prisma|tests|\.github)\//;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (TEST_FILE_RE.test(entry)) out.push(full);
  }
  return out;
}

/** @returns {{file: string, line: number, text: string, rule: string}[]} */
export function scanRepo(root = process.cwd()) {
  const violations = [];
  for (const scanRoot of SCAN_ROOTS) {
    for (const file of walk(join(root, scanRoot))) {
      const rel = relative(root, file).split("\\").join("/");
      if (ALLOWLIST.has(rel)) continue;
      const source = readFileSync(file, "utf8");
      if (!CWD_AS_PATH_BASE.test(source) && !BARE_REPO_RELATIVE_READ.test(source)) {
        continue;
      }
      // Report precise lines. Re-join a small window so a wrapped call still
      // reports the line the call STARTS on rather than the line cwd sits on.
      const lines = source.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        const window = lines.slice(i, i + 4).join("\n");
        const startsHere =
          (CWD_AS_PATH_BASE.test(window) && /\b(?:join|resolve)\s*\($/.test(lines[i].trimEnd())) ||
          CWD_AS_PATH_BASE.test(lines[i]) ||
          BARE_REPO_RELATIVE_READ.test(lines[i]);
        if (!startsHere) continue;
        violations.push({
          file: rel,
          line: i + 1,
          text: lines[i].trim(),
          rule: BARE_REPO_RELATIVE_READ.test(lines[i])
            ? "bare-repo-relative-read"
            : "cwd-as-path-base",
        });
      }
    }
  }
  return violations;
}

/** Allowlist entries whose file no longer exists or no longer needs the entry. */
export function findStaleAllowlist(root = process.cwd()) {
  const stale = [];
  for (const rel of ALLOWLIST) {
    let source;
    try {
      source = readFileSync(join(root, rel), "utf8");
    } catch {
      stale.push(`${rel} (file no longer exists)`);
      continue;
    }
    if (!CWD_AS_PATH_BASE.test(source) && !BARE_REPO_RELATIVE_READ.test(source)) {
      stale.push(`${rel} (no longer resolves from cwd)`);
    }
  }
  return stale;
}

function main() {
  const violations = scanRepo();
  const stale = findStaleAllowlist();

  if (violations.length > 0) {
    console.error("");
    console.error("ERROR: BI-96033E25 — a vitest test resolves a repo path from process.cwd().");
    console.error("");
    console.error("This passes when vitest runs with cwd = the package directory and FAILS with a");
    console.error("misleading ENOENT when it runs as `vitest run --root <repo>/<package>`, which");
    console.error("points outside the repository. Resolve from the test file instead:");
    console.error("");
    console.error('  const rootDir = join(__dirname, "..", "..", "..");');
    console.error("");
    console.error("Offending lines:");
    for (const v of violations) console.error(`  ${v.file}:${v.line}  [${v.rule}]  ${v.text}`);
    console.error("");
    process.exit(1);
  }

  if (stale.length > 0) {
    console.error("");
    console.error("ERROR: BI-96033E25 — the cwd-independence allowlist is stale.");
    console.error("Delete these from ALLOWLIST in scripts/check-test-cwd-independence.mjs:");
    for (const f of stale) console.error(`  ${f}`);
    console.error("");
    process.exit(1);
  }

  console.log(
    `✓ No vitest test resolves a repo path from process.cwd() (${ALLOWLIST.size} verified-safe exception).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
