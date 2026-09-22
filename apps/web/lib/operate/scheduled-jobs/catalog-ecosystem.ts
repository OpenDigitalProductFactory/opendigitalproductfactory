/**
 * Ecosystem participation jobs (EP-35BA9476).
 *
 * Grouped into their own module the way flow, watch and hygiene entries are —
 * the module-size ratchet on catalog.ts exists to stop one file becoming the
 * home for every job, and a family of related entries is exactly what belongs
 * behind one spread.
 */

import type { ScheduledJobCatalogEntry } from "./catalog-types";

export const ECOSYSTEM_JOB_CATALOG_ENTRIES: readonly ScheduledJobCatalogEntry[] = [
  {
    jobId: "ecosystem-issue-submission-sweep",
    inngestId: "ecosystem/issue-submission-sweep",
    honorsEnabledGate: true,
    name: "Ecosystem: issue submission sweep",
    purpose:
      "Submits locally-triaged issue reports to the ecosystem so they are heard, without "
      + "needing anyone to remember. Halts and asks once if upstream feedback has not been "
      + "turned on; respects the contribution pause and fork-only mode.",
    cron: "41 5 * * *",
    cadence: "Daily (05:41)",
    category: "editable",
    tracksRunData: true,
    runNowEvent: null,
  },

  {
    jobId: "ecosystem-inbound-issue-triage",
    inngestId: "ecosystem/inbound-issue-triage",
    honorsEnabledGate: true,
    name: "Ecosystem: inbound issue triage",
    purpose:
      "Reads what the ecosystem submitted — upstream issues filed by the relay and peer "
      + "federated demand — and files it into the backlog with the submitter preserved. "
      + "No-ops unless the installation's purpose is evolve-dpf.",
    cron: "17 6 * * 1",
    cadence: "Weekly (Mondays, 06:17)",
    category: "editable",
    tracksRunData: true,
    runNowEvent: null,
  },
];
