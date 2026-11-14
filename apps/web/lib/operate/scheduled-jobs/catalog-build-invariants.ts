import type { ScheduledJobCatalogEntry } from "./catalog-types";

/** BI-9FA1F9CF: a Build Studio plan that passed review must not stay refused on PLAN_REQUIRED. */
export const PLAN_GATE_STALL_JOB_CATALOG_ENTRY: ScheduledJobCatalogEntry = {
  jobId: "plan-gate-stall-invariant",
  inngestId: "build/plan-gate-stall-invariant",
  honorsEnabledGate: true,
  name: "Plan gate stall invariant",
  purpose: "Reports Build Studio builds whose plan passed review but stay refused on PLAN_REQUIRED for 15 minutes.",
  cron: "4,19,34,49 * * * *",
  cadence: "Every 15 min (at :04)",
  category: "editable",
  tracksRunData: false,
  runNowEvent: null,
};
