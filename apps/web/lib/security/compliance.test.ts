// EP-SOVEREIGN-SOC P6 — security compliance reporting + evidence unit tests.
import { describe, expect, it } from "vitest";

import {
  SECURITY_COMPLIANCE_FRAMEWORKS,
  buildSecurityComplianceReport,
  securityCaseToEvidenceInput,
  type ComplianceFramework,
  type SecurityPostureMetrics,
} from "./compliance";

const FRAMEWORKS = Object.keys(SECURITY_COMPLIANCE_FRAMEWORKS) as ComplianceFramework[];

const active: SecurityPostureMetrics = {
  detections: 12,
  openCases: 3,
  resolvedCases: 5,
  connectedSources: 4,
  staleSources: 1,
};

describe("SECURITY_COMPLIANCE_FRAMEWORKS", () => {
  it("covers six frameworks, each with a Detect and a Respond control", () => {
    expect(FRAMEWORKS).toHaveLength(6);
    for (const f of FRAMEWORKS) {
      const families = SECURITY_COMPLIANCE_FRAMEWORKS[f].map((c) => c.controlFamily);
      expect(families).toContain("Detect");
      expect(families).toContain("Respond");
    }
  });
});

describe("buildSecurityComplianceReport", () => {
  it("evidences Detect + Respond when monitoring + resolution are active", () => {
    const r = buildSecurityComplianceReport("NIST-CSF", active);
    expect(r.evidencedCount).toBe(2);
    expect(r.controls.every((c) => c.evidenced)).toBe(true);
    expect(r.summary).toMatch(/2\/2/);
  });

  it("does not evidence Detect with no detections, nor Respond with no resolved cases", () => {
    const r = buildSecurityComplianceReport("PCI-DSS", {
      ...active,
      detections: 0,
      resolvedCases: 0,
    });
    expect(r.evidencedCount).toBe(0);
    expect(r.controls.find((c) => c.controlFamily === "Detect")!.evidenced).toBe(false);
    expect(r.controls.find((c) => c.controlFamily === "Respond")!.evidenced).toBe(false);
  });

  it("requires connected sources before Detect is evidenced", () => {
    const r = buildSecurityComplianceReport("SOC2", { ...active, connectedSources: 0 });
    expect(r.controls.find((c) => c.controlFamily === "Detect")!.evidenced).toBe(false);
  });
});

describe("securityCaseToEvidenceInput", () => {
  it("produces idempotent, case-keyed evidence", () => {
    const e = securityCaseToEvidenceInput({
      caseKey: "case:manual:1",
      title: "Lateral movement",
      severity: "high",
      verdict: "malicious",
      status: "resolved",
      openedAt: new Date("2026-06-25T12:00:00.000Z"),
      resolvedAt: new Date("2026-06-25T12:30:00.000Z"),
    });
    expect(e.evidenceId).toBe("security-case:case:manual:1");
    expect(e.evidenceType).toBe("security-operations");
    expect(e.description).toMatch(/detects and responds/);
    expect(e.description).toMatch(/resolved/);
  });
});
