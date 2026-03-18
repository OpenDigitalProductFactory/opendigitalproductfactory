import { describe, expect, it } from "vitest";
import {
  generateScanId, generateAlertId,
  validateAlertResolution, buildScanPrompt,
  SCAN_STATUSES, SCAN_TRIGGER_TYPES,
  ALERT_TYPES, ALERT_SEVERITIES, ALERT_STATUSES, ALERT_RESOLUTIONS,
  REGULATORY_MONITOR_PROMPT,
} from "./regulatory-monitor-types";

describe("ID generators", () => {
  it("generates scan IDs with SCAN- prefix", () => {
    expect(generateScanId()).toMatch(/^SCAN-[A-Z0-9]{8}$/);
  });
  it("generates alert IDs with RALRT- prefix", () => {
    expect(generateAlertId()).toMatch(/^RALRT-[A-Z0-9]{8}$/);
  });
  it("generates unique IDs", () => {
    const ids = Array.from({ length: 20 }, () => generateScanId());
    expect(new Set(ids).size).toBe(20);
  });
});

describe("validateAlertResolution", () => {
  it("accepts valid resolutions", () => {
    for (const r of ALERT_RESOLUTIONS) {
      expect(validateAlertResolution(r)).toBeNull();
    }
  });
  it("rejects invalid resolution", () => {
    expect(validateAlertResolution("bogus")).toMatch(/Resolution must be one of/);
  });
});

describe("buildScanPrompt", () => {
  it("fills in regulation details", () => {
    const prompt = buildScanPrompt({
      name: "GDPR", shortName: "GDPR", jurisdiction: "EU",
      lastKnownVersion: "2024 amendment",
      sourceCheckDate: new Date("2026-01-15"),
      sourceUrl: "https://example.com/gdpr",
    });
    expect(prompt).toContain("GDPR");
    expect(prompt).toContain("EU");
    expect(prompt).toContain("2024 amendment");
    expect(prompt).toContain("2026-01-15");
    expect(prompt).toContain("https://example.com/gdpr");
  });
  it("handles null values with defaults", () => {
    const prompt = buildScanPrompt({
      name: "SOX", shortName: "SOX", jurisdiction: "US",
    });
    expect(prompt).toContain("unknown");
    expect(prompt).toContain("never");
    expect(prompt).toContain("none provided");
  });
});

describe("constants", () => {
  it("exports scan statuses", () => {
    expect(SCAN_STATUSES).toEqual(["running", "completed", "failed"]);
  });
  it("exports trigger types", () => {
    expect(SCAN_TRIGGER_TYPES).toEqual(["scheduled", "manual"]);
  });
  it("exports alert types", () => {
    expect(ALERT_TYPES).toContain("change-detected");
    expect(ALERT_TYPES).toContain("new-regulation");
    expect(ALERT_TYPES).toContain("deadline-approaching");
    expect(ALERT_TYPES).toContain("enforcement-action");
  });
  it("exports alert severities", () => {
    expect(ALERT_SEVERITIES).toEqual(["low", "medium", "high", "critical"]);
  });
  it("exports alert statuses", () => {
    expect(ALERT_STATUSES).toEqual(["pending", "reviewed", "actioned", "dismissed"]);
  });
  it("exports alert resolutions", () => {
    expect(ALERT_RESOLUTIONS).toContain("dismissed");
    expect(ALERT_RESOLUTIONS).toContain("obligation-created");
    expect(ALERT_RESOLUTIONS).toContain("regulation-updated");
    expect(ALERT_RESOLUTIONS).toContain("flagged-for-further-review");
  });
  it("exports LLM prompt template", () => {
    expect(REGULATORY_MONITOR_PROMPT).toContain("regulatory compliance monitor");
    expect(REGULATORY_MONITOR_PROMPT).toContain("hasChanged");
  });
});
