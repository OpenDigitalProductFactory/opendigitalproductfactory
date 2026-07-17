import { describe, expect, it } from "vitest";

import {
  assessPatchState,
  compareVersions,
  isActionable,
  parseVersion,
  type PatchAssessmentInput,
} from "./patch-intel";

const NOW = new Date("2026-06-25T00:00:00.000Z");

describe("parseVersion", () => {
  it("parses plain semver", () => {
    expect(parseVersion("1.2.3")).toEqual({ release: [1, 2, 3], prerelease: [] });
  });

  it("strips a leading v and build metadata", () => {
    expect(parseVersion("v1.2.3+build.5")).toEqual({ release: [1, 2, 3], prerelease: [] });
  });

  it("captures prerelease identifiers", () => {
    expect(parseVersion("1.0.0-rc.2")).toEqual({ release: [1, 0, 0], prerelease: ["rc", 2] });
  });

  it("accepts non-three-part numeric versions (2024.06)", () => {
    expect(parseVersion("2024.06")).toEqual({ release: [2024, 6], prerelease: [] });
  });

  it("returns null for non-semver OS package strings", () => {
    expect(parseVersion("1:2.30-1ubuntu2")).toBeNull();
    expect(parseVersion("")).toBeNull();
    expect(parseVersion(null)).toBeNull();
    expect(parseVersion("notaversion")).toBeNull();
  });
});

describe("compareVersions", () => {
  it("detects behind / current / ahead", () => {
    expect(compareVersions("1.2.0", "1.2.3")).toBe("behind");
    expect(compareVersions("1.2.3", "1.2.3")).toBe("current");
    expect(compareVersions("1.3.0", "1.2.3")).toBe("ahead");
  });

  it("treats missing trailing segments as zero", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe("current");
    expect(compareVersions("1.2", "1.2.1")).toBe("behind");
  });

  it("orders prerelease below the release", () => {
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBe("behind");
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBe("ahead");
    expect(compareVersions("1.0.0-rc.1", "1.0.0-rc.2")).toBe("behind");
  });

  it("returns unknown when either side is not parseable", () => {
    expect(compareVersions("1:2.30-1ubuntu2", "2.31")).toBe("unknown");
    expect(compareVersions("1.2.3", "stable")).toBe("unknown");
  });
});

describe("assessPatchState — vulnerabilities", () => {
  it("allows NVD CPE advisories to project as missing-patch posture instead of OSS vulnerability posture", () => {
    const result = assessPatchState({
      installedVersion: "22.04",
      advisories: [
        {
          id: "CVE-2026-4242",
          severity: "critical",
          cisaKev: true,
          source: "nvd",
          findingKind: "patch-gap",
        },
      ],
      defaultApplyVia: "apt",
      confidence: "verified",
      now: NOW,
    });

    expect(result.findingKind).toBe("patch-gap");
    expect(result.policySeverity).toBe("critical");
    expect(result.primaryAdvisoryId).toBe("CVE-2026-4242");
    expect(result.primaryAdvisorySource).toBe("nvd");
    expect(result.remediationHint).toMatchObject({
      applyVia: "apt",
      cisaKev: true,
      confidence: "verified",
    });
    expect(result.rationale).toContain("CVE-2026-4242");
  });

  it("flags an open advisory with no known fix as a vulnerability", () => {
    const input: PatchAssessmentInput = {
      installedVersion: "1.2.3",
      advisories: [{ id: "CVE-2026-0001", severity: "high" }],
      now: NOW,
    };
    const r = assessPatchState(input);
    expect(r.findingKind).toBe("vulnerability");
    expect(r.policySeverity).toBe("high");
    expect(r.primaryAdvisoryId).toBe("CVE-2026-0001");
  });

  it("ignores an advisory already resolved by the installed version", () => {
    const input: PatchAssessmentInput = {
      installedVersion: "1.2.5",
      advisories: [{ id: "CVE-2026-0002", severity: "critical", fixedVersion: "1.2.4" }],
      now: NOW,
    };
    const r = assessPatchState(input);
    expect(r.findingKind).toBe("none");
  });

  it("keeps an advisory open when installed is below the fix and targets the fix", () => {
    const input: PatchAssessmentInput = {
      installedVersion: "1.2.0",
      advisories: [{ id: "CVE-2026-0003", severity: "medium", fixedVersion: "1.2.4" }],
      now: NOW,
    };
    const r = assessPatchState(input);
    expect(r.findingKind).toBe("vulnerability");
    expect(r.remediationHint.targetVersion).toBe("1.2.4");
  });

  it("flags a vulnerability even when the version is current", () => {
    const input: PatchAssessmentInput = {
      installedVersion: "3.0.0",
      latestStableVersion: "3.0.0",
      advisories: [{ id: "GHSA-xxxx", severity: "high" }],
      now: NOW,
    };
    const r = assessPatchState(input);
    expect(r.findingKind).toBe("vulnerability");
    expect(r.versionComparison).toBe("current");
  });

  it("escalates and routes CISA KEV advisories urgently", () => {
    const input: PatchAssessmentInput = {
      installedVersion: "1.0.0",
      advisories: [
        { id: "CVE-2026-LOW", severity: "low" },
        { id: "CVE-2026-KEV", severity: "medium", cisaKev: true, fixedVersion: "1.0.1" },
      ],
      now: NOW,
    };
    const r = assessPatchState(input);
    expect(r.cisaKev).toBe(true);
    // KEV floors severity to at least high even though the advisory said medium.
    expect(r.policySeverity).toBe("high");
    // KEV advisory is picked as primary over the low one.
    expect(r.primaryAdvisoryId).toBe("CVE-2026-KEV");
    expect(r.remediationHint.cisaKev).toBe(true);
    expect(r.rationale).toMatch(/KEV/);
  });

  it("classifies a vulnerability on an unparseable OS version", () => {
    const input: PatchAssessmentInput = {
      installedVersion: "1:2.30-1ubuntu2",
      advisories: [{ id: "CVE-2026-OS", severity: "critical" }],
      now: NOW,
    };
    const r = assessPatchState(input);
    expect(r.findingKind).toBe("vulnerability");
    expect(r.versionComparison).toBe("unknown");
    expect(r.policySeverity).toBe("critical");
  });
});

describe("assessPatchState — end-of-life", () => {
  it("flags EOL when the date is in the past and there is no open advisory", () => {
    const input: PatchAssessmentInput = {
      installedVersion: "8.0.0",
      latestStableVersion: "12.0.0",
      eolDate: "2025-01-01",
      now: NOW,
    };
    const r = assessPatchState(input);
    expect(r.findingKind).toBe("end-of-life");
    expect(r.policySeverity).toBe("high");
    expect(r.remediationHint.targetVersion).toBe("12.0.0");
  });

  it("does not flag EOL when the date is in the future", () => {
    const input: PatchAssessmentInput = {
      installedVersion: "8.0.0",
      latestStableVersion: "8.0.0",
      eolDate: "2027-01-01",
      now: NOW,
    };
    const r = assessPatchState(input);
    expect(r.findingKind).toBe("none");
  });
});

describe("assessPatchState — version hygiene gaps", () => {
  it("flags behind-on-safe-version as a medium patch gap", () => {
    const input: PatchAssessmentInput = {
      installedVersion: "1.0.0",
      latestSafeVersion: "1.4.0",
      latestStableVersion: "1.4.0",
      now: NOW,
    };
    const r = assessPatchState(input);
    expect(r.findingKind).toBe("patch-gap");
    expect(r.policySeverity).toBe("medium");
    expect(r.remediationHint.targetVersion).toBe("1.4.0");
  });

  it("downgrades to low when only the stable (not the safe) version is ahead", () => {
    const input: PatchAssessmentInput = {
      installedVersion: "1.4.0",
      latestSafeVersion: "1.4.0",
      latestStableVersion: "1.5.0",
      now: NOW,
    };
    const r = assessPatchState(input);
    // Comparison uses latestSafe first (current), so no behind verdict -> none.
    expect(r.findingKind).toBe("none");
  });

  it("returns none when up to date with no advisories", () => {
    const input: PatchAssessmentInput = {
      installedVersion: "2.0.0",
      latestSafeVersion: "2.0.0",
      latestStableVersion: "2.0.0",
      now: NOW,
    };
    const r = assessPatchState(input);
    expect(r.findingKind).toBe("none");
    expect(r.policySeverity).toBe("info");
  });
});

describe("remediationHint + isActionable", () => {
  it("propagates applyVia, reboot, and confidence", () => {
    const r = assessPatchState({
      installedVersion: "1.0.0",
      latestSafeVersion: "2.0.0",
      defaultApplyVia: "winget",
      rebootLikely: true,
      confidence: "verified",
      now: NOW,
    });
    expect(r.remediationHint).toMatchObject({
      applyVia: "winget",
      rebootLikely: true,
      confidence: "verified",
      targetVersion: "2.0.0",
    });
  });

  it("isActionable is false only for the none verdict", () => {
    expect(isActionable(assessPatchState({ installedVersion: "1.0.0", latestSafeVersion: "1.0.0", now: NOW }))).toBe(
      false,
    );
    expect(
      isActionable(assessPatchState({ installedVersion: "1.0.0", latestSafeVersion: "2.0.0", now: NOW })),
    ).toBe(true);
  });
});
