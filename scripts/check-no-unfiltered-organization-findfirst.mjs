#!/usr/bin/env node
/**
 * BI-EE2F38D5: ratchet on unfiltered `organization.findFirst` calls.
 *
 * The ratified kernel rule install-is-the-tenant (W18, DI-2DEB0D9B417F) says a
 * new unfiltered `organization.findFirst()` is a defect. It hardcodes the
 * single-organization assumption where nobody can see it, and silently picks
 * an arbitrary row if a second organization ever exists. Ask for the install's
 * organization by name instead:
 *
 *   import { getInstallOrganization, findInstallOrganization } from "@dpf/db";
 *
 * This guard flags every `.organization.findFirst(` call whose arguments carry
 * no `where`, in apps/ and packages/ TypeScript (tests excluded), beyond the
 * per-file counts in the budgeted baseline. The baseline only shrinks: a file
 * whose count fell must be recorded with --update in the same change
 * (BI-40F7C033 burns it down).
 *
 *   node scripts/check-no-unfiltered-organization-findfirst.mjs           # check
 *   node scripts/check-no-unfiltered-organization-findfirst.mjs --update  # record shrinkage
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const BASELINE_PATH = "scripts/unfiltered-organization-findfirst-baseline.json";
const ROOTS = ["apps", "packages"];
const SKIP_DIRS = new Set(["node_modules", "generated", ".next", "dist", "build", "coverage", "fixtures", "__fixtures__"]);
const CALL = /\.organization\s*\.\s*findFirst\s*\(/g;

function isTestFile(path) {
  return /\.(test|spec)\.tsx?$/.test(path) || path.includes("/__tests__/") || path.endsWith(".test-fixtures.ts");
}

/** The argument text of the call whose "(" is at openIndex, up to its matching ")". */
function argumentText(body, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < body.length; i++) {
    const ch = body[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return body.slice(openIndex + 1, i);
    }
  }
  return body.slice(openIndex + 1);
}

/** 1-based line numbers of unfiltered organization.findFirst calls in `body`. */
export function findUnfilteredCalls(body) {
  const hits = [];
  for (const match of body.matchAll(CALL)) {
    const lineStart = body.lastIndexOf("\n", match.index) + 1;
    const lineText = body.slice(lineStart, body.indexOf("\n", match.index) === -1 ? undefined : body.indexOf("\n", match.index));
    const trimmed = lineText.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    const args = argumentText(body, match.index + match[0].length - 1);
    if (/\bwhere\s*:/.test(args)) continue;
    hits.push({ line: body.slice(0, match.index).split("\n").length, text: trimmed });
  }
  return hits;
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) yield* walk(full);
    else if (s.isFile() && /\.tsx?$/.test(entry) && !entry.endsWith(".d.ts")) yield full;
  }
}

/** Per-file counts of unfiltered calls under apps/ and packages/. */
export function scanCounts(root = REPO_ROOT) {
  const counts = {};
  for (const top of ROOTS) {
    for (const file of walk(join(root, top))) {
      const rel = relative(root, file).replace(/\\/g, "/");
      if (isTestFile(rel)) continue;
      const hits = findUnfilteredCalls(readFileSync(file, "utf8"));
      if (hits.length) counts[rel] = hits.length;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

/** Compare observed counts with the baseline. */
export function compareToBaseline(observed, baselineFiles) {
  const grown = [];
  const shrunk = [];
  for (const [file, count] of Object.entries(observed)) {
    const allowed = baselineFiles[file] ?? 0;
    if (count > allowed) grown.push({ file, count, allowed });
  }
  for (const [file, allowed] of Object.entries(baselineFiles)) {
    const count = observed[file] ?? 0;
    if (count < allowed) shrunk.push({ file, count, allowed });
  }
  return { grown, shrunk };
}

function readBaseline(root) {
  return JSON.parse(readFileSync(join(root, BASELINE_PATH), "utf8"));
}

function main() {
  const update = process.argv.includes("--update");
  const baseline = readBaseline(REPO_ROOT);
  const observed = scanCounts();
  const { grown, shrunk } = compareToBaseline(observed, baseline.files ?? {});

  if (grown.length) {
    console.error("\nERROR: new unfiltered organization.findFirst call(s).\n");
    console.error("The install is the tenant (kernel principle install-is-the-tenant). Ask for the organization by name:");
    console.error('  import { getInstallOrganization, findInstallOrganization } from "@dpf/db";\n');
    for (const g of grown) {
      console.error(`  ${g.file}: ${g.count} unfiltered (baseline ${g.allowed})`);
      for (const h of findUnfilteredCalls(readFileSync(join(REPO_ROOT, g.file), "utf8"))) console.error(`    :${h.line}  ${h.text}`);
    }
    console.error("");
    process.exit(1);
  }
  if (shrunk.length && !update) {
    console.error(`\nERROR: ${shrunk.length} file(s) now have fewer unfiltered calls than ${BASELINE_PATH} allows.`);
    console.error("Record the shrinkage in this change: node scripts/check-no-unfiltered-organization-findfirst.mjs --update\n");
    for (const s of shrunk) console.error(`  ${s.file}: ${s.count} (baseline ${s.allowed})`);
    console.error("");
    process.exit(1);
  }
  if (update) {
    const next = { ...baseline, files: observed };
    writeFileSync(join(REPO_ROOT, BASELINE_PATH), `${JSON.stringify(next, null, 2)}\n`);
    console.log(`Recorded ${Object.values(observed).reduce((a, b) => a + b, 0)} unfiltered call(s) in ${Object.keys(observed).length} file(s).`);
    return;
  }
  const total = Object.values(observed).reduce((a, b) => a + b, 0);
  console.log(`✓ No new unfiltered organization.findFirst calls (${total} in the shrinking baseline).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
