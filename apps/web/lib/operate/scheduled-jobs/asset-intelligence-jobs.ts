// Asset-intelligence scheduled jobs, split out of catalog.ts (BI-C62127B9).
//
// The catalog is one hand-maintained list by design — see its header for why
// reflection cannot replace it — but it sits against an 800-line ceiling with a
// paired hotspot count, so it grows by DOMAIN GROUP rather than by row. This is
// the second such group, following catalog-decision-governance.ts; the next
// domain to add a job should follow the pattern rather than push the shared
// file over again.

import {
  CATALOG_SWEEP_JOB_ID,
  CATALOG_SWEEP_JOB_NAME,
  CATALOG_SWEEP_SCHEDULED_INNGEST_ID,
  CATALOG_SWEEP_REQUESTED_EVENT,
  CATALOG_SWEEP_CRON,
  CATALOG_SWEEP_CADENCE,
} from "@/lib/asset-intelligence/catalog-sweep-constants";
import {
  IDENTITY_INFERENCE_JOB_ID,
  IDENTITY_INFERENCE_JOB_NAME,
  IDENTITY_INFERENCE_SCHEDULED_INNGEST_ID,
  IDENTITY_INFERENCE_REQUESTED_EVENT,
  IDENTITY_INFERENCE_CRON,
  IDENTITY_INFERENCE_CADENCE,
} from "@/lib/asset-intelligence/identity-inference-constants";

import type { ScheduledJobCatalogEntry } from "./catalog-types";

export const ASSET_INTELLIGENCE_JOBS: readonly ScheduledJobCatalogEntry[] = [
  {
    jobId: CATALOG_SWEEP_JOB_ID,
    honorsEnabledGate: true,
    inngestId: CATALOG_SWEEP_SCHEDULED_INNGEST_ID,
    name: CATALOG_SWEEP_JOB_NAME,
    purpose:
      "EP-ASSET-INTELLIGENCE (spec §4.2/§4.4): iterates the CatalogIdentity spine and runs the open enrichment feeds — SBOM→identity bridge, CPE 2.3 crosswalk, and endoflife.date support-lifecycle milestones. If it stops, normalized identity + EOL/EOS posture goes stale.",
    cron: CATALOG_SWEEP_CRON,
    cadence: CATALOG_SWEEP_CADENCE,
    category: "editable",
    tracksRunData: true,
    runNowEvent: CATALOG_SWEEP_REQUESTED_EVENT,
  },
  {
    jobId: IDENTITY_INFERENCE_JOB_ID,
    honorsEnabledGate: true,
    inngestId: IDENTITY_INFERENCE_SCHEDULED_INNGEST_ID,
    name: IDENTITY_INFERENCE_JOB_NAME,
    purpose:
      "EP-ASSET-INTELLIGENCE (spec §4.2/§8): resolves the ambiguous tail of inventory items that deterministic fingerprint rules could not identify, using a cheap model (batched + per-run inference budget cap). Logs each AI resolution, promotes repeated ones to shadow fingerprint rules, and auto-applies only at high confidence. If it stops, unidentified estate items never gain a canonical identity or support-lifecycle posture.",
    cron: IDENTITY_INFERENCE_CRON,
    cadence: IDENTITY_INFERENCE_CADENCE,
    category: "editable",
    tracksRunData: true,
    runNowEvent: IDENTITY_INFERENCE_REQUESTED_EVENT,
  },
] as const;
