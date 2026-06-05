// Corpus-aware golden-decision baseline test.
//
// Loads the REAL founder-kernel commandment corpus from
// docs/founder-kernel/wiki/principles/*.md via the canonical @dpf/db
// `parseWikiFrontmatter`, scores the curated scenario panel through the real
// `decide()` engine, and gates on the winner + margin floor of each canonical
// decision. A flip = a broken baseline (CI fails). A soft snapshot diff against
// golden-decisions.baseline.json surfaces *how* the numbers drift as the corpus
// evolves, without failing on benign movement.
//
// Regenerate the snapshot after a deliberate, reviewed corpus change:
//   UPDATE_GOLDEN_BASELINE=1 pnpm --filter web exec vitest run lib/decision/golden-decisions.test.ts
//
// Spec: docs/superpowers/specs/2026-06-05-situational-aware-decision-weighting-design.md

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseWikiFrontmatter, type WikiPageFrontmatter } from "@dpf/db";
import {
  GOLDEN_SCENARIOS,
  scoreScenario,
  selectKernelCommandments,
  type ParsedPrinciplePage,
  type ScenarioSnapshot,
} from "./golden-decisions";

const PRINCIPLES_DIR = fileURLToPath(
  new URL("../../../../docs/founder-kernel/wiki/principles", import.meta.url),
);
const BASELINE_PATH = fileURLToPath(
  new URL("./golden-decisions.baseline.json", import.meta.url),
);

function loadCorpus(): ParsedPrinciplePage[] {
  const files = readdirSync(PRINCIPLES_DIR).filter((f) => f.endsWith(".md"));
  const pages: ParsedPrinciplePage[] = [];
  for (const file of files) {
    const raw = readFileSync(`${PRINCIPLES_DIR}/${file}`, "utf8");
    const { frontmatter } = parseWikiFrontmatter<WikiPageFrontmatter>(raw);
    if (frontmatter.pageKind !== "principle") continue;
    if (frontmatter.status && frontmatter.status !== "published") continue;
    pages.push({
      slug: file.replace(/\.md$/, ""),
      principleTier: frontmatter.principleTier,
      principleAppliesTo: frontmatter.principleAppliesTo,
      principleDimensionVector: frontmatter.principleDimensionVector,
      principleWeight: frontmatter.principleWeight,
    });
  }
  return pages;
}

const corpus = loadCorpus();
const commandments = selectKernelCommandments(corpus);
const snapshots: ScenarioSnapshot[] = [];

describe("golden decisions — corpus-aware baseline (full kernel, universal-ring)", () => {
  it("loads a non-trivial commandment corpus including the promoted proper-fix", () => {
    expect(commandments.length).toBeGreaterThanOrEqual(10);
    expect(commandments.map((c) => c.id)).toContain("proper-fix-over-quick-fix");
    expect(commandments.map((c) => c.id)).toContain("architecture-over-shortcuts");
  });

  for (const scenario of GOLDEN_SCENARIOS) {
    it(`[${scenario.id}] ${scenario.rationale}`, () => {
      const { snapshot } = scoreScenario(scenario, commandments);
      snapshots.push(snapshot);

      // HARD GATE — a flipped winner or a coin-flip margin is a broken baseline.
      expect(
        snapshot.winner,
        `Canonical decision "${scenario.id}" flipped to "${snapshot.winner}". ` +
          `Top contributors: ${snapshot.topContributors.map((c) => `${c.principle}(${c.contribution})`).join(", ")}. ` +
          `A corpus/dimension change moved this decision — revisit the dimension or the principle aggregate, then bless a new baseline.`,
      ).toBe(scenario.expectedWinner);
      expect(
        snapshot.margin,
        `Canonical decision "${scenario.id}" degenerated to a near-tie (margin ${snapshot.margin} < floor ${scenario.marginFloor}).`,
      ).toBeGreaterThanOrEqual(scenario.marginFloor);
    });
  }

  it("snapshot review: surfaces numeric drift vs the committed baseline (soft)", () => {
    const current: Record<string, ScenarioSnapshot> = {};
    for (const s of snapshots) current[s.id] = s;

    if (process.env.UPDATE_GOLDEN_BASELINE === "1") {
      writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + "\n");
      return;
    }
    if (!existsSync(BASELINE_PATH)) return; // first run before a baseline is committed

    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Record<string, ScenarioSnapshot>;
    for (const [id, snap] of Object.entries(current)) {
      const base = baseline[id];
      if (!base) continue;
      // Winner flips are already hard-failed above; here we only REPORT benign drift
      // (margin, composites, contributor mix, corpus size) so reviewers see how the
      // living corpus is moving a decision even when it still holds.
      const notes: string[] = [];
      if (base.principlesConsidered !== snap.principlesConsidered)
        notes.push(`commandments ${base.principlesConsidered}→${snap.principlesConsidered}`);
      if (Math.abs(base.margin - snap.margin) > 0.05)
        notes.push(`margin ${base.margin}→${snap.margin}`);
      if (notes.length) {
        // eslint-disable-next-line no-console
        console.warn(`[golden-baseline drift] ${id}: ${notes.join("; ")} — review and regenerate with UPDATE_GOLDEN_BASELINE=1 if intended.`);
      }
    }
    expect(true).toBe(true);
  });
});
