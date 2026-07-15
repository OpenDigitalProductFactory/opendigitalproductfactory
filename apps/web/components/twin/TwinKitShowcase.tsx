"use client";

// apps/web/components/twin/TwinKitShowcase.tsx
//
// Developer preview of the Operational Twin grammar kit (P2). Renders the ten
// primitives twice — once for a PHYSICAL twin (restaurant FLOOR) and once for a
// NON-PHYSICAL board twin (SaaS TENANTS) — proving one grammar spans both lenses.
// The cog banner is live (tap Confirm / Dismiss) to demonstrate the HITL loop.

import { useState } from "react";

import {
  AttributedFeed,
  CapacityChips,
  CogBanner,
  NeedsYouQuests,
  PresenceRow,
  ResourceUnitGrid,
  TwinQueue,
  TwinZone,
  UtilityBand,
  WorkItem,
  type CapacityChipData,
  type FeedEventData,
  type QuestData,
  type QueueItemData,
  type ResourceUnitData,
  type TwinActor,
  type UtilityMeterData,
  type WorkItemData,
} from "@/components/twin";

// ── Shared: the utility band is identical across archetypes (that's the point). ──
const UTILITY: UtilityMeterData[] = [
  { key: "bills", label: "Bills due", value: "2 · £1,240", intent: "warning", hint: "Next 7 days" },
  { key: "tax", label: "VAT return", value: "12 days", intent: "info" },
  { key: "compliance", label: "Compliance", value: "All clear", intent: "success" },
  { key: "improve", label: "Improve", value: "3 ideas", intent: "accent" },
];

// ─────────────────────────── Physical: restaurant FLOOR ──────────────────────────
const FLOOR_CHIPS: CapacityChipData[] = [
  { key: "tables", label: "Tables", value: 6, max: 8, intent: "info", live: true },
  { key: "seats", label: "Seats", value: 22, max: 32, intent: "info" },
  { key: "6tops", label: "6-tops free", value: 1, intent: "warning" },
  { key: "wait", label: "Waitlist", value: 3, intent: "danger", live: true },
];
const FLOOR_UNITS: ResourceUnitData[] = [
  { key: "t9", label: "Table 9", state: "Seated", intent: "success", sublabel: "2 · 34 min", owner: { name: "Ana", kind: "human" } },
  { key: "t10", label: "Table 10", state: "Dessert", intent: "info", sublabel: "4 · 1h05", owner: { name: "Ana", kind: "human" } },
  { key: "t11", label: "Table 11", state: "Open", intent: "neutral", sublabel: "seats 2" },
  { key: "t12", label: "Table 12", state: "Bussing", intent: "warning", sublabel: "seats 6", owner: { name: "AI expo", kind: "ai" } },
];
const FLOOR_TICKETS: WorkItemData[] = [
  { key: "k1", label: "Table 10 · mains", owner: { name: "Kitchen", kind: "human" }, progress: 70 },
  { key: "k2", label: "Online · pickup #4821", owner: { name: "AI host", kind: "ai" }, progress: 40, sublabel: "ready 7:45" },
  { key: "k3", label: "Table 7 · wine", blockedOnExternal: true, blockedLabel: "Blocked · cellar restock" },
];
const FLOOR_QUEUE: QueueItemData[] = [
  { key: "w1", label: "Nguyen party", meta: "4 guests", waiting: "8 min", suggestion: "Seat at Table 12 (bussing, ~4 min)" },
  { key: "w2", label: "Walk-in", meta: "2 guests", waiting: "3 min" },
  { key: "w3", label: "Reservation · Patel", meta: "6 · 8:00pm", waiting: "res" },
];
const FLOOR_PRESENCE: TwinActor[] = [
  { name: "You", kind: "human", focus: "expediting" },
  { name: "Ana", kind: "human", focus: "sections 9–10" },
  { name: "AI host", kind: "ai", focus: "waitlist + online" },
  { name: "AI expo", kind: "ai", focus: "table turns" },
];
const FLOOR_FEED: FeedEventData[] = [
  { key: "f1", actor: { name: "AI host", kind: "ai" }, action: "proposed seating for", target: "Nguyen party", at: "just now" },
  { key: "f2", actor: { name: "Ana", kind: "human" }, action: "fired mains for", target: "Table 10", at: "2m" },
  { key: "f3", actor: { name: "AI expo", kind: "ai" }, action: "flagged slow turn on", target: "Table 12", at: "5m" },
];
const FLOOR_QUESTS: QuestData[] = [
  { key: "q1", title: "6-top blocked", detail: "Nguyen party waiting 8 min · only Table 12 fits (bussing)", intent: "danger", cta: "Seat" },
  { key: "q2", title: "Cellar restock", detail: "Table 7 wine order can't complete", intent: "warning", cta: "Reorder" },
];

// ─────────────────────────── Non-physical: SaaS TENANTS board ─────────────────────
const SAAS_CHIPS: CapacityChipData[] = [
  { key: "accounts", label: "Accounts", value: 128, intent: "info" },
  { key: "atrisk", label: "At risk", value: 4, intent: "danger", live: true },
  { key: "renewals", label: "Renewals (30d)", value: 9, intent: "warning" },
  { key: "seats", label: "Seats used", value: 812, max: 1000, intent: "info" },
];
const SAAS_UNITS: ResourceUnitData[] = [
  { key: "a1", label: "Northwind", state: "Healthy", intent: "success", sublabel: "92 · Enterprise", owner: { name: "Dana (CSM)", kind: "human" } },
  { key: "a2", label: "Acme Co", state: "At risk", intent: "danger", sublabel: "41 · usage −38%", owner: { name: "AI success", kind: "ai" } },
  { key: "a3", label: "Globex", state: "Onboarding", intent: "info", sublabel: "day 6 of 14", owner: { name: "Dana (CSM)", kind: "human" } },
  { key: "a4", label: "Initech", state: "Expansion", intent: "accent", sublabel: "seats +20 pending" },
];
const SAAS_WORK: WorkItemData[] = [
  { key: "s1", label: "Acme · renewal", owner: { name: "AI success", kind: "ai" }, progress: 25, sublabel: "closes in 11 days" },
  { key: "s2", label: "Globex · onboarding", owner: { name: "Dana (CSM)", kind: "human" }, progress: 45 },
  { key: "s3", label: "Initech · security review", blockedOnExternal: true, blockedLabel: "Blocked · customer legal" },
];
const SAAS_QUEUE: QueueItemData[] = [
  { key: "r1", label: "Acme Co", meta: "Enterprise · usage −38%", waiting: "at risk", suggestion: "Route to Dana (lowest load, owns segment)" },
  { key: "r2", label: "Umbrella", meta: "renewal · 6 days", waiting: "6d" },
  { key: "r3", label: "Soylent", meta: "NPS detractor", waiting: "2d" },
];
const SAAS_PRESENCE: TwinActor[] = [
  { name: "You", kind: "human", focus: "renewals desk" },
  { name: "Dana", kind: "human", focus: "3 accounts" },
  { name: "AI success", kind: "ai", focus: "health scores + at-risk" },
];
const SAAS_FEED: FeedEventData[] = [
  { key: "sf1", actor: { name: "AI success", kind: "ai" }, action: "flagged churn risk on", target: "Acme Co", at: "just now" },
  { key: "sf2", actor: { name: "Dana", kind: "human" }, action: "logged QBR for", target: "Northwind", at: "18m" },
  { key: "sf3", actor: { name: "AI success", kind: "ai" }, action: "drafted renewal email for", target: "Umbrella", at: "1h" },
];
const SAAS_QUESTS: QuestData[] = [
  { key: "sq1", title: "Acme at risk", detail: "Usage −38% with renewal in 11 days", intent: "danger", cta: "Assign" },
  { key: "sq2", title: "Initech blocked", detail: "Security review stalled on customer legal", intent: "warning", cta: "Nudge" },
];

interface TwinExample {
  chips: CapacityChipData[];
  zoneLabel: string;
  units: ResourceUnitData[];
  workLabel: string;
  work: WorkItemData[];
  queueLabel: string;
  queue: QueueItemData[];
  cog: { proposal: string; signals: string[]; confirmLabel: string };
  presence: TwinActor[];
  feed: FeedEventData[];
  quests: QuestData[];
}

const FLOOR: TwinExample = {
  chips: FLOOR_CHIPS,
  zoneLabel: "Dining floor",
  units: FLOOR_UNITS,
  workLabel: "On the pass",
  work: FLOOR_TICKETS,
  queueLabel: "Waitlist",
  queue: FLOOR_QUEUE,
  cog: {
    proposal: "Seat the Nguyen party (4) at Table 12 once bussed (~4 min)",
    signals: ["dwell-time", "turn-time", "party-fit"],
    confirmLabel: "Seat party",
  },
  presence: FLOOR_PRESENCE,
  feed: FLOOR_FEED,
  quests: FLOOR_QUESTS,
};

const BOARD: TwinExample = {
  chips: SAAS_CHIPS,
  zoneLabel: "Accounts · at-risk lane",
  units: SAAS_UNITS,
  workLabel: "Engagements in flight",
  work: SAAS_WORK,
  queueLabel: "Renewals & risk queue",
  queue: SAAS_QUEUE,
  cog: {
    proposal: "Route Acme Co to Dana — lowest CSM load and owns the Enterprise segment",
    signals: ["health-score", "CSM-load", "segment-fit"],
    confirmLabel: "Assign account",
  },
  presence: SAAS_PRESENCE,
  feed: SAAS_FEED,
  quests: SAAS_QUESTS,
};

function TwinPanel({ title, kind, example }: { title: string; kind: string; example: TwinExample }) {
  const [resolved, setResolved] = useState(false);
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--dpf-text)]">{title}</h2>
        <span className="rounded-full bg-[var(--dpf-surface-3)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--dpf-muted)]">
          {kind}
        </span>
      </header>

      <CapacityChips chips={example.chips} />

      <PresenceRow members={example.presence} />

      <CogBanner
        proposal={example.cog.proposal}
        signals={example.cog.signals}
        confirmLabel={example.cog.confirmLabel}
        resolved={resolved}
        onConfirm={() => setResolved(true)}
        onDismiss={() => setResolved(true)}
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <TwinZone label={example.zoneLabel} meta={`${example.units.length} units`}>
          <ResourceUnitGrid units={example.units} className="!grid-cols-2" />
        </TwinZone>

        <TwinZone label={example.workLabel}>
          <div className="flex flex-col gap-2">
            {example.work.map(({ key, ...item }) => (
              <WorkItem key={key} {...item} />
            ))}
          </div>
        </TwinZone>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <TwinQueue label={example.queueLabel} items={example.queue} />
        <div className="flex flex-col gap-3">
          <TwinZone label="Needs you">
            <NeedsYouQuests quests={example.quests} />
          </TwinZone>
          <TwinZone label="Activity">
            <AttributedFeed events={example.feed} />
          </TwinZone>
        </div>
      </div>
    </section>
  );
}

export function TwinKitShowcase() {
  return (
    <div className="flex flex-col gap-6">
      <TwinZone label="Utility band — identical across every archetype">
        <UtilityBand meters={UTILITY} />
      </TwinZone>

      <TwinPanel title="Restaurant — FLOOR" kind="physical twin" example={FLOOR} />
      <TwinPanel title="SaaS — TENANTS board" kind="non-physical twin" example={BOARD} />
    </div>
  );
}
