// Data-governance registration for the owned durable-job engine (BI-85E6EF14,
// spec 2026-09-25 §5.2). Engine state only: written and read by
// apps/web/lib/jobs/postgres, never shown on a surface, and pruned by the engine
// after its retention window. Payloads carry what senders put in them, mostly
// record identifiers, as Inngest's own store does today.

import type { DataAssetDefinition } from "./asset-types";

function jobEngineAsset(id: `data:${string}`, prismaModel: string): DataAssetDefinition {
  return {
    id,
    physical: { prismaModel },
    domain: "platform-operations",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["operational"],
    sensitivity: "internal",
    criticality: "standard",
    subjectLocators: [],
    lifecycleClass: "operational",
    purposeCapabilities: ["platform-operations"],
    residencyClass: "local-only",
    projectionClass: "structure",
    classification: { state: "confirmed", source: "manual", effectiveFrom: "2026-10-01" },
    fields: [],
  };
}

export const JOB_ENGINE_ASSETS: readonly DataAssetDefinition[] = [
  jobEngineAsset("data:job-event", "JobEvent"),
  jobEngineAsset("data:job-run", "JobRun"),
  jobEngineAsset("data:job-step", "JobStep"),
  jobEngineAsset("data:job-wait", "JobWait"),
  jobEngineAsset("data:job-concurrency-slot", "JobConcurrencySlot"),
  jobEngineAsset("data:job-cron-state", "JobCronState"),
];
