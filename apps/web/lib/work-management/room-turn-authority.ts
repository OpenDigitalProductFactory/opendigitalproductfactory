// EP-WORK-POSTURE §8.2 — the room owns the coworker's controls (founder
// direction 2026-09-08; BI-947780FE, BI-F114354D, BI-7ADEBDC1).
//
// Until this module existed, three per-turn decisions were made by whoever
// was typing: whether the coworker could fill fields on the page, whether it
// could reach the public web, and which Cost/Quality/Time posture it ran at.
// The first two were browser-stored switches POSTed as client-asserted
// booleans; the third was a per-coworker identity preference. None of them
// looked at the Workroom the coworker was working in.
//
// This is the ONE resolver for all three. It is pure: the server half
// (room-turn-authority.server.ts) loads the room and the grants and hands
// them here. Every rule below is deny-by-default and tighten-only —
// a room may narrow what a coworker's standing grants permit; it never widens.
import { COWORKER_READ_BASELINE_GRANTS, isToolAllowedByGrants } from "@/lib/tak/agent-grants";
import type { GoldenTrianglePreference } from "@/lib/golden-triangle/types";
import type { ProactivityActionBoundary } from "@/lib/proactivity/proactivity-types";

import { shapeDefaultPriority, type WorkroomShapeKey } from "./room-shapes";

/** What the turn was actually given. Everything here is server-resolved. */
export type RoomTurnAuthority = {
  /** Semantic Workroom id (WC-*) the turn runs in, or null when unroomed. */
  workroomId: string | null;
  /** The room's collaboration shape (declared, or null when the room has none). */
  collaborationShape: WorkroomShapeKey | null;
  /** The room's declared standing activity shape key@version, when any. */
  workShapeKey: string | null;
  /**
   * The grants the ROOM authorizes for this turn, in the agent-grant vocabulary.
   * `null` = the room declares no activity shape, so the coworker's own grants
   * bound the surface alone. Non-null = the effective surface is the
   * intersection of the coworker's grants and this list.
   */
  authorizedGrants: readonly string[] | null;
  /** The action boundary the room resolved (declared → shape bias → default). */
  actionBoundary: ProactivityActionBoundary | null;
  externalAccess: {
    enabled: boolean;
    reason:
      | "web-search-grant"
      | "no-web-search-grant"
      | "room-does-not-authorize-web";
  };
  handsOn: {
    enabled: boolean;
    reason:
      | "room-action-boundary"
      | "room-advises-only"
      | "platform-default-boundary"
      | "platform-default-advises-only"
      | "no-authority-declared";
  };
  /** The Cost/Quality/Time posture the room runs at, or null to fall to org/platform. */
  priority: GoldenTrianglePreference | null;
  prioritySource: "room-declaration" | "shape-default" | null;
};

export type RoomTurnAuthorityFacts = {
  /** The room the turn runs in, already loaded; null when unroomed. */
  room: {
    workroomId: string;
    collaborationShape: WorkroomShapeKey | null;
    workShapeKey: string | null;
    /** `WorkShapeDefinition.grants` for the declared activity shape, or null. */
    workShapeGrants: readonly string[] | null;
    declaredActionBoundary: ProactivityActionBoundary | null;
    declaredPriority: GoldenTrianglePreference | null;
    /** The shape-derived action boundary (work-posture derive.ts), when any. */
    shapeActionBoundary: ProactivityActionBoundary | null;
  } | null;
  /** The coworker's standing grants (AgentToolGrant / registry), already loaded. */
  agentGrants: readonly string[];
  /** The decreed platform default for rooms (WorkroomDefaultControl), when set. */
  platformDefaultActionBoundary: ProactivityActionBoundary | null;
};

const WORK_SHAPE_GRANT_PREFIX = "tool:";

/**
 * Translate a work shape's `grants` ("tool:read", "tool:web_search", …) into the
 * agent-grant vocabulary the runtime already enforces. "tool:read" expands to
 * the coworker read baseline; every other token is the grant key verbatim.
 * Unknown tokens pass through — an unknown key matches no tool, which is a
 * deny, never a widen.
 */
export function roomGrantsFromWorkShape(grants: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of grants) {
    const token = raw.startsWith(WORK_SHAPE_GRANT_PREFIX)
      ? raw.slice(WORK_SHAPE_GRANT_PREFIX.length)
      : raw;
    if (token === "read") {
      for (const g of COWORKER_READ_BASELINE_GRANTS) out.add(g);
      continue;
    }
    if (token.trim()) out.add(token.trim());
  }
  return [...out];
}

/** Whether a room-authorized surface admits a tool. `null` surface = room does not narrow. */
export function roomAuthorizesTool(
  toolName: string,
  authorizedGrants: readonly string[] | null | undefined,
): boolean {
  if (!authorizedGrants) return true;
  return isToolAllowedByGrants(toolName, [...authorizedGrants]);
}

function boundaryPermitsHandsOn(boundary: ProactivityActionBoundary | null): boolean {
  return boundary === "propose" || boundary === "preauthorized";
}

/**
 * Pure derivation. Order of authority, tighten-only:
 *   web:      standing `web_search` grant AND (no room surface OR room surface carries it)
 *   hands-on: the room's action boundary (declared → shape) is propose/preauthorized;
 *             unroomed → the decreed platform room default; nothing declared → deny
 *   priority: room declaration → shape default → null (org/platform decide)
 */
export function deriveRoomTurnAuthority(facts: RoomTurnAuthorityFacts): RoomTurnAuthority {
  const room = facts.room;
  const hasWebGrant = facts.agentGrants.includes("web_search");
  const authorizedGrants = room?.workShapeGrants ? roomGrantsFromWorkShape(room.workShapeGrants) : null;

  let externalAccess: RoomTurnAuthority["externalAccess"];
  if (!hasWebGrant) {
    externalAccess = { enabled: false, reason: "no-web-search-grant" };
  } else if (authorizedGrants && !authorizedGrants.includes("web_search")) {
    externalAccess = { enabled: false, reason: "room-does-not-authorize-web" };
  } else {
    externalAccess = { enabled: true, reason: "web-search-grant" };
  }

  const actionBoundary: ProactivityActionBoundary | null = room
    ? room.declaredActionBoundary ?? room.shapeActionBoundary ?? facts.platformDefaultActionBoundary
    : facts.platformDefaultActionBoundary;

  let handsOn: RoomTurnAuthority["handsOn"];
  if (room) {
    handsOn = boundaryPermitsHandsOn(actionBoundary)
      ? { enabled: true, reason: "room-action-boundary" }
      : actionBoundary
        ? { enabled: false, reason: "room-advises-only" }
        : { enabled: false, reason: "no-authority-declared" };
  } else if (facts.platformDefaultActionBoundary) {
    handsOn = boundaryPermitsHandsOn(facts.platformDefaultActionBoundary)
      ? { enabled: true, reason: "platform-default-boundary" }
      : { enabled: false, reason: "platform-default-advises-only" };
  } else {
    handsOn = { enabled: false, reason: "no-authority-declared" };
  }

  let priority: GoldenTrianglePreference | null = null;
  let prioritySource: RoomTurnAuthority["prioritySource"] = null;
  if (room?.declaredPriority) {
    priority = room.declaredPriority;
    prioritySource = "room-declaration";
  } else if (room?.collaborationShape) {
    priority = shapeDefaultPriority(room.collaborationShape);
    prioritySource = "shape-default";
  }

  return {
    workroomId: room?.workroomId ?? null,
    collaborationShape: room?.collaborationShape ?? null,
    workShapeKey: room?.workShapeKey ?? null,
    authorizedGrants,
    actionBoundary,
    externalAccess,
    handsOn,
    priority,
    prioritySource,
  };
}

/** The unroomed, no-authority-declared answer: everything denied, nothing inherited. */
export function unroomedTurnAuthority(agentGrants: readonly string[]): RoomTurnAuthority {
  return deriveRoomTurnAuthority({ room: null, agentGrants, platformDefaultActionBoundary: null });
}

/**
 * The context the governed executor carries per call so the authority
 * evaluator can deny a tool the room does not authorize (BI-F114354D).
 */
export type RoomAuthorityContext = Pick<
  RoomTurnAuthority,
  "workroomId" | "collaborationShape" | "workShapeKey" | "authorizedGrants" | "actionBoundary"
>;

export function toRoomAuthorityContext(authority: RoomTurnAuthority): RoomAuthorityContext | null {
  if (!authority.workroomId) return null;
  return {
    workroomId: authority.workroomId,
    collaborationShape: authority.collaborationShape,
    workShapeKey: authority.workShapeKey,
    authorizedGrants: authority.authorizedGrants,
    actionBoundary: authority.actionBoundary,
  };
}
