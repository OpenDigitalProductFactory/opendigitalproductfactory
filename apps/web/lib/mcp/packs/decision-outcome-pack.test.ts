import { describe, expect, it, vi } from "vitest";

import { decisionOutcomePack } from "./decision-outcome-pack";
import { TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";

const recordDecisionOutcome = vi.fn();

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/decision/decision-outcome-store", () => ({
  recordDecisionOutcome: (input: unknown) => recordDecisionOutcome(input),
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
    });

    const result = await call({ interactionId: "DI-7", chosenOptionId: "b", resolvedBy: "human" });

    expect(result.success).toBe(true);
    expect(result.message).toContain("OVERRIDE");
    expect(result.data).toEqual({ interactionId: "DI-7", disposition: "overridden", agreement: false });
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
