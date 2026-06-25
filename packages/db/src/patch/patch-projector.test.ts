import { describe, expect, it } from "vitest";

import {
  applyViaForPackageManager,
  assessEvidence,
  evidenceToPatchFinding,
  runPatchAssessment,
  type PatchAssessmentStore,
  type PatchFindingUpsert,
  type PatchIntel,
  type PatchIntelProvider,
  type SoftwareEvidenceLike,
} from "./patch-projector";

const NOW = new Date("2026-06-25T00:00:00.000Z");

class FakeStore implements PatchAssessmentStore {
  findings = new Map<string, PatchFindingUpsert>();
  resolvedCount = 0;

  constructor(
    private readonly evidence: SoftwareEvidenceLike[],
    seed: PatchFindingUpsert[] = [],
  ) {
    for (const f of seed) this.findings.set(f.findingKey, f);
  }

  async listSoftwareEvidence(): Promise<SoftwareEvidenceLike[]> {
    return this.evidence;
  }

  async upsertFinding(finding: PatchFindingUpsert): Promise<void> {
    this.findings.set(finding.findingKey, finding);
  }

  async resolveFindingsExcept(activeKeys: string[]): Promise<number> {
    const active = new Set(activeKeys);
    let resolved = 0;
    for (const key of [...this.findings.keys()]) {
      if (key.startsWith("patch:") && !active.has(key)) {
        this.findings.delete(key);
        resolved += 1;
      }
    }
    this.resolvedCount = resolved;
    return resolved;
  }
}

describe("applyViaForPackageManager", () => {
  it("maps package managers to apply backends", () => {
    expect(applyViaForPackageManager("dpkg")).toBe("apt");
    expect(applyViaForPackageManager("rpm")).toBe("dnf");
    expect(applyViaForPackageManager("brew")).toBe("brew");
    expect(applyViaForPackageManager("powershell")).toBe("winget");
    expect(applyViaForPackageManager("npm")).toBe("vendor-adapter");
    expect(applyViaForPackageManager("something-else")).toBe("unknown");
    expect(applyViaForPackageManager(null)).toBe("unknown");
  });
});

describe("assessEvidence", () => {
  it("derives applyVia from the package manager when intel omits it", () => {
    const ev: SoftwareEvidenceLike = {
      evidenceKey: "e1",
      inventoryEntityId: "host1",
      rawVersion: "1.0.0",
      packageManager: "dpkg",
    };
    const r = assessEvidence(ev, { latestSafeVersion: "1.4.0" }, NOW);
    expect(r.findingKind).toBe("patch-gap");
    expect(r.remediationHint.applyVia).toBe("apt");
  });
});

describe("evidenceToPatchFinding", () => {
  const baseEv: SoftwareEvidenceLike = {
    evidenceKey: "ev-firefox",
    inventoryEntityId: "host-1",
    rawProductName: "Firefox",
    rawPackageName: "firefox",
    rawVersion: "120.0",
    packageManager: "winget",
    customerAccountId: "acct-9",
  };

  it("returns null for a clean (none) verdict", () => {
    const assessment = assessEvidence(baseEv, { latestSafeVersion: "120.0" }, NOW);
    expect(evidenceToPatchFinding(baseEv, assessment)).toBeNull();
  });

  it("maps a KEV vulnerability to a cisa-kev finding keyed on the CVE", () => {
    const intel: PatchIntel = {
      advisories: [{ id: "CVE-2026-9999", severity: "high", cisaKev: true, fixedVersion: "120.1" }],
    };
    const assessment = assessEvidence(baseEv, intel, NOW);
    const finding = evidenceToPatchFinding(baseEv, assessment)!;
    expect(finding.findingKind).toBe("vulnerability");
    expect(finding.adapterKey).toBe("cisa-kev");
    expect(finding.vendorIdentifier).toBe("CVE-2026-9999");
    expect(finding.policySeverity).toBe("high");
    expect(finding.findingKey).toBe("patch:ev-firefox");
    expect(finding.affectedType).toBe("DiscoveredSoftwareEvidence");
    expect(finding.title).toContain("CVE-2026-9999");
    expect(finding.remediationHint.targetVersion).toBe("120.1");
    expect(finding.source.customerAccountId).toBe("acct-9");
  });

  it("maps a plain patch gap to a patch-intel finding with a synthetic identifier", () => {
    const assessment = assessEvidence(baseEv, { latestSafeVersion: "121.0" }, NOW);
    const finding = evidenceToPatchFinding(baseEv, assessment)!;
    expect(finding.findingKind).toBe("patch-gap");
    expect(finding.adapterKey).toBe("patch-intel");
    expect(finding.vendorIdentifier).toBe("winget:firefox");
    expect(finding.remediationHint.targetVersion).toBe("121.0");
  });
});

describe("runPatchAssessment", () => {
  const evidence: SoftwareEvidenceLike[] = [
    { evidenceKey: "vuln", inventoryEntityId: "h1", rawProductName: "openssl", rawVersion: "3.0.0", packageManager: "dpkg" },
    { evidenceKey: "gap", inventoryEntityId: "h1", rawProductName: "curl", rawVersion: "8.0.0", packageManager: "dpkg" },
    { evidenceKey: "clean", inventoryEntityId: "h2", rawProductName: "bash", rawVersion: "5.2.0", packageManager: "dpkg" },
  ];

  const provider: PatchIntelProvider = (ev) => {
    switch (ev.evidenceKey) {
      case "vuln":
        return { advisories: [{ id: "CVE-2026-1", severity: "critical" }] };
      case "gap":
        return { latestSafeVersion: "8.8.0" };
      default:
        return { latestSafeVersion: ev.rawVersion };
    }
  };

  it("assesses all evidence, upserts actionable findings, and skips clean ones", async () => {
    const store = new FakeStore(evidence);
    const summary = await runPatchAssessment(store, provider, { now: NOW });
    expect(summary.assessed).toBe(3);
    expect(summary.actionable).toBe(2);
    expect(summary.byKind).toEqual({ vulnerability: 1, "patch-gap": 1 });
    expect(summary.bySeverity).toEqual({ critical: 1, medium: 1 });
    expect(store.findings.has("patch:vuln")).toBe(true);
    expect(store.findings.has("patch:gap")).toBe(true);
    expect(store.findings.has("patch:clean")).toBe(false);
  });

  it("resolves a previously-open finding that is now clean", async () => {
    const stale: PatchFindingUpsert = {
      findingKey: "patch:was-vulnerable",
      findingKind: "vulnerability",
      title: "old",
      description: "",
      affectedType: "DiscoveredSoftwareEvidence",
      affectedId: "old",
      adapterKey: "osv",
      vendorIdentifier: "CVE-old",
      policySeverity: "high",
      remediationHint: {},
      source: {},
    };
    const store = new FakeStore(evidence, [stale]);
    const summary = await runPatchAssessment(store, provider, { now: NOW });
    expect(summary.resolved).toBe(1);
    expect(store.findings.has("patch:was-vulnerable")).toBe(false);
  });
});
