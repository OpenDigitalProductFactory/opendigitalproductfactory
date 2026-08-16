// Per-acumen Workroom shape registry (W14 — BI-E0BFFF77, EP-1C37C089).
//
// Each platform acumen (a WSID craft family with a resident coworker) gets a
// declared Workroom shape envelope: the standing craft-stewardship room it
// lives in, the shape its outward reviews take, and the shape any
// consequential change must be convened under. The Workroom shape gate
// (lib/governance/workroom-shape-governance-hook.ts) reads a room's DECLARED
// shape claim first; this registry is the provisioning source for those
// declarations and for summoning the right roles into each acumen's rooms.
//
// Pure data + integrity function; no DB. The contract test cross-checks
// professionKeys against docs/professions/registry.json (with a declared
// pending-registry exception list that must shrink, never grow).

import { WORKROOM_SHAPE_KEYS, type WorkroomShapeKey } from "./room-shapes";
import type { WorkroomParticipantRole } from "./room-types";

export type AcumenRoomShapeDefinition = {
  /** WSID profession family key (docs/professions/registry.json). */
  professionKey: string;
  /** The resident coworker that stewards this acumen's rooms. */
  coworkerAgentId: string;
  /** Shape of the standing craft room (corpus curation, findings triage). */
  standingShape: WorkroomShapeKey;
  /** Shape any outward-facing review by this acumen convenes under. */
  reviewShape: WorkroomShapeKey;
  /** Shape any consequential change by this acumen convenes under. */
  consequentialShape: WorkroomShapeKey;
  cadence: "standing" | "per-build";
  participantRoles: readonly WorkroomParticipantRole[];
  gating: {
    /** Decision domain classes this acumen's rooms are scoped to. */
    domainClasses: readonly string[];
    /** Default autonomy for consequential work inside the envelope. */
    autonomyDefault: "propose" | "supervised";
  };
};

const SHARED_SHAPES = {
  standingShape: "craft-stewardship",
  reviewShape: "outward-review",
  consequentialShape: "change-consequential",
  cadence: "standing",
  participantRoles: ["accountable", "specialist", "reviewer"],
  gating: {
    domainClasses: ["professional-practice", "architecture-tradeoff"],
    autonomyDefault: "propose",
  },
} as const satisfies Omit<AcumenRoomShapeDefinition, "professionKey" | "coworkerAgentId">;

export const ACUMEN_ROOM_SHAPES: readonly AcumenRoomShapeDefinition[] = [
  { professionKey: "data-architect", coworkerAgentId: "data-architect", ...SHARED_SHAPES },
  { professionKey: "ux-design", coworkerAgentId: "ux-design-critic", ...SHARED_SHAPES },
  { professionKey: "software-engineer", coworkerAgentId: "build-specialist", ...SHARED_SHAPES },
  { professionKey: "security", coworkerAgentId: "security-engineer", ...SHARED_SHAPES },
  { professionKey: "devops-platform", coworkerAgentId: "platform-engineer", ...SHARED_SHAPES },
  { professionKey: "mcp-integration", coworkerAgentId: "integration-engineer", ...SHARED_SHAPES },
];

/**
 * professionKeys used above that do NOT yet exist as families in
 * docs/professions/registry.json. The contract test enforces that every entry
 * here is genuinely absent from the registry — the moment the family lands,
 * this list must shrink, so the exception is a ratchet, not a hole.
 */
export const ACUMEN_PROFESSION_KEYS_PENDING_REGISTRY: readonly string[] = [
  "mcp-integration",
];

const VALID_PARTICIPANT_ROLES = [
  "accountable",
  "coordinator",
  "contributor",
  "specialist",
  "approver",
  "reviewer",
  "observer",
] as const satisfies readonly WorkroomParticipantRole[];

export function getAcumenRoomShape(
  professionKey: string,
): AcumenRoomShapeDefinition | null {
  return (
    ACUMEN_ROOM_SHAPES.find((entry) => entry.professionKey === professionKey) ?? null
  );
}

/**
 * Structural integrity of the registry: unique professionKeys, every shape key
 * registered in WORKROOM_SHAPE_KEYS, every participant role a valid
 * WorkroomParticipantRole. Throws on the first violation (provisioning-time
 * invariant; also exercised by the contract test).
 */
export function assertAcumenRoomShapeIntegrity(
  entries: readonly AcumenRoomShapeDefinition[] = ACUMEN_ROOM_SHAPES,
): void {
  const shapeKeys = new Set<string>(WORKROOM_SHAPE_KEYS);
  const roleKeys = new Set<string>(VALID_PARTICIPANT_ROLES);
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.professionKey)) {
      throw new Error(`acumen-room-shapes: duplicate professionKey ${entry.professionKey}`);
    }
    seen.add(entry.professionKey);
    if (!entry.coworkerAgentId.trim()) {
      throw new Error(`acumen-room-shapes: ${entry.professionKey} has no coworkerAgentId`);
    }
    for (const shape of [entry.standingShape, entry.reviewShape, entry.consequentialShape]) {
      if (!shapeKeys.has(shape)) {
        throw new Error(`acumen-room-shapes: ${entry.professionKey} references unregistered shape ${shape}`);
      }
    }
    if (entry.participantRoles.length === 0) {
      throw new Error(`acumen-room-shapes: ${entry.professionKey} declares no participant roles`);
    }
    for (const role of entry.participantRoles) {
      if (!roleKeys.has(role)) {
        throw new Error(`acumen-room-shapes: ${entry.professionKey} declares invalid role ${role}`);
      }
    }
    if (entry.gating.domainClasses.length === 0) {
      throw new Error(`acumen-room-shapes: ${entry.professionKey} declares no domain classes`);
    }
  }
}
