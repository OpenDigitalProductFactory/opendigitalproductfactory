// apps/web/components/twin/snapshot.ts
//
// The render contract for a live operational twin (EP-LIVING-BUSINESS-VIZ P3).
// A `TwinProfile` (@dpf/storefront-templates, merged P1) says WHICH template and
// WHAT the nouns/zones/queues/cog are; a `TwinSnapshot` supplies the live VALUES
// that fill them at a moment in time. `TwinView` composes the grammar kit from
// the two.
//
// A future projection (`LivingBusinessSnapshot`, parent spec P4) will produce this
// shape from real substrate — agent_registry/Agent + agent-event-bus, the finance
// spine, scheduling — keyed by the profile. Until then `buildDemoTwinSnapshot`
// (demo-snapshot.ts) fills it deterministically for the fixture.

import type { Intent } from "@/components/ui/report-kit";

import type {
  CapacityChipData,
  FeedEventData,
  QuestData,
  QueueItemData,
  ResourceUnitData,
  TwinActor,
  UtilityMeterData,
  WorkItemData,
} from "./types";

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
