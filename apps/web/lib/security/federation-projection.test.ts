// EP-SOVEREIGN-SOC P5 — federation projection (sovereignty boundary) unit tests.
import { describe, expect, it } from "vitest";

import { assertNoExcludedEgress } from "@dpf/db/projection-serialization";

import {
  SECURITY_PROJECTION_CONTRACT,
  buildSecurityCaseCloudEvent,
  projectSecurityCase,
  type SecurityCaseFullView,
} from "./federation-projection";

const fullCase: SecurityCaseFullView = {
  caseKey: "case:manual:1",
  title: "Lateral movement",
  severity: "high",
  status: "resolved",
  verdict: "malicious",
  confidence: "high",
  openedAt: "2026-06-25T12:00:00.000Z",
  resolvedAt: "2026-06-25T12:30:00.000Z",
  // These must NEVER cross the link:
  timeline: [{ kind: "note", note: "creds found", rawLog: "secret raw bytes" }],
  evidence: { hostMemoryDump: "...", password: "hunter2" },
};

describe("projectSecurityCase — the sovereignty boundary", () => {
  it("crosses only the case summary; timeline + evidence stay local", () => {
    const r = projectSecurityCase(fullCase);
    expect(Object.keys(r.projected)).toEqual(["case"]);
    expect(r.projected.case).toMatchObject({ caseKey: "case:manual:1", verdict: "malicious" });
    expect(r.excluded.slices).toContain("timeline");
    expect(r.excluded.slices).toContain("evidence");
  });

  it("passes the negative-egress proof — nothing forbidden or excluded leaks", () => {
    const r = projectSecurityCase(fullCase);
    expect(assertNoExcludedEgress(SECURITY_PROJECTION_CONTRACT, r.projected)).toEqual([]);
  });

  it("crosses only the allow-listed case fields", () => {
    const r = projectSecurityCase(fullCase);
    expect(Object.keys(r.projected.case as object).sort()).toEqual(
      ["caseKey", "confidence", "openedAt", "resolvedAt", "severity", "status", "title", "verdict"].sort(),
    );
  });
});

describe("buildSecurityCaseCloudEvent", () => {
  it("wraps the minimized projection with the link id and no violations", () => {
    const { event, violations } = buildSecurityCaseCloudEvent("link_1", fullCase);
    expect(violations).toEqual([]);
    expect(event.dpflinkid).toBe("link_1");
    expect(event.type).toBe("dpf.security.case.projected");
    expect(Object.keys(event.data as object)).toEqual(["case"]);
  });
});
