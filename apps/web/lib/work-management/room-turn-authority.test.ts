import { describe, expect, it } from "vitest";

import { COWORKER_READ_BASELINE_GRANTS } from "@/lib/tak/agent-grants";

import {
  deriveRoomTurnAuthority,
  roomAuthorizesTool,
  workroomIdFromRoute,
  roomGrantsFromWorkShape,
  toRoomAuthorityContext,
  unroomedTurnAuthority,
  type RoomTurnAuthorityFacts,
} from "./room-turn-authority";
import { shapeDefaultPriority } from "./room-shapes";

const ASSURED = { preset: "assured" as const, qualityWeight: 0.8, costWeight: 0.1, timeWeight: 0.1 };

function room(overrides: Partial<NonNullable<RoomTurnAuthorityFacts["room"]>> = {}): NonNullable<RoomTurnAuthorityFacts["room"]> {
  return {
    workroomId: "WC-ROOM",
    collaborationShape: "outward-review",
    workShapeKey: null,
    workShapeGrants: null,
    declaredActionBoundary: null,
    declaredPriority: null,
    shapeActionBoundary: "propose",
    ...overrides,
  };
}

describe("roomGrantsFromWorkShape", () => {
  it("maps tool:read to the coworker read baseline and other tokens to grant keys", () => {
    const grants = roomGrantsFromWorkShape(["tool:read", "tool:web_search", "licence_record_write", " "]);
    for (const g of COWORKER_READ_BASELINE_GRANTS) expect(grants).toContain(g);
    expect(grants).toContain("web_search");
    expect(grants).toContain("licence_record_write");
    expect(grants).not.toContain("");
  });
});

describe("roomAuthorizesTool", () => {
  it("does not narrow when the room declares no surface", () => {
    expect(roomAuthorizesTool("search_public_web", null)).toBe(true);
    expect(roomAuthorizesTool("search_public_web", undefined)).toBe(true);
  });
  it("admits a tool the room surface carries and denies one it does not", () => {
    expect(roomAuthorizesTool("search_public_web", ["web_search"])).toBe(true);
    expect(roomAuthorizesTool("search_public_web", ["registry_read"])).toBe(false);
  });
});

describe("deriveRoomTurnAuthority — web access", () => {
  it("denies web without the standing web_search grant, even in a room whose activity carries it", () => {
    const out = deriveRoomTurnAuthority({
      room: room({ workShapeGrants: ["tool:read", "tool:web_search"] }),
      agentGrants: ["registry_read"],
      platformDefaultActionBoundary: null,
    });
    expect(out.externalAccess).toEqual({ enabled: false, reason: "no-web-search-grant" });
  });

  it("denies web when the room declares an activity that does not carry it — the room narrows the grant", () => {
    const out = deriveRoomTurnAuthority({
      room: room({ workShapeKey: "assurance-sweep", workShapeGrants: ["tool:read"] }),
      agentGrants: ["web_search"],
      platformDefaultActionBoundary: null,
    });
    expect(out.externalAccess).toEqual({ enabled: false, reason: "room-does-not-authorize-web" });
    expect(out.authorizedGrants).toEqual([...COWORKER_READ_BASELINE_GRANTS]);
  });

  it("admits web when the grant exists and the room does not narrow the surface", () => {
    const out = deriveRoomTurnAuthority({ room: room(), agentGrants: ["web_search"], platformDefaultActionBoundary: null });
    expect(out.externalAccess).toEqual({ enabled: true, reason: "web-search-grant" });
    expect(out.authorizedGrants).toBeNull();
  });

  it("unroomed: the standing grant alone decides web, exactly like a scheduled turn", () => {
    expect(unroomedTurnAuthority(["web_search"]).externalAccess.enabled).toBe(true);
    expect(unroomedTurnAuthority([]).externalAccess.enabled).toBe(false);
  });
});

describe("deriveRoomTurnAuthority — hands-on (form fill)", () => {
  it("follows the room's declared action boundary over the shape bias", () => {
    const advise = deriveRoomTurnAuthority({
      room: room({ declaredActionBoundary: "advise", shapeActionBoundary: "propose" }),
      agentGrants: [],
      platformDefaultActionBoundary: "preauthorized",
    });
    expect(advise.handsOn).toEqual({ enabled: false, reason: "room-advises-only" });
    const propose = deriveRoomTurnAuthority({
      room: room({ declaredActionBoundary: "propose" }),
      agentGrants: [],
      platformDefaultActionBoundary: null,
    });
    expect(propose.handsOn).toEqual({ enabled: true, reason: "room-action-boundary" });
  });

  it("falls to the shape bias when the room declares nothing", () => {
    const out = deriveRoomTurnAuthority({ room: room({ shapeActionBoundary: "propose" }), agentGrants: [], platformDefaultActionBoundary: null });
    expect(out.handsOn.enabled).toBe(true);
  });

  it("unroomed: the decreed platform room default decides; nothing declared means deny", () => {
    expect(unroomedTurnAuthority([]).handsOn).toEqual({ enabled: false, reason: "no-authority-declared" });
    const decreed = deriveRoomTurnAuthority({ room: null, agentGrants: [], platformDefaultActionBoundary: "propose" });
    expect(decreed.handsOn).toEqual({ enabled: true, reason: "platform-default-boundary" });
    const quiet = deriveRoomTurnAuthority({ room: null, agentGrants: [], platformDefaultActionBoundary: "advise" });
    expect(quiet.handsOn).toEqual({ enabled: false, reason: "platform-default-advises-only" });
  });
});

describe("deriveRoomTurnAuthority — Golden Triangle", () => {
  it("uses the room's declared priority first", () => {
    const out = deriveRoomTurnAuthority({ room: room({ declaredPriority: ASSURED }), agentGrants: [], platformDefaultActionBoundary: null });
    expect(out.priority).toEqual(ASSURED);
    expect(out.prioritySource).toBe("room-declaration");
  });

  it("falls to the collaboration shape's default preset, and to null when unroomed", () => {
    const out = deriveRoomTurnAuthority({ room: room({ collaborationShape: "escalation" }), agentGrants: [], platformDefaultActionBoundary: null });
    expect(out.priority).toEqual(shapeDefaultPriority("escalation"));
    expect(out.priority?.preset).toBe("fast");
    expect(out.prioritySource).toBe("shape-default");
    expect(unroomedTurnAuthority([]).priority).toBeNull();
  });

  it("two coworkers in the same room resolve the same priority regardless of identity", () => {
    const a = deriveRoomTurnAuthority({ room: room(), agentGrants: ["web_search"], platformDefaultActionBoundary: null });
    const b = deriveRoomTurnAuthority({ room: room(), agentGrants: [], platformDefaultActionBoundary: null });
    expect(a.priority).toEqual(b.priority);
    expect(a.handsOn).toEqual(b.handsOn);
  });
});

describe("deriveRoomTurnAuthority — participant term (W2)", () => {
  const withParticipants = (agentPrincipalId: string | null, roles: string[] | null) =>
    room({
      workShapeGrants: ["tool:read", "tool:web_search"],
      participants: [
        { principalId: "PR-OTHER", roles: ["coordinator"] },
        ...(roles ? [{ principalId: "PR-AGENT", roles }] : []),
      ],
      agentPrincipalId,
    });

  it("does not narrow a room that records no participants", () => {
    const out = deriveRoomTurnAuthority({ room: room(), agentGrants: ["web_search"], platformDefaultActionBoundary: null });
    expect(out.participantRoles).toBeNull();
    expect(out.memberOfRoom).toBe(true);
    expect(out.handsOn.enabled).toBe(true);
  });

  it("narrows a coworker the room does not list to the read baseline, hands off", () => {
    const out = deriveRoomTurnAuthority({ room: withParticipants("PR-AGENT", null), agentGrants: ["web_search"], platformDefaultActionBoundary: null });
    expect(out.memberOfRoom).toBe(false);
    expect(out.participantRoles).toEqual([]);
    expect(out.authorizedGrants).toEqual([...COWORKER_READ_BASELINE_GRANTS]);
    expect(out.externalAccess).toEqual({ enabled: false, reason: "room-does-not-authorize-web" });
    expect(out.handsOn).toEqual({ enabled: false, reason: "not-a-room-participant" });
  });

  it("treats an observer as read-only", () => {
    const out = deriveRoomTurnAuthority({ room: withParticipants("PR-AGENT", ["observer"]), agentGrants: ["web_search"], platformDefaultActionBoundary: null });
    expect(out.memberOfRoom).toBe(true);
    expect(out.handsOn.reason).toBe("not-a-room-participant");
    expect(out.authorizedGrants).toEqual([...COWORKER_READ_BASELINE_GRANTS]);
  });

  it("keeps the activity surface for a listed specialist", () => {
    const out = deriveRoomTurnAuthority({ room: withParticipants("PR-AGENT", ["specialist"]), agentGrants: ["web_search"], platformDefaultActionBoundary: null });
    expect(out.participantRoles).toEqual(["specialist"]);
    expect(out.externalAccess.enabled).toBe(true);
    expect(out.handsOn.enabled).toBe(true);
  });

  it("an unresolved agent principal in a participant-recording room is not a member", () => {
    const out = deriveRoomTurnAuthority({ room: withParticipants(null, ["specialist"]), agentGrants: [], platformDefaultActionBoundary: null });
    expect(out.memberOfRoom).toBe(false);
  });
});

describe("workroomIdFromRoute", () => {
  it("names the room from the Build Studio work page and the Workroom case page", () => {
    expect(workroomIdFromRoute("/build/work/WC-ROOM")).toBe("WC-ROOM");
    expect(workroomIdFromRoute("/workspace/cases/work-capsule%3AWC-F99E0B98")).toBe("WC-F99E0B98");
    expect(workroomIdFromRoute("/workspace/cases/work-capsule:WC-F99E0B98?tab=details")).toBe("WC-F99E0B98");
  });
  it("returns null for routes that do not name a room directly", () => {
    expect(workroomIdFromRoute("/workspace/cases/booking%3ABK-1")).toBeNull();
    expect(workroomIdFromRoute("/finance")).toBeNull();
    expect(workroomIdFromRoute(null)).toBeNull();
  });
});

describe("toRoomAuthorityContext", () => {
  it("projects only the executor-relevant fields and null when unroomed", () => {
    const ctx = toRoomAuthorityContext(deriveRoomTurnAuthority({
      room: room({ workShapeKey: "assurance-sweep", workShapeGrants: ["tool:read"] }),
      agentGrants: [],
      platformDefaultActionBoundary: null,
    }));
    expect(ctx?.workroomId).toBe("WC-ROOM");
    expect(ctx?.workShapeKey).toBe("assurance-sweep");
    expect(ctx?.authorizedGrants).toEqual([...COWORKER_READ_BASELINE_GRANTS]);
    expect(toRoomAuthorityContext(unroomedTurnAuthority([]))).toBeNull();
  });
});
