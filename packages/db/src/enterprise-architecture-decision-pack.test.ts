import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { extractPrinciplePayload, parseFrontmatter } from "./seed-wiki-kernel";
import type { WikiPageFrontmatter } from "./wiki-frontmatter";
import { ALL_PROFESSION_EXTERNAL_SOURCES } from "./seed-profession-corpus";
import {
  PRINCIPLE_DIMENSIONS,
  PRINCIPLE_TIERS,
  PROFESSION_COMPETENCY_LEVELS,
} from "./wiki-taxonomy";

// BI-D65E044E Phase 1 — the enterprise-architecture minimum viable decision-pack.
//
// WHY THIS TEST EXISTS
// The profession gate deferred 69 times on `architecture-tradeoff` while six
// published, vectored enterprise-architecture pages sat in the corpus. Those six
// are DESCRIPTIVE (what TOGAF / ArchiMate / IT4IT ARE); none of them carries a
// rule a review verdict can be decided from. Spec §11.3 defines "primed" as
// enough decision-bearing material in the family's live decision classes that
// the gate can recommend or arbitrate on the family's ROUTINE CONSULT SHAPES —
// "verified against the family's own recent deferral questions, not
// hypotheticals".
//
// So the pack is pinned against the mined deferrals, not against a wish list.
// CONSULT_SHAPES below is the clustering of the 69 real `defer` rows
// (DecisionInteraction, domainClass=architecture-tradeoff, mined 2026-07-29):
// every row arrived from reviewDesignDoc/reviewPlanDoc with the same option set
// ["aligned", "revise-before-building"], and each row's verdict prose falls into
// one or more of these shapes. `evidence` quotes the actual deferral text.
//
// If a future edit deletes or renames a pack page, the shape it covered fails
// loudly here — which is the point: the gap this closes is invisible from the
// page count alone.

const PACK_DIR = join(
  __dirname,
  "../../../docs/professions/enterprise-architecture/wiki",
);

type ConsultShape = {
  /** What the reviewer was actually being asked to settle. */
  shape: string;
  /** Verbatim fragment from a mined `defer` row. */
  evidence: string;
  /** Rows in the mined set whose verdict prose exhibits this shape. */
  minedRows: number;
  /** Pack page slugs that let the gate settle it. */
  coveredBy: string[];
};

const CONSULT_SHAPES: ConsultShape[] = [
  {
    shape: "spec-alignment verdict where the findings are minor",
    evidence:
      "The plan is largely aligned with architectural standards but requires minor "
      + "adjustments to ensure canonical API naming consistency, schema alignment, and "
      + "progressive disclosure adherence.",
    minedRows: 60,
    coveredBy: ["architecture-review-verdict-thresholds"],
  },
  {
    shape: "reuse-vs-new-model — is a new model justified, or does one exist?",
    evidence:
      "The design introduces new data models without clear alignment to canonical "
      + "structures, lacks adherence to established job naming conventions, and does not "
      + "reference the canonical enum registry, creating risk of architectural drift.",
    minedRows: 12,
    coveredBy: [
      "verify-the-substrate-before-proposing-new",
      "extend-canonical-models-never-fork",
    ],
  },
  {
    shape: "canonical home / single-source-of-truth ownership",
    evidence:
      "the main architectural edits being to keep the database model canonical in "
      + "packages/db, extend existing navigation rather than recreate it, and make "
      + "service-layer enforcement the explicit single authority for partner-domain mutations.",
    minedRows: 25,
    coveredBy: ["extend-canonical-models-never-fork"],
  },
  {
    shape: "schema extension, migration safety, and database-enforced invariants",
    evidence:
      "portfolioId in SpendPeriodRollup must be nullable (String?) to support "
      + "expand-contract backfill, but Task 4 defines it as required (String) ... "
      + "SpendPeriodRollup's unique constraint is unenforceable with nullable fields.",
    minedRows: 15,
    coveredBy: ["evolve-schema-additively"],
  },
  {
    shape: "API/naming consistency and typed-contract discipline",
    evidence:
      "lacks enumerated strongly-typed values for costBasis, periodType, and "
      + "recommendation types—clarify these before implementing to maintain canonical "
      + "data-model stewardship and API contracts.",
    minedRows: 18,
    coveredBy: ["name-and-type-the-contract-canonically"],
  },
  {
    shape: "value-stream mapping — does the change serve a load-bearing stage?",
    evidence:
      "it could better articulate its connection to a load-bearing value-stream stage "
      + "to ensure end-to-end outcome alignment.",
    minedRows: 9,
    coveredBy: ["anchor-changes-to-a-value-stream-stage"],
  },
  {
    shape: "association justification and evidence sufficiency",
    evidence:
      "Spec is structurally sound but has important architectural misalignments: "
      + "audit trail ambiguity between mutable confirmations and immutable corrections, "
      + "... missing data integrity constraint on correction targets.",
    minedRows: 8,
    coveredBy: ["minimal-proven-associations"],
  },
];

/** The pages this BI adds — the decision-bearing half of the family corpus. */
const PACK_SLUGS = [
  "anchor-changes-to-a-value-stream-stage",
  "architecture-review-verdict-thresholds",
  "evolve-schema-additively",
  "extend-canonical-models-never-fork",
  "minimal-proven-associations",
  "name-and-type-the-contract-canonically",
  "verify-the-substrate-before-proposing-new",
];

function loadPage(slug: string) {
  const raw = readFileSync(join(PACK_DIR, `${slug}.md`), "utf8");
  return parseFrontmatter<WikiPageFrontmatter>(raw);
}

describe("EA decision-pack — coverage of the mined deferral shapes", () => {
  it("covers every mined consult shape with at least one pack page", () => {
    for (const shape of CONSULT_SHAPES) {
      expect(shape.coveredBy.length, `uncovered shape: ${shape.shape}`).toBeGreaterThan(0);
      for (const slug of shape.coveredBy) {
        expect(PACK_SLUGS, `${shape.shape} -> ${slug}`).toContain(slug);
      }
    }
  });

  it("pins every pack page to a shape — no page without mined demand", () => {
    const covering = new Set(CONSULT_SHAPES.flatMap((s) => s.coveredBy));
    for (const slug of PACK_SLUGS) {
      expect(covering, `${slug} answers no mined consult shape`).toContain(slug);
    }
  });

  it("the dominant shape (the alignment verdict itself) is decision-bearing", () => {
    // 60 of 69 mined rows are a verdict call with options
    // ["aligned", "revise-before-building"]. If the page that supplies the
    // verdict rule loses its principleDirection, the gate is back to deferring.
    const { frontmatter } = loadPage("architecture-review-verdict-thresholds");
    expect(frontmatter.principleDirection).toBeTruthy();
    expect(frontmatter.principleTier).toBe("core");
  });
});

describe("EA decision-pack — frontmatter contract", () => {
  it.each(PACK_SLUGS)("%s is published, sourced, and vectored", (slug) => {
    const { frontmatter, body } = loadPage(slug);

    expect(frontmatter.title, "title").toBeTruthy();
    expect(frontmatter.status ?? "published").toBe("published");
    expect(frontmatter.abstract, "abstract").toBeTruthy();
    expect(body.trim().length).toBeGreaterThan(400);

    // pageKind MUST be `principle`, and not merely because the pages read like
    // principles: extractPrinciplePayload (seed-wiki-kernel.ts) returns `{}` for
    // every pageKind except "principle". A `heuristic` page therefore seeds with
    // its principleDimensionVector, principleDirection, and principleTier
    // SILENTLY DROPPED — it persists as prose with no vector, so it cannot score
    // and cannot move a verdict. Five vectored `heuristic` pages elsewhere in
    // docs/professions/ are already losing their payload this way.
    expect(frontmatter.pageKind, `${slug} must be a principle to keep its vector`).toBe(
      "principle",
    );

    // detectUnsourcedProfessionPages is an ERROR-severity lint for any published
    // professions/ page with zero citations — and the conduit rule requires the
    // citation to be a source the seeder actually registers.
    const sources = frontmatter.sources ?? [];
    expect(sources.length, `${slug} has no sources`).toBeGreaterThan(0);
    for (const key of sources) {
      expect(
        ALL_PROFESSION_EXTERNAL_SOURCES,
        `${slug} cites unregistered source ${key}`,
      ).toHaveProperty(key);
    }

    expect(PROFESSION_COMPETENCY_LEVELS).toContain(frontmatter.professionCompetencyLevel);
    expect(PRINCIPLE_TIERS).toContain(frontmatter.principleTier);
    expect(frontmatter.principleDirection, `${slug} principleDirection`).toBeTruthy();
  });

  it.each(PACK_SLUGS)("%s carries a signed, in-registry dimension vector", (slug) => {
    const { frontmatter } = loadPage(slug);
    const vector = frontmatter.principleDimensionVector;

    // A material with no vector contributes nothing to structured option
    // scoring (computeStructuredAlignment reads the PRINCIPLE's dimensions), so
    // an unvectored pack page cannot move a verdict — it would promote into
    // material that scores exactly zero.
    expect(vector, `${slug} has no principleDimensionVector`).toBeTruthy();
    const entries = Object.entries(vector ?? {});
    expect(entries.length).toBeGreaterThan(0);

    for (const [axis, weight] of entries) {
      expect(PRINCIPLE_DIMENSIONS, `${slug}: unknown axis ${axis}`).toContain(axis);
      expect(typeof weight).toBe("number");
      expect(Math.abs(weight), `${slug}.${axis} out of range`).toBeLessThanOrEqual(1);
      expect(weight, `${slug}.${axis} is zero — say nothing instead`).not.toBe(0);
    }
  });
});

describe("EA decision-pack — the seeder accepts every page", () => {
  // extractPrinciplePayload is the seed walker's own gate: it THROWS on an
  // unknown dimension key and on the §8A.1 archetype/population coherence
  // violations. Running it here is what makes "the pages seed" a functional
  // claim rather than a structural one — a page that parses but would abort
  // `seedProfessionCorpus` on a fresh install is not shipped material.
  it.each(PACK_SLUGS)("%s passes the seed walker's principle gate", (slug) => {
    const { frontmatter } = loadPage(slug);
    const payload = extractPrinciplePayload(frontmatter);

    expect(payload.principleDimensionVector).toEqual(frontmatter.principleDimensionVector);
    // principleDimensions is derived from the vector's keys when not authored;
    // it is what retrieval filters on, so an empty derivation means the page is
    // invisible to dimension-scoped recall.
    expect(payload.principleDimensions?.length ?? 0).toBeGreaterThan(0);
  });
});

describe("EA corpus — the pack lands beside the existing family pages", () => {
  it("does not orphan a wikilink to a page that does not exist", () => {
    const present = new Set(
      readdirSync(PACK_DIR)
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.replace(/\.md$/, "")),
    );

    for (const slug of PACK_SLUGS) {
      const raw = readFileSync(join(PACK_DIR, `${slug}.md`), "utf8");
      const links = [...raw.matchAll(/\[\[professions\/enterprise-architecture\/([^\]]+)\]\]/g)];
      expect(links.length, `${slug} links to no sibling page`).toBeGreaterThan(0);
      for (const [, target] of links) {
        expect(present, `${slug} links to missing page ${target}`).toContain(target);
      }
    }
  });

  it("leaves the six pre-existing family pages in place", () => {
    const present = new Set(
      readdirSync(PACK_DIR)
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.replace(/\.md$/, "")),
    );
    for (const slug of [
      "archimate-three-layers",
      "architecture-decision-record",
      "conways-law",
      "it4it-value-streams",
      "record-decisions-as-adrs",
      "togaf-adm-phases",
    ]) {
      expect(present, `pre-existing page ${slug} disappeared`).toContain(slug);
    }
  });
});
