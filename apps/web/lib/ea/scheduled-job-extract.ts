// apps/web/lib/ea/scheduled-job-extract.ts
//
// Pure extractor for the Scheduling SysML projection (Parity Engine, living-graph
// — EP-ARCH-GRAPH-LIVE / EP-SCHEDULING-SURFACE). Projects EVERY scheduled unit of
// work the platform runs — across substrates — from the canonical scheduling map
// into the one architecture graph, so "scheduling" is a first-class surface
// (a navigable package with nodes and cross-layer edges) instead of being
// invisible. Before this, the ~26 Inngest crons + seeded agent tasks had no
// representation in the graph at all.
//
// SysML mapping (intra-model; cross-LAYER edges to the data model are applied by
// applySysmlModel.crossLayerRelationships):
//   - package        scheduling:pkg                 "Scheduling"
//   - substrate def  scheduling:substrate:<sub>     part_definition (inngest-cron, scheduled-agent-task)
//   - scheduled job  scheduling:job:<id>            part_usage (one SchedulingMapEntry)
// Each job `traces` to the Prisma data-model node for its substrate
// (prisma:model:ScheduledJob / prisma:model:ScheduledAgentTask), the real edge
// that lets a data-model change's blast_radius reach the scheduled work, and that
// answers "what scheduled work runs, and what breaks if it stops?".

import type { SysmlDesiredModel } from "./sysml-model-seed";
import {
  SCHEDULING_MAP,
  SUBSTRATE_DATA_MODEL,
  type SchedulingMapEntry,
  type SchedulingSubstrate,
} from "@/lib/operate/scheduled-jobs/scheduling-map";

export const SCHEDULING_PACKAGE_KEY = "scheduling:pkg";

/** Cross-LAYER target key convention: the data-model element the Prisma->EA
 *  mirror stamps as `prisma:model:<Model>`. Resolved by the applier against the
 *  live graph; links on a later pass if the data-model mirror has not run yet. */
export function dataModelKeyFor(substrate: SchedulingSubstrate): string {
  return `prisma:model:${SUBSTRATE_DATA_MODEL[substrate]}`;
}

const SUBSTRATE_LABEL: Record<SchedulingSubstrate, string> = {
  "inngest-cron": "Inngest crons",
  "scheduled-agent-task": "Scheduled agent tasks",
};

export function buildSchedulingModel(
  entries: readonly SchedulingMapEntry[] = SCHEDULING_MAP,
): SysmlDesiredModel {
  const elements: SysmlDesiredModel["elements"] = [];
  const relationships: SysmlDesiredModel["relationships"] = [];
  const crossLayerRelationships: SysmlDesiredModel["relationships"] = [];

  elements.push({
    sysmlKey: SCHEDULING_PACKAGE_KEY,
    typeSlug: "package",
    name: "Scheduling",
    description:
      "Live SysML projection of every scheduled unit of work the platform runs, across all substrates (Inngest crons + seeded coworker agent tasks), derived from the canonical scheduling map so scheduling is a first-class surface in the architecture graph and cannot drift.",
    properties: { sourceKey: "scheduling-map", jobCount: entries.length },
  });

  // Group jobs by their underlying substrate.
  const bySubstrate = new Map<SchedulingSubstrate, SchedulingMapEntry[]>();
  for (const e of entries) {
    const arr = bySubstrate.get(e.substrate) ?? [];
    arr.push(e);
    bySubstrate.set(e.substrate, arr);
  }

  for (const substrate of [...bySubstrate.keys()].sort()) {
    const substrateKey = `scheduling:substrate:${substrate}`;
    const jobs = bySubstrate.get(substrate)!;
    elements.push({
      sysmlKey: substrateKey,
      typeSlug: "part_definition",
      name: SUBSTRATE_LABEL[substrate] ?? substrate,
      description: `Scheduled work run by the ${substrate} substrate.`,
      properties: { sourceKey: `scheduling:substrate:${substrate}`, layer: "operational", jobCount: jobs.length },
    });
    relationships.push({ fromKey: SCHEDULING_PACKAGE_KEY, toKey: substrateKey, relSlug: "contains" });

    for (const job of [...jobs].sort((a, b) => a.id.localeCompare(b.id))) {
      const jobKey = `scheduling:job:${job.id}`;
      elements.push({
        sysmlKey: jobKey,
        typeSlug: "part_usage",
        name: job.name,
        description: `${job.cadence} — ${job.purpose}`,
        properties: {
          sourceKey: `scheduling:job:${job.id}`,
          layer: "operational",
          refinementLevel: "actual",
          jobId: job.id,
          substrate: job.substrate,
          cron: job.cron,
          cadence: job.cadence,
          category: job.category,
        },
      });
      relationships.push({ fromKey: substrateKey, toKey: jobKey, relSlug: "contains" });
      // Cross-layer: this scheduled job traces to its substrate's data-model type.
      crossLayerRelationships.push({ fromKey: jobKey, toKey: dataModelKeyFor(substrate), relSlug: "traces" });
    }
  }

  return {
    elements,
    relationships,
    elementTypeSlugs: ["package", "part_definition", "part_usage"],
    relTypeSlugs: ["contains", "traces"],
    view: {
      name: "Scheduling — Live Projection",
      description:
        "Live, system-maintained projection of all scheduled platform work and the substrate that runs each job.",
      viewpointName: "System Decomposition & Interfaces",
      scopeRef: "scheduling",
    },
    softRemovePrefix: "scheduling:",
    crossLayerRelationships,
  };
}
