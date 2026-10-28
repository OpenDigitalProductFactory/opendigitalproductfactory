import type { Intent } from "./semantic-intent.ts";

/** The defining doctrine of the operating twin: humans, AI coworkers, and
 *  external partners (resellers/franchisees) inhabit the SAME surface. Every
 *  actor-bearing primitive carries this so they render on one plane (attributed,
 *  not segregated). */
export type TwinActorKind = "human" | "ai" | "partner";

export interface TwinActor {
  name: string;
  kind: TwinActorKind;
  /** What this actor is attending to right now (presence "focus"). */
  focus?: string;
}

/** A live constraint counter — the archetype's real limits, not vanity metrics. */
export interface CapacityChipData {
  key: string;
  label: string;
  value: number | string;
  /** Denominator for "x / max" counters (seats, assets, seats-in-use). */
  max?: number;
  intent?: Intent;
  /** Pulse a live dot (motion-safe) — the counter is changing in real time. */
  live?: boolean;
}

/** A countable unit — table, van, chair, room, account, tenant — with state + owner. */
export interface ResourceUnitData {
  /** A record link supplied by an authorized host; it never grants command authority. */
  action?: { label: string; href: string };
  key: string;
  label: string;
  /** Human-readable state ("Seated", "Ready", "In bay", "At risk"). */
  state: string;
  intent?: Intent;
  owner?: TwinActor;
  /** Secondary line — occupancy, ETA, plan tier. */
  sublabel?: string;
}

/** A unit of demand being processed — ticket, job, agreement, matter, renewal. */
export interface WorkItemData {
  action?: { label: string; href: string };
  ownerRef?: string;
  priority?: string;
  key: string;
  label: string;
  owner?: TwinActor;
  /** 0–100 progress along the item's lane. */
  progress?: number;
  /** Waiting on something outside the business (supplier, customer, court). */
  blockedOnExternal?: boolean;
  blockedLabel?: string;
  sublabel?: string;
}

/** One item waiting in an ordered demand queue. */
export interface QueueItemData {
  action?: { label: string; href: string };
  key: string;
  label: string;
  meta?: string;
  /** How long it has been waiting ("8 min", "2 days"). */
  waiting?: string;
  /** The cog's proposed allocation for THIS item (rendered inline, tap-to-confirm upstream). */
  suggestion?: string;
}

/** A supporting-activity meter — bills, tax, compliance, improve. */
export interface UtilityMeterData {
  key: string;
  label: string;
  value: string;
  intent?: Intent;
  hint?: string;
}

/** One entry on the shared human+AI event plane. */
export interface FeedEventData {
  key: string;
  actor: TwinActor;
  action: string;
  target?: string;
  /** Pre-formatted relative time ("just now", "2m"). Formatting is the caller's job. */
  at?: string;
}

/** One attention item pinned to twin context. */
export interface QuestData {
  key: string;
  title: string;
  detail?: string;
  intent?: Intent;
  cta?: string;
}

/** Live units for one of the profile's zones (keyed to `TwinProfile.zones[].key`). */
export interface TwinZoneSnapshot {
  key: string;
  units: ResourceUnitData[];
  /** Right-aligned zone summary ("6 / 8 seated"). */
  meta?: string;
}

/** Live demand for one of the profile's queues (keyed to `TwinProfile.queues[].key`). */
export interface TwinQueueSnapshot {
  key: string;
  items: QueueItemData[];
  emptyLabel?: string;
}

/** One value-stream stage with the live demand sitting in it (workstream C —
 *  grounding the twin's queues in the archetype's real process). Keyed to the
 *  `deriveTwinValueStreamBinding` stages so the animation view and the
 *  architecture view line up. */
export interface TwinStageFlow {
  stageKey: string;
  label: string;
  order: number;
  loadBearing: boolean;
  /** Whether any twin queue or zone binds to this stage. A stage nothing binds
   *  can never hold a record, so its count is not a measurement of zero — it is
   *  the absence of one, and the strip must say so rather than print 0
   *  (BI-AF50DBD5). */
  observable: boolean;
  /** Backbone stage a leaf profile inherits rather than declares (BI-4B11F98E).
   *  The strip defers these behind a disclosure so the archetype's own day
   *  stays what is visible on arrival. */
  inherited?: boolean;
  /** Demand units currently at this stage. */
  count: number;
  /** Longest wait among demand at this stage ("8m", "2d"); omitted when none waits. */
  longestWait?: string;
}

/** A realized customer outcome — revenue in, work delivered (workstream D). The
 *  proof that the machine is producing, not just busy. */
export interface TwinOutcome {
  key: string;
  label: string;
  value: string;
  intent?: Intent;
  hint?: string;
}

/** The cog's current proposal over live state (constraint → proposal → confirm). */
export interface TwinCogSnapshot {
  proposal: string;
  confirmLabel?: string;
  /** Overrides the profile's default cog signals for this specific proposal. */
  signals?: string[];
}

export interface TwinSnapshot {
  capacityChips: CapacityChipData[];
  /** The archetype's value-stream backbone with demand counts overlaid (workstream
   *  C). Optional — a fixture without grounding simply omits it. */
  stageFlow?: TwinStageFlow[];
  /** Realized customer outcomes — revenue in, work delivered (workstream D).
   *  Optional; omitted when there is no outcome data. */
  outcomes?: TwinOutcome[];
  /** Archetype-owned label for the outcome strip (for example Mission impact). */
  outcomesHeading?: string;
  zones: TwinZoneSnapshot[];
  workItems: WorkItemData[];
  queues: TwinQueueSnapshot[];
  cog?: TwinCogSnapshot;
  presence: TwinActor[];
  feed: FeedEventData[];
  quests: QuestData[];
  utility: UtilityMeterData[];
}
