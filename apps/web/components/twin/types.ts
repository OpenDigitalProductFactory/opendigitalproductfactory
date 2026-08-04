// apps/web/components/twin/types.ts
//
// Shared prop vocabulary for the Operational Twin grammar kit (EP-LIVING-BUSINESS-VIZ P2).
// These are the ten primitives every twin — floor, map, yard, or board — composes from,
// lifted out of the four prototypes onto the `--dpf-*` token + report-kit substrate.
// Spec: docs/superpowers/specs/2026-07-12-operational-twin-framework-design.md §3.
//
// The components are presentational: a template (P3) binds a `TwinProfile`
// (@dpf/storefront-templates) + a live snapshot to these props. Keeping the kit
// snapshot-shaped rather than profile-shaped is deliberate — the same primitive
// renders a restaurant table and a SaaS tenant.

import type { Intent } from "@/components/ui/report-kit";

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
