// apps/web/components/twin/demo-snapshot.ts
//
// Deterministic demo data for a `TwinView` (EP-LIVING-BUSINESS-VIZ P3). Fills a
// `TwinSnapshot` from any `TwinProfile` so the twin is demonstrable BEFORE the
// live `LivingBusinessSnapshot` projection exists (parent spec P4). This is
// FIXTURE data — plausible, profile-shaped, and fully deterministic (no
// Math.random/Date, so tests and SSR are stable). It is not, and must not become,
// a data source: the real projection replaces it wholesale behind the same shape.

import type { TwinProfile } from "@dpf/storefront-templates";

import type { Intent } from "@/components/ui/report-kit";

import type { TwinSnapshot, TwinZoneSnapshot } from "./snapshot";
import type { CapacityChipData, ResourceUnitData } from "./types";

const STATE_CYCLE: Array<{ state: string; intent: Intent }> = [
  { state: "Active", intent: "success" },
  { state: "In progress", intent: "info" },
  { state: "Open", intent: "neutral" },
  { state: "Needs attention", intent: "warning" },
];

function titleCase(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

/** A small, stable pseudo-value from a string — keeps the fixture deterministic. */
function seed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 997;
  return h;
}

function unitsForZone(profile: TwinProfile, zoneKey: string, count: number): ResourceUnitData[] {
  const noun = titleCase(profile.resourceNoun.singular);
  const base = seed(`${profile.template}:${zoneKey}`);
  return Array.from({ length: count }, (_, i) => {
    const s = STATE_CYCLE[(base + i) % STATE_CYCLE.length];
    const owned = (base + i) % 3 === 0;
    return {
      key: `${zoneKey}-${i}`,
      label: `${noun} ${base % 20 + i + 1}`,
      state: s.state,
      intent: s.intent,
      owner: owned
        ? { name: i % 2 === 0 ? "AI coworker" : "Team", kind: i % 2 === 0 ? "ai" : "human" }
        : undefined,
    } satisfies ResourceUnitData;
  });
}

/**
 * Build a deterministic demo snapshot for a profile. `buildDemoTwinSnapshot` is
 * the fixture equivalent of the future projection: same shape, invented values.
 */
export function buildDemoTwinSnapshot(profile: TwinProfile): TwinSnapshot {
  const resPlural = profile.resourceNoun.plural;
  const workSingular = profile.workItemNoun.singular;

  const capacityChips: CapacityChipData[] = profile.capacityChips.map((label, i) => {
    const v = (seed(label) % 12) + i;
    const intents: Intent[] = ["info", "success", "warning", "danger"];
    return {
      key: `cap-${i}`,
      label,
      value: v,
      intent: intents[i % intents.length],
      live: i === 0,
    } satisfies CapacityChipData;
  });

  const zones: TwinZoneSnapshot[] = profile.zones.map((z) => {
    const count = 3 + (seed(z.key) % 3);
    return { key: z.key, units: unitsForZone(profile, z.key, count) } satisfies TwinZoneSnapshot;
  });

  const queues = profile.queues.map((qs, qi) => {
    const n = 2 + (seed(qs.key) % 3);
    return {
      key: qs.key,
      items: Array.from({ length: n }, (_, i) => ({
        key: `${qs.key}-${i}`,
        label: `${titleCase(workSingular)} #${seed(qs.key) + i}`,
        meta: i === 0 ? "highest priority" : undefined,
        waiting: `${(i + 1) * 4}m`,
        suggestion:
          qi === 0 && i === 0
            ? `Route to best ${profile.resourceNoun.singular} (${profile.cog.signals[0]})`
            : undefined,
      })),
    };
  });

  const workItems = [
    {
      key: "w0",
      label: `${titleCase(workSingular)} · in flight`,
      owner: { name: "AI coworker", kind: "ai" as const },
      progress: 55,
    },
    {
      key: "w1",
      label: `${titleCase(workSingular)} · with the team`,
      owner: { name: "Team", kind: "human" as const },
      progress: 30,
    },
    {
      key: "w2",
      label: `${titleCase(workSingular)} · waiting on a third party`,
      blockedOnExternal: true,
      blockedLabel: "Blocked · external",
    },
  ];

  const firstChip = profile.capacityChips[0] ?? resPlural;
  const cog = {
    proposal: `Allocate the next ${workSingular} to the best ${profile.resourceNoun.singular} by ${profile.cog.signals[0]}`,
    confirmLabel: `Assign ${workSingular}`,
    signals: profile.cog.signals.slice(0, 3),
  };

  const presence = [
    { name: "You", kind: "human" as const, focus: "on the floor" },
    { name: "Team", kind: "human" as const, focus: resPlural },
    { name: "AI coworker", kind: "ai" as const, focus: `watching ${firstChip}` },
  ];

  const feed = [
    { key: "f0", actor: { name: "AI coworker", kind: "ai" as const }, action: `proposed a ${workSingular} allocation`, at: "just now" },
    { key: "f1", actor: { name: "You", kind: "human" as const }, action: `confirmed a ${workSingular}`, at: "3m" },
    { key: "f2", actor: { name: "AI coworker", kind: "ai" as const }, action: `flagged a ${profile.resourceNoun.singular} needing attention`, at: "9m" },
  ];

  const quests = [
    { key: "q0", title: `A ${workSingular} needs you`, detail: `Blocked on a third party — one tap to nudge`, intent: "warning" as Intent, cta: "Nudge" },
  ];

  const utility = [
    { key: "bills", label: "Bills due", value: "2 · £1,240", intent: "warning" as Intent, hint: "Next 7 days" },
    { key: "tax", label: "Tax filing", value: "12 days", intent: "info" as Intent },
    { key: "compliance", label: "Compliance", value: "All clear", intent: "success" as Intent },
    { key: "improve", label: "Improve", value: "3 ideas", intent: "accent" as Intent },
  ];

  return { capacityChips, zones, workItems, queues, cog, presence, feed, quests, utility };
}
