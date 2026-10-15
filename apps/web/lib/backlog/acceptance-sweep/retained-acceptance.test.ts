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
