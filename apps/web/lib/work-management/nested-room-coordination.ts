import { responsibilityParentsOf, type AccountabilityEdge } from "./human-accountability";

export type CoordinationActor = {
  principalId: string;
  displayName: string;
  kind: "person" | "agent";
  agentId: string | null;
};
export type NestedRoomCoordinationInput = {
  roomId: string;
  rooms: Array<{ roomId: string; coordinators: CoordinationActor[] }>;
  edges: AccountabilityEdge[];
  unresolvedRoomIds?: readonly string[];
  agents: Array<{ agentId: string; displayName: string; escalatesTo: string | null }>;
  humanRoles: Array<{ roleId: string; displayName: string; holders: CoordinationActor[] }>;
};
export type CoordinationStep = {
  kind: "room-owner" | "agent" | "human-role" | "human";
  ref: string;
  displayName: string;
  roomId?: string;
};
export type NestedRoomCoordination = {
  delegations: Array<{ parentRoomId: string; childRoomId: string;
    parentCoordinatorId: string; childCoordinatorId: string }>;
  escalation: { state: "resolved"; steps: CoordinationStep[] }
    | { state: "setup-required"; reason: string; steps: CoordinationStep[]; targetRef?: string };
};

/** Read-only projection of existing ownership and relation records; grants no authority. */
export function projectNestedRoomCoordination(input: NestedRoomCoordinationInput): NestedRoomCoordination {
  const delegations: NestedRoomCoordination["delegations"] = [];
  const steps: CoordinationStep[] = [];
  const blocked = (reason: string, targetRef?: string): NestedRoomCoordination => ({
    delegations, escalation: { state: "setup-required", reason, steps, ...(targetRef ? { targetRef } : {}) },
  });
  const rooms = new Map(input.rooms.map(room => [room.roomId, room]));
  const lineage: string[] = [];
  let current: string | undefined = input.roomId;
  // Validate the complete recorded lineage before claiming a route is usable.
  while (current) {
    if (lineage.includes(current)) return blocked("responsibility-cycle");
    if (lineage.length >= 32 || input.unresolvedRoomIds?.includes(current) || !rooms.has(current)) {
      return blocked("incomplete-responsibility-lineage");
    }
    lineage.push(current);
    const parents = responsibilityParentsOf(input.edges, current);
    if (parents.length > 1) return blocked("conflicting-responsibility-parents");
    current = parents[0];
  }
  const owners = new Map<string, CoordinationActor>();
  for (const roomId of lineage) {
    const coordinators = [...new Map(rooms.get(roomId)!.coordinators.map(actor => [actor.principalId, actor])).values()];
    if (coordinators.length > 1) return blocked("conflicting-coordinators");
    // Zero coordinators: the room is unowned. Escalate past it to the parent
    // rather than inventing an owner or blocking the recorded parent path.
    if (coordinators.length === 1) owners.set(roomId, coordinators[0]!);
  }
  for (let i = 1; i < lineage.length; i += 1) {
    const childRoomId = lineage[i - 1]!;
    const parentRoomId = lineage[i]!;
    const parentOwner = owners.get(parentRoomId);
    const childOwner = owners.get(childRoomId);
    if (!parentOwner || !childOwner) continue;
    delegations.push({ parentRoomId, childRoomId,
      parentCoordinatorId: parentOwner.principalId,
      childCoordinatorId: childOwner.principalId });
  }
  const seenPrincipals = new Set<string>();
  const seenAgents = new Set<string>();
  for (const roomId of lineage) {
    const owner = owners.get(roomId);
    if (!owner) continue;
    if (!seenPrincipals.has(owner.principalId)) {
      steps.push({ kind: owner.kind === "person" ? "human" : "room-owner",
        ref: owner.principalId, displayName: owner.displayName, roomId });
      seenPrincipals.add(owner.principalId);
    }
    if (owner.kind === "person") return { delegations, escalation: { state: "resolved", steps } };
    if (owner.agentId) seenAgents.add(owner.agentId);
  }
  let registryStart: string | null = null;
  for (let i = lineage.length - 1; i >= 0; i -= 1) {
    const owner = owners.get(lineage[i]!);
    if (owner?.agentId) { registryStart = owner.agentId; break; }
  }
  if (!registryStart) return blocked("coordinator-not-recorded");
  const agents = new Map(input.agents.map((row) => [row.agentId, row] as const));
  let currentAgentId: string = registryStart;
  for (let depth = 0; depth < 32; depth += 1) {
    const agent = agents.get(currentAgentId);
    if (!agent) return blocked("agent-not-recorded");
    const next = agent.escalatesTo;
    if (!next) return blocked("escalation-target-not-recorded");
    if (next.startsWith("HR-")) {
      const roles = input.humanRoles.filter(role => role.roleId === next);
      if (roles.length !== 1) return blocked("human-role-not-recorded", next);
      const role = roles[0]!;
      steps.push({ kind: "human-role", ref: role.roleId, displayName: role.displayName });
      const holders = [...new Map(role.holders.map(actor => [actor.principalId, actor])).values()];
      if (holders.length !== 1) return blocked(holders.length ? "human-role-conflict" : "human-role-unfilled");
      const person = holders[0]!;
      if (person.kind !== "person") return blocked("role-holder-not-human");
      steps.push({ kind: "human", ref: person.principalId, displayName: person.displayName });
      return { delegations, escalation: { state: "resolved", steps } };
    }
    if (seenAgents.has(next)) return blocked("agent-escalation-cycle");
    seenAgents.add(next);
    const nextAgent = agents.get(next);
    if (!nextAgent) return blocked("agent-not-recorded");
    steps.push({ kind: "agent", ref: next, displayName: nextAgent.displayName });
    currentAgentId = next;
  }
  return blocked("agent-escalation-limit");
}
