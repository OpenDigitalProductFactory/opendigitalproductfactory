// apps/web/lib/operate/scheduled-jobs/catalog-watches.ts
//
// Catalog entries for the proactive WATCH jobs: crons whose output is a finding
// or an issue addressed to an operator, rather than a maintenance effect on the
// platform itself. They share a shape — editable cadence, a run-now event, and
// a deliberate refusal to act on what they find — so they read better together
// than scattered through the main catalog.
//
// Split out of catalog.ts, which sat at exactly the 800-LOC module ceiling and
// so could not accept another job (BI-OPT-RATCHETS). Same precedent as
// ./catalog-types.

import {
  BUSINESS_JOURNEY_WATCHDOG_CADENCE,
  BUSINESS_JOURNEY_WATCHDOG_CRON,
  BUSINESS_JOURNEY_WATCHDOG_INNGEST_ID,
  BUSINESS_JOURNEY_WATCHDOG_JOB_ID,
  BUSINESS_JOURNEY_WATCHDOG_JOB_NAME,
  BUSINESS_JOURNEY_WATCHDOG_REQUESTED_EVENT,
} from "@/lib/business-journeys/watchdog-constants";
import {
  OBLIGATION_WATCH_CADENCE,
  OBLIGATION_WATCH_CRON,
  OBLIGATION_WATCH_INNGEST_ID,
  OBLIGATION_WATCH_JOB_ID,
  OBLIGATION_WATCH_JOB_NAME,
  OBLIGATION_WATCH_REQUESTED_EVENT,
} from "@/lib/compliance/obligation-watch-constants";
import {
  WORKROOM_DRIVE_CADENCE,
  WORKROOM_DRIVE_CRON,
  WORKROOM_DRIVE_INNGEST_ID,
  WORKROOM_DRIVE_JOB_ID,
  WORKROOM_DRIVE_JOB_NAME,
  WORKROOM_DRIVE_REQUESTED_EVENT,
} from "@/lib/work-management/workroom-drive-constants";

import type { ScheduledJobCatalogEntry } from "./catalog-types";

export const WATCH_JOB_CATALOG_ENTRIES: readonly ScheduledJobCatalogEntry[] = [
  {
    jobId: BUSINESS_JOURNEY_WATCHDOG_JOB_ID,
    inngestId: BUSINESS_JOURNEY_WATCHDOG_INNGEST_ID,
    honorsEnabledGate: true,
    name: BUSINESS_JOURNEY_WATCHDOG_JOB_NAME,
    purpose:
      "BI-E105303D / EP-PROACTIVE-OPS: exercises the install's critical business journeys (front door, enquiry, booking, sign-in, checkout) against the running system, records evidence, and raises a journey_failure issue the Needs-you inbox surfaces. If it stops, a broken signup or booking path goes unnoticed until a customer complains.",
    cron: BUSINESS_JOURNEY_WATCHDOG_CRON,
    cadence: BUSINESS_JOURNEY_WATCHDOG_CADENCE,
    category: "editable",
    tracksRunData: false,
    runNowEvent: BUSINESS_JOURNEY_WATCHDOG_REQUESTED_EVENT,
  },
  {
    jobId: OBLIGATION_WATCH_JOB_ID,
    inngestId: OBLIGATION_WATCH_INNGEST_ID,
    honorsEnabledGate: true,
    name: OBLIGATION_WATCH_JOB_NAME,
    purpose:
      "TAK §8.11 obligation-assurance-watch: sweeps recorded obligations, control reviews, and licence expiries against a 30-day look-ahead and raises an assurance finding for each one falling due, plus for any recurrence that has no next date. The accountable owner decides the response; this job never decides it. If it stops, six recorded cadence columns go back to reading as controls in force while behaving as controls that are not.",
    cron: OBLIGATION_WATCH_CRON,
    cadence: OBLIGATION_WATCH_CADENCE,
    category: "editable",
    tracksRunData: false,
    runNowEvent: OBLIGATION_WATCH_REQUESTED_EVENT,
  },
  {
    jobId: WORKROOM_DRIVE_JOB_ID,
    inngestId: WORKROOM_DRIVE_INNGEST_ID,
    honorsEnabledGate: true,
    name: WORKROOM_DRIVE_JOB_NAME,
    purpose:
      "BI-FCD639D9: wakes standing Workrooms on their declared trigger, dispatches agent stages through ScheduledAgentTask, converts human/governed stages into attention, and stops on budget, review, or a declared stop. If it stops, standing rooms wait for a person to notice.",
    cron: WORKROOM_DRIVE_CRON,
    cadence: WORKROOM_DRIVE_CADENCE,
    category: "editable",
    tracksRunData: false,
    runNowEvent: WORKROOM_DRIVE_REQUESTED_EVENT,
  },
] as const;
