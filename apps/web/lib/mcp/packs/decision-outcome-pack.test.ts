import { describe, expect, it, vi } from "vitest";

import { decisionOutcomePack } from "./decision-outcome-pack";
import { TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";

const recordDecisionOutcome = vi.fn();
const loadDecisionTrustReport = vi.fn();

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/decision/decision-outcome-store", () => ({
  recordDecisionOutcome: (input: unknown) => recordDecisionOutcome(input),
}));
vi.mock("@/lib/decision/decision-trust-state-store", () => ({
  loadDecisionTrustReport: (db: unknown) => loadDecisionTrustReport(db),
}));

function call(params: Record<string, unknown>) {
  return decisionOutcomePack.handlers.record_decision_outcome!(params, {} as never);
}

describe("record_decision_outcome definition", () => {
  const definition = decisionOutcomePack.definitions[0]!;

  it("declares itself a side-effecting record, not a read", () => {
    expect(definition.name).toBe("record_decision_outcome");
    expect(definition.sideEffect).toBe(true);
  });

  it("mirrors its grant into the gating source, which is agent-grants", () => {
    // composeToolPacks throws on a mismatch, but the failure reads as a
    // duplicate-registration error; assert the intent directly.
    expect(decisionOutcomePack.grants.record_decision_outcome).toEqual(["decision_record_create"]);
    expect(TOOL_TO_GRANTS.record_decision_outcome).toEqual(["decision_record_create"]);
  });

  it("tells the caller that an override is wanted, not something to soften", () => {
    // The whole value of this corpus is the labelled corrections. A description
    // that made an override sound like a failure would suppress exactly the
    // rows worth collecting.
    expect(definition.description).toContain("OVERRIDE");
    expect(definition.description).toContain("do not soften");
  });

  it("documents that an absent report is never read as agreement", () => {
    expect(definition.description).toContain("never read as agreement");
  });
});

describe("record_decision_outcome handler", () => {
  it("distinguishes an omitted chosenOptionId from an explicit null", async () => {
    // null MEANS unresolved. Collapsing the two would silently record
    // "unresolved" for a caller that simply forgot the field.
    recordDecisionOutcome.mockClear();
    const omitted = await call({ interactionId: "DI-1" });
    expect(omitted.success).toBe(false);
    expect(omitted.message).toContain("chosenOptionId is required");
    expect(recordDecisionOutcome).not.toHaveBeenCalled();

    recordDecisionOutcome.mockResolvedValueOnce({
      recorded: true,
      disposition: "unresolved",
      agreement: null,
      interactionId: "DI-1",
    });
    const explicit = await call({ interactionId: "DI-1", chosenOptionId: null });
    expect(explicit.success).toBe(true);
    expect(recordDecisionOutcome.mock.calls[0]![0]).toMatchObject({ chosenOptionId: null });
  });

  it("defaults the resolver to agent and rejects any other value", async () => {
    recordDecisionOutcome.mockClear();
    recordDecisionOutcome.mockResolvedValueOnce({
      recorded: true,
      disposition: "followed",
      agreement: true,
      interactionId: "DI-1",
    });
    await call({ interactionId: "DI-1", chosenOptionId: "a" });
    expect(recordDecisionOutcome.mock.calls[0]![0]).toMatchObject({ resolvedBy: "agent" });

    const bad = await call({ interactionId: "DI-1", chosenOptionId: "a", resolvedBy: "cron" });
    expect(bad.success).toBe(false);
    expect(bad.message).toContain('"agent" or "human"');
  });

  it("requires an interactionId", async () => {
    recordDecisionOutcome.mockClear();
    const result = await call({ interactionId: "  ", chosenOptionId: "a" });
    expect(result.success).toBe(false);
    expect(recordDecisionOutcome).not.toHaveBeenCalled();
  });

  it("reports an override plainly rather than as a failure", async () => {
    recordDecisionOutcome.mockClear();
    recordDecisionOutcome.mockResolvedValueOnce({
      recorded: true,
      disposition: "overridden",
      agreement: false,
      interactionId: "DI-7",
      shadowLedger: { written: true, ledgerId: "DSL-DI-7", agreement: false },
    });

    const result = await call({ interactionId: "DI-7", chosenOptionId: "b", resolvedBy: "human" });

    expect(result.success).toBe(true);
    expect(result.message).toContain("OVERRIDE");
    // BI-6082C235: whether the coworker's shadow-ledger row was completed is
    // part of the answer, so a skipped measurement is visible to the caller.
    expect(result.data).toEqual({
      interactionId: "DI-7",
      disposition: "overridden",
      agreement: false,
      shadowLedger: { written: true, ledgerId: "DSL-DI-7", agreement: false },
    });
  });

  it("surfaces a refusal with its reason so the caller can tell it from an outage", async () => {
    recordDecisionOutcome.mockClear();
    recordDecisionOutcome.mockResolvedValueOnce({
      recorded: false,
      reason: "already-resolved",
      detail: "An outcome is already recorded on this decision.",
    });

    const result = await call({ interactionId: "DI-7", chosenOptionId: "b" });

    expect(result.success).toBe(false);
    expect(result.data).toEqual({ reason: "already-resolved" });
    expect(result.message).toContain("already recorded");
  });

  it("trims an empty-string option into the unresolved disposition", async () => {
    recordDecisionOutcome.mockClear();
    recordDecisionOutcome.mockResolvedValueOnce({
      recorded: true,
      disposition: "unresolved",
      agreement: null,
      interactionId: "DI-1",
    });
    await call({ interactionId: "DI-1", chosenOptionId: "   " });
    expect(recordDecisionOutcome.mock.calls[0]![0]).toMatchObject({ chosenOptionId: null });
  });

  it("rejects a non-string, non-null option rather than stringifying it", async () => {
    recordDecisionOutcome.mockClear();
    const result = await call({ interactionId: "DI-1", chosenOptionId: 3 });
    expect(result.success).toBe(false);
    expect(recordDecisionOutcome).not.toHaveBeenCalled();
  });
});

describe("report_decision_trust_state (BI-7D1E43DE)", () => {
  const definition = decisionOutcomePack.definitions.find((d) => d.name === "report_decision_trust_state")!;

  it("is a read, granted at the registry_read tier in both places", () => {
    expect(definition.sideEffect).toBe(false);
    expect(decisionOutcomePack.grants.report_decision_trust_state).toEqual(["registry_read"]);
    expect(TOOL_TO_GRANTS.report_decision_trust_state).toEqual(["registry_read"]);
  });

  it("tells the caller not to estimate a withheld rate, and that agreement is not correctness", () => {
    expect(definition.description).toContain("insufficient samples");
    expect(definition.description).toContain("do not estimate");
    expect(definition.description).toContain("concordance, not correctness");
  });

  it("narrows to one coworker without dropping that coworker's unmeasured entry", async () => {
    loadDecisionTrustReport.mockResolvedValueOnce({
      minSamples: 10,
      allShadow: true,
      rows: [
        { agentId: "AGT-A", agreementRate: null },
        { agentId: "AGT-B", agreementRate: null },
      ],
      unmeasuredCoworkers: [{ agentId: "AGT-A", attributedDecisions: 3, inLedger: 0 }],
      caveats: ["Agreement is concordance, not correctness."],
    });
    const result = await decisionOutcomePack.handlers.report_decision_trust_state!({ agentId: "AGT-A" }, {} as never);
    expect(result.success).toBe(true);
    const data = result.data as { rows: Array<{ agentId: string }>; unmeasuredCoworkers: unknown[] };
    expect(data.rows.map((r) => r.agentId)).toEqual(["AGT-A"]);
    expect(data.unmeasuredCoworkers).toHaveLength(1);
    expect(result.message).toContain("Every level is shadow");
    expect(result.message).toContain("concordance, not correctness");
  });
});
