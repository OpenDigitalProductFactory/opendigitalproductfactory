import { describe, expect, it } from "vitest";

import { parseStoredWorkroomOutcome } from "../work-management/room-cycle-adapter";
import {
  buildDeliberationOutcomeSeal,
  mapConsensusToOutcomeState,
  verdictNeedsEscalation,
} from "./deliberation-room";

const BASE = {
  deliberationRunId: "DRUN-1",
  adjudicatorTaskNodeId: "dnode-DRUN-1-summarizer-0",
  deliberationOutcomeId: "DOUT-1",
  mergedRecommendation: "Adopt option B; the objection is mitigated.",
  accountablePrincipalRef: "system:deliberation",
  completedAt: new Date("2026-08-14T00:00:00.000Z"),
};

describe("mapConsensusToOutcomeState", () => {
  it("maps consensus states to outcome states", () => {
    expect(mapConsensusToOutcomeState("consensus")).toBe("achieved");
    expect(mapConsensusToOutcomeState("partial-consensus")).toBe("partially-achieved");
    expect(mapConsensusToOutcomeState("no-consensus")).toBe("not-achieved");
    expect(mapConsensusToOutcomeState("insufficient-evidence")).toBe("not-achieved");
    expect(mapConsensusToOutcomeState("anything-else")).toBe("not-achieved");
  });
});

describe("verdictNeedsEscalation", () => {
  it("escalates only when consensus was not reached", () => {
    expect(verdictNeedsEscalation("consensus")).toBe(false);
    expect(verdictNeedsEscalation("partial-consensus")).toBe(false);
    expect(verdictNeedsEscalation("no-consensus")).toBe(true);
    expect(verdictNeedsEscalation("insufficient-evidence")).toBe(true);
  });
});

describe("buildDeliberationOutcomeSeal", () => {
  it("seals a consensus verdict as an achieved packet referencing the canonical outcome", () => {
    const { packet, storedPayload } = buildDeliberationOutcomeSeal({ ...BASE, consensusState: "consensus" });
    expect(packet.outcomeState).toBe("achieved");
    expect(packet.summary).toContain("option B");
    // Canonical evidence ref → satisfies raw_chat_not_durable + the task-node evidence requirement.
    expect(packet.evidenceRefs).toEqual([{ kind: "evidence", id: "DOUT-1" }]);
    expect(packet.accountablePrincipalRef).toBe("system:deliberation");
    // The stored payload round-trips through the room-outcome message parser.
    expect(parseStoredWorkroomOutcome(storedPayload)?.packet.outcomeState).toBe("achieved");
    expect(storedPayload.carrierId).toBe(BASE.adjudicatorTaskNodeId);
    expect(storedPayload.cycleKey).toBe("DRUN-1");
  });

  it("seals a no-consensus verdict as not-achieved (the review/escalation signal)", () => {
    const { packet } = buildDeliberationOutcomeSeal({ ...BASE, consensusState: "no-consensus" });
    expect(packet.outcomeState).toBe("not-achieved");
  });

  it("falls back to a generated summary when the recommendation is empty", () => {
    const { packet } = buildDeliberationOutcomeSeal({ ...BASE, mergedRecommendation: "  ", consensusState: "consensus" });
    expect(packet.summary).toContain("DRUN-1");
  });
});
