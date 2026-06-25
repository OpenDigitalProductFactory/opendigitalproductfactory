import { describe, expect, it } from "vitest";

import type { OsvVuln, SoftwareEvidenceLike } from "@dpf/db/patch";

import { createOsvPatchIntelProvider } from "./patch-intel-provider";

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
