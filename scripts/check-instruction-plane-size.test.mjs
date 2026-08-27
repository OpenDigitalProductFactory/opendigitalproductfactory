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
  assumptionMarkers,
} from "./check-instruction-plane-size.mjs";

import { globSync, readFileSync } from "node:fs";
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

test("extractedItemStrict makes the per-description budget hard without structuralStrict", () => {
  // BI-58F6755A: the structural signal stays Phase-0 advisory until the AGENTS.md split
  // lands, but skill descriptions are already separate files. Their budget must be
  // enforceable on its own, or the aggregate ratchet alone lets one description balloon
  // while the others shrink to pay for it.
  const args = {
    manifest: { ...MANIFEST, maxExtractedItemChars: 300, structuralStrict: false },
    fileTexts: { "CLAUDE.md": CLAUDE_OK, "AGENTS.md": "x".repeat(500) },
    baseline: { "CLAUDE.md": byteLen(CLAUDE_OK), "AGENTS.md": 500, "extracted:skills": 800 },
    extracted: [
      { id: "skills", bytes: 800, items: [{ file: "a/SKILL.md", bytes: 800, description: "d" }] },
    ],
    strict: false,
  };
  assert.deepEqual(evaluate(args).errors, [], "advisory while the flag is absent");

  const strictManifest = { ...args.manifest, extractedItemStrict: true };
  const enforced = evaluate({ ...args, manifest: strictManifest });
  assert.ok(
    enforced.errors.some((e) => e.includes("a/SKILL.md") && e.includes("> 300")),
    "flag alone must promote the per-item budget to a hard error",
  );
  assert.ok(
    !enforced.warnings.some((w) => w.includes("a/SKILL.md")),
    "a promoted finding must not also be reported as a warning",
  );
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

// --- Hard 1,024-character description limit (Agent Skills API) -------------------
// Every other threshold in this guard is a DPF budget shipped advisory. This one is a
// platform limit — over it the skill fails validation at install — so the tests below
// pin that it errors even in the loosest configuration.

const DESC_ARGS = (descriptionChars, extra = {}) => ({
  manifest: { ...MANIFEST, maxDescriptionChars: 1024, maxExtractedItemChars: 100000, ...extra },
  fileTexts: { "CLAUDE.md": CLAUDE_OK, "AGENTS.md": "x".repeat(500) },
  baseline: { "CLAUDE.md": byteLen(CLAUDE_OK), "AGENTS.md": 500, "extracted:skills": 800 },
  strict: false,
  extracted: [
    {
      id: "skills",
      bytes: 800,
      items: [{ file: "a/SKILL.md", bytes: 800, descriptionChars, description: "d" }],
    },
  ],
});

test("a description over 1024 chars FAILS even when nothing else is strict", () => {
  const { errors } = evaluate(DESC_ARGS(1025));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /1025 characters \(hard limit 1024\)/);
  assert.match(errors[0], /platform limit, not a DPF budget/);
});

test("the 1024-char limit is HARD — structuralStrict:false cannot downgrade it", () => {
  // The oversized-frontmatter signal right above it IS downgradeable; this one must not be.
  const { errors, warnings } = evaluate(DESC_ARGS(2000, { structuralStrict: false }));
  assert.ok(errors.some((e) => e.includes("hard limit 1024")));
  assert.ok(!warnings.some((w) => w.includes("hard limit 1024")));
});

test("exactly 1024 chars passes — the limit is inclusive", () => {
  assert.deepEqual(evaluate(DESC_ARGS(1024)).errors, []);
});

test("a description in the top 10% warns before it fails", () => {
  const { errors, warnings } = evaluate(DESC_ARGS(995));
  assert.deepEqual(errors, [], "97% is a warning, not yet a failure");
  assert.ok(warnings.some((w) => w.includes("995 of 1024") && w.includes("97%")));
});

test("a comfortably short description produces neither", () => {
  const { errors, warnings } = evaluate(DESC_ARGS(300));
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test("descriptionChars counts code points, not UTF-16 units", () => {
  // A 2-unit emoji must count as one character, or a description of astral glyphs
  // would be rejected at half the real limit.
  const g = extractGroup(
    { id: "t", glob: "packages/dpf-skill-pack/skills/*/SKILL.md", fields: ["name", "description"] },
    REPO_ROOT,
  );
  for (const item of g.items) {
    assert.equal(item.descriptionChars, [...item.description].length);
    assert.ok(item.descriptionChars <= item.bytes, "chars can never exceed UTF-8 bytes");
  }
});

test("the live skill pack is within the hard API limit", () => {
  const manifest = JSON.parse(
    readFileSync(join(REPO_ROOT, "scripts", "instruction-plane-manifest.json"), "utf8"),
  );
  const g = extractGroup(manifest.alwaysOnExtracted[0], REPO_ROOT);
  const over = g.items.filter((i) => i.descriptionChars > manifest.maxDescriptionChars);
  assert.deepEqual(over.map((i) => `${i.file}:${i.descriptionChars}`), []);
});

// --- Contingency markers: two kinds, two clocks -----------------------------------
// ⟦runtime:⟧ drifts with the environment; ⟦model:⟧ drifts with model releases. The
// convention is worth nothing if it stops grepping cleanly, so a malformed marker is a
// hard error rather than a silent skip.

test("assumptionMarkers counts each kind separately", () => {
  const text = [
    "- **A rule.** prose ⟦runtime: verify against package.json⟧ more prose",
    "- **Another.** prose ⟦model: assumes the model won't self-verify⟧",
    "- **A third.** two on one line ⟦runtime: a⟧ and ⟦model: b⟧",
    "- **Unmarked.** nothing here",
  ].join("\n");
  const m = assumptionMarkers(text);
  assert.equal(m.runtime, 2);
  assert.equal(m.model, 2);
  assert.deepEqual(m.malformed, []);
});

test("an unterminated marker is reported as malformed, not counted", () => {
  const m = assumptionMarkers("prose ⟦model: I forgot to close this\nnext line ⟧");
  assert.equal(m.model, 0, "an unterminated marker must not count as a real one");
  assert.deepEqual(m.malformed, [{ kind: "model", line: 1 }]);
});

test("evaluate FAILS on a malformed marker in an always-on file", () => {
  const { errors } = evaluate({
    manifest: MANIFEST,
    fileTexts: { "CLAUDE.md": CLAUDE_OK, "AGENTS.md": "⟦runtime: never closed" },
    baseline: { "CLAUDE.md": byteLen(CLAUDE_OK), "AGENTS.md": byteLen("⟦runtime: never closed") },
    strict: false,
  });
  assert.ok(errors.some((e) => e.includes("unterminated") && e.includes("AGENTS.md:1")));
});

test("evaluate reports marker counts across the always-on set", () => {
  const { markers } = evaluate({
    manifest: MANIFEST,
    fileTexts: {
      "CLAUDE.md": CLAUDE_OK,
      "AGENTS.md": "a ⟦runtime: x⟧ b ⟦model: y⟧ c ⟦model: z⟧ d ⟦situational: w — review r⟧",
    },
    baseline: {
      "CLAUDE.md": byteLen(CLAUDE_OK),
      "AGENTS.md": byteLen(
        "a ⟦runtime: x⟧ b ⟦model: y⟧ c ⟦model: z⟧ d ⟦situational: w — review r⟧",
      ),
    },
    strict: false,
  });
  assert.deepEqual(markers, { runtime: 1, model: 2, situational: 1 });
});

test("a malformed ⟦situational:⟧ marker is caught like the other two clocks", () => {
  // The third clock earns its keep only if an unterminated one still errors —
  // an ungreppable marker is worse than none, because it reads as recorded.
  const m = assumptionMarkers("rule ⟦situational: pre-GA, no external installs");
  assert.equal(m.situational, 0);
  assert.deepEqual(m.malformed, [{ kind: "situational", line: 1 }]);
});

test("an unrecognised marker kind is ignored, not miscounted", () => {
  // Only the two defined clocks are tracked; ⟦todo:⟧ or similar must not inflate either.
  const m = assumptionMarkers("prose ⟦todo: something⟧ and ⟦runtime: real⟧");
  assert.equal(m.runtime, 1);
  assert.equal(m.model, 0);
  assert.deepEqual(m.malformed, []);
});

test("markers survive relocation and none are malformed, plane or destination", () => {
  // Markers travel WITH their content: BI-0020D511 Phase 1 moved procedure out of the
  // always-on plane into runbooks, and the ⟦runtime:⟧ markers on that procedure went with
  // it — which is the convention working, not markers being lost. So the invariant is
  // "still present somewhere reachable", not "still in AGENTS.md". Counting only the
  // plane would turn every correct relocation into a red test.
  const manifest = JSON.parse(
    readFileSync(join(REPO_ROOT, "scripts", "instruction-plane-manifest.json"), "utf8"),
  );
  const files = [
    ...manifest.alwaysOn,
    ...(manifest.ruleDestinations ?? []).flatMap((g) => globSync(g, { cwd: REPO_ROOT })),
  ];
  let runtime = 0;
  let model = 0;
  for (const file of files) {
    let text;
    try {
      text = readFileSync(join(REPO_ROOT, file), "utf8");
    } catch {
      continue;
    }
    const m = assumptionMarkers(text);
    assert.deepEqual(m.malformed, [], `${file} has a malformed marker`);
    runtime += m.runtime;
    model += m.model;
  }
  assert.ok(runtime >= 10, `expected the BI-ACC7A2B5 runtime markers to survive, saw ${runtime}`);
  assert.ok(model >= 1, `expected at least one model-assumption marker, saw ${model}`);
});
