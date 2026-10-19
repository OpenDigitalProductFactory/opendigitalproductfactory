import { describe, expect, it } from "vitest";
import { projectNestedRoomCoordination, type NestedRoomCoordinationInput } from "./nested-room-coordination";

const actor = (principalId: string, agentId?: string) => ({ principalId, displayName: principalId,
  kind: agentId ? "agent" as const : "person" as const, agentId: agentId ?? null });
const fixture = (): NestedRoomCoordinationInput => ({
  roomId: "child",
  rooms: [{ roomId: "child", coordinators: [actor("specialist", "AGT-101")] },
    { roomId: "parent", coordinators: [actor("orchestrator", "AGT-100")] }],
  edges: [{ fromWorkroomId: "parent", toWorkroomId: "child", relation: "contains" }],
  agents: [{ agentId: "AGT-100", displayName: "Portfolio coordinator", escalatesTo: "AGT-ORCH-000" },
    { agentId: "AGT-ORCH-000", displayName: "COO", escalatesTo: "HR-000" }],
  humanRoles: [{ roleId: "HR-000", displayName: "Accountable owner", holders: [actor("recorded-human")] }],
});

describe("nested Workroom coordination", () => {
  it("projects declared delegation and walks parent coordinators and registry to one named human", () => {
    const result = projectNestedRoomCoordination(fixture());
    expect(result.delegations).toEqual([{ parentRoomId: "parent", childRoomId: "child",
      parentCoordinatorId: "orchestrator", childCoordinatorId: "specialist" }]);
    expect(result.escalation.state).toBe("resolved");
    expect(result.escalation.steps.map(step => step.ref)).toEqual([
      "specialist", "orchestrator", "AGT-ORCH-000", "HR-000", "recorded-human",
    ]);
  });

  it("does not turn dependency or contribution into delegation or inherited authority", () => {
    const input = fixture();
    input.edges = input.edges.map(edge => ({ ...edge, relation: "depends-on" }));
    const result = projectNestedRoomCoordination(input);
    expect(result.delegations).toEqual([]);
    expect(result.escalation).toMatchObject({ state: "setup-required", reason: "agent-not-recorded" });
  });

  it("refuses cycles before presenting even a recorded human as a valid route", () => {
    const input = fixture();
    input.rooms[0]!.coordinators = [actor("recorded-human")];
    input.edges.push({ fromWorkroomId: "child", toWorkroomId: "parent", relation: "contains" });
    expect(projectNestedRoomCoordination(input).escalation).toMatchObject({
      state: "setup-required", reason: "responsibility-cycle",
    });
  });

  it("refuses ambiguous parents and multiple coordinators instead of picking a first row", () => {
    const input = fixture();
    input.edges.push({ fromWorkroomId: "other", toWorkroomId: "child", relation: "contains" });
    expect(projectNestedRoomCoordination(input).escalation).toMatchObject({
      state: "setup-required", reason: "conflicting-responsibility-parents",
    });
    const multiple = fixture();
    multiple.rooms[1]!.coordinators.push(actor("second"));
    expect(projectNestedRoomCoordination(multiple).escalation).toMatchObject({
      state: "setup-required", reason: "conflicting-coordinators",
    });
  });

  it("refuses an orchestrator loop and never falls back to a convenient administrator", () => {
    const input = fixture();
    input.agents[1]!.escalatesTo = "AGT-100";
    expect(projectNestedRoomCoordination(input).escalation).toMatchObject({
      state: "setup-required", reason: "agent-escalation-cycle",
    });
  });

  it.each([
    { holders: [], reason: "human-role-unfilled" },
    { holders: [actor("one"), actor("two")], reason: "human-role-conflict" },
    { holders: [actor("not-human", "AGT-100")], reason: "role-holder-not-human" },
  ])(
    "requires exactly one recorded human role holder: $reason", ({ holders, reason }) => {
      const input = fixture();
      input.humanRoles[0]!.holders = holders;
      expect(projectNestedRoomCoordination(input).escalation).toMatchObject({ state: "setup-required", reason });
    },
  );

  it("reports bounded unread ancestry rather than treating truncation as a root", () => {
    const input = fixture();
    input.unresolvedRoomIds = ["parent"];
    expect(projectNestedRoomCoordination(input).escalation).toMatchObject({
      state: "setup-required", reason: "incomplete-responsibility-lineage",
    });
  });

  it("keeps room ownership distinct from escalation and does not mutate any inputs", () => {
    const input = fixture();
    const before = JSON.stringify(input);
    projectNestedRoomCoordination(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
