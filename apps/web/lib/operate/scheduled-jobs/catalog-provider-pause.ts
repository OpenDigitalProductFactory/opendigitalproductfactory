import type { ScheduledJobCatalogEntry } from "./catalog-types";

export const PROVIDER_PAUSE_JOB_CATALOG_ENTRY: ScheduledJobCatalogEntry = {
  jobId: "provider-pause-reconcile",
  inngestId: "ops/provider-pause-reconcile",
  name: "Resume overdue provider pauses",
  purpose: "Resumes due operator pauses after restart or delayed event delivery, preserving newer pauses and health restrictions.",
  cron: "1,6,11,16,21,26,31,36,41,46,51,56 * * * *",
  cadence: "Every 5 minutes",
  category: "core",
  tracksRunData: false,
  ungatedReason: "Operator-selected pause timers must complete after restart; each persisted pause identity and expiry governs resumption.",
  runNowEvent: null,
};
