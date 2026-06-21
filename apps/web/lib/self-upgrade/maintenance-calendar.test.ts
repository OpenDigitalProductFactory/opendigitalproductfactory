import { describe, expect, it } from "vitest";
import {
  HEAVY_JOB_IDS,
  HEAVY_MAINTENANCE,
  isHeavyMaintenanceBusyAtUtc,
  parseSimpleCron,
  type HeavyMaintenanceWindow,
} from "./maintenance-calendar";
import { getCatalogEntry } from "@/lib/operate/scheduled-jobs/catalog";
import { POSTGRES_BACKUP_CRON } from "@/lib/operate/backups/constants";
import { DATA_RETENTION_CRON } from "@/lib/operate/retention/constants";

// 2026-05-25 is a Monday; 2026-05-31 is a Sunday.
const MON_0315_UTC = new Date("2026-05-25T03:15:00Z");
const MON_0430_UTC = new Date("2026-05-25T04:30:00Z");
const MON_0230_UTC = new Date("2026-05-25T02:30:00Z");
const MON_0530_UTC = new Date("2026-05-25T05:30:00Z");
const MON_1200_UTC = new Date("2026-05-25T12:00:00Z");
const SUN_0315_UTC = new Date("2026-05-31T03:15:00Z");

describe("parseSimpleCron", () => {
  it("parses a daily cron", () => {
    expect(parseSimpleCron("0 3 * * *")).toEqual({ minute: 0, hour: 3, daysOfWeek: null });
  });
  it("parses a weekly (day-of-week) cron", () => {
    expect(parseSimpleCron("0 3 * * 0")).toEqual({ minute: 0, hour: 3, daysOfWeek: [0] });
  });
  it("returns null for unsupported shapes (intervals, day-of-month, month)", () => {
    expect(parseSimpleCron("*/5 * * * *")).toBeNull();
    expect(parseSimpleCron("0 3 5 * *")).toBeNull();
    expect(parseSimpleCron("0 3 * 6 *")).toBeNull();
    expect(parseSimpleCron("0 25 * * *")).toBeNull();
    expect(parseSimpleCron("0 3 * *")).toBeNull(); // wrong field count
  });
});

describe("isHeavyMaintenanceBusyAtUtc (default calendar)", () => {
  it("is busy during the 03:00-04:00 UTC backup/maintenance cluster", () => {
    expect(isHeavyMaintenanceBusyAtUtc(MON_0315_UTC)).toBe(true);
  });
  it("is busy during the 04:00-05:00 UTC retention sweep", () => {
    expect(isHeavyMaintenanceBusyAtUtc(MON_0430_UTC)).toBe(true);
  });
  it("is clear before the cluster (02:30 UTC), after it (05:30 UTC), and midday", () => {
    expect(isHeavyMaintenanceBusyAtUtc(MON_0230_UTC)).toBe(false);
    expect(isHeavyMaintenanceBusyAtUtc(MON_0530_UTC)).toBe(false);
    expect(isHeavyMaintenanceBusyAtUtc(MON_1200_UTC)).toBe(false);
  });
});

describe("isHeavyMaintenanceBusyAtUtc (day-of-week + wrap)", () => {
  const weeklyPrune: HeavyMaintenanceWindow[] = [
    { label: "infra prune", cron: "0 3 * * 0", durationMin: 30 },
  ];
  it("a weekly Sunday window is busy on Sunday and clear on Monday", () => {
    expect(isHeavyMaintenanceBusyAtUtc(SUN_0315_UTC, weeklyPrune)).toBe(true);
    expect(isHeavyMaintenanceBusyAtUtc(MON_0315_UTC, weeklyPrune)).toBe(false);
  });
  it("a window wrapping past midnight marks the next UTC day's early minutes busy", () => {
    const wrap: HeavyMaintenanceWindow[] = [{ label: "late", cron: "0 23 * * *", durationMin: 120 }];
    expect(isHeavyMaintenanceBusyAtUtc(new Date("2026-05-25T00:30:00Z"), wrap)).toBe(true); // 23:00+120 = 01:00
    expect(isHeavyMaintenanceBusyAtUtc(new Date("2026-05-25T01:30:00Z"), wrap)).toBe(false);
  });
});

describe("calendar derives from SCHEDULED_JOB_CATALOG (single source of truth + drift guard)", () => {
  it("every tracked heavy job id resolves to a catalog entry (none silently dropped)", () => {
    for (const jobId of HEAVY_JOB_IDS) {
      expect(
        getCatalogEntry(jobId),
        `heavy job '${jobId}' is missing from SCHEDULED_JOB_CATALOG`,
      ).toBeDefined();
    }
    expect(HEAVY_MAINTENANCE).toHaveLength(HEAVY_JOB_IDS.length);
  });

  it("pins the backup + retention timing to the runtime cron constants", () => {
    // The catalog shows "daily" for backups; the constant pins the real 03:00 UTC.
    const crons = HEAVY_MAINTENANCE.map((w) => w.cron);
    expect(crons).toContain(POSTGRES_BACKUP_CRON);
    expect(crons).toContain(DATA_RETENTION_CRON);
    expect(parseSimpleCron(POSTGRES_BACKUP_CRON)?.hour).toBe(3);
    expect(parseSimpleCron(DATA_RETENTION_CRON)?.hour).toBe(4);
  });

  it("labels come from the catalog (not hand-written)", () => {
    const labels = HEAVY_MAINTENANCE.map((w) => w.label);
    expect(labels).toContain(getCatalogEntry("infra-prune")?.name);
  });
});
