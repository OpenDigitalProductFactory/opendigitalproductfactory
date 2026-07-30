// Tests for the instruction-plane size ratchet (BI-0020D511, Phase 0).
// Uses the node:test runner (run via `node --test`) to match the other guard
// tests (e.g. check-n-minus-one-caller-honesty.test.mjs) — no vitest dependency
// in the guard CI job. Proves the ratchet actually blocks growth and a silent
// second forced-read file, not merely that the happy path prints OK.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluate,
  parseBaseline,
  serializeBaseline,
  pointerReferences,
  sectionSizes,
  byteLen,
  frontmatterFields,
  extractGroup,
} from "./check-instruction-plane-size.mjs";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const MANIFEST = {
  pointerFile: "CLAUDE.md",
  alwaysOn: ["CLAUDE.md", "AGENTS.md"],
  perSectionCharBudget: 6000,
  maxLineChars: 800,
  structuralStrict: false,
};

const CLAUDE_OK = "# Pointer\n\nRead [/AGENTS.md](AGENTS.md) before any work.\n";

test("byteLen counts UTF-8 bytes like wc -c", () => {
  assert.equal(byteLen("abc"), 3);
  assert.equal(byteLen("é"), 2);
  assert.equal(byteLen("—"), 3);
});

test("parseBaseline resolves union-merge duplicates to the max; round-trips", () => {
  const b = parseBaseline("AGENTS.md\t100\nAGENTS.md\t250\nCLAUDE.md\t10\n");
  assert.equal(b["AGENTS.md"], 250);
  assert.equal(b["CLAUDE.md"], 10);
  assert.equal(serializeBaseline(b), "AGENTS.md\t250\nCLAUDE.md\t10\n");
});

test("parseBaseline ignores comments and blanks", () => {
  assert.deepEqual(parseBaseline("# note\n\nX.md\t5\n"), { "X.md": 5 });
});

test("pointerReferences extracts link targets and bare /paths, strips slash", () => {
  assert.deepEqual(pointerReferences("Read [/AGENTS.md](AGENTS.md) now").sort(), ["AGENTS.md"]);
});

test("pointerReferences ignores external URLs", () => {
  assert.deepEqual(pointerReferences("see [x](https://e.com/y.md)"), []);
});

test("pointerReferences catches a second forced-read file", () => {
  assert.deepEqual(
    pointerReferences("Read [/AGENTS.md](AGENTS.md) and /doctrine-extras.md").sort(),
    ["AGENTS.md", "doctrine-extras.md"],
  );
});

test("evaluate passes when files are at or below baseline", () => {
  const { errors } = evaluate({
    manifest: MANIFEST,
    fileTexts: { "CLAUDE.md": CLAUDE_OK, "AGENTS.md": "x".repeat(500) },
    baseline: { "CLAUDE.md": byteLen(CLAUDE_OK), "AGENTS.md": 500 },
    strict: false,
  });
  assert.deepEqual(errors, []);
});

test("evaluate FAILS when a baselined always-on file grows", () => {
  const { errors } = evaluate({
    manifest: MANIFEST,
    fileTexts: { "CLAUDE.md": CLAUDE_OK, "AGENTS.md": "x".repeat(600) },
    baseline: { "CLAUDE.md": byteLen(CLAUDE_OK), "AGENTS.md": 500 },
    strict: false,
  });
  assert.ok(errors.some((e) => e.includes("AGENTS.md grew 500 -> 600")));
});

test("evaluate FAILS a manifest file with no baseline entry", () => {
  const { errors } = evaluate({
    manifest: MANIFEST,
    fileTexts: { "CLAUDE.md": CLAUDE_OK, "AGENTS.md": "x" },
    baseline: { "CLAUDE.md": byteLen(CLAUDE_OK) },
    strict: false,
  });
  assert.ok(errors.some((e) => e.includes("AGENTS.md is in the manifest but missing")));
});

test("evaluate FAILS closure when the pointer forces a file not in alwaysOn", () => {
  const { errors } = evaluate({
    manifest: MANIFEST,
    fileTexts: {
      "CLAUDE.md": "Read [/AGENTS.md](AGENTS.md) and /doctrine-extras.md before any work.",
      "AGENTS.md": "x".repeat(500),
    },
    baseline: { "CLAUDE.md": 100000, "AGENTS.md": 500 },
    strict: false,
  });
  assert.ok(errors.some((e) => e.includes("doctrine-extras.md") && e.includes("NOT in")));
});

test("structural signal is advisory by default, hard under strict", () => {
  const bigSection = "## Huge\n" + "y".repeat(7000) + "\n";
  const fileTexts = { "CLAUDE.md": CLAUDE_OK, "AGENTS.md": bigSection };
  const baseline = { "CLAUDE.md": byteLen(CLAUDE_OK), "AGENTS.md": byteLen(bigSection) };
  const advisory = evaluate({ manifest: MANIFEST, fileTexts, baseline, strict: false });
  assert.deepEqual(advisory.errors, []);
  assert.ok(advisory.warnings.some((w) => w.includes("Huge")));
  const strict = evaluate({ manifest: MANIFEST, fileTexts, baseline, strict: true });
  assert.ok(strict.errors.some((e) => e.includes("Huge")));
});

test("sectionSizes splits on ## / ### headers and sums bytes", () => {
  const s = sectionSizes("## A\nline\n### B\nmore\n");
  assert.deepEqual(s.map((x) => x.header), ["A", "B"]);
  assert.ok(s[0].bytes > 0);
});

// --- harness-injected tier (BI-0020D511 §12) -------------------------------
// The pointer-forced tier cannot see what the HARNESS injects. Claude Code and
// Codex load every skill's frontmatter name+description into every session, so
// prose relocated from AGENTS.md into a skill description is still always-on.
// These prove the ratchet counts that tier and blocks exactly that relocation.

test("frontmatterFields reads only requested top-level scalars, incl. continuations", () => {
  const doc = [
    "---",
    "name: dpf-thing",
    'description: "Use when X.',
    '  Continues here."',
    "category: build",
    "---",
    "",
    "# Body that must NOT be measured",
  ].join("\n");
  const f = frontmatterFields(doc, ["name", "description"]);
  assert.equal(f.name, "dpf-thing");
  assert.ok(f.description.includes("Continues here"));
  assert.equal(f.category, undefined, "unrequested fields are not billed");
});

test("frontmatterFields returns {} when there is no frontmatter", () => {
  assert.deepEqual(frontmatterFields("# Just a heading\n", ["description"]), {});
});

test("evaluate ratchets an extracted group and blocks growth", () => {
  const base = { "CLAUDE.md": byteLen(CLAUDE_OK), "AGENTS.md": 500 };
  const fileTexts = { "CLAUDE.md": CLAUDE_OK, "AGENTS.md": "x".repeat(500) };
  const group = (bytes) => ({ id: "skills", bytes, items: [] });

  const ok = evaluate({
    manifest: MANIFEST,
    fileTexts,
    baseline: { ...base, "extracted:skills": 900 },
    strict: false,
    extracted: [group(900)],
  });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.currentTotal, 500 + byteLen(CLAUDE_OK) + 900, "extracted bytes join the total");

  const grown = evaluate({
    manifest: MANIFEST,
    fileTexts,
    baseline: { ...base, "extracted:skills": 900 },
    strict: false,
    extracted: [group(1200)],
  });
  assert.ok(
    grown.errors.some((e) => e.includes("extracted:skills") && e.includes("900 -> 1200")),
    "relocating prose into skill descriptions must fail the ratchet",
  );
});

test("evaluate FAILS an extracted group missing from the baseline", () => {
  const { errors } = evaluate({
    manifest: MANIFEST,
    fileTexts: { "CLAUDE.md": CLAUDE_OK, "AGENTS.md": "x".repeat(500) },
    baseline: { "CLAUDE.md": byteLen(CLAUDE_OK), "AGENTS.md": 500 },
    strict: false,
    extracted: [{ id: "skills", bytes: 900, items: [] }],
  });
  assert.ok(errors.some((e) => e.includes("extracted:skills") && e.includes("--update")));
});

test("oversized single description is advisory by default, hard under strict", () => {
  const args = {
    manifest: { ...MANIFEST, maxExtractedItemChars: 700 },
    fileTexts: { "CLAUDE.md": CLAUDE_OK, "AGENTS.md": "x".repeat(500) },
    baseline: { "CLAUDE.md": byteLen(CLAUDE_OK), "AGENTS.md": 500, "extracted:skills": 800 },
    extracted: [
      { id: "skills", bytes: 800, items: [{ file: "a/SKILL.md", bytes: 800, description: "d" }] },
    ],
  };
  const advisory = evaluate({ ...args, strict: false });
  assert.deepEqual(advisory.errors, []);
  assert.ok(advisory.warnings.some((w) => w.includes("a/SKILL.md")));
  assert.ok(evaluate({ ...args, strict: true }).errors.some((e) => e.includes("a/SKILL.md")));
});

test("extractGroup reads real SKILL.md frontmatter and excludes the body", () => {
  const g = extractGroup(
    { id: "dpf", glob: "packages/dpf-skill-pack/skills/*/SKILL.md", fields: ["name", "description"] },
    REPO_ROOT,
  );
  assert.ok(g.items.length > 20, "expected the DPF skill pack to be discovered");
  assert.ok(g.bytes > 0);
  const bodyBytes = g.items.reduce(
    (n, i) => n + byteLen(readFileSync(join(REPO_ROOT, i.file), "utf8")),
    0,
  );
  assert.ok(g.bytes < bodyBytes / 5, "always-on frontmatter must be a small fraction of the bodies");
});
