// apps/web/lib/twin/demo-business-snapshot.ts
//
// Archetype Demo Factory — the persona'd render bridge (EP-ARCHETYPE-DEMO A·P2).
//
// `demoBusinessToTwinSnapshot` maps a generated `DemoBusiness`
// (@dpf/storefront-templates, A·P1) onto the `TwinSnapshot` render contract, so
// the SAME `TwinView` renders a real persona'd demo — in memory, no database.
// It is the third sibling of the snapshot family:
//   • live    : DB rows      → TwinSnapshot   (loadLivingBusinessSnapshot)
//   • fixture : TwinProfile  → TwinSnapshot   (buildDemoTwinSnapshot)
//   • demo    : DemoBusiness → TwinSnapshot   (this)
// The gallery (A·P2) renders all 94 through it; the load path (A·P1) proves the
// live path renders the same shape from the same generator.
//
// PURE + deterministic (the DemoBusiness is already deterministic in its seed).

import type { DemoBusiness, TwinProfile } from "@dpf/storefront-templates";

import type { Intent } from "@/components/ui/report-kit";

import type { TwinSnapshot, TwinZoneSnapshot, TwinQueueSnapshot } from "@/components/twin/snapshot";
import type {
  CapacityChipData,
  QueueItemData,
  ResourceUnitData,
  UtilityMeterData,
  WorkItemData,
} from "@/components/twin/types";

const RESOURCE_STATES: Array<{ state: string; intent: Intent }> = [
  { state: "Active", intent: "success" },
  { state: "In progress", intent: "info" },
  { state: "Open", intent: "neutral" },
  { state: "Needs attention", intent: "warning" },
];

function money(currency: string, amount: number): string {
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : currency === "EUR" ? "€" : "";
  return `${symbol}${Math.round(amount).toLocaleString("en-US")}`;
}

/** Map a generated demo business onto the twin render contract. */
export function demoBusinessToTwinSnapshot(demo: DemoBusiness, profile: TwinProfile): TwinSnapshot {
  const workerByKey = new Map(demo.workforce.map((w) => [w.key, w]));

  // Zones ← resources arranged by zone; each resource's owner is its worker (if a person).
  const zones: TwinZoneSnapshot[] = profile.zones.map((zone) => {
    const inZone = demo.resources.filter((r) => r.zoneKey === zone.key);
    const units: ResourceUnitData[] = inZone.map((r, i) => {
      const st = RESOURCE_STATES[i % RESOURCE_STATES.length];
      const worker = r.workerKey ? workerByKey.get(r.workerKey) : undefined;
      return {
        key: r.key,
        label: r.label,
        state: st.state,
        intent: st.intent,
        ...(worker ? { owner: { name: worker.name, kind: worker.kind } } : {}),
      };
    });
    return { key: zone.key, units, meta: `${units.length} ${profile.resourceNoun.plural}` };
  });

  // Queues ← demand still waiting in each queue; the primary queue leads with the cog suggestion.
  const queues: TwinQueueSnapshot[] = profile.queues.map((qs, qi) => {
    const waiting = demo.demand.filter((d) => d.queueKey === qs.key);
    const items: QueueItemData[] = waiting.map((d, i) => ({
      key: d.key,
      label: d.label,
      meta: i === 0 ? "next up" : undefined,
      waiting: `${d.waitingMinutes}m`,
      suggestion: qi === 0 && i === 0 ? demo.cogProposal : undefined,
    }));
    return { key: qs.key, items, emptyLabel: "No demand waiting" };
  });

  // Work items ← in-flight (assigned, not queued) demand.
  const inFlight = demo.demand.filter((d) => !d.queueKey && d.assignedResourceKey);
  const workItems: WorkItemData[] = inFlight.slice(0, 4).map((d, i) => ({
    key: d.key,
    label: d.label,
    owner: i === 0 ? { name: demo.workforce[0]?.name ?? "Team", kind: "human" } : undefined,
    progress: 30 + ((i * 20) % 60),
  }));

  const paidRevenue = demo.finance.invoices.filter((v) => v.paid).reduce((s, v) => s + v.amount, 0);
  const billsDue = demo.finance.bills.reduce((s, b) => s + b.amountDue, 0);
  const longestWait = demo.demand.reduce((m, d) => Math.max(m, d.waitingMinutes), 0);

  const capacityChips: CapacityChipData[] = [
    { key: "team", label: "Workforce", value: demo.workforce.length, intent: "info", live: true },
    {
      key: "ai",
      label: "AI coworkers",
      value: demo.workforce.filter((w) => w.kind === "ai").length,
      intent: "accent",
    },
    { key: "demand", label: "Open demand", value: demo.demand.length, intent: "success" },
    {
      key: "wait",
      label: "Longest wait",
      value: `${longestWait}m`,
      intent: longestWait > 60 ? "warning" : "neutral",
    },
  ];

  const utility: UtilityMeterData[] = [
    {
      key: "revenue",
      label: "Revenue in",
      value: money(demo.currency, paidRevenue),
      intent: "success",
      hint: "Paid invoices",
    },
    {
      key: "bills",
      label: "Bills due",
      value: `${demo.finance.bills.length} · ${money(demo.currency, billsDue)}`,
      intent: "warning",
      hint: "Upcoming",
    },
    ...(demo.finance.taxPeriod
      ? [
          {
            key: "tax",
            label: "Tax filing",
            value: `${demo.finance.taxPeriod.dueInDays} days`,
            intent: "info" as Intent,
          },
        ]
      : []),
    {
      key: "compliance",
      label: "Compliance",
      value: demo.finance.obligations.length === 0 ? "All clear" : `${demo.finance.obligations.length} open`,
      intent: demo.finance.obligations.length === 0 ? ("success" as Intent) : ("warning" as Intent),
    },
  ];

  return {
    capacityChips,
    zones,
    workItems,
    queues,
    cog: {
      proposal: demo.cogProposal,
      confirmLabel: `Assign ${profile.workItemNoun.singular}`,
      signals: profile.cog.signals.slice(0, 3),
    },
    presence: demo.workforce
      .slice(0, 6)
      .map((w) => ({ name: w.name, kind: w.kind, focus: w.role })),
    feed: demo.demand.slice(0, 3).map((d, i) => ({
      key: `feed-${i}`,
      actor:
        i % 2 === 0
          ? { name: demo.workforce.find((w) => w.kind === "ai")?.name ?? "AI coworker", kind: "ai" as const }
          : { name: demo.workforce[0]?.name ?? "You", kind: "human" as const },
      action: i % 2 === 0 ? `proposed an allocation for ${d.label}` : `confirmed ${d.label}`,
      at: i === 0 ? "just now" : `${i * 4}m`,
    })),
    quests:
      demo.finance.bills.length > 0
        ? [
            {
              key: "bills",
              title: `${demo.finance.bills.length} bills need review`,
              detail: `${money(demo.currency, billsDue)} due soon`,
              intent: "warning" as Intent,
              cta: "Review",
            },
          ]
        : [],
    utility,
  };
}

/** A compact, scannable card summary for the gallery grid (A·P2). */
export interface DemoGalleryCard {
  archetypeId: string;
  archetypeName: string;
  companyName: string;
  template: string;
  staffedZones: string; // "3 / 3 zones staffed"
  queuedDemand: number;
  longestWaitMinutes: number;
  workforce: number;
  aiCoworkers: number;
  revenueIn: string;
  cogProposal: string;
}

export function demoGalleryCard(demo: DemoBusiness, profile: TwinProfile): DemoGalleryCard {
  const staffedZoneKeys = new Set(demo.resources.map((r) => r.zoneKey));
  const queued = demo.demand.filter((d) => d.queueKey);
  const paidRevenue = demo.finance.invoices.filter((v) => v.paid).reduce((s, v) => s + v.amount, 0);
  return {
    archetypeId: demo.archetypeId,
    archetypeName: demo.archetypeName,
    companyName: demo.companyName,
    template: demo.template,
    staffedZones: `${staffedZoneKeys.size} / ${profile.zones.length} zones staffed`,
    queuedDemand: queued.length,
    longestWaitMinutes: demo.demand.reduce((m, d) => Math.max(m, d.waitingMinutes), 0),
    workforce: demo.workforce.length,
    aiCoworkers: demo.workforce.filter((w) => w.kind === "ai").length,
    revenueIn: money(demo.currency, paidRevenue),
    cogProposal: demo.cogProposal,
  };
}
