// scripts/report-principle-vectors.test.mjs
//
// BI-4AD74F86. A report that silently drops a page it cannot read would
// under-count exactly the corpus it exists to characterize, so the tests are
// mostly about what happens to the awkward pages.

import assert from "node:assert/strict";
import test from "node:test";

import { parsePrinciple, summarize } from "./report-principle-vectors.mjs";

const DIMENSIONS = ["long_term_maintainability", "blast_radius", "operator_effort", "evidence_density"];
const COSTS = ["blast_radius", "operator_effort"];

function page(fm) {
  return `---\n${fm}\n---\n\n## Rule\n\nBody.\n`;
}

test("reads tier, weight and vector from frontmatter", () => {
  const parsed = parsePrinciple("example", page([
    "title: Example",
    "principleTier: core",
    'principleDimensionVector: {"blast_radius": -0.6, "evidence_density": 0.4}',
    "principleWeight: 0.5",
    "principleWeightRationale: because",
  ].join("\n")));

  assert.equal(parsed.tier, "core");
  assert.equal(parsed.weight, 0.5);
  assert.equal(parsed.weightRationale, true);
  assert.deepEqual(parsed.vector, { blast_radius: -0.6, evidence_density: 0.4 });
});

test("reports an unreadable page instead of dropping it", () => {
  // Dropping it would under-count the corpus and overstate how healthy it is.
  const broken = parsePrinciple("broken", page('principleDimensionVector: {"blast_radius": -0.6'));
  assert.equal(broken.vectorError, "unparseable principleDimensionVector");

  const noFm = parsePrinciple("nofm", "# No frontmatter\n");
  assert.equal(noFm.error, "no frontmatter");

  const summary = summarize({ principles: [broken, noFm], dimensions: DIMENSIONS, costDimensions: COSTS });
  assert.equal(summary.parseErrors.length, 2);
});

test("measures each axis by its share of its own vector, not its raw magnitude", () => {
  // Alignment is scale-invariant, so two vectors that differ only by a constant
  // describe the same shape and must report identically.
  const small = parsePrinciple("small", page('principleDimensionVector: {"blast_radius": -0.2, "evidence_density": 0.2}'));
  const large = parsePrinciple("large", page('principleDimensionVector: {"blast_radius": -0.9, "evidence_density": 0.9}'));

  const summary = summarize({ principles: [small, large], dimensions: DIMENSIONS, costDimensions: COSTS });
  const shares = summary.axisUse.get("blast_radius").map((u) => u.share);

  assert.deepEqual(shares, [0.5, 0.5]);
});

test("flags a positive weight on a cost axis", () => {
  const bad = parsePrinciple("bad", page('principleDimensionVector: {"blast_radius": 1.0}'));

  const summary = summarize({ principles: [bad], dimensions: DIMENSIONS, costDimensions: COSTS });

  assert.deepEqual(summary.signViolations, [{ slug: "bad", axis: "blast_radius", weight: 1 }]);
});

test("separates an axis outside the registry from a known one", () => {
  // These pages cannot seed at all, so they are a different problem from a
  // badly-weighted vector and are counted separately.
  const invented = parsePrinciple("invented", page('principleDimensionVector: {"architectural_coherence": 0.9}'));

  const summary = summarize({ principles: [invented], dimensions: DIMENSIONS, costDimensions: COSTS });

  assert.deepEqual([...summary.unknownAxes.keys()], ["architectural_coherence"]);
  assert.equal(summary.signViolations.length, 0);
});

test("records vector width, which is the padding population", () => {
  const wide = parsePrinciple("wide", page(
    'principleDimensionVector: {"blast_radius": -0.5, "evidence_density": 0.5, "operator_effort": -0.3}',
  ));
  const narrow = parsePrinciple("narrow", page('principleDimensionVector: {"evidence_density": 0.9}'));

  const summary = summarize({ principles: [wide, narrow], dimensions: DIMENSIONS, costDimensions: COSTS });

  assert.deepEqual(
    summary.widths.map((w) => [w.slug, w.width]).sort(),
    [["narrow", 1], ["wide", 3]],
  );
});

test("counts a page carrying no vector without treating it as an error", () => {
  const bare = parsePrinciple("bare", page("principleTier: core"));

  const summary = summarize({ principles: [bare], dimensions: DIMENSIONS, costDimensions: COSTS });

  assert.deepEqual(summary.noVector, [{ slug: "bare", tier: "core" }]);
  assert.equal(summary.parseErrors.length, 0);
});
