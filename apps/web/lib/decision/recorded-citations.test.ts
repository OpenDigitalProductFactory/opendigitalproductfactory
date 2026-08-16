// End-to-end round-trip for the trust-envelope citation record (BI-8192557E
// phase 2a). The property under test is NOT "the decoder parses JSON" — it is
// that a citation recorded by `principle_decide` survives the write, survives
// the jsonb round-trip, and arrives at `reverifyCitations` in a shape the
// repo-backed resolver can actually re-resolve against live source.
//
// Two failure modes are guarded explicitly:
//   1. a fabricated-but-well-formed locator (admissible, but never true) must
//      DEGRADE after the round-trip — persistence must not launder it; and
//   2. a legacy row with no locator must report as UNVERIFIABLE, never as
//      confirmed. Absence of evidence is not evidence.

import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { citationsToSources, type AdmissibleCitation } from "./evidence-grounding";
import { recordKernelConsultInteraction } from "./kernel-consult-ledger";
import { recordedCitationsFromSources } from "./recorded-citations";
import { reverifyCitations } from "./evidence-reverifier";
import { createRepoLocatorResolver } from "./locator-resolver";
import { decisionInteractionRowToEvaluation } from "@/lib/decision-perspective/persistence";
import type { DecisionResult } from "./option-scoring";
import type { DecisionCallerContext } from "./caller-context";

const REAL_EXCERPT = 'return "grounded value";';

async function fixtureRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dpf-recorded-citations-"));
  await mkdir(join(root, "apps", "web", "lib"), { recursive: true });
  await writeFile(
    join(root, "apps", "web", "lib", "real.ts"),
    ["export function real() {", `  ${REAL_EXCERPT}`, "}", ""].join("\n"),
    "utf8",
  );
  return root;
}

/**
 * The jsonb boundary. Prisma stores `sources` as JSON, so anything that does
 * not survive serialization is not actually persisted — asserting on the
 * in-memory object would hide exactly the loss this phase exists to fix.
 */
function throughJsonb<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

/** Read the persisted row back the way the audit surface does. */
function readBackSources(sources: unknown) {
  return decisionInteractionRowToEvaluation({
    interactionId: "DI-TEST",
    profileId: "mark-dpf-platform",
    profileVersionId: "mark-dpf-platform-v1",
    sources,
  }).sources;
}

const wwmdContext: DecisionCallerContext = {
  principalId: null,
  governingProfileId: "mark-dpf-platform",
  governingProfileKind: "platform",
  callingPopulation: "external_coding_agent",
  resolvedVia: "calling-population",
};

function makeResult(): DecisionResult {
  return {
    recommendation: { optionId: "option-a", composite: 4.2, margin: 1.5, confidence: "high" },
    scores: [{ optionId: "option-a", composite: 4.2, contributions: [] }],
    flags: {
      tieMargin: 0.2,
      semanticFallbackRatio: 0,
      structuredCoverage: "strong",
      commandmentConflict: false,
      commandmentConflictPrinciples: [],
    },
    reasoning: "Recommends option-a.",
  };
}

function makeDb() {
  const created: Array<Record<string, unknown>> = [];
  return {
    created,
    decisionPerspectiveProfile: {
      findUnique: async () => ({ profileId: "mark-dpf-platform", kind: "platform" }),
    },
    decisionPerspectiveProfileVersion: {
      findFirst: async () => ({ versionId: "mark-dpf-platform-v1" }),
    },
    decisionInteraction: {
      create: async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return args.data;
      },
    },
  };
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

describe("recordKernelConsultInteraction — locator persistence", () => {
  it("writes the structured locator onto the row, not just its sourceType", async () => {
    const db = makeDb();
    const outcome = await recordKernelConsultInteraction({
      db: db as never,
      result: makeResult(),
      callerContext: wwmdContext,
      question: "Which storage approach should we take?",
      optionIds: ["option-a"],
      optionDescriptions: { "option-a": "Reuse table" },
      appliedPrincipleCount: 3,
      citations: [citation()],
    });

    expect(outcome.recorded).toBe(true);
    const [source] = readBackSources(throughJsonb(db.created[0]!.sources));
    expect(source).toMatchObject({
      materialId: "option-a:evidence_density",
      sourceType: "code",
      locator: { sourceType: "code", filePath: "apps/web/lib/real.ts", line: 2 },
      grade: "B",
      optionId: "option-a",
      dimensionKey: "evidence_density",
      excerpt: REAL_EXCERPT,
    });
  });

  it("keeps the pre-existing source fields intact (additive, not a replacement)", async () => {
    const db = makeDb();
    await recordKernelConsultInteraction({
      db: db as never,
      result: makeResult(),
      callerContext: wwmdContext,
      question: "q",
      optionIds: ["option-a"],
      optionDescriptions: {},
      appliedPrincipleCount: 1,
      citations: [citation({ grade: "A" })],
    });
    const [source] = readBackSources(throughJsonb(db.created[0]!.sources));
    expect(source!.summary).toBe(REAL_EXCERPT);
    expect(source!.effectiveWeight).toBe(1);
  });

  it("does not change what the hash chain seals", async () => {
    const db = makeDb();
    await recordKernelConsultInteraction({
      db: db as never,
      result: makeResult(),
      callerContext: wwmdContext,
      question: "q",
      optionIds: ["option-a"],
      optionDescriptions: {},
      appliedPrincipleCount: 1,
      citations: [citation()],
      evidenceDigests: { "option-a": { evidence_density: "digest-1" } },
      now: new Date("2026-08-15T00:00:00.000Z"),
    });
    // The seal covers criteria + evidence digests; `sources` is deliberately
    // outside it, so widening the source row must not disturb the chain.
    const row = db.created[0]!;
    expect(row.chainEntryHash).toEqual(expect.any(String));
    expect(JSON.stringify(row.sources)).not.toContain(row.chainEntryHash as string);
  });
});

describe("recordedCitationsFromSources", () => {
  it("round-trips a persisted locator into a confirmed re-verification", async () => {
    const repoRoot = await fixtureRepo();
    const persisted = throughJsonb(citationsToSources([citation()]));

    const { citations, unverifiable, whollyUnverifiable } = recordedCitationsFromSources(
      readBackSources(persisted),
    );
    expect(unverifiable).toEqual([]);
    expect(whollyUnverifiable).toBe(false);
    expect(citations).toHaveLength(1);

    const report = await reverifyCitations(citations, createRepoLocatorResolver({ repoRoot }));
    expect(report.allConfirmed).toBe(true);
    expect(report.confirmed).toBe(1);
    expect(report.degrade).toEqual([]);
  });

  it("degrades a fabricated-but-well-formed locator that survived the write", async () => {
    const repoRoot = await fixtureRepo();
    const fabricated = citation({
      // Normalizes cleanly and passes admissibility — and does not exist.
      locator: { sourceType: "code", filePath: "apps/web/lib/invented.ts", line: 2 },
    });
    const persisted = throughJsonb(citationsToSources([fabricated]));

    const { citations } = recordedCitationsFromSources(readBackSources(persisted));
    const report = await reverifyCitations(citations, createRepoLocatorResolver({ repoRoot }));

    expect(report.allConfirmed).toBe(false);
    expect(report.results[0]!.verdict).toBe("unresolved");
    expect(report.degrade).toEqual([{ optionId: "option-a", dimensionKey: "evidence_density" }]);
  });

  it("degrades a real file that never contained the recorded excerpt", async () => {
    const repoRoot = await fixtureRepo();
    const persisted = throughJsonb(
      citationsToSources([citation({ excerpt: "return \"a value never written\";" })]),
    );

    const { citations } = recordedCitationsFromSources(readBackSources(persisted));
    const report = await reverifyCitations(citations, createRepoLocatorResolver({ repoRoot }));

    expect(report.results[0]!.verdict).toBe("degraded");
    expect(report.allConfirmed).toBe(false);
  });

  it("reports a legacy row (no locator) as unverifiable, never as verified", async () => {
    // Exactly the shape every row on the live install carries today: the four
    // original fields and nothing else.
    const legacy = readBackSources([
      {
        materialId: "mark-dpf-platform:never-fabricate",
        sourceType: "principle",
        summary: "Never fabricate.",
        effectiveWeight: 1,
      },
    ]);

    const { citations, unverifiable, whollyUnverifiable } = recordedCitationsFromSources(legacy);
    expect(citations).toEqual([]);
    expect(unverifiable).toEqual([
      {
        materialId: "mark-dpf-platform:never-fabricate",
        sourceType: "principle",
        reason: "no-locator",
      },
    ]);
    expect(whollyUnverifiable).toBe(true);

    // And the re-verifier must not read "nothing to check" as "all confirmed".
    const report = await reverifyCitations(citations, async () => ({
      resolved: true,
      liveExcerpt: "anything",
    }));
    expect(report.allConfirmed).toBe(false);
  });

  it("rejects a locator that no longer normalizes rather than passing it through", () => {
    const { citations, unverifiable } = recordedCitationsFromSources([
      {
        materialId: "option-a:evidence_density",
        sourceType: "code",
        summary: "x",
        effectiveWeight: 0.5,
        // A `code` locator with no filePath cannot be re-resolved. Handing it to
        // a resolver would let a permissive one decide; fail closed here instead.
        locator: { sourceType: "code" } as never,
      },
    ]);
    expect(citations).toEqual([]);
    expect(unverifiable[0]!.reason).toBe("malformed-locator");
  });

  it("recovers the (option, dimension) binding from materialId when the explicit fields are absent", () => {
    const { citations } = recordedCitationsFromSources([
      {
        materialId: "option-b:blast_radius",
        sourceType: "spec",
        summary: "x",
        effectiveWeight: 0.5,
        locator: { sourceType: "spec", path: "docs/spec.md" },
      },
    ]);
    expect(citations[0]).toMatchObject({ optionId: "option-b", dimensionKey: "blast_radius" });
  });

  it("refuses a citation with no attributable (option, dimension) pair", () => {
    const { citations, unverifiable } = recordedCitationsFromSources([
      {
        materialId: "unbound",
        sourceType: "doc",
        summary: "x",
        effectiveWeight: 0.5,
        locator: { sourceType: "doc", path: "docs/thing.md" },
      },
    ]);
    // Re-verification reports degrades per (option, dimension); a verdict that
    // cannot name its pair could never be acted on, so it is not a citation.
    expect(citations).toEqual([]);
    expect(unverifiable[0]!.reason).toBe("no-dimension-binding");
  });

  it("yields nothing for a row with no sources, and that still cannot read as confirmed", async () => {
    // `whollyUnverifiable` is about recorded-but-opaque evidence; a row with no
    // sources at all has none to be opaque. The fail-closed guarantee for that
    // case lives downstream: an empty report is never `allConfirmed`.
    expect(recordedCitationsFromSources([]).whollyUnverifiable).toBe(false);
    expect(recordedCitationsFromSources(null).citations).toEqual([]);
    const report = await reverifyCitations([], async () => ({ resolved: true, liveExcerpt: "x" }));
    expect(report.allConfirmed).toBe(false);
  });
});
