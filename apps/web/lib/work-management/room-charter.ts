/**
 * Room charter (BI-C649809F): the room's recorded decision about who may join
 * without a person being asked. Pure module.
 *
 * A charter names the participant kinds a room admits, the highest GAID
 * authorization class (GAID §9) an admitted participant may hold there, and when
 * it expires. It lives on the room policy (`workroomPolicy.charter` in
 * WorkItem.evidence). A room with no explicit charter gets the platform default
 * only when its sensitivity ceiling is public or internal; confidential and
 * restricted rooms admit no one without a person.
 *
 * The charter decides whether an admission is an authority change. It never
 * grants access: the invite handler's own admission and clearance checks still
 * apply, and recorded steering or a person still decides a non-damaging call.
 * Design: docs/superpowers/specs/2026-10-27-agent-dialog-broker-design.md §4.2
 */
import { GAID_AUTHORIZATION_CLASS_ORDER, type GaidAuthorizationClass } from "@/lib/identity/authorization-classes";
import { clearanceCovers } from "./room-participation";

export const ROOM_CHARTER_PARTICIPANT_KINDS = [
  "org-coworker",
  "operator-assistant",
  "estate-peer-agent",
  "partner-agent",
  "public-agent",
] as const;

export type RoomCharterParticipantKind = (typeof ROOM_CHARTER_PARTICIPANT_KINDS)[number];

export type RoomCharter = {
  admits: RoomCharterParticipantKind[];
  classCeiling: GaidAuthorizationClass;
  expiresAt: string | null;
};

export type ResolvedRoomCharter = RoomCharter & { source: "explicit" | "platform-default" };

const DEFAULT_CHARTER_CEILINGS = new Set(["public", "internal"]);

export const PLATFORM_DEFAULT_ROOM_CHARTER: RoomCharter = {
  admits: ["org-coworker", "operator-assistant"],
  classCeiling: "create",
  expiresAt: null,
};

function isKind(value: unknown): value is RoomCharterParticipantKind {
  return typeof value === "string" && (ROOM_CHARTER_PARTICIPANT_KINDS as readonly string[]).includes(value);
}

function isAuthorizationClass(value: unknown): value is GaidAuthorizationClass {
  return typeof value === "string" && (GAID_AUTHORIZATION_CLASS_ORDER as readonly string[]).includes(value);
}

/** Read a stored charter. Unknown kinds are dropped; no valid ceiling means no charter. */
export function parseRoomCharter(value: unknown): RoomCharter | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (!isAuthorizationClass(record.classCeiling)) return null;
  const admits = Array.isArray(record.admits) ? [...new Set(record.admits.filter(isKind))] : [];
  const expiresAt = typeof record.expiresAt === "string" && !Number.isNaN(Date.parse(record.expiresAt))
    ? record.expiresAt
    : null;
  return { admits, classCeiling: record.classCeiling, expiresAt };
}

export function resolveRoomCharter(input: {
  charter: RoomCharter | undefined;
  sensitivityCeiling: string;
}): ResolvedRoomCharter | null {
  if (input.charter) return { ...input.charter, source: "explicit" };
  if (!DEFAULT_CHARTER_CEILINGS.has(input.sensitivityCeiling)) return null;
  return { ...PLATFORM_DEFAULT_ROOM_CHARTER, admits: [...PLATFORM_DEFAULT_ROOM_CHARTER.admits], source: "platform-default" };
}

/** A local Agent: the external CLI identities are the operator's assistants. */
export function classifyInviteeAgent(agentId: string): RoomCharterParticipantKind {
  return agentId.trim().toLowerCase().startsWith("agt-ext-") ? "operator-assistant" : "org-coworker";
}

/** What admission asks for: posting creates records; read-only observes. */
export function requestedAdmissionClass(canAct: boolean): GaidAuthorizationClass {
  return canAct ? "create" : "observe";
}

function classWithinCeiling(requested: GaidAuthorizationClass, ceiling: GaidAuthorizationClass): boolean {
  // cross-boundary is admitted only by name, never by sitting below a ceiling.
  if (requested === "cross-boundary") return ceiling === "cross-boundary";
  return GAID_AUTHORIZATION_CLASS_ORDER.indexOf(requested) <= GAID_AUTHORIZATION_CLASS_ORDER.indexOf(ceiling);
}

export type CharterAdmissionDecision = { inCharter: boolean; reason: string };

export function evaluateCharterAdmission(input: {
  charter: ResolvedRoomCharter | null;
  invitee: { kind: RoomCharterParticipantKind | null; active: boolean; sensitivityClearance: readonly string[] };
  roomSensitivityCeiling: string;
  requestedClass: GaidAuthorizationClass;
  now: Date;
}): CharterAdmissionDecision {
  const outside = (why: string): CharterAdmissionDecision => ({ inCharter: false, reason: `outside-charter:${why}` });
  const { charter, invitee } = input;
  if (!charter) return outside("no-charter");
  if (charter.expiresAt && Date.parse(charter.expiresAt) <= input.now.getTime()) return outside("expired");
  if (!invitee.kind) return outside("invitee-kind-unknown");
  if (!invitee.active) return outside("invitee-inactive");
  if (!charter.admits.includes(invitee.kind)) return outside("kind-not-admitted");
  if (!clearanceCovers(invitee.sensitivityClearance, input.roomSensitivityCeiling)) return outside("clearance-below-ceiling");
  if (!classWithinCeiling(input.requestedClass, charter.classCeiling)) return outside("class-above-ceiling");
  return { inCharter: true, reason: `in-charter:${charter.source}:${invitee.kind}:${input.requestedClass}` };
}
