import { describe, expect, it, vi } from "vitest";

import { reviewedArtifactDigest } from "./architecture-advisory-outcome";
import { resolveArchitectureAdvisoryOutcomes } from "./architecture-advisory-outcome-sweep";

const DESIGN = { problemStatement: "one", proposedApproach: "reuse the ledger" };
const NOW = new Date("2026-10-21T12:00:00Z");

function decision(over: Record<string, unknown> & { interactionId: string }) {
  return {
    buildId: "FB-1",
    gateKey: "profession",
    options: ["aligned", "revise-before-building"],
    scoredOptions: null,
    humanOutcome: null,
    createdAt: new Date("2026-10-21T10:00:00Z"),
    outcomePayload: {
      proposedOptionId: "aligned",
      reviewedArtifact: { buildId: "FB-1", kind: "design", digest: reviewedArtifactDigest(DESIGN) },
    },
    ...over,
  };
}

function makeDb(input: {
  decisions: Record<string, unknown>[];
  builds: Record<string, unknown>[];
  ledger: Record<string, unknown>[];
}) {
  return {
    decisionInteraction: { findMany: vi.fn().mockResolvedValue(input.decisions) },
    featureBuild: { findMany: vi.fn().mockResolvedValue(input.builds) },
    decisionShadowLedger: {
      findMany: vi.fn(async (args: { where: { ledgerId: { in: string[] } } }) =>
        input.ledger.filter((row) => args.where.ledgerId.in.includes(String(row.ledgerId)))),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

describe("resolveArchitectureAdvisoryOutcomes (BI-22601A38)", () => {
  it("writes an outcome resolution onto the advisory's unreconciled ledger row, labelled as an outcome", async () => {
    const db = makeDb({
      decisions: [decision({ interactionId: "DI-1" })],
      builds: [{ buildId: "FB-1", phase: "plan", designDoc: DESIGN, buildPlan: null }],
      ledger: [{ ledgerId: "DSL-DI-1", metadata: { domainClass: "architecture-tradeoff", resolvedBy: null } }],
    });

    const result = await resolveArchitectureAdvisoryOutcomes(db, { now: NOW });

    expect(result).toMatchObject({ examined: 1, resolved: 1, written: 1, failed: 0 });
    const update = db.decisionShadowLedger.updateMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    // Never overwrites a row a person (or an earlier pass) already reconciled.
    expect(update.where).toEqual({ ledgerId: "DSL-DI-1", reconciledAt: null });
    expect(update.data).toMatchObject({
      actualDecision: { chosenOptionId: "aligned", disposition: "followed" },
      outcome: { disposition: "followed", resolvedBy: "outcome", signal: "advanced-unchanged" },
      agreement: true,
      reconciledAt: NOW,
      metadata: {
        domainClass: "architecture-tradeoff",
        resolvedBy: "outcome",
        outcomeEvidence: { signal: "advanced-unchanged", buildId: "FB-1", kind: "design", buildPhase: "plan" },
      },
    });
  });

  it("records a revision the architect did not ask for as an override", async () => {
    const db = makeDb({
      decisions: [
        decision({ interactionId: "DI-1" }),
        decision({
          interactionId: "DI-2",
          createdAt: new Date("2026-10-21T11:00:00Z"),
          outcomePayload: {
            proposedOptionId: "aligned",
            reviewedArtifact: { buildId: "FB-1", kind: "design", digest: "changed" },
          },
        }),
      ],
      builds: [{ buildId: "FB-1", phase: "ideate", designDoc: { changed: true }, buildPlan: null }],
      ledger: [{ ledgerId: "DSL-DI-1", metadata: {} }, { ledgerId: "DSL-DI-2", metadata: {} }],
    });
    const result = await resolveArchitectureAdvisoryOutcomes(db, { now: NOW });
    expect(result.written).toBe(1);
    const update = db.decisionShadowLedger.updateMany.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(update.data).toMatchObject({
      actualDecision: { chosenOptionId: "revise-before-building", disposition: "overridden" },
      agreement: false,
      reconciledAt: new Date("2026-10-21T11:00:00Z"),
    });
  });

  it("leaves alone an advisory a person already answered, and one with no ledger row to complete", async () => {
    const db = makeDb({
      decisions: [
        decision({ interactionId: "DI-1", humanOutcome: { type: "escalation", chosenOptionId: "aligned" } }),
        decision({ interactionId: "DI-2" }),
      ],
      builds: [{ buildId: "FB-1", phase: "build", designDoc: DESIGN, buildPlan: null }],
      ledger: [],
    });
    const result = await resolveArchitectureAdvisoryOutcomes(db, { now: NOW });
    expect(result).toMatchObject({ examined: 1, resolved: 1, written: 0 });
    expect(db.decisionShadowLedger.updateMany).not.toHaveBeenCalled();
  });

  it("ignores an advisory recorded before it named its subject", async () => {
    const db = makeDb({
      decisions: [decision({ interactionId: "DI-OLD", buildId: null, outcomePayload: { proposedOptionId: "aligned" } })],
      builds: [],
      ledger: [{ ledgerId: "DSL-DI-OLD", metadata: {} }],
    });
    const result = await resolveArchitectureAdvisoryOutcomes(db, { now: NOW });
    expect(result).toMatchObject({ examined: 0, resolved: 0, written: 0 });
    expect(db.featureBuild.findMany).not.toHaveBeenCalled();
  });

  it("counts a failed write and carries on", async () => {
    const db = makeDb({
      decisions: [decision({ interactionId: "DI-1" })],
      builds: [{ buildId: "FB-1", phase: "plan", designDoc: DESIGN, buildPlan: null }],
      ledger: [{ ledgerId: "DSL-DI-1", metadata: {} }],
    });
    db.decisionShadowLedger.updateMany.mockRejectedValueOnce(new Error("db down"));
    const result = await resolveArchitectureAdvisoryOutcomes(db, { now: NOW });
    expect(result).toMatchObject({ written: 0, failed: 1 });
  });
});
