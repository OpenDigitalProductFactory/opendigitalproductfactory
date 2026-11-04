// The core of the Workroom-owned harness evolution loop (BI-49BC21C1 slice 1;
// spec docs/superpowers/specs/2026-10-28-harness-evolution-loop-design.md).
//
// The unit of improvement is the room: each room's own coworker turns and
// human interactions are its trajectories, and a miss that recurs in the room
// is that room's candidate. One core, layered: a layer (ring 0 first, then
// archetype and ancillary) is data — its shapes and its miss-kind table — and
// passes through these same pure functions, so no layer forks the core.

export const MS_PER_DAY = 86_400_000;
/** Trajectory moments kept per candidate: enough to replay, small to store. */
const MAX_TRAJECTORY_REFS = 5;
const MAX_CODE_CHARS = 60;
const TERMINAL_STATUSES = new Set(["done", "retired"]);

// ─── Budget ─────────────────────────────────────────────────────────────────

export type HarnessEvolutionBudget = {
  maxRooms: number;
  maxCandidatesPerRoom: number;
  maxCandidates: number;
  maxProbeReplays: number;
  tokenCap: number;
  lookbackDays: number;
  minRecurrence: number;
};

const BUDGET_BOUNDS: Record<keyof HarnessEvolutionBudget, { min: number; max: number; fallback: number }> = {
  maxRooms: { min: 1, max: 200, fallback: 50 },
  maxCandidatesPerRoom: { min: 1, max: 10, fallback: 3 },
  maxCandidates: { min: 1, max: 200, fallback: 50 },
  maxProbeReplays: { min: 0, max: 200, fallback: 20 },
  tokenCap: { min: 0, max: 2_000_000, fallback: 200_000 },
  lookbackDays: { min: 1, max: 30, fallback: 7 },
  minRecurrence: { min: 2, max: 20, fallback: 2 },
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** The run's caps from taskConfig, clamped so an operator cannot unbound a run. */
export function resolveHarnessEvolutionBudget(taskConfig: unknown): HarnessEvolutionBudget {
  const config = asRecord(taskConfig);
  const budget = {} as HarnessEvolutionBudget;
  for (const key of Object.keys(BUDGET_BOUNDS) as Array<keyof HarnessEvolutionBudget>) {
    const { min, max, fallback } = BUDGET_BOUNDS[key];
    const raw = config[key];
    const value = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : fallback;
    budget[key] = Math.min(max, Math.max(min, value));
  }
  return budget;
}

/** The configured ring-0 platform queue, in order, without blanks or repeats. */
export function resolveSeedItemIds(taskConfig: unknown): string[] {
  const raw = asRecord(taskConfig).seedItemIds;
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const id = value.trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

// ─── Layers ─────────────────────────────────────────────────────────────────

/** Where a room's harness is edited first. Advisory until slice 2 routes it. */
export type ComponentHint =
  // A refusal for want of authority: the fix is a narrow GPP permit for this
  // specific action, not a person's approval (GPP; BI-6B610D94).
  | "gpp-permit"
  | "gate-hook-script"
  | "skill-tool"
  | "stage-brief"
  | "role-grant"
  | "coworker-prompt"
  | "unclassified";

export type MissActor = "coworker" | "human";

/** The scope whose doctrine decides an edit: platform, business or craft. */
export type DecisionScope = "wwmd" | "wwwd" | "wsid";
const DECISION_SCOPES = new Set<string>(["wwmd", "wwwd", "wsid"]);

/** Refusal codes that mean "no authority for this action" rather than a bad call. */
const PERMIT_GAP_CODES = new Set(["authority_denied", "approval_required", "permission_denied", "grant_missing", "workroom_access_denied"]);

export type HarnessLayer = {
  key: string;
  /** Scope consulted when the room records none: ring 0 is platform work, so WWMD. */
  decisionScope: DecisionScope;
  /** A room is in the layer when its declared shape key starts with one of these. */
  shapeKeyPrefixes: readonly string[];
  /** Room activity kinds that count as misses in this layer. */
  missKinds: Readonly<Record<string, { actor: MissActor; componentHint: ComponentHint }>>;
};

/** Ring 0: platform development, delivered through the delivery-* shapes. */
export const RING0_LAYER: HarnessLayer = {
  key: "ring-0",
  decisionScope: "wwmd",
  shapeKeyPrefixes: ["delivery-"],
  missKinds: {
    "command-rejected": { actor: "coworker", componentHint: "stage-brief" },
    "runtime-verification-failed": { actor: "coworker", componentHint: "gate-hook-script" },
    "provider-blocked": { actor: "coworker", componentHint: "role-grant" },
    "error": { actor: "coworker", componentHint: "unclassified" },
    "status-override": { actor: "human", componentHint: "stage-brief" },
    "workroom-drive-attention": { actor: "human", componentHint: "stage-brief" },
  },
};

export function shapeKeyOf(shapeRef: string): string {
  return shapeRef.split("@")[0] ?? shapeRef;
}

export function layerForShapeRef(shapeRef: string | null, layers: readonly HarnessLayer[]): HarnessLayer | null {
  if (!shapeRef) return null;
  const key = shapeKeyOf(shapeRef);
  return layers.find((layer) => layer.shapeKeyPrefixes.some((prefix) => key.startsWith(prefix))) ?? null;
}

/** The room's full declared shape ref (`delivery-medium@1.0.0`), the experiment unit. */
export function readDeclaredWorkShapeRef(scopeClaims: unknown): string | null {
  if (!Array.isArray(scopeClaims)) return null;
  for (const claim of scopeClaims) {
    const ref = asRecord(claim).workShape;
    if (typeof ref === "string" && ref.length > 0) return ref;
  }
  return null;
}

// ─── Misses ─────────────────────────────────────────────────────────────────

export type TrajectoryRef = { kind: "tool-execution" | "room-activity"; id: string };

export type RoomMiss = {
  missKey: string;
  actor: MissActor;
  componentHint: ComponentHint;
  at: Date;
  ref: TrajectoryRef;
};

/** A coworker turn the room's own tools refused, keyed by tool and refusal code. */
export function roomMissFromToolFailure(row: { id: string; toolName: string; error: string | null; createdAt: Date }): RoomMiss {
  const code = (row.error ?? "").split(":")[0]!.trim().slice(0, MAX_CODE_CHARS) || "unknown";
  return {
    missKey: `tool:${row.toolName}:${code}`,
    actor: "coworker",
    componentHint: PERMIT_GAP_CODES.has(code) ? "gpp-permit" : "skill-tool",
    at: row.createdAt,
    ref: { kind: "tool-execution", id: row.id },
  };
}

/** A room activity the layer counts as a miss, or null when it is ordinary work. */
export function roomMissFromActivity(row: { id: string; kind: string; recordedAt: Date }, layer: HarnessLayer): RoomMiss | null {
  const entry = layer.missKinds[row.kind];
  if (!entry) return null;
  return {
    missKey: `activity:${row.kind}`,
    actor: entry.actor,
    componentHint: entry.componentHint,
    at: row.recordedAt,
    ref: { kind: "room-activity", id: row.id },
  };
}

// ─── Candidates ─────────────────────────────────────────────────────────────

export type RoomCandidate = {
  candidateKey: string;
  capsuleId: string;
  shapeRef: string;
  layer: string;
  /** The scope whose doctrine guides this room's edit (WWMD / WWWD / WSID). */
  decisionScope: DecisionScope;
  missKey: string;
  actor: MissActor;
  componentHint: ComponentHint;
  recurrence: number;
  lastSeenAt: string;
  trajectory: TrajectoryRef[];
};

export type RoomCandidatesResult = {
  candidates: RoomCandidate[];
  /** Miss keys seen fewer than minRecurrence times: counted, not recorded. */
  belowThreshold: number;
  /** Recurring miss keys past the per-room cap, left for a later run. */
  overCap: number;
};

export function deriveRoomCandidates(input: {
  room: { capsuleId: string; shapeRef: string; decisionScope?: string | null };
  layer: HarnessLayer;
  misses: readonly RoomMiss[];
  minRecurrence: number;
  maxCandidates: number;
}): RoomCandidatesResult {
  const groups = new Map<string, RoomMiss[]>();
  for (const miss of input.misses) {
    const group = groups.get(miss.missKey);
    if (group) group.push(miss);
    else groups.set(miss.missKey, [miss]);
  }

  const roomScope = input.room.decisionScope;
  const decisionScope = roomScope && DECISION_SCOPES.has(roomScope) ? (roomScope as DecisionScope) : input.layer.decisionScope;
  let belowThreshold = 0;
  const recurring: RoomCandidate[] = [];
  for (const [missKey, group] of groups) {
    if (group.length < input.minRecurrence) {
      belowThreshold += 1;
      continue;
    }
    const newestFirst = [...group].sort((a, b) => b.at.getTime() - a.at.getTime() || a.ref.id.localeCompare(b.ref.id));
    const head = newestFirst[0]!;
    recurring.push({
      candidateKey: `${input.room.capsuleId}:${missKey}`,
      capsuleId: input.room.capsuleId,
      shapeRef: input.room.shapeRef,
      layer: input.layer.key,
      decisionScope,
      missKey,
      actor: head.actor,
      componentHint: head.componentHint,
      recurrence: group.length,
      lastSeenAt: head.at.toISOString(),
      trajectory: newestFirst.slice(0, MAX_TRAJECTORY_REFS).map((miss) => miss.ref),
    });
  }

  recurring.sort(
    (a, b) =>
      b.recurrence - a.recurrence
      || b.lastSeenAt.localeCompare(a.lastSeenAt)
      || a.missKey.localeCompare(b.missKey),
  );
  const candidates = recurring.slice(0, input.maxCandidates);
  return { candidates, belowThreshold, overCap: recurring.length - candidates.length };
}

// ─── Aggregation ────────────────────────────────────────────────────────────

export type CrossRoomRecurrence = {
  layer: string;
  shapeKey: string;
  missKey: string;
  rooms: string[];
  shapeRefs: string[];
  totalRecurrence: number;
};

/**
 * The same miss in two or more rooms of one shape: a promotion candidate for
 * the shape layer, pending a probe win in each room (spec AC-8). Shape
 * versions group together so a version bump does not hide a recurrence.
 */
export function findCrossRoomRecurrences(candidates: readonly RoomCandidate[]): CrossRoomRecurrence[] {
  const groups = new Map<string, CrossRoomRecurrence>();
  for (const candidate of candidates) {
    const shapeKey = shapeKeyOf(candidate.shapeRef);
    const key = `${candidate.layer}|${shapeKey}|${candidate.missKey}`;
    const group = groups.get(key) ?? {
      layer: candidate.layer, shapeKey, missKey: candidate.missKey, rooms: [], shapeRefs: [], totalRecurrence: 0,
    };
    if (!group.rooms.includes(candidate.capsuleId)) group.rooms.push(candidate.capsuleId);
    if (!group.shapeRefs.includes(candidate.shapeRef)) group.shapeRefs.push(candidate.shapeRef);
    group.totalRecurrence += candidate.recurrence;
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((group) => group.rooms.length >= 2)
    .map((group) => ({ ...group, rooms: [...group.rooms].sort(), shapeRefs: [...group.shapeRefs].sort() }))
    .sort(
      (a, b) =>
        b.rooms.length - a.rooms.length
        || b.totalRecurrence - a.totalRecurrence
        || a.shapeKey.localeCompare(b.shapeKey)
        || a.missKey.localeCompare(b.missKey),
    );
}

export type PlatformQueueItem = { itemId: string; title: string; status: string };

export type PlatformQueue = {
  open: PlatformQueueItem[];
  rejected: Array<{ itemId: string; reason: "missing" } | { itemId: string; reason: "terminal"; status: string }>;
};

/** The configured ring-0 platform items, in order, with a reason for each one dropped. */
export function resolvePlatformQueue(seedItemIds: readonly string[], items: readonly PlatformQueueItem[]): PlatformQueue {
  const byId = new Map(items.map((item) => [item.itemId, item]));
  const queue: PlatformQueue = { open: [], rejected: [] };
  for (const itemId of seedItemIds) {
    const item = byId.get(itemId);
    if (!item) queue.rejected.push({ itemId, reason: "missing" });
    else if (TERMINAL_STATUSES.has(item.status)) queue.rejected.push({ itemId, reason: "terminal", status: item.status });
    else queue.open.push(item);
  }
  return queue;
}
