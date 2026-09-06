// Types for the scheduled-job catalog (BI-ED117C82 extraction).
//
// Split from catalog.ts when that file crossed the 800-LOC ceiling. The catalog
// is a hand-maintained registry that grows with every new scheduled job, so the
// shape it conforms to is separated from the data itself rather than capping the
// list. Pure types — no imports, no runtime.

export type JobCategory = "core" | "editable";

export interface ScheduledJobCatalogEntry {
  /** Join key against ScheduledJob.jobId. For crons that maintain a row this
   *  IS that row's jobId; for the rest it is a stable synthetic id (an
   *  edit/enable upserts a row under this id on first mutation). */
  jobId: string;
  /** The Inngest function id (id passed to inngest.createFunction). */
  inngestId: string;
  /** Human-readable job name. */
  name: string;
  /** One-line purpose — what breaks if this never runs. */
  purpose: string;
  /** Raw cron expression as defined in code. */
  cron: string;
  /** Human cadence label for display (derived from `cron`). */
  cadence: string;
  category: JobCategory;
  /** True when a ScheduledJob row carries live run data for this job. */
  tracksRunData: boolean;
  /** True when the job's own entry gate actually consults ScheduledJob.enabled,
   *  so the operator's Disable is load-bearing. Default false: most crons never
   *  read the column, and a switch that silently does nothing is worse than an
   *  absent one (BI-7E49FA15). */
  honorsEnabledGate?: boolean;
  /** Declared reason a job is deliberately NOT gated on ScheduledJob.enabled.
   *  Every entry carries exactly one of `honorsEnabledGate: true` or a
   *  non-empty `ungatedReason` (catalog.test.ts enforces it), so "no kill
   *  switch" is always a recorded decision rather than an omission. */
  ungatedReason?: string;
  /** Inngest event name that triggers a one-shot manual run, or null when no
   *  manual-trigger event function exists for this job. */
  runNowEvent: string | null;
}
