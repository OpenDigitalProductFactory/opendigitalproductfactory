// BI-7E49FA15 — every catalogued cron records its kill-switch posture.
//
// The Scheduled Jobs surface renders killSwitchEnforced from honorsEnabledGate,
// and gateAtEntry enforces ScheduledJob.enabled only for entries that declare
// it. An entry with neither flag is a job whose Disable button silently does
// nothing — the defect this item fixed — so the catalog must say, for every
// row, either "gated" or exactly why not.

import { describe, expect, it } from "vitest";
import { UPLOADS_BACKUP_JOB_ID } from "@/lib/operate/backups/constants";

import { SCHEDULED_JOB_CATALOG, SCHEDULED_JOB_HEARTBEATS, getCatalogEntry, getCatalogEntryByInngestId } from "./catalog";

describe("scheduled-job catalog kill-switch posture (BI-7E49FA15)", () => {
  it("every entry declares exactly one of honorsEnabledGate: true or a non-empty ungatedReason", () => {
    const offenders = SCHEDULED_JOB_CATALOG.filter((e) => {
      const gated = e.honorsEnabledGate === true;
      const reasoned =
        typeof e.ungatedReason === "string" && e.ungatedReason.trim().length > 0;
      return gated === reasoned;
    }).map((e) => e.inngestId);
    expect(offenders).toEqual([]);
  });

  it("keeps the quiescence callers deliberately ungated", () => {
    for (const inngestId of ["ops/self-upgrade-scheduled", "ops/all-backups-daily-scheduled"]) {
      const entry = getCatalogEntryByInngestId(inngestId);
      expect(entry?.honorsEnabledGate).not.toBe(true);
      expect(entry?.ungatedReason).toMatch(/quiescence/i);
    }
  });

  it("resolves an entry by Inngest function id and nothing for an unknown id", () => {
    expect(getCatalogEntryByInngestId("ops/code-graph-reconcile-scheduled")?.jobId).toBe(
      "code-graph-reconcile",
    );
    expect(getCatalogEntryByInngestId("ops/no-such-function")).toBeUndefined();
  });

  it("has a real parent in cron parity, but no independent cron for the uploads step", () => {
    const entry = SCHEDULED_JOB_HEARTBEATS.find(({ jobId }) => jobId === UPLOADS_BACKUP_JOB_ID);
    expect(entry).toMatchObject({ parentJobId: "all-backups-daily" });
    expect(getCatalogEntry(entry!.parentJobId)).toMatchObject({
      inngestId: "ops/all-backups-daily-scheduled",
      cron: entry!.schedule,
    });
    expect(SCHEDULED_JOB_CATALOG.some(({ jobId }) => jobId === UPLOADS_BACKUP_JOB_ID)).toBe(false);
  });
});
