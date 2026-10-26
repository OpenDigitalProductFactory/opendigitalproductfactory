import { expect, it } from "vitest";
import { retainedAcceptanceWithoutBinding } from "./retained-acceptance";
import type { InitiativeReadinessDecision } from "@/lib/backlog/initiative-readiness/types";

it("a historical allowed verdict cannot discharge an unbound retained obligation or spawn a review", () => {
  const decision = { verdict: "allowed", satisfied: [], unmet: [], blockers: [] } as unknown as InitiativeReadinessDecision;
  const result = retainedAcceptanceWithoutBinding(decision, ["author"]);
  expect(result.closable).toBe(false);
  expect(result.owner).toBeNull();
  expect(result.objectiveMappingPacket).toBeUndefined();
  expect(result.owed).toEqual([expect.objectContaining({ code: "ACCEPTANCE_EVIDENCE_REQUIRED", state: "missing" })]);
  expect(result.unroutable[0]?.nextAction).toContain("deployed revision");
  expect(result.excludedAgentIds).toEqual(["author"]);
  expect(decision.verdict).toBe("allowed");
});

it("does not escalate Small runtime acceptance to a larger independent-review lane", () => {
  const decision = { verdict: "allowed", satisfied: [], unmet: [], blockers: [],
    shapeDecision: { effective: "small", declared: "small", sensitivity: "low" },
  } as unknown as InitiativeReadinessDecision;
  const result = retainedAcceptanceWithoutBinding(decision, ["author"]);
  expect(result.owed).toEqual([expect.objectContaining({
    code: "ACCEPTANCE_EVIDENCE_REQUIRED", state: "missing", accountableRole: "delivery-coordinator",
  })]);
  expect(result.closable).toBe(false);
  expect(result.owed[0]?.nextAction).toContain("runtime");
});

it("consumes genuine Small checks without clearing other unmet work or stronger shapes", () => {
  const decision = { verdict: "input-required", satisfied: [], unmet: [], blockers: [],
    shapeDecision: { effective: "small" },
  } as unknown as InitiativeReadinessDecision;
  const pass = { state: "pass" as const, evidenceRefs: ["runtime-check-1"] };
  expect(retainedAcceptanceWithoutBinding(decision, ["author"], pass)).toMatchObject({ closable: true, owed: [] });
  expect(retainedAcceptanceWithoutBinding(decision, ["author"], { state: "fail", evidenceRefs: ["failure"] }))
    .toMatchObject({ closable: false, owed: [expect.objectContaining({ state: "fail" })] });
  expect(retainedAcceptanceWithoutBinding({ ...decision, shapeDecision: { effective: "medium" } } as InitiativeReadinessDecision, ["author"], pass))
    .toMatchObject({ closable: false, owed: [expect.objectContaining({ state: "missing", accountableRole: "acceptance-reviewer" })] });
  expect(retainedAcceptanceWithoutBinding({ ...decision, unmet: [{ code: "RESEARCH_REQUIRED", state: "missing", accountableRole: "design-author" }] } as InitiativeReadinessDecision, [], pass).closable).toBe(false);
});
