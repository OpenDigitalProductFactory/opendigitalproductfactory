import { describe, expect, it } from "vitest";

import { projectAreaTeam } from "./area-team";

// EP-2FB6C0CC, BI-A369B0AB — AC-AREA-TEAM: Team is a projection of route and
// work-shape bindings, room participants and owner roles; every row links to one
// canonical record and nothing is copied.

const agents = [
  { slug: "customer-advisor", agentId: "AGT-WS-CUSTOMER", displayName: "Customer Success Manager" },
  { slug: "storefront-advisor", agentId: "AGT-WS-STOREFRONT", displayName: "Storefront Operations Manager" },
];

describe("projectAreaTeam", () => {
  it("merges a coworker's route ownership, coordination and room roles into one row", () => {
    const team = projectAreaTeam({
      routeOwners: [{ agentSlug: "customer-advisor", routeLabel: "Customer" }],
      coordinators: [{ agentSlug: "customer-advisor", shapeTitle: "Inquiry response watch" }],
      participants: [
        { principalId: "PR-1", principalKind: "agent", displayName: "x", agentSlug: "customer-advisor", roles: ["coordinator"] },
        { principalId: "PR-1", principalKind: "agent", displayName: "x", agentSlug: "customer-advisor", roles: ["coordinator"] },
      ],
      ownerRoles: [],
      agents,
    });

    expect(team).toEqual([
      {
        id: "agent:customer-advisor",
        kind: "coworker",
        name: "Customer Success Manager",
        href: "/workforce/AGT-WS-CUSTOMER",
        does: ["Looks after Customer", "Coordinates Inquiry response watch", "Coordinator in 2 live rooms"],
      },
    ]);
  });

  it("lists people from room membership with a link to the identity record", () => {
    const team = projectAreaTeam({
      routeOwners: [],
      coordinators: [],
      participants: [
        { principalId: "PR-9", principalKind: "human", displayName: "Mark", agentSlug: null, roles: ["coordinator", "approver"] },
      ],
      ownerRoles: [],
      agents,
    });

    expect(team).toEqual([
      {
        id: "principal:PR-9",
        kind: "person",
        name: "Mark",
        href: "/platform/identity/principals",
        does: ["Approver in 1 live room, coordinator in 1 live room"],
      },
    ]);
  });

  it("shows an owner role nobody holds as an honest next step, after coworkers and people", () => {
    const team = projectAreaTeam({
      routeOwners: [{ agentSlug: "storefront-advisor", routeLabel: "Storefront" }],
      coordinators: [],
      participants: [],
      ownerRoles: ["role:customer-owner", "role:customer-owner"],
      agents,
    });

    expect(team.map((member) => [member.kind, member.name, member.href])).toEqual([
      ["coworker", "Storefront Operations Manager", "/workforce/AGT-WS-STOREFRONT"],
      ["unassigned-role", "Customer owner", null],
    ]);
    expect(team[1]?.does).toEqual(["Signs off this area's work. Not assigned to a person yet."]);
  });

  it("keeps an unknown coworker slug visible without inventing a record link", () => {
    const team = projectAreaTeam({
      routeOwners: [{ agentSlug: "retired-agent", routeLabel: "Finance" }],
      coordinators: [],
      participants: [],
      ownerRoles: [],
      agents,
    });
    expect(team[0]).toMatchObject({ name: "retired-agent", href: null });
  });
});
