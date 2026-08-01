// Tests for the instruction-plane rule-coverage guard (BI-0020D511 §12f).
// node:test runner, matching the other guard tests — no vitest dependency in the
// guard CI job.
//
// The bar here is the same one the size ratchet's tests set: prove the guard BLOCKS the
// failure it exists for, not merely that the happy path prints OK. The failure it exists
// for is a Phase 1 cut that deletes a rule instead of relocating it, so the load-bearing
// case is "anchor vanishes from every plane → error", and its twin "anchor moved to a
// registered destination → no error". A guard that passed the first but failed the second
// would be worse than none: it would block the split it is supposed to make safe.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateRuleCoverage,
  parseRuleBaseline,
  serializeRuleBaseline,
  ruleAnchors,
  ruleLabel,
  anchorsIn,
  resolveAnchor,
} from "./check-instruction-plane-rule-coverage.mjs";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const KERNEL = "docs/founder-kernel/wiki/principles/never-fabricate.md";
const PROFESSION = "docs/professions/data-architect/wiki/strongly-typed-string-enums.md";

const bullet = (label, anchor) => `- **${label}** Some prose. → [kernel principle](${anchor})`;

test("ruleAnchors picks up the kernel-principle shape", () => {
  const found = ruleAnchors(bullet("Never fabricate.", KERNEL));
  assert.equal(found.length, 1);
  assert.equal(found[0].anchor, KERNEL);
  assert.equal(found[0].label, "Never fabricate.");
});

test("ruleAnchors picks up the FLAT profession shape (regression: an earlier pattern dropped all 11)", () => {
  const found = ruleAnchors(bullet("Typed enums.", PROFESSION));
  assert.equal(found.length, 1, "profession wiki pages have no directory under wiki/");
  assert.equal(found[0].anchor, PROFESSION);
});

test("ruleAnchors ignores non-rule links and external URLs", () => {
  const text = [
    "See [the spec](docs/superpowers/specs/2026-07-24-thing-design.md) for detail.",
    "See [upstream](https://example.com/wiki/principles/foo.md) too.",
  ].join("\n");
  assert.deepEqual(ruleAnchors(text), []);
});

test("ruleLabel falls back to a heading, then to empty", () => {
  assert.equal(ruleLabel("### 4. Branching, Commits & PRs"), "4. Branching, Commits & PRs");
  assert.equal(ruleLabel("plain prose with a [link](docs/x/wiki/principles/y.md)"), "");
});

test("a rule that vanishes from every plane FAILS — the whole point of the guard", () => {
  const baseline = new Map([[KERNEL, "Never fabricate."]]);
  const { errors } = evaluateRuleCoverage({
    baseline,
    alwaysOnTexts: { "AGENTS.md": "- **Some other rule.** No anchors here." },
    destinationTexts: {},
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /DROPPED, not relocated/);
  assert.match(errors[0], /never-fabricate/);
});

test("a rule RELOCATED to a registered destination passes — the split must stay possible", () => {
  const baseline = new Map([[KERNEL, "Never fabricate."]]);
  const { errors } = evaluateRuleCoverage({
    baseline,
    alwaysOnTexts: { "AGENTS.md": "Doctrine shrank; the rule moved to its skill." },
    destinationTexts: {
      // Real SKILL.md files reach the kernel with `../../../../docs/…` from
      // packages/dpf-skill-pack/skills/<slug>/ — use the true form, not a root-relative
      // string that would be a broken link on disk.
      "packages/dpf-skill-pack/skills/dpf-x/SKILL.md": bullet(
        "Never fabricate.",
        `../../../../${KERNEL}`,
      ),
    },
  });
  assert.deepEqual(errors, []);
});

test("relocation to an UNREGISTERED file still fails — destinations are an allow-list", () => {
  const baseline = new Map([[KERNEL, "Never fabricate."]]);
  const { errors } = evaluateRuleCoverage({
    baseline,
    alwaysOnTexts: { "AGENTS.md": "moved away" },
    // Not passed as a destination: the manifest never registered it.
    destinationTexts: {},
  });
  assert.equal(errors.length, 1);
});

test("a dangling anchor target FAILS — an unreadable rule is a lost rule one hop later", () => {
  const baseline = new Map([[KERNEL, "Never fabricate."]]);
  const { errors } = evaluateRuleCoverage({
    baseline,
    alwaysOnTexts: { "AGENTS.md": bullet("Never fabricate.", KERNEL) },
    targetExists: () => false,
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /target file does not exist/);
});

test("adding a NEW rule is never an error, and is reported for the next --update", () => {
  const { errors, added } = evaluateRuleCoverage({
    baseline: new Map(),
    alwaysOnTexts: { "AGENTS.md": bullet("Brand new rule.", KERNEL) },
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(added, [KERNEL]);
});

test("a duplicated anchor is advisory by default and an error under --strict", () => {
  const text = [bullet("Rule.", KERNEL), bullet("Same rule restated.", KERNEL)].join("\n");
  const loose = evaluateRuleCoverage({
    baseline: new Map([[KERNEL, "Rule."]]),
    alwaysOnTexts: { "AGENTS.md": text },
  });
  assert.deepEqual(loose.errors, []);
  assert.equal(loose.warnings.length, 1);
  assert.match(loose.warnings[0], /2×/);

  const strict = evaluateRuleCoverage({
    baseline: new Map([[KERNEL, "Rule."]]),
    alwaysOnTexts: { "AGENTS.md": text },
    strict: true,
  });
  assert.equal(strict.errors.length, 1);
});

test("baseline round-trips, and a union-merge duplicate collapses to one entry", () => {
  const anchors = new Map([
    [PROFESSION, "Typed enums."],
    [KERNEL, "Never fabricate."],
  ]);
  const round = parseRuleBaseline(serializeRuleBaseline(anchors));
  assert.equal(round.size, 2);
  assert.equal(round.get(KERNEL), "Never fabricate.");
  // merge=union can leave the same anchor twice; the first label wins, size stays 1.
  const merged = parseRuleBaseline(`${KERNEL}\tNever fabricate.\n${KERNEL}\tNever fabricate.\n`);
  assert.equal(merged.size, 1);
});

test("anchorsIn tolerates a missing file (null text) without throwing", () => {
  assert.deepEqual([...anchorsIn({ "gone.md": null })], []);
});

test("the committed baseline matches the live always-on plane", () => {
  const manifest = JSON.parse(
    readFileSync(join(REPO_ROOT, "scripts", "instruction-plane-manifest.json"), "utf8"),
  );
  const baseline = parseRuleBaseline(
    readFileSync(join(REPO_ROOT, "scripts", "instruction-plane-rule-baseline.txt"), "utf8"),
  );
  const texts = {};
  for (const f of manifest.alwaysOn) texts[f] = readFileSync(join(REPO_ROOT, f), "utf8");
  const live = anchorsIn(texts, manifest.ruleAnchorPattern);

  // Every live anchor is baselined. (The reverse is the guard's job, not the test's:
  // a baselined anchor may legitimately live in a destination after Phase 1.)
  for (const anchor of live) {
    assert.ok(baseline.has(anchor), `live rule anchor ${anchor} is missing from the baseline — run --update`);
  }
  assert.ok(live.size >= 40, `expected the pre-split plane to carry 40+ rule anchors, saw ${live.size}`);
});

// --- Relative-link resolution (regression: Phase 1 relocation) --------------------
// Moving a rule from AGENTS.md (repo root) into docs/architecture/*.md correctly rewrites
// its anchor link from `docs/founder-kernel/…` to `../founder-kernel/…`. Comparing raw
// strings reported those rules as DELETED — a false positive on the exact operation this
// guard exists to make safe, whose cheapest silencer is --update.

test("resolveAnchor resolves a relative target to a repo-relative path", () => {
  assert.equal(
    resolveAnchor("../founder-kernel/wiki/principles/x.md", "docs/architecture/runbook.md"),
    "docs/founder-kernel/wiki/principles/x.md",
  );
  assert.equal(resolveAnchor("./a/b.md", "docs/c.md"), "docs/a/b.md");
  assert.equal(resolveAnchor("/docs/a.md", "docs/c.md"), "docs/a.md");
  assert.equal(resolveAnchor(KERNEL, "AGENTS.md"), KERNEL, "root-relative is unchanged");
});

test("a rule relocated into a subdirectory is NOT reported as dropped", () => {
  const baseline = new Map([[KERNEL, "Never fabricate."]]);
  const { errors } = evaluateRuleCoverage({
    baseline,
    alwaysOnTexts: { "AGENTS.md": "the rule moved out" },
    // Same target, written the way a doc one level down must write it.
    destinationTexts: {
      "docs/architecture/runbook.md": "- **Never fabricate.** → [kernel principle](../founder-kernel/wiki/principles/never-fabricate.md)",
    },
  });
  assert.deepEqual(errors, [], "a correctly-rewritten relative link is the same rule");
});
