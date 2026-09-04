// Phase 2b — the independent re-verification pass over a recorded decision.
//
// The tests that matter here are the ones separating the three ways a decision
// can fail to be "verified", because collapsing them is how a re-verifier turns
// into a fabrication-accusation generator:
//   - a citation that no longer holds        → degraded   (a real finding)
//   - no source checkout on this install     → unverifiable/no-source-access
//   - no locators on the record at all       → unverifiable/no-recorded-locators
// Only the first is a statement about the decision's evidence.

import { describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  guardResolverPaths,
  reverifyDecisionEvidence,
  type SourceAccess,
} from "./evidence-reverification";
import { citationsToSources, type AdmissibleCitation } from "./evidence-grounding";
import { partialSourceTree } from "@/lib/testing/degenerate-env";
import { createRepoLocatorResolver } from "./locator-resolver";
import type { LocatorResolver } from "./evidence-reverifier";

const REAL_EXCERPT = 'return "grounded value";';
const SECRET = "DATABASE_URL=postgres://user:hunter2@db/prod";

async function fixtureRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dpf-reverify-"));
  await mkdir(join(root, "apps", "web", "lib"), { recursive: true });
  await writeFile(
    join(root, "apps", "web", "lib", "real.ts"),
    ["export function real() {", `  ${REAL_EXCERPT}`, "}", ""].join("\n"),
    "utf8",
  );
  await writeFile(join(root, ".env"), `${SECRET}\n`, "utf8");
  return root;
}

function citation(over: Partial<AdmissibleCitation> = {}): AdmissibleCitation {
  return {
    optionId: "option-a",
    dimensionKey: "evidence_density",
    grade: "B",
    excerpt: REAL_EXCERPT,
    locator: { sourceType: "code", filePath: "apps/web/lib/real.ts", line: 2 },
    ...over,
  };
}

/** A db whose row carries exactly what the ledger would have written. */
function dbWith(citations: AdmissibleCitation[] | null, overrides: Record<string, unknown> = {}) {
  const sources = citations === null ? [] : JSON.parse(JSON.stringify(citationsToSources(citations)));
  return {
    decisionInteraction: {
      findUnique: vi.fn(async () => ({
        interactionId: "DI-TEST",
        profileId: "mark-dpf-platform",
        profileVersionId: "v1",
        question: "Which storage approach?",
        createdAt: new Date("2026-08-16T00:00:00.000Z"),
        sources,
        ...overrides,
      })),
    },
  };
}

/** A real checkout: revision is knowable, so a miss is evidence about the citation. */
const AVAILABLE = (repoRoot: string): SourceAccess => ({
  available: true,
  repoRoot,
  anchored: true,
  anchorDetail: "a git checkout",
});
/** Readable source of unknown revision — the live install's image-synced volume. */
const UNANCHORED = (repoRoot: string): SourceAccess => ({
  available: true,
  repoRoot,
  anchored: false,
  anchorDetail: "NOT a git checkout, so its revision is unknown",
});
const UNAVAILABLE: SourceAccess = { available: false, detail: "no source checkout on this install" };
const NEVER_CALLED: LocatorResolver = async () => {
  throw new Error("resolver must not be called");
};

describe("reverifyDecisionEvidence", () => {
  it("confirms a decision whose citations still resolve and still match", async () => {
    const repoRoot = await fixtureRepo();
    const lookup = await reverifyDecisionEvidence({
      db: dbWith([citation()]),
      interactionId: "DI-TEST",
      sourceAccess: AVAILABLE(repoRoot),
      resolve: createRepoLocatorResolver({ repoRoot }),
    });

    expect(lookup.found).toBe(true);
    if (!lookup.found) return;
    expect(lookup.report.outcome).toBe("verified");
    expect(lookup.report.confirmed).toBe(1);
    expect(lookup.report.degrade).toEqual([]);
    expect(lookup.report.coverage).toMatchObject({ recordedSources: 1, checked: 1, complete: true });
  });

  it("degrades a fabricated-but-well-formed citation", async () => {
    const repoRoot = await fixtureRepo();
    const lookup = await reverifyDecisionEvidence({
      db: dbWith([citation({ locator: { sourceType: "code", filePath: "apps/web/lib/invented.ts" } })]),
      interactionId: "DI-TEST",
      sourceAccess: AVAILABLE(repoRoot),
      resolve: createRepoLocatorResolver({ repoRoot }),
    });

    if (!lookup.found) throw new Error("expected found");
    expect(lookup.report.outcome).toBe("degraded");
    expect(lookup.report.degrade).toEqual([{ optionId: "option-a", dimensionKey: "evidence_density" }]);
    expect(lookup.report.unverifiableCause).toBeNull();
  });

  // The load-bearing distinction. Without this the pass reports every decision
  // on every production install as fabricated.
  it("reports no-source-access as unverifiable, NOT as degraded, and never resolves", async () => {
    const lookup = await reverifyDecisionEvidence({
      db: dbWith([citation()]),
      interactionId: "DI-TEST",
      sourceAccess: UNAVAILABLE,
      resolve: NEVER_CALLED,
    });

    if (!lookup.found) throw new Error("expected found");
    expect(lookup.report.outcome).toBe("unverifiable");
    expect(lookup.report.unverifiableCause).toBe("no-source-access");
    expect(lookup.report.degrade).toEqual([]);
    expect(lookup.report.degraded).toBe(0);
    expect(lookup.report.sourceAccess.available).toBe(false);
    // Recorded sources are still reported, so the caller can see what went unchecked.
    expect(lookup.report.coverage).toMatchObject({ recordedSources: 1, checked: 0 });
  });

  it("reports a legacy row with no locators as unverifiable, not verified", async () => {
    const db = {
      decisionInteraction: {
        findUnique: vi.fn(async () => ({
          interactionId: "DI-LEGACY",
          profileId: "mark-dpf-platform",
          profileVersionId: "v1",
          question: "q",
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
          // Exactly the shape live rows carry today.
          sources: [
            {
              materialId: "mark-dpf-platform:never-fabricate",
              sourceType: "principle",
              summary: "Never fabricate.",
              effectiveWeight: 1,
            },
          ],
        })),
      },
    };
    const lookup = await reverifyDecisionEvidence({
      db,
      interactionId: "DI-LEGACY",
      sourceAccess: AVAILABLE("/nonexistent"),
      resolve: NEVER_CALLED,
    });

    if (!lookup.found) throw new Error("expected found");
    expect(lookup.report.outcome).toBe("unverifiable");
    expect(lookup.report.unverifiableCause).toBe("no-recorded-locators");
    expect(lookup.report.unverifiableSources[0]!.reason).toBe("no-locator");
  });

  it("reports partial coverage rather than a clean bill of health", async () => {
    const repoRoot = await fixtureRepo();
    const sources = [
      ...JSON.parse(JSON.stringify(citationsToSources([citation()]))),
      // A second source the ledger's perspective-gate path writes: no locator.
      { materialId: "opt:dim", sourceType: "principle", summary: "doctrine", effectiveWeight: 1 },
    ];
    const db = {
      decisionInteraction: {
        findUnique: vi.fn(async () => ({
          interactionId: "DI-MIXED",
          profileId: "p",
          profileVersionId: "v1",
          question: "q",
          createdAt: new Date(),
          sources,
        })),
      },
    };

    const lookup = await reverifyDecisionEvidence({
      db,
      interactionId: "DI-MIXED",
      sourceAccess: AVAILABLE(repoRoot),
      resolve: createRepoLocatorResolver({ repoRoot }),
    });

    if (!lookup.found) throw new Error("expected found");
    expect(lookup.report.outcome).toBe("verified");
    expect(lookup.report.coverage).toMatchObject({
      recordedSources: 2,
      checked: 1,
      unverifiable: 1,
      complete: false,
    });
  });

  // BI-EE2B243D — the live regression. PROJECT_ROOT on the install is an
  // image-synced source volume: package.json is present, `.git` is not, and the
  // tree carries only PART of the repo. Every true citation resolved to nothing
  // and the pass reported "degraded" — i.e. accused honest evidence of being
  // fabricated. Absence in a tree of unknown revision proves nothing.
  it("does NOT degrade a citation missing from a tree of unknown revision", async () => {
    // Exactly the live shape: a plausible root, no .git, and the cited file absent
    // (the shared degenerate-environment fixture — BI-927D64C0 M4).
    const { root: repoRoot } = partialSourceTree({ withGit: false, withFile: false });

    const lookup = await reverifyDecisionEvidence({
      db: dbWith([citation()]),
      interactionId: "DI-TEST",
      sourceAccess: UNANCHORED(repoRoot),
      resolve: createRepoLocatorResolver({ repoRoot }),
    });

    if (!lookup.found) throw new Error("expected found");
    expect(lookup.report.outcome).not.toBe("degraded");
    expect(lookup.report.outcome).toBe("unverifiable");
    expect(lookup.report.unverifiableCause).toBe("unanchored-source");
    expect(lookup.report.degrade).toEqual([]);
    expect(lookup.report.degraded).toBe(0);
    expect(lookup.report.inconclusive).toEqual([
      {
        optionId: "option-a",
        dimensionKey: "evidence_density",
        rawVerdict: "unresolved",
        reason: "unanchored-source",
      },
    ]);
    expect(lookup.report.sourceAccess.anchored).toBe(false);
  });

  // Confirmation survives the anchoring rule: if the cited text IS there, it
  // existed, whatever revision the tree is at. Only refutation needs an anchor.
  it("still confirms a citation whose text is present on an unanchored tree", async () => {
    const repoRoot = await fixtureRepo();
    const lookup = await reverifyDecisionEvidence({
      db: dbWith([citation()]),
      interactionId: "DI-TEST",
      sourceAccess: UNANCHORED(repoRoot),
      resolve: createRepoLocatorResolver({ repoRoot }),
    });

    if (!lookup.found) throw new Error("expected found");
    expect(lookup.report.outcome).toBe("verified");
    expect(lookup.report.confirmed).toBe(1);
    expect(lookup.report.inconclusive).toEqual([]);
  });

  it("keeps a real refutation when the tree IS a checkout", async () => {
    const repoRoot = await fixtureRepo();
    const lookup = await reverifyDecisionEvidence({
      db: dbWith([citation({ locator: { sourceType: "code", filePath: "apps/web/lib/invented.ts" } })]),
      interactionId: "DI-TEST",
      sourceAccess: AVAILABLE(repoRoot),
      resolve: createRepoLocatorResolver({ repoRoot }),
    });

    if (!lookup.found) throw new Error("expected found");
    expect(lookup.report.outcome).toBe("degraded");
    expect(lookup.report.inconclusive).toEqual([]);
  });

  it("reports a missing decision as not found rather than as an empty pass", async () => {
    const lookup = await reverifyDecisionEvidence({
      db: { decisionInteraction: { findUnique: vi.fn(async () => null) } },
      interactionId: "DI-NOPE",
      sourceAccess: UNAVAILABLE,
      resolve: NEVER_CALLED,
    });
    expect(lookup).toEqual({ found: false, interactionId: "DI-NOPE" });
  });
});

describe("guardResolverPaths", () => {
  it("refuses a citation naming a blocked file instead of echoing its contents", async () => {
    const repoRoot = await fixtureRepo();
    const { isPathAllowedSync } = await import("@/lib/build/codebase-tools");
    const guarded = guardResolverPaths(createRepoLocatorResolver({ repoRoot }), isPathAllowedSync);

    // The cited path is INSIDE the repo root, so phase 1's confinement check
    // passes it. Without the blocklist the secret would round-trip as liveExcerpt.
    const resolution = await guarded({ sourceType: "code", filePath: ".env" });

    expect(resolution).toEqual({ resolved: false, liveExcerpt: null });
    expect(JSON.stringify(resolution)).not.toContain("hunter2");
  });

  it("still resolves an ordinary source path", async () => {
    const repoRoot = await fixtureRepo();
    const { isPathAllowedSync } = await import("@/lib/build/codebase-tools");
    const guarded = guardResolverPaths(createRepoLocatorResolver({ repoRoot }), isPathAllowedSync);

    const resolution = await guarded({ sourceType: "code", filePath: "apps/web/lib/real.ts", line: 2 });
    expect(resolution.resolved).toBe(true);
    expect(resolution.liveExcerpt).toContain(REAL_EXCERPT);
  });

  it("passes through a locator whose sourceType names no path", async () => {
    const seen: string[] = [];
    const guarded = guardResolverPaths(
      async (locator) => {
        seen.push(locator.sourceType);
        return { resolved: false, liveExcerpt: null };
      },
      () => false, // even a deny-all guard must not swallow pathless locators
    );
    await guarded({ sourceType: "runtime-state", snapshotKey: "k", capturedAt: "2026-08-16" });
    expect(seen).toEqual(["runtime-state"]);
  });
});
