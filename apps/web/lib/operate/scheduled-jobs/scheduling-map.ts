// BI-SCHED-CANONICAL-MAP / EP-SCHEDULING-SURFACE — the canonical scheduling map.
//
// ONE in-code manifest of every recurring unit of work the platform runs, across
// ALL substrates — not just Inngest crons. This is the single "front door": new
// scheduled work registers here, the EA extractor (scheduled-job-extract.ts)
// projects it into the architecture graph, and the contention check
// (scheduling-map.test.ts) reads it to catch same-tick pile-ups.
//
// Storage is NOT unified (substrate-first doctrine): Inngest crons keep their
// catalog, ScheduledAgentTasks keep their table. This map is the read-model that
// spans them so scheduling can be reasoned about as one surface.

import { SCHEDULED_JOB_CATALOG } from "./catalog";

/** Which underlying mechanism runs the work. Each maps to the Prisma data-model
 *  node the EA extractor draws its cross-layer `traces` edge to. */
export type SchedulingSubstrate = "inngest-cron" | "scheduled-agent-task";

/** Prisma model (EA data-object node `prisma:model:<Model>`) each substrate
 *  traces to in the architecture graph. */
export const SUBSTRATE_DATA_MODEL: Record<SchedulingSubstrate, string> = {
  "inngest-cron": "ScheduledJob",
  "scheduled-agent-task": "ScheduledAgentTask",
};

export interface SchedulingMapEntry {
  /** Stable id within its substrate (inngestId for crons, taskId for agent tasks). */
  id: string;
  name: string;
  substrate: SchedulingSubstrate;
  /** 5-field cron expression where one exists; null when the cadence is a named
   *  token (e.g. the "daily" backup crons resolve their time from an env const). */
  cron: string | null;
  /** Human cadence label for display. */
  cadence: string;
  /** core = platform-integrity; editable = operator-tunable. */
  category: "core" | "editable";
  purpose: string;
}

// Inngest crons — derived from the authoritative catalog so this cannot drift
// from the running functions (the catalog itself is guarded by the
// scheduledFunctions <-> catalog parity test in queue/functions/index.test.ts).
const CRON_ENTRIES: SchedulingMapEntry[] = SCHEDULED_JOB_CATALOG.map((e) => ({
  id: e.inngestId,
  name: e.name,
  substrate: "inngest-cron" as const,
  // A named token like "daily" carries no analysable tick; only keep real exprs.
  cron: e.cron.includes("*") ? e.cron : null,
  cadence: e.cadence,
  category: e.category,
  purpose: e.purpose,
}));

// Autonomous coworker scheduled tasks (seeded ScheduledAgentTask rows). Ids and
// schedules mirror their seed config in packages/db/src/{data-model-mirror,
// sysml-projection,discovery-triage,hive-scout}-config.ts. Restated as literals
// rather than imported: the @dpf/db test alias resolves to a light client barrel
// that does not re-export these constants, so a cross-package import resolves
// undefined under vitest. These are stable seed ids — they change rarely and
// only alongside the seed.
const AGENT_TASK_ENTRIES: SchedulingMapEntry[] = [
  {
    id: "data-model-mirror-nightly",
    name: "Data model mirror (nightly)",
    substrate: "scheduled-agent-task",
    cron: "0 3 * * *",
    cadence: "Daily at 03:00",
    category: "core",
    purpose: "Nightly data-model -> EA mirror reconcile (deterministic handler).",
  },
  {
    id: "sysml-projection-nightly",
    name: "SysML projection (nightly)",
    substrate: "scheduled-agent-task",
    cron: "0 4 * * *",
    cadence: "Daily at 04:00",
    category: "core",
    purpose: "Nightly SysML projection reconcile — runs after the data-model mirror.",
  },
  {
    id: "discovery-taxonomy-gap-triage-daily",
    name: "Discovery taxonomy-gap triage (daily)",
    substrate: "scheduled-agent-task",
    cron: "0 8 * * *",
    cadence: "Daily at 08:00",
    category: "editable",
    purpose: "Triages discovery taxonomy gaps into the backlog.",
  },
  {
    id: "external-catalog-scout-weekly",
    name: "Hive scout (weekly cadence)",
    substrate: "scheduled-agent-task",
    cron: "17 8 * * *",
    cadence: "Daily at 08:17",
    category: "editable",
    purpose: "Scheduled portfolio-intelligence sweep.",
  },
];

/** Every scheduled unit of work the platform runs, across all substrates. */
export const SCHEDULING_MAP: readonly SchedulingMapEntry[] = [
  ...CRON_ENTRIES,
  ...AGENT_TASK_ENTRIES,
];

/** Group map entries that fire on the exact same cron expression — the
 *  deterministic "same tick" contention signal. Entries with a null cron
 *  (named-token cadences) are excluded. Returns cron -> entries, only for
 *  crons shared by 2+ entries. */
export function cronCollisions(
  entries: readonly SchedulingMapEntry[] = SCHEDULING_MAP,
): Map<string, SchedulingMapEntry[]> {
  const byCron = new Map<string, SchedulingMapEntry[]>();
  for (const e of entries) {
    if (!e.cron) continue;
    const arr = byCron.get(e.cron) ?? [];
    arr.push(e);
    byCron.set(e.cron, arr);
  }
  return new Map([...byCron].filter(([, arr]) => arr.length > 1));
}
