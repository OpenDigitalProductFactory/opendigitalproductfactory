import { describe, expect, it, vi } from "vitest";

import {
  BACKLOG_TRIAGE_GATE_KEY,
  TRIAGE_LEDGER_ROUTE_CONTEXT,
  recordTriageDecision,
  triageRiskTier,
} from "./backlog-triage-ledger";
import { tierForGateKey } from "@/lib/wiki/decision-audit";
import type { TriageCandidate, TriageDecision } from "./backlog-triage-drain";

const item: TriageCandidate = { itemId: "BI-XYZ", title: "Add a thing" };
const decision: TriageDecision = {
  outcome: "build",
  effortSize: "small",
  confidence: 0.93,
  rationale: "clearly scoped",
};

function makeDb(overrides: { version?: { versionId: string } | null } = {}) {
  return {
    decisionPerspectiveProfileVersion: {
      findFirst: vi.fn(async () =>
        overrides.version === undefined ? { versionId: "PV-1" } : overrides.version,
      ),
    },
    decisionInteraction: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => args.data),
    },
  };
}

describe("recordTriageDecision", () => {
  it("writes a ledger row keyed to the triage gate", async () => {
    const db = makeDb();
    const outcome = await recordTriageDecision({
      db: db as never,
      item,
      decision,
      appliedEffortSize: "small",
      effortSizeFromAuthor: false,
    });

    expect(outcome.recorded).toBe(true);
    const data = db.decisionInteraction.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.gateKey).toBe(BACKLOG_TRIAGE_GATE_KEY);
    expect(data.routeContext).toBe(TRIAGE_LEDGER_ROUTE_CONTEXT);
    // The drain applies the decision, so it arbitrates rather than advises.
    expect(data.outcomeType).toBe("arbitrate");
    expect(data.question).toContain("BI-XYZ");
  });

  it("records the mutation it is about to authorise, so the row is auditable against the item", async () => {
    const db = makeDb();
    await recordTriageDecision({
      db: db as never,
      item,
      decision,
      appliedEffortSize: "large",
      effortSizeFromAuthor: true,
    });

    const data = db.decisionInteraction.create.mock.calls[0]![0].data as Record<string, unknown>;
    const payload = data.outcomePayload as Record<string, unknown>;
    expect(payload.autonomous).toBe(true);
    expect(payload.backlogItemId).toBe("BI-XYZ");
    expect(payload.mutationApplied).toEqual({
      status: "open",
      triageOutcome: "build",
      effortSize: "large",
    });
    // The divergence between author size and model size is preserved, so an
    // operator can see the model wanted something else.
    expect(payload.effortSizeFromAuthor).toBe(true);
    expect(payload.modelProposedEffortSize).toBe("small");
  });

  it("refuses (rather than throws) when the platform profile has no version row", async () => {
    const db = makeDb({ version: null });
    const outcome = await recordTriageDecision({
      db: db as never,
      item,
      decision,
      appliedEffortSize: "small",
      effortSizeFromAuthor: false,
    });

    expect(outcome).toEqual({ recorded: false, reason: "profile-not-provisioned" });
    expect(db.decisionInteraction.create).not.toHaveBeenCalled();
  });

  it("refuses (rather than throws) when the ledger write fails", async () => {
    const db = makeDb();
    db.decisionInteraction.create = vi.fn(async () => {
      throw new Error("db down");
    });

    const outcome = await recordTriageDecision({
      db: db as never,
      item,
      decision,
      appliedEffortSize: "small",
      effortSizeFromAuthor: false,
    });

    expect(outcome).toEqual({ recorded: false, reason: "ledger-write-failed" });
  });
});

describe("triageRiskTier", () => {
  it("never rates an unattended mutation as low risk", () => {
    for (const size of ["small", "medium", "large", "xlarge"]) {
      expect(triageRiskTier(size)).not.toBe("low");
    }
  });

  it("escalates with committed effort", () => {
    expect(triageRiskTier("small")).toBe("medium");
    expect(triageRiskTier("medium")).toBe("medium");
    expect(triageRiskTier("large")).toBe("high");
    expect(triageRiskTier("xlarge")).toBe("high");
  });
});

describe("triage gate tiering", () => {
  it("audits under WWMD — triage is a platform-doctrine call", () => {
    expect(tierForGateKey(BACKLOG_TRIAGE_GATE_KEY)).toBe("wwmd");
  });

  it("stays distinguishable from the Build Studio gate within that tier", () => {
    expect(BACKLOG_TRIAGE_GATE_KEY).not.toBe("build-studio");
  });
});
