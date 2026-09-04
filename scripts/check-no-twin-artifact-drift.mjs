#!/usr/bin/env node
// Twin-artifact set-parity ratchet — BI-788EC51A (late-defect-detection M3).
//
// Catches "half the chain" drift: the same change landing in one twin artifact
// but not its counterpart. Two incident classes drove this guard:
//
//   (a) PR #4371 — dpf-postgres was added to the release image BUILD matrix in
//       .github/workflows/publish-image.yml but not to the MERGE/publish
//       matrix, so every arch digest was built and the named tag never
//       existed. Rule 1 compares every `image:` matrix list in a workflow
//       file; the sets must be identical across jobs.
//
//   (b) BI-68EED40A — a fix applied to a scripts/**/*.sh installer script
//       whose same-basename .ps1 twin was missed. Rule 2a requires twin
//       EXISTENCE in directories where twins are the norm (baseline-exempted,
//       shrink-only); Rule 2b requires `# twin-contract: <key>` marker-key
//       parity between any existing sh/ps1 twin pair.
//
// Rules:
//   1. IMAGE-MATRIX SET PARITY. For each .github/workflows/*.y*ml file,
//      extract every block of the form
//          image:
//            - <name>            (scalar list — merge/promote style)
//        or
//          image:
//            - name: <name>      (object list — build style; only the `name`
//              ...                key of each object is read)
//      A block only counts if the `image:` key is followed by a MORE-INDENTED
//      `- ` list (a scalar `image: pgvector/...` service-container line is
//      ignored). If a file contains two or more such blocks, their name sets
//      must be identical; any name present in one block and absent from
//      another is a violation naming the file and both jobs/blocks.
//   2a. TWIN EXISTENCE. Under TWIN_NORM_DIRS (directories where the sh/ps1
//       twin convention is the norm), every non-test .sh must have a
//       same-basename .ps1 sibling and vice versa, unless the file is listed
//       in scripts/twin-artifact-baseline.txt. The baseline is shrink-only:
//       a duplicate entry fails closed, and an entry whose file is gone or
//       has since gained its twin is stale and must be removed.
//   2b. TWIN-CONTRACT MARKER PARITY. For every same-directory same-basename
//       .sh/.ps1 pair anywhere under scripts/, lines matching
//           # twin-contract: <key>
//       must yield identical key sets in both twins. Zero markers exist
//       today; the mechanism activates as markers are adopted — annotate a
//       shared guarded behavior in one twin and the guard forces the
//       annotation (i.e. the behavior) into the other.
//
// What this guard does NOT cover (declared undercount, honest by design):
//   - Semantic parity of twin scripts. Only marker key SETS and file
//     existence are compared — a behavioral fix that carries no
//     `twin-contract` marker in either twin is invisible to Rule 2b.
//   - Matrix lists keyed by anything other than `image:` (e.g. `platform:`),
//     and matrices split across multiple workflow FILES.
//   - Parity between workflow matrices and compose files / release manifests
//     (scripts/release/verify-compose-image-manifests.mjs owns that edge).
//   - sh/ps1 twins living outside scripts/, and twin conventions other than
//     sh/ps1 (e.g. bash vs .cmd).
//
// Exit codes: 0 clean, 1 violation (details on stderr), 2 config/baseline
// error (fail closed).
//
//   node scripts/check-no-twin-artifact-drift.mjs

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPTS_DIR, "..");
const WORKFLOWS_DIR = join(REPO_ROOT, ".github", "workflows");
export const BASELINE_PATH = join(SCRIPTS_DIR, "twin-artifact-baseline.txt");

// Directories (repo-relative, forward slashes) where the sh/ps1 twin
// convention is the norm — a single-sided script here is presumed drift.
export const TWIN_NORM_DIRS = ["scripts/hooks", "scripts/installer", "scripts/safety"];

// Test artifacts are legitimately platform-specific (node:test drives the .sh
// side, Pester the .ps1 side) — never twin-checked.
const TEST_FILE_PATTERN = /(\.test\.sh|\.Tests\.ps1|\.test\.ps1)$/i;

// ─── Rule 1: image-matrix set parity ─────────────────────────────────────

// Extraction contract: line-oriented YAML scan, no YAML library (node stdlib
// only, and the shapes we read are the two GitHub Actions matrix idioms shown
// in the header). A block = an `image:` key with an empty value followed by a
// more-indented `- ` list. Entries are either bare scalars (`- dpf-portal`)
// or objects whose FIRST line is `- name: dpf-portal`; continuation keys of
// an object entry (context/file/target…) are skipped. Comment and blank
// lines inside the list are skipped. The block ends at the first non-blank,
// non-comment line indented at or left of the `image:` key.
export function extractImageMatrixBlocks(yamlText) {
  const lines = yamlText.split(/\r?\n/);
  const blocks = [];
  let currentJob = "(top-level)";
  for (let i = 0; i < lines.length; i++) {
    const jobMatch = lines[i].match(/^ {2}([A-Za-z0-9_-]+):\s*(#.*)?$/);
    if (jobMatch) currentJob = jobMatch[1];

    const keyMatch = lines[i].match(/^(\s*)image:\s*(#.*)?$/);
    if (!keyMatch) continue;
    const keyIndent = keyMatch[1].length;
    const images = [];
    let j = i + 1;
    let itemIndent = null;
    for (; j < lines.length; j++) {
      const line = lines[j];
      if (/^\s*(#.*)?$/.test(line)) continue; // blank or comment
      const indent = line.match(/^(\s*)/)[1].length;
      if (indent <= keyIndent) break; // block over
      const item = line.match(/^(\s*)- (.*)$/);
      if (item) {
        const thisIndent = item[1].length;
        if (itemIndent === null) itemIndent = thisIndent;
        if (thisIndent !== itemIndent) break; // nested list — not ours
        const body = item[2].trim();
        const named = body.match(/^name:\s*(\S+)/);
        images.push(named ? named[1] : body.replace(/\s+#.*$/, ""));
      }
      // non-dash lines deeper than keyIndent are object continuations — skip
    }
    if (images.length > 0) blocks.push({ job: currentJob, line: i + 1, images });
  }
  return blocks;
}

// Pairwise set comparison across all blocks of one file: any name present in
// one block and absent from another is a violation. Symmetric, so it catches
// build-but-not-merge AND merge-but-not-build.
export function compareImageSets(file, blocks) {
  const violations = [];
  for (let a = 0; a < blocks.length; a++) {
    for (let b = a + 1; b < blocks.length; b++) {
      const setA = new Set(blocks[a].images);
      const setB = new Set(blocks[b].images);
      for (const name of setA) {
        if (!setB.has(name)) {
          violations.push(
            `${file}: image "${name}" is in the "${blocks[a].job}" matrix (line ${blocks[a].line}) but NOT in the "${blocks[b].job}" matrix (line ${blocks[b].line})`,
          );
        }
      }
      for (const name of setB) {
        if (!setA.has(name)) {
          violations.push(
            `${file}: image "${name}" is in the "${blocks[b].job}" matrix (line ${blocks[b].line}) but NOT in the "${blocks[a].job}" matrix (line ${blocks[a].line})`,
          );
        }
      }
    }
  }
  return violations;
}

// ─── Rule 2: sh/ps1 twins ────────────────────────────────────────────────

// Baseline parser — fail closed on duplicate paths (same idiom as
// scripts/check-module-size.mjs): a duplicated entry usually means a bad
// union-merge, and silently deduping would hide it.
export function parseBaseline(text) {
  const entries = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (entries.has(line)) {
      throw new Error(`duplicate baseline entry: ${line} (fix scripts/twin-artifact-baseline.txt — likely a bad merge)`);
    }
    entries.add(line);
  }
  return entries;
}

// files: repo-relative forward-slash paths of every .sh/.ps1 under scripts/.
export function findTwinViolations(files, baseline, readContent) {
  const violations = [];
  const staleBaseline = [];
  const fileSet = new Set(files);
  const usedBaseline = new Set();

  const twinOf = (f) =>
    f.endsWith(".sh") ? f.slice(0, -3) + ".ps1" : f.slice(0, -4) + ".sh";

  // Rule 2a — twin existence in norm dirs.
  for (const f of files) {
    if (TEST_FILE_PATTERN.test(f)) continue;
    if (!TWIN_NORM_DIRS.some((d) => f.startsWith(d + "/"))) continue;
    if (fileSet.has(twinOf(f))) continue;
    if (baseline.has(f)) {
      usedBaseline.add(f);
      continue;
    }
    violations.push(
      `${f}: missing ${f.endsWith(".sh") ? ".ps1" : ".sh"} twin (${twinOf(f)}) in a twin-norm directory. Add the twin, or — only if the file is genuinely single-platform — add it to scripts/twin-artifact-baseline.txt with a reason comment.`,
    );
  }

  // Shrink-only baseline: entries whose file is gone or no longer single-sided
  // (or that never matched anything) are stale and must be removed.
  for (const entry of baseline) {
    if (!usedBaseline.has(entry)) staleBaseline.push(entry);
  }

  // Rule 2b — twin-contract marker parity on every existing pair.
  const markerPattern = /(?:^|\s)#\s*twin-contract:\s*(\S+)/gm;
  const keysOf = (path) => {
    const keys = new Set();
    const text = readContent(path);
    for (const m of text.matchAll(markerPattern)) keys.add(m[1]);
    return keys;
  };
  for (const f of files) {
    if (!f.endsWith(".sh") || TEST_FILE_PATTERN.test(f)) continue;
    const twin = twinOf(f);
    if (!fileSet.has(twin)) continue;
    const shKeys = keysOf(f);
    const psKeys = keysOf(twin);
    for (const k of shKeys) {
      if (!psKeys.has(k)) {
        violations.push(`${twin}: missing twin-contract marker "${k}" declared in ${f} — port the guarded behavior and its marker.`);
      }
    }
    for (const k of psKeys) {
      if (!shKeys.has(k)) {
        violations.push(`${f}: missing twin-contract marker "${k}" declared in ${twin} — port the guarded behavior and its marker.`);
      }
    }
  }

  return { violations, staleBaseline };
}

// ─── Discovery + main ────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(sh|ps1)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

function main() {
  const violations = [];

  // Rule 1 across every workflow file.
  if (existsSync(WORKFLOWS_DIR)) {
    for (const name of readdirSync(WORKFLOWS_DIR)) {
      if (!/\.ya?ml$/i.test(name)) continue;
      const rel = `.github/workflows/${name}`;
      const blocks = extractImageMatrixBlocks(readFileSync(join(WORKFLOWS_DIR, name), "utf8"));
      violations.push(...compareImageSets(rel, blocks));
    }
  }

  // Rule 2 across scripts/.
  let baseline;
  try {
    baseline = existsSync(BASELINE_PATH) ? parseBaseline(readFileSync(BASELINE_PATH, "utf8")) : new Set();
  } catch (err) {
    console.error(`ERROR: BI-788EC51A — ${err.message}`);
    process.exit(2);
  }
  const scriptFiles = walk(SCRIPTS_DIR)
    .map((f) => relative(REPO_ROOT, f).split(sep).join("/"))
    .sort();
  const { violations: twinViolations, staleBaseline } = findTwinViolations(
    scriptFiles,
    baseline,
    (rel) => readFileSync(join(REPO_ROOT, rel), "utf8"),
  );
  violations.push(...twinViolations);

  if (violations.length > 0) {
    console.error("");
    console.error("ERROR: BI-788EC51A — twin-artifact set-parity drift detected.");
    console.error("The same change must land in BOTH halves of a twinned artifact");
    console.error("(build vs merge image matrix; .sh vs .ps1 script).");
    console.error("");
    for (const v of violations) console.error(`  ${v}`);
    console.error("");
    process.exit(1);
  }

  if (staleBaseline.length > 0) {
    console.error("");
    console.error("ERROR: BI-788EC51A — twin-artifact baseline is stale (shrink-only).");
    console.error("These entries no longer name a single-sided file (removed, or twin added);");
    console.error("delete them from scripts/twin-artifact-baseline.txt:");
    for (const f of staleBaseline) console.error(`  ${f}`);
    console.error("");
    process.exit(1);
  }

  console.log("✓ Twin-artifact parity: image matrices agree; no single-sided or marker-drifted sh/ps1 twins.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
