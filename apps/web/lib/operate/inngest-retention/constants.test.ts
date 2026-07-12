import { describe, expect, it } from "vitest";

import {
  INNGEST_HISTORY_RETENTION_DAYS,
  INNGEST_REDIS_RUN_STATE_TTL_HOURS_CEILING,
  ORPHAN_REAP_AGE_HOURS,
  nextInngestRetentionRunAt,
} from "./constants";

describe("Inngest retention TTL alignment (BI-915C40C6)", () => {
  it("reaps orphans only after Redis run-state has certainly expired", () => {
    // Generator bound: Postgres unfinished rows outliving Redis {estate} TTL
    // are corpses. Reap age must sit strictly above the observed Redis ceiling
    // so a live run is never deleted while state may still exist.
    expect(ORPHAN_REAP_AGE_HOURS).toBeGreaterThan(INNGEST_REDIS_RUN_STATE_TTL_HOURS_CEILING);
  });

  it("keeps history retention longer than the orphan reap window", () => {
    // Finished history is operational telemetry; keep more of it than the
    // orphan window so a reaped corpse is still diagnosable in finished tables.
    expect(INNGEST_HISTORY_RETENTION_DAYS * 24).toBeGreaterThan(ORPHAN_REAP_AGE_HOURS);
  });

  it("schedules the next 6h slot at :17 past the block", () => {
    // 2026-07-11T12:00:00Z is exactly a block start → next slot is 12:17 same day.
    const from = new Date("2026-07-11T12:00:00.000Z");
    expect(nextInngestRetentionRunAt(from).toISOString()).toBe("2026-07-11T12:17:00.000Z");
  });
});
