import { describe, expect, it } from "vitest";

import type { OsvVuln, SoftwareEvidenceLike } from "@dpf/db/patch";

import {
  createNvdCpePatchIntelProvider,
  createOsvPatchIntelProvider,
  mergePatchIntel,
  milestoneEolDate,
} from "./patch-intel-provider";

const VULN: OsvVuln = {
  id: "GHSA-aaaa",
  aliases: ["CVE-2026-1"],
  database_specific: { severity: "HIGH" },
  affected: [
    { package: { ecosystem: "npm", name: "left-pad" }, ranges: [{ events: [{ introduced: "0" }, { fixed: "1.3.0" }] }] },
  ],
};

function ev(overrides: Partial<SoftwareEvidenceLike> = {}): SoftwareEvidenceLike {
  return {
    evidenceKey: "e1",
    inventoryEntityId: "host-1",
    packageManager: "npm",
    rawPackageName: "left-pad",
    rawVersion: "1.0.0",
    ...overrides,
  };
}

describe("createOsvPatchIntelProvider", () => {
  it("returns OSV advisories (with KEV flag) for a language-ecosystem package", async () => {
    const provider = createOsvPatchIntelProvider({
      fetchVulns: async () => [VULN],
      kevCves: new Set(["CVE-2026-1"]),
    });
    const intel = await provider(ev());
    expect(intel?.advisories?.[0]).toMatchObject({
      id: "CVE-2026-1",
      severity: "high",
      fixedVersion: "1.3.0",
      cisaKev: true,
    });
  });

  it("does not even call OSV for OS package managers it can't query reliably", async () => {
    let called = false;
    const provider = createOsvPatchIntelProvider({
      fetchVulns: async () => {
        called = true;
        return [];
      },
      kevCves: new Set(),
    });
    expect(await provider(ev({ packageManager: "dpkg" }))).toBeNull();
    expect(called).toBe(false);
  });

  it("returns null when name or version is missing", async () => {
    const provider = createOsvPatchIntelProvider({ fetchVulns: async () => [VULN], kevCves: new Set() });
    expect(await provider(ev({ rawPackageName: null, rawProductName: null }))).toBeNull();
    expect(await provider(ev({ rawVersion: null }))).toBeNull();
  });

  it("returns null when OSV finds nothing", async () => {
    const provider = createOsvPatchIntelProvider({ fetchVulns: async () => [], kevCves: new Set() });
    expect(await provider(ev())).toBeNull();
  });

  it("returns null (no fabrication) when OSV errors", async () => {
    const provider = createOsvPatchIntelProvider({
      fetchVulns: async () => {
        throw new Error("network");
      },
      kevCves: new Set(),
    });
    expect(await provider(ev())).toBeNull();
  });
});

describe("createNvdCpePatchIntelProvider", () => {
  it("queries NVD by the resolved CatalogIdentity CPE and keeps the result as patch-gap intel", async () => {
    const provider = createNvdCpePatchIntelProvider({
      fetchAdvisories: async (cpe) => {
        expect(cpe).toBe("cpe:2.3:o:canonical:ubuntu_linux:22.04:*:*:*:*:*:*:*");
        return [{ id: "CVE-2026-4242", severity: "high", source: "nvd", findingKind: "patch-gap" }];
      },
    });

    const intel = await provider(
      ev({
        packageManager: "dpkg",
        rawPackageName: "ubuntu",
        catalogIdentityCpe: "cpe:2.3:o:canonical:ubuntu_linux:22.04:*:*:*:*:*:*:*",
        catalogIdentityPart: "o",
      }),
    );

    expect(intel?.advisories).toEqual([
      { id: "CVE-2026-4242", severity: "high", source: "nvd", findingKind: "patch-gap" },
    ]);
    expect(intel?.confidence).toBe("verified");
  });

  it("projects CatalogLifecycleMilestone EOL rows even when NVD has no CVEs", async () => {
    const provider = createNvdCpePatchIntelProvider({
      fetchAdvisories: async () => [],
    });

    const intel = await provider(
      ev({
        packageManager: "dpkg",
        rawPackageName: "ubuntu",
        catalogIdentityCpe: "cpe:2.3:o:canonical:ubuntu_linux:20.04:*:*:*:*:*:*:*",
        catalogLifecycleMilestones: [
          { milestone: "release", date: "2020-04-23T00:00:00.000Z" },
          { milestone: "eol", date: "2025-05-31T00:00:00.000Z" },
        ],
      }),
    );

    expect(intel?.eolDate).toBe("2025-05-31T00:00:00.000Z");
    expect(intel?.advisories).toEqual([]);
  });

  it("does not query NVD without a CPE", async () => {
    let called = false;
    const provider = createNvdCpePatchIntelProvider({
      fetchAdvisories: async () => {
        called = true;
        return [];
      },
    });

    expect(await provider(ev({ catalogIdentityCpe: null }))).toBeNull();
    expect(called).toBe(false);
  });
});

describe("catalog lifecycle helpers", () => {
  it("uses unsupported-component milestones as the EOL date and ignores release-only rows", () => {
    expect(
      milestoneEolDate([
        { milestone: "release", date: "2022-04-01T00:00:00.000Z" },
        { milestone: "security_updates_end", date: "2026-04-01T00:00:00.000Z" },
      ]),
    ).toBe("2026-04-01T00:00:00.000Z");
    expect(milestoneEolDate([{ milestone: "release", date: "2022-04-01T00:00:00.000Z" }])).toBeNull();
  });

  it("merges OSV and NVD intel without dropping either advisory source", () => {
    expect(
      mergePatchIntel(
        { advisories: [{ id: "GHSA-aaaa", severity: "medium", source: "osv" }] },
        {
          advisories: [{ id: "CVE-2026-4242", severity: "high", source: "nvd", findingKind: "patch-gap" }],
          eolDate: "2025-01-01",
        },
      ),
    ).toMatchObject({
      eolDate: "2025-01-01",
      advisories: [
        { id: "GHSA-aaaa", source: "osv" },
        { id: "CVE-2026-4242", source: "nvd", findingKind: "patch-gap" },
      ],
    });
  });
});
