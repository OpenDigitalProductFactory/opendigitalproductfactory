import { describe, expect, it } from "vitest";
import {
  BACKLOG_STATUSES,
  describeTransition,
  isBacklogStatus,
  isLegalTransition,
  requiresAdminGrant,
} from "./transitions";

describe("isBacklogStatus", () => {
  it("accepts canonical values", () => {
    for (const s of BACKLOG_STATUSES) expect(isBacklogStatus(s)).toBe(true);
  });
  it("rejects synonyms and underscored variants", () => {
    expect(isBacklogStatus("todo")).toBe(false);
    expect(isBacklogStatus("in_progress")).toBe(false);
    expect(isBacklogStatus("complete")).toBe(false);
    expect(isBacklogStatus(null)).toBe(false);
    expect(isBacklogStatus(undefined)).toBe(false);
  });
});

describe("isLegalTransition", () => {
  it("treats same-status as a no-op success", () => {
    for (const s of BACKLOG_STATUSES) expect(isLegalTransition(s, s)).toBe(true);
  });

  it("permits triage exits to open and deferred only", () => {
    expect(isLegalTransition("triaging", "open")).toBe(true);
    expect(isLegalTransition("triaging", "deferred")).toBe(true);
    expect(isLegalTransition("triaging", "in-progress")).toBe(false);
    expect(isLegalTransition("triaging", "done")).toBe(false);
    expect(isLegalTransition("triaging", "retired")).toBe(true);
  });

  it("permits open ↔ in-progress and forward to done/deferred", () => {
    expect(isLegalTransition("open", "in-progress")).toBe(true);
    expect(isLegalTransition("in-progress", "open")).toBe(true);
    expect(isLegalTransition("open", "done")).toBe(true);
    expect(isLegalTransition("in-progress", "done")).toBe(true);
    expect(isLegalTransition("open", "deferred")).toBe(true);
    expect(isLegalTransition("in-progress", "deferred")).toBe(true);
  });

  it("permits deferred reactivation", () => {
    expect(isLegalTransition("deferred", "open")).toBe(true);
    expect(isLegalTransition("deferred", "in-progress")).toBe(true);
    expect(isLegalTransition("deferred", "done")).toBe(false);
  });

  it("keeps retired terminal but explicitly reversible for correction", () => {
    expect(isLegalTransition("open", "retired")).toBe(true);
    expect(isLegalTransition("in-progress", "retired")).toBe(true);
    expect(isLegalTransition("deferred", "retired")).toBe(true);
    expect(isLegalTransition("retired", "open")).toBe(true);
    expect(isLegalTransition("retired", "triaging")).toBe(true);
    expect(isLegalTransition("retired", "in-progress")).toBe(false);
    expect(isLegalTransition("retired", "done")).toBe(false);
  });

  it("permits reopen from done to open or triaging", () => {
    expect(isLegalTransition("done", "done")).toBe(true);
    expect(isLegalTransition("done", "open")).toBe(true);
    expect(isLegalTransition("done", "triaging")).toBe(true);
    expect(isLegalTransition("done", "in-progress")).toBe(false);
  });

  it("permits retriage from open / in-progress / deferred / done", () => {
    expect(isLegalTransition("open", "triaging")).toBe(true);
    expect(isLegalTransition("in-progress", "triaging")).toBe(true);
    expect(isLegalTransition("deferred", "triaging")).toBe(true);
    expect(isLegalTransition("done", "triaging")).toBe(true);
  });
});

describe("requiresAdminGrant", () => {
  it("flags any move out of done", () => {
    expect(requiresAdminGrant("done", "open")).toBe(true);
    expect(requiresAdminGrant("done", "in-progress")).toBe(true);
    expect(requiresAdminGrant("done", "deferred")).toBe(true);
  });
  it("flags any move out of retired", () => {
    expect(requiresAdminGrant("retired", "open")).toBe(true);
    expect(requiresAdminGrant("retired", "triaging")).toBe(true);
  });
  it("does not flag the done → done no-op", () => {
    expect(requiresAdminGrant("done", "done")).toBe(false);
  });
  it("does not flag normal forward moves", () => {
    expect(requiresAdminGrant("open", "done")).toBe(false);
    expect(requiresAdminGrant("triaging", "open")).toBe(false);
  });
});

describe("describeTransition", () => {
  it("renders no-op, legal, illegal", () => {
    expect(describeTransition("open", "open")).toContain("no-op");
    expect(describeTransition("open", "done")).toBe("open → done");
    expect(describeTransition("triaging", "done")).toContain("illegal");
  });
});
