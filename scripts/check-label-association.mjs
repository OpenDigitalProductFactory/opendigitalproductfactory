#!/usr/bin/env node
// Label association guard.
//
// A <label> is only a label to assistive tech if it is programmatically tied to
// its control — either explicitly via htmlFor, or implicitly by wrapping the
// control. A label that merely sits NEXT to an input renders correctly, screenshots
// correctly, and reads correctly in the DOM inspector, while a screen reader
// announces an unlabelled edit field. Every human check passes; only a
// programmatic one fails.
//
// Found on the add-contact form during a dogfooding pass: five labels
// ("First name *", "Email *", …) rendered as siblings of their inputs with no
// htmlFor, no id and no nesting. The operator sees a labelled form; a screen
// reader user sees five anonymous boxes.
//
// This is a RATCHET, not a mass-rewrite. The portal has ~400 pre-existing orphans
// across ~140 files; forcing them all in one pass would be a blind edit of surfaces
// nobody is testing. It fails a PR that adds a NEW orphan (a new file with one, or
// more in an already-baselined file) and retightens as surfaces are migrated —
// the same discipline as check-style-drift.mjs and check-ux-primitive-adoption.mjs.
//
//   node scripts/check-label-association.mjs            # check (CI)
//   node scripts/check-label-association.mjs --report   # per-file table
//   node scripts/check-label-association.mjs --update   # regenerate the baseline

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = join(REPO_ROOT, "scripts", "label-association-baseline.json");
const ROOTS = ["apps/web/components", "apps/web/app"];
const DEFAULT_BUDGET = Object.freeze({
  owner: "platform-architecture",
  expiry: "2026-11-16",
});

/** Controls a <label> can legitimately be bound to. */
const CONTROL_RE = /<(input|select|textarea)\b/;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!/node_modules|\.next|dist|coverage/.test(p)) walk(p, out);
    } else if (e.name.endsWith(".tsx") && !e.name.endsWith(".test.tsx")) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Count labels in a source file that are bound to no control.
 *
 * A label passes when it carries htmlFor, OR wraps a control, OR is explicitly
 * marked with a trailing `{/* label-association-allow *\/}`-style comment on the
 * opening tag line (for the rare label that names a composite widget rather than a
 * single control, e.g. a radio group heading).
 */
export function countOrphanLabels(src) {
  let orphans = 0;
  const samples = [];
  const re = /<label\b([^>]*)>/g;
  let m;
  while ((m = re.exec(src))) {
    const attrs = m[1];
    if (/htmlFor=/.test(attrs)) continue;
    if (/aria-hidden/.test(attrs)) continue;

    // An `id`-less label naming a composite widget can opt out deliberately.
    const lineStart = src.lastIndexOf("\n", m.index) + 1;
    const lineEnd = src.indexOf("\n", m.index);
    const line = src.slice(lineStart, lineEnd === -1 ? src.length : lineEnd);
    if (line.includes("label-association-allow")) continue;

    const close = src.indexOf("</label>", re.lastIndex);
    const inner = close === -1 ? "" : src.slice(re.lastIndex, close);
    if (CONTROL_RE.test(inner)) continue; // implicit association by wrapping

    orphans += 1;
    if (samples.length < 3) samples.push(inner.replace(/\s+/g, " ").trim().slice(0, 48));
  }
  return { orphans, samples };
}

function scan() {
  const counts = {};
  const samples = {};
  for (const root of ROOTS) {
    for (const file of walk(join(REPO_ROOT, root))) {
      let src;
      try {
        if (!statSync(file).isFile()) continue;
        src = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      if (!src.includes("<label")) continue;
      const { orphans, samples: s } = countOrphanLabels(src);
      if (orphans > 0) {
        const rel = relative(REPO_ROOT, file).split("\\").join("/");
        counts[rel] = orphans;
        samples[rel] = s;
      }
    }
  }
  return { counts, samples };
}

function readBaseline() {
  try {
    const parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    return { ...DEFAULT_BUDGET, ...parsed, files: parsed.files ?? {} };
  } catch {
    return { ...DEFAULT_BUDGET, version: 1, files: {} };
  }
}

function writeBaseline(counts) {
  const prev = readBaseline();
  const body = {
    version: 1,
    owner: prev.owner ?? DEFAULT_BUDGET.owner,
    expiry: prev.expiry ?? DEFAULT_BUDGET.expiry,
    note:
      "Label-association ratchet baseline. A <label> must be bound to its control by " +
      "htmlFor or by wrapping it; a label that merely sits next to an input is invisible " +
      "to assistive tech. Shrink-only: associate a surface's labels, then --update " +
      "retightens. Regenerate with: node scripts/check-label-association.mjs --update",
    files: Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))),
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(body, null, 2)}\n`);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(
    `Wrote label-association baseline: ${total} orphan label(s) across ${Object.keys(counts).length} file(s).`,
  );
}

const args = process.argv.slice(2);
const { counts, samples } = scan();
const total = Object.values(counts).reduce((a, b) => a + b, 0);

if (args.includes("--update")) {
  writeBaseline(counts);
  process.exit(0);
}

if (args.includes("--report")) {
  const rows = Object.entries(counts).sort(([, a], [, b]) => b - a);
  for (const [file, n] of rows) {
    console.log(`${String(n).padStart(4)}  ${file}  e.g. ${JSON.stringify(samples[file]?.[0] ?? "")}`);
  }
  console.log(`\n${total} orphan label(s) across ${rows.length} file(s).`);
  process.exit(0);
}

const baseline = readBaseline();
const budget = baseline.files ?? {};
const added = [];
const shrunk = [];

for (const [file, n] of Object.entries(counts)) {
  const allowed = budget[file] ?? 0;
  if (n > allowed) added.push({ file, n, allowed });
}
for (const [file, allowed] of Object.entries(budget)) {
  const n = counts[file] ?? 0;
  if (n < allowed) shrunk.push({ file, n, allowed });
}

if (added.length > 0) {
  console.error("Label-association ratchet failed.\n");
  console.error(
    "A <label> must be bound to its control — htmlFor={id} on the label with a matching\n" +
      "id on the input, or wrap the control inside the label. A label that only sits next\n" +
      "to an input renders and screenshots correctly while a screen reader announces an\n" +
      "unlabelled field.\n",
  );
  for (const { file, n, allowed } of added) {
    const s = samples[file]?.[0];
    console.error(`  - ${file} (${n} orphan${n === 1 ? "" : "s"}, baseline ${allowed})${s ? ` e.g. ${JSON.stringify(s)}` : ""}`);
  }
  console.error(
    "\nIf a label genuinely names a composite widget rather than one control, mark it\n" +
      "with a `label-association-allow` comment on the same line and say why.",
  );
  process.exit(1);
}

if (shrunk.length > 0) {
  console.log(`Label-association debt shrank in ${shrunk.length} file(s) — retighten with --update:`);
  for (const { file, n, allowed } of shrunk.slice(0, 10)) {
    console.log(`  - ${file} (${allowed} -> ${n})`);
  }
}

console.log(
  `Label association OK — ${total} orphan label(s) across ${Object.keys(counts).length} file(s) ` +
    `(budgeted), owner ${baseline.owner}, review by ${baseline.expiry}.`,
);
