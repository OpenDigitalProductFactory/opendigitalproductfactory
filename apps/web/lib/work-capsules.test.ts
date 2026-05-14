import { describe, expect, it } from "vitest";

import {
  WORK_CAPSULE_ACTIVITY_KINDS,
  WORK_CAPSULE_EVIDENCE_KINDS,
  WORK_CAPSULE_EXECUTOR_KINDS,
  WORK_CAPSULE_SOURCES,
  WORK_CAPSULE_STATUSES,
  isWorkCapsuleStatus,
  normalizeBranchTaxonomy,
  parseScopeClaims,
} from "./work-capsules";

describe("work capsule enums", () => {
  it("uses hyphenated status values", () => {
    expect(WORK_CAPSULE_STATUSES).toContain("ready-for-review");
    expect(WORK_CAPSULE_STATUSES).toContain("ready-for-promotion");
    expect(WORK_CAPSULE_STATUSES).not.toContain("ready_for_review");
  });

  it("recognizes valid statuses only", () => {
    expect(isWorkCapsuleStatus("working")).toBe(true);
    expect(isWorkCapsuleStatus("in_progress")).toBe(false);
  });

  it("declares source, executor, and activity enums", () => {
    expect(WORK_CAPSULE_SOURCES).toContain("external-adoption");
    expect(WORK_CAPSULE_EXECUTOR_KINDS).toContain("codex-desktop");
    expect(WORK_CAPSULE_ACTIVITY_KINDS).toContain("evidence-recorded");
  });
});

describe("scope claims", () => {
  it("filters invalid scope claims and rejects malformed timestamps", () => {
    const claims = parseScopeClaims([
      {
        kind: "path",
        value: "apps/web/lib/work-capsules.ts",
        intent: "edit",
        recordedAt: "2026-05-14T00:00:00.000Z",
        recordedByPrincipalId: "principal-1",
      },
      { kind: "bad", value: "x", intent: "edit" },
      {
        kind: "path",
        value: "apps/web/x.ts",
        intent: "edit",
        recordedAt: "yesterday",
        recordedByPrincipalId: "principal-1",
      },
      {
        kind: "path",
        value: "",
        intent: "edit",
        recordedAt: "2026-05-14T00:00:00.000Z",
        recordedByPrincipalId: "principal-1",
      },
    ]);

    expect(claims).toHaveLength(1);
    expect(claims[0]?.kind).toBe("path");
  });
});

describe("evidence kinds", () => {
  it("recognizes the allowlist", () => {
    expect(WORK_CAPSULE_EVIDENCE_KINDS).toContain("test");
    expect(WORK_CAPSULE_EVIDENCE_KINDS).toContain("note");
  });
});

describe("branch taxonomy", () => {
  it("extracts known branch prefixes", () => {
    expect(normalizeBranchTaxonomy("feat/work-capsules")).toBe("feat");
    expect(normalizeBranchTaxonomy("doc/work-capsules")).toBe("doc");
    expect(normalizeBranchTaxonomy("random")).toBe(null);
  });
});
