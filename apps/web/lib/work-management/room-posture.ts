// EP-WORK-POSTURE Slice D (BI-4F468192) — the room's EFFECTIVE posture.
//
// The switch-on. Everything before this slice computed a posture that nothing
// consulted; this module assembles the resolver's inputs from facts the room
// already carries and produces the posture the room actually runs at.
//
// Pure and DB-free, in the same discipline as the rest of room-read-model: the
// asynchronous parts (the org's operating hours, the archetype's value stream,
// the coworker's inherited posture) are pre-resolved by the loader and handed
// in as `context`, exactly as `structure` and `sourceHealth` already are.
//
// The tighten-only invariant is enforced inside resolveWorkPosture, so nothing
// assembled here can widen what a coworker may do unattended.
import {
  resolveWorkPosture,
  type ArchetypeStreamInput,
  type PostureHardPolicy,
  type ResolvedWorkPosture,
  type RoomPostureDeclaration,
} from "@/lib/work-posture";
import type { ProactivityPlan } from "@/lib/proactivity/proactivity-types";
import type { GoldenTrianglePreference } from "@/lib/golden-triangle";
import type { WeeklySchedule } from "@/lib/operating-hours-types";
import type { LowTrafficWindow } from "@/lib/self-upgrade/auto-window";

/**
 * The asynchronous half, pre-resolved by the loader. When this is absent the
 * room simply has no posture (null) and every existing surface behaves exactly
 * as it does today — the inert default that keeps this slice safe to land.
 */
export interface WorkroomPostureContext {
  /** The posture the EXISTING ladders resolved (agent -> org -> platform). */
  inherited: {
    proactivityPlan: ProactivityPlan;
    priority?: GoldenTrianglePreference | null;
    source?: ResolvedWorkPosture["proactivitySource"];
  };
  /** The org's operating clock, from the existing operating-hours substrate. */
  operatingHours?: {
    schedule: WeeklySchedule | null;
    timezone: string | null;
    lowTrafficWindows?: readonly LowTrafficWindow[] | null;
  } | null;
  /** The archetype's operational value stream (OVSM projection). */
  stream?: ArchetypeStreamInput | null;
  /** Hard bounds the posture may never cross. */
  hardPolicy?: PostureHardPolicy | null;
  /** The activity family, when the room's subject maps to one. */
  activityFamily?: string | null;
  /**
   * The platform's decreed default for rooms, when one is set. Sits below
   * derivation and above the coworker ladder (workroom-posture-defaults.ts).
   */
  workroomDefault?: RoomPostureDeclaration | null;
  /**
   * Identity the operator control needs to WRITE back. Null when the room is not
   * editable from this surface — the control is not rendered rather than
   * rendered inert.
   */
  editable?: {
    roomRowId: string;
    caseKey: string;
    declaredShape: string | null;
    hasDeclaration: boolean;
  } | null;
}

/** The room facts the posture derives from — all already on the WorkroomView. */
export interface WorkroomPostureFacts {
  shapeKey: string | null;
  activityKind: string | null;
  mode: string;
  cycleActive: boolean;
  /** The room's own time boundary, when it has one. */
  dueAt: string | null;
  declaration: RoomPostureDeclaration | null;
}

export interface WorkroomPostureView extends ResolvedWorkPosture {
  /** Carried through so the room surface can render a settable control. */
  editable?: {
    roomRowId: string;
    caseKey: string;
    declaredShape: string | null;
    hasDeclaration: boolean;
  } | null;
  /**
   * True when the room's posture is the inherited one unchanged — nothing about
   * this room's shape, stream or clock asked for anything different. Surfaces
   * honestly rather than implying a decision that was never made.
   */
  inert: boolean;
}

function parseDueAt(dueAt: string | null): Date | null {
  if (!dueAt) return null;
  const parsed = new Date(dueAt);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Resolve the posture a room runs at. Returns null when the loader supplied no
 * context, so a caller that cannot resolve the inherited posture gets "no
 * posture" rather than a fabricated one.
 */
export function resolveWorkroomPosture(
  facts: WorkroomPostureFacts,
  context: WorkroomPostureContext | null | undefined,
  now: Date,
): WorkroomPostureView | null {
  if (!context) return null;

  const hours = context.operatingHours;
  const resolved = resolveWorkPosture({
    inherited: context.inherited,
    hardPolicy: context.hardPolicy ?? null,
    declaration: facts.declaration,
    workroomDefault: context.workroomDefault ?? null,
    shape: {
      shapeKey: facts.shapeKey,
      activityKind: facts.activityKind,
      mode: facts.mode,
      cycleActive: facts.cycleActive,
    },
    stream: context.stream ?? null,
    temporal: {
      now,
      schedule: hours?.schedule ?? null,
      timezone: hours?.timezone ?? null,
      lowTrafficWindows: hours?.lowTrafficWindows ?? null,
      dueAt: parseDueAt(facts.dueAt),
      activityFamily: context.activityFamily ?? null,
    },
  });

  // Carry the editable identity through so the room surface can render a control
  // that WRITES, not just a section that reads. Absent identity means the control
  // is not rendered at all rather than rendered dead.
  return { ...resolved, editable: context.editable ?? null };
}
