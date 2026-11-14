/**
 * Work Atlas projection: one compact row per open workroom (BI-7ACC31F9).
 *
 * The portal and the `list_workrooms` `view: "atlas"` MCP read both return
 * `projectAtlas` output, so people and agents see one picture. Health comes
 * from the shared operator summary (atlas-health.ts), never a local rule.
 * Fields with nothing recorded are left out rather than invented.
 *
 * Design: docs/superpowers/specs/2026-10-27-work-atlas-design.md §4.
 *
 * Pure and synchronous.
 */
import type { MessageKey } from "@dpf/i18n";
import { projectWorkroomOperatorSummary } from "@/lib/work-capsules/workroom-operator-summary";
import { ATLAS_HEALTH_STATES, type AtlasHealth } from "@/lib/work-management/atlas-health";
import type { RoomWorkforce } from "@/lib/work-management/room-workforce.server";

/** Longest title carried in the overview; the room page has the full one. */
export const ATLAS_TITLE_MAX = 80;

/** Rooms read for one Atlas picture. Above this the projection says it is truncated. */
export const ATLAS_ROOM_READ_LIMIT = 2000;

/** The inventory fields the Atlas reads (a subset of `loadCapsuleLivenessInventory` rows). */
export type AtlasInventoryRoom = {
  capsuleId: string;
  title: string;
  status: string;
  liveness: string;
  isLive: boolean;
  portfolioRole: string | null;
  trueLivenessAt: string | null;
  drive: { action: string | null; reason: string | null; attentionRecorded?: boolean } | null;
  stageKey: string | null;
  /** Declared delivery or activity shape key (`readDeclaredWorkShapeKey`), null when none. */
  shapeKey?: string | null;
};

export type AtlasOwner = Pick<RoomWorkforce, "accountability" | "accountableDisplayName">;

export type AtlasRoom = {
  capsuleId: string;
  title: string;
  /** Portfolio role, or "unplaced" when none is recorded. */
  portfolio: string;
  health: AtlasHealth;
  label: MessageKey<"workrooms">;
  /** Declared shape key; left out when the room declares none ("Unshaped"). */
  shape?: string;
  owner?: string;
  stage?: string;
  lastSignalAt?: string;
};

export type AtlasPicture = {
  observedAt: string;
  total: number;
  /** True when more rooms exist than were read; counts then cover the rooms read. */
  truncated: boolean;
  counts: Record<AtlasHealth, number>;
  rooms: AtlasRoom[];
};

function capTitle(title: string): string {
  return title.length <= ATLAS_TITLE_MAX ? title : `${title.slice(0, ATLAS_TITLE_MAX - 1)}…`;
}

export function projectAtlasRoom(room: AtlasInventoryRoom, owner: AtlasOwner | undefined): AtlasRoom {
  const summary = projectWorkroomOperatorSummary({
    capsuleId: room.capsuleId,
    status: room.status,
    liveness: room.liveness,
    isLive: room.isLive,
    accountability: owner?.accountability,
    drive: room.drive ?? undefined,
  });
  return {
    capsuleId: room.capsuleId,
    title: capTitle(room.title),
    portfolio: room.portfolioRole ?? "unplaced",
    health: summary.health,
    label: summary.label,
    ...(room.shapeKey ? { shape: room.shapeKey } : {}),
    ...(owner?.accountableDisplayName ? { owner: owner.accountableDisplayName } : {}),
    ...(room.stageKey ? { stage: room.stageKey } : {}),
    ...(room.trueLivenessAt ? { lastSignalAt: room.trueLivenessAt } : {}),
  };
}

/** `rooms` may hold one more than `limit`; that extra row only signals truncation. */
export function projectAtlas(input: {
  rooms: readonly AtlasInventoryRoom[];
  owners: ReadonlyMap<string, AtlasOwner>;
  limit: number;
  observedAt: Date;
}): AtlasPicture {
  const read = input.rooms.slice(0, input.limit);
  const rooms = read.map((room) => projectAtlasRoom(room, input.owners.get(room.capsuleId)));
  const counts = Object.fromEntries(ATLAS_HEALTH_STATES.map((state) => [state, 0])) as Record<AtlasHealth, number>;
  for (const room of rooms) counts[room.health] += 1;
  return {
    observedAt: input.observedAt.toISOString(),
    total: rooms.length,
    truncated: input.rooms.length > input.limit,
    counts,
    rooms,
  };
}
