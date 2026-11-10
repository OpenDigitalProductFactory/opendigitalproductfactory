// apps/web/lib/operate/scheduled-jobs/catalog-guard-outcomes.ts
//
// Catalog entries for the guard outcome jobs (BI-FEDD8F45): daily refusal
// classification, then the daily retirement review. Split out of catalog.ts,
// which sits at the 800-LOC module ceiling (BI-OPT-RATCHETS), the same
// precedent as ./catalog-watches.

import type { ScheduledJobCatalogEntry } from "./catalog-types";

export const GUARD_OUTCOME_JOB_CATALOG_ENTRIES: readonly ScheduledJobCatalogEntry[] = [
  {
    jobId: "guard-outcome-classify",
    inngestId: "ops/guard-outcome-classify",
    honorsEnabledGate: true,
    name: "Guard outcome classification",
    purpose:
      "BI-FEDD8F45: classifies each recorded guard refusal as caught, overridden, false refusal or unresolved from later runs of the same guard on the same clone and branch, and prunes guard-outcome telemetry past 365 days.",
    cron: "43 5 * * *",
    cadence: "Daily at 05:43",
    category: "editable",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "guard-retirement-review",
    inngestId: "ops/guard-retirement-review",
    honorsEnabledGate: true,
    name: "Guard retirement review",
    purpose:
      "BI-FEDD8F45: files one review item for a guard refused but never caught or with a false-refusal rate above 25%, and one weekly digest of never-refused guards. Never disables or deletes a guard.",
    cron: "40 6 * * *",
    cadence: "Daily at 06:40",
    category: "editable",
    tracksRunData: false,
    runNowEvent: null,
  },
];
