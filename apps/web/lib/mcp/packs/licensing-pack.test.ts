import { beforeEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({
  saveLicensingInvestigationFinding: vi.fn(),
  createLicenseReadinessIssue: vi.fn(),
}));
vi.mock("@/lib/actions/licensing-compliance", () => service);

import { licensingPack } from "./licensing-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "save_licensing_investigation",
  "create_licensing_readiness_issue",
];

const EXPECTED_GRANTS: Record<string, string[]> = {
  save_licensing_investigation: ["policy_write"],
  create_licensing_readiness_issue: ["policy_write"],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("licensing pack — registration", () => {
  it("exposes exactly the two licensing tools", () => {
    expect(licensingPack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(licensingPack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("descriptions are provenance-free (no BI/Phase/path leakage)", () => {
    for (const d of licensingPack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("preserves requiredCapability, executionMode, and sideEffect metadata verbatim", () => {
    const byName = Object.fromEntries(licensingPack.definitions.map((d) => [d.name, d]));
    for (const t of EXPECTED_TOOLS) {
      expect(byName[t].requiredCapability, t).toBe("manage_compliance");
      expect(byName[t].executionMode, t).toBe("immediate");
      expect(byName[t].sideEffect, t).toBe(true);
    }
  });

  it("grants mirror agent-grants for every tool", () => {
    for (const t of EXPECTED_TOOLS) {
      expect(licensingPack.grants[t]).toEqual(EXPECTED_GRANTS[t]);
      expect(isToolAllowedByGrants(t, EXPECTED_GRANTS[t])).toBe(true);
    }
  });
});

describe("licensing pack — handler behavior (delegation preserved)", () => {
  it("save_licensing_investigation coerces optional string/boolean params and reports the record id", async () => {
    service.saveLicensingInvestigationFinding.mockResolvedValue({ ok: true, id: "lic-profile-1", message: "Saved licensing investigation." });
    const res = await licensingPack.handlers.save_licensing_investigation(
      {
        setupStatus: "investigating",
        investigationMode: "new_business",
        homeCountryCode: "US",
        notes: "official source pending",
        appendNotes: true,
        legalActivityConfidence: 42, // non-string is dropped
      },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("lic-profile-1");
    expect(res.message).toBe("Saved licensing investigation.");
    expect(res.error).toBeUndefined();
    expect(service.saveLicensingInvestigationFinding).toHaveBeenCalledWith({
      setupStatus: "investigating",
      investigationMode: "new_business",
      homeCountryCode: "US",
      primaryRegionCode: undefined,
      operatingFootprintSummary: undefined,
      legalActivityConfidence: undefined,
      researchCoverageStatus: undefined,
      notes: "official source pending",
      appendNotes: true,
    });
  });

  it("save_licensing_investigation surfaces a service failure as an error", async () => {
    service.saveLicensingInvestigationFinding.mockResolvedValue({ ok: false, message: "Not authorized to manage compliance." });
    const res = await licensingPack.handlers.save_licensing_investigation({}, "u1");
    expect(res.success).toBe(false);
    expect(res.message).toBe("Not authorized to manage compliance.");
    expect(res.error).toBe("Not authorized to manage compliance.");
  });

  it("create_licensing_readiness_issue forwards required + optional fields and reports the issue id", async () => {
    service.createLicenseReadinessIssue.mockResolvedValue({ ok: true, id: "lic-issue-9", message: "Filed licensing readiness issue." });
    const res = await licensingPack.handlers.create_licensing_readiness_issue(
      {
        issueType: "missing_person_credential",
        severity: "high",
        title: "Instructor certification missing",
        details: "State requires a certified lead.",
        organizationLicenseRecordId: "org-lic-1",
      },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("lic-issue-9");
    expect(res.message).toBe("Filed licensing readiness issue.");
    expect(service.createLicenseReadinessIssue).toHaveBeenCalledWith({
      issueType: "missing_person_credential",
      severity: "high",
      title: "Instructor certification missing",
      details: "State requires a certified lead.",
      organizationLicenseRecordId: "org-lic-1",
      personLicenseRecordId: undefined,
    });
  });

  it("create_licensing_readiness_issue defaults missing required strings to empty and surfaces failure", async () => {
    service.createLicenseReadinessIssue.mockResolvedValue({ ok: false, message: "issueType is required." });
    const res = await licensingPack.handlers.create_licensing_readiness_issue({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("issueType is required.");
    expect(service.createLicenseReadinessIssue).toHaveBeenCalledWith({
      issueType: "",
      severity: undefined,
      title: "",
      details: undefined,
      organizationLicenseRecordId: undefined,
      personLicenseRecordId: undefined,
    });
  });
});
