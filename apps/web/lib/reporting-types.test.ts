// apps/web/lib/reporting-types.test.ts
import { describe, expect, it } from "vitest";
import {
  generateSnapshotId, calculatePostureScore, isValidSubmissionTransition, SUBMISSION_STATUS_FLOW,
} from "./reporting-types";

describe("ID generator", () => {
  it("generates snapshot IDs with SNAP- prefix", () => {
    expect(generateSnapshotId()).toMatch(/^SNAP-[A-Z0-9]{8}$/);
  });
  it("generates unique IDs", () => {
    const ids = Array.from({ length: 20 }, () => generateSnapshotId());
    expect(new Set(ids).size).toBe(20);
  });
});

describe("calculatePostureScore", () => {
  it("returns 100 for perfect compliance", () => {
    expect(calculatePostureScore({ totalObligations: 10, coveredObligations: 10, totalControls: 8, implementedControls: 8, openIncidents: 0, overdueActions: 0 })).toBe(100);
  });
  it("returns 0 for worst case", () => {
    expect(calculatePostureScore({ totalObligations: 10, coveredObligations: 0, totalControls: 10, implementedControls: 0, openIncidents: 10, overdueActions: 10 })).toBe(0);
  });
  it("returns intermediate score for partial compliance", () => {
    const score = calculatePostureScore({ totalObligations: 10, coveredObligations: 5, totalControls: 10, implementedControls: 5, openIncidents: 2, overdueActions: 1 });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
  });
  it("handles zero totals gracefully", () => {
    expect(calculatePostureScore({ totalObligations: 0, coveredObligations: 0, totalControls: 0, implementedControls: 0, openIncidents: 0, overdueActions: 0 })).toBe(100);
  });
  it("clamps to 0-100 range", () => {
    const score = calculatePostureScore({ totalObligations: 1, coveredObligations: 1, totalControls: 1, implementedControls: 1, openIncidents: 100, overdueActions: 100 });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe("isValidSubmissionTransition", () => {
  it("allows draft → pending", () => expect(isValidSubmissionTransition("draft", "pending")).toBe(true));
  it("allows pending → submitted", () => expect(isValidSubmissionTransition("pending", "submitted")).toBe(true));
  it("allows pending → draft", () => expect(isValidSubmissionTransition("pending", "draft")).toBe(true));
  it("allows submitted → acknowledged", () => expect(isValidSubmissionTransition("submitted", "acknowledged")).toBe(true));
  it("allows submitted → rejected", () => expect(isValidSubmissionTransition("submitted", "rejected")).toBe(true));
  it("allows rejected → draft", () => expect(isValidSubmissionTransition("rejected", "draft")).toBe(true));
  it("rejects draft → submitted", () => expect(isValidSubmissionTransition("draft", "submitted")).toBe(false));
  it("rejects submitted → draft", () => expect(isValidSubmissionTransition("submitted", "draft")).toBe(false));
  it("rejects acknowledged → anything", () => expect(isValidSubmissionTransition("acknowledged", "draft")).toBe(false));
});

describe("constants", () => {
  it("exports submission status flow", () => {
    expect(SUBMISSION_STATUS_FLOW).toHaveProperty("draft");
    expect(SUBMISSION_STATUS_FLOW).toHaveProperty("pending");
    expect(SUBMISSION_STATUS_FLOW).toHaveProperty("submitted");
    expect(SUBMISSION_STATUS_FLOW.acknowledged).toEqual([]);
  });
});
