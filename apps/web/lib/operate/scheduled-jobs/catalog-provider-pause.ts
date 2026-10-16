import type { ScheduledJobCatalogEntry } from "./catalog-types";

export const SUBSCRIPTION_QUOTA_JOB_CATALOG_ENTRY: ScheduledJobCatalogEntry = {
  jobId: "subscription-quota-recovery", inngestId: "ops/subscription-quota-recovery",
  name: "Recheck limited subscriptions", purpose: "Checks active ChatGPT and Codex accounts hourly for recovered capacity before the provider's estimated reset.",
  cron: "3,8,13,18,23,28,33,38,43,48,53,58 * * * *", cadence: "Hourly per limited account",
  category: "core", tracksRunData: false,
  ungatedReason: "Bounded recovery of enabled subscription accounts; manual pauses, hard failures and changed credentials remain authoritative.",
  runNowEvent: null,
};

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
