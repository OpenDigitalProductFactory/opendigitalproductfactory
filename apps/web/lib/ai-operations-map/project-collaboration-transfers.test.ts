import { describe, expect, it } from "vitest";
import { projectCollaborationTransfers } from "./project-collaboration-transfers";

describe("projectCollaborationTransfers", () => {
  const labels = { "AGT-OWNER": "COO", "AGT-EA": "Enterprise Architect" };

  it("projects rows newest-first with resolved labels and mapped state", () => {
    const out = projectCollaborationTransfers({
      agentLabels: labels,
      delegationChains: [
        { id: "c1", fromAgentId: "AGT-OWNER", toAgentId: "AGT-EA", status: "active", reason: "coworker handoff", startedAt: new Date("2026-06-05T00:00:00Z") },
        { id: "c2", fromAgentId: "AGT-OWNER", toAgentId: "AGT-EA", status: "completed", reason: null, startedAt: new Date("2026-06-05T01:00:00Z") },
      ],
    });
    expect(out.map((t) => t.id)).toEqual(["c2", "c1"]); // newest first
    expect(out[0]).toMatchObject({ fromLabel: "COO", toLabel: "Enterprise Architect", state: "completed" });
    expect(out[1].state).toBe("active");
  });

  it("maps blocked status and keeps the reason", () => {
    const out = projectCollaborationTransfers({
      agentLabels: labels,
      delegationChains: [
        { id: "c3", fromAgentId: "AGT-OWNER", toAgentId: "AGT-X", status: "blocked", reason: "not permitted", startedAt: new Date("2026-06-05T00:00:00Z") },
      ],
    });
    expect(out[0]).toMatchObject({ state: "blocked", reason: "not permitted", toLabel: "AGT-X" }); // unknown label falls back to id
  });

  it("respects the limit", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `c${i}`,
      fromAgentId: "AGT-OWNER",
      toAgentId: "AGT-EA",
      status: "active",
      reason: null,
      startedAt: new Date(2026, 5, 5, i),
    }));
    expect(projectCollaborationTransfers({ agentLabels: labels, delegationChains: rows, limit: 2 })).toHaveLength(2);
  });
});
