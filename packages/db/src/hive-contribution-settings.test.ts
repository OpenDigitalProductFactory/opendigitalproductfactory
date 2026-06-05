import { describe, expect, it } from "vitest";
import {
  buildLedgerEntry,
  HIVE_CONTRIBUTION_TYPES,
  isContributionEnabled,
  isTypeOptedIn,
  resolveHiveContributionStatuses,
  type HiveContributionConfig,
} from "./hive-contribution-settings";

const base: HiveContributionConfig = {
  deviceFingerprintOptIn: true,
  hiveContributionsPaused: false,
  contributionMode: "selective",
};

describe("device fingerprint opt-in (default-on)", () => {
  it("is enabled by default", () => {
    expect(isContributionEnabled("device_fingerprint", base)).toBe(true);
  });

  it("is disabled when opted out", () => {
    expect(isContributionEnabled("device_fingerprint", { ...base, deviceFingerprintOptIn: false })).toBe(false);
  });
});

describe("source/improvement follows contributionMode", () => {
  it("enabled for selective / contribute_all", () => {
    expect(isTypeOptedIn("source", { ...base, contributionMode: "selective" })).toBe(true);
    expect(isTypeOptedIn("improvement", { ...base, contributionMode: "contribute_all" })).toBe(true);
  });
  it("disabled for fork_only", () => {
    expect(isTypeOptedIn("source", { ...base, contributionMode: "fork_only" })).toBe(false);
  });
});

describe("master pause overrides every type", () => {
  it("disables all types regardless of per-type opt-in", () => {
    const paused = { ...base, hiveContributionsPaused: true };
    for (const type of HIVE_CONTRIBUTION_TYPES) {
      expect(isContributionEnabled(type, paused), type).toBe(false);
    }
  });

  it("preserves the per-type opt-in state under pause (optedIn vs enabled)", () => {
    const statuses = resolveHiveContributionStatuses({ ...base, hiveContributionsPaused: true });
    const fp = statuses.find((s) => s.type === "device_fingerprint")!;
    expect(fp.optedIn).toBe(true); // preference retained
    expect(fp.enabled).toBe(false); // but paused
  });
});

describe("resolveHiveContributionStatuses", () => {
  it("returns one status per type with a plain-language description", () => {
    const statuses = resolveHiveContributionStatuses(base);
    expect(statuses).toHaveLength(HIVE_CONTRIBUTION_TYPES.length);
    const fp = statuses.find((s) => s.type === "device_fingerprint")!;
    expect(fp.description).toMatch(/Never your MAC/);
  });
});

describe("buildLedgerEntry", () => {
  it("shapes a ledger row starting at submitted", () => {
    const entry = buildLedgerEntry({
      contributionType: "device_fingerprint",
      contributor: "dpf-pseudo-1",
      ruleKey: "estate:reolink-camera",
      summary: "Reolink IP camera → Security & Surveillance",
      redactionStatus: "not_required",
    });
    expect(entry.status).toBe("submitted");
    expect(entry.contributionType).toBe("device_fingerprint");
    expect(entry.ruleKey).toBe("estate:reolink-camera");
  });
});
