// EP-2FB6C0CC (spec 2026-08-14-portfolio-shaped-information-architecture-design.md
// §9.3 item 2, BI-A369B0AB): an area's Team view. The people and AI coworkers who
// work in a portfolio area, and what each may do there.
//
// A projection only. Every row comes from substrate that already records it:
//   - route ownership: ROUTE_AGENT_MAP, projected into AuthorityBinding scopeType=route
//   - standing-room coordination: AuthorityBinding scopeType=workroom, resourceType=work-shape
//   - room membership: WorkroomParticipant on the area's live rooms
//   - owner roles: the `role:*` stage owners of the area's work shapes
// Agent.portfolioId is NOT used: it records where a coworker is employed
// (AI coworkers are Workforce capacity), not the area it serves.

export type AreaTeamMemberKind = "coworker" | "person" | "unassigned-role";

export type AreaTeamMember = {
  /** Stable identity: `agent:<slug>`, `principal:<id>` or `role:<role>`. */
  id: string;
  kind: AreaTeamMemberKind;
  name: string;
  /** The one canonical record for this member; null for an unassigned role. */
  href: string | null;
  /** What this member does in the area, one plain sentence each. */
  does: string[];
};

export type AreaRouteOwner = { agentSlug: string; routeLabel: string };
export type AreaCoordinator = { agentSlug: string; shapeTitle: string };
export type AreaParticipant = {
  principalId: string;
  principalKind: string;
  displayName: string;
  agentSlug: string | null;
  roles: readonly string[];
};
export type AreaAgentIdentity = { slug: string; agentId: string; displayName: string };

export type AreaTeamInput = {
  routeOwners: readonly AreaRouteOwner[];
  coordinators: readonly AreaCoordinator[];
  participants: readonly AreaParticipant[];
  /** `role:<role>` refs from the area's work shapes that no binding resolves to a person. */
  ownerRoles: readonly string[];
  agents: readonly AreaAgentIdentity[];
};

function humanizeRole(ref: string): string {
  const role = ref.replace(/^role:/, "").replace(/-/g, " ");
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function roleCounts(roles: readonly string[][]): string {
  const counts = new Map<string, number>();
  for (const list of roles) for (const role of list) counts.set(role, (counts.get(role) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([role, count]) => `${role} in ${count} live room${count === 1 ? "" : "s"}`)
    .join(", ");
}

/** Pure: merge the four sources into one row per member, coworkers first. */
export function projectAreaTeam(input: AreaTeamInput): AreaTeamMember[] {
  const agentsBySlug = new Map(input.agents.map((agent) => [agent.slug, agent]));
  const members = new Map<string, AreaTeamMember>();

  const coworker = (slug: string): AreaTeamMember => {
    const id = `agent:${slug}`;
    let member = members.get(id);
    if (!member) {
      const agent = agentsBySlug.get(slug);
      member = {
        id,
        kind: "coworker",
        name: agent?.displayName ?? slug,
        href: agent ? `/workforce/${agent.agentId}` : null,
        does: [],
      };
      members.set(id, member);
    }
    return member;
  };

  for (const owner of input.routeOwners) coworker(owner.agentSlug).does.push(`Looks after ${owner.routeLabel}`);
  for (const coordinator of input.coordinators) {
    coworker(coordinator.agentSlug).does.push(`Coordinates ${coordinator.shapeTitle}`);
  }

  const roomRoles = new Map<string, string[][]>();
  for (const participant of input.participants) {
    const member =
      participant.principalKind === "agent" && participant.agentSlug
        ? coworker(participant.agentSlug)
        : (members.get(`principal:${participant.principalId}`) ??
          (() => {
            const person: AreaTeamMember = {
              id: `principal:${participant.principalId}`,
              kind: participant.principalKind === "agent" ? "coworker" : "person",
              name: participant.displayName,
              href: "/platform/identity/principals",
              does: [],
            };
            members.set(person.id, person);
            return person;
          })());
    const list = roomRoles.get(member.id) ?? [];
    list.push([...participant.roles]);
    roomRoles.set(member.id, list);
  }
  for (const [id, roles] of roomRoles) {
    const summary = roleCounts(roles);
    if (summary) members.get(id)!.does.push(summary.charAt(0).toUpperCase() + summary.slice(1));
  }

  for (const ref of [...new Set(input.ownerRoles)].sort()) {
    members.set(ref, {
      id: ref,
      kind: "unassigned-role",
      name: humanizeRole(ref),
      href: null,
      does: ["Signs off this area's work. Not assigned to a person yet."],
    });
  }

  const order: Record<AreaTeamMemberKind, number> = { coworker: 0, person: 1, "unassigned-role": 2 };
  return [...members.values()]
    .map((member) => ({ ...member, does: [...new Set(member.does)] }))
    .sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
}
