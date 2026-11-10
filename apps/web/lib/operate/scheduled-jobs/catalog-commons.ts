// apps/web/lib/operate/scheduled-jobs/catalog-commons.ts
//
// Catalog entries for the COMMONS crons: the weekly passes that move durable
// findings out of this install and into shared knowledge, or report that they
// have not moved. They share a shape — weekly, operator-tunable, deterministic,
// and each files exactly one backlog item rather than acting on anyone's
// behalf, because choosing where a learning belongs is a judgment call.
//
// Split out of catalog.ts, which was at the 800-LOC module ceiling. Same
// precedent as ./catalog-flow, ./catalog-hygiene and ./catalog-watches.

import type { ScheduledJobCatalogEntry } from "./catalog-types";

export const COMMONS_JOB_CATALOG_ENTRIES: readonly ScheduledJobCatalogEntry[] = [
  {
    jobId: "canonical-improvement-digest",
    inngestId: "ops/canonical-improvement-digest",
    honorsEnabledGate: true,
    name: "Canonical improvement digest",
    purpose:
      "Batches [reference-doc] ImprovementProposal rows into one doc chore BI for human-approved canonical-source PRs (process-spine §6.5).",
    cron: "17 6 * * 1",
    cadence: "Weekly (Mon 06:17)",
    category: "editable",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "local-only-knowledge-sweep",
    inngestId: "ops/local-only-knowledge-sweep",
    honorsEnabledGate: true,
    name: "Local-only knowledge sweep",
    purpose:
      "Reports durable findings this install captured and never routed to a commons lane (ImprovementProposal still at contributionStatus 'local'), and files one standing chore BI naming the governed route per lane. Never contributes anything itself (BI-1281A164, EP-HIVE-HARVEST).",
    cron: "43 6 * * 1",
    cadence: "Weekly (Mon 06:43)",
    category: "editable",
    tracksRunData: true,
    runNowEvent: null,
  },
];
