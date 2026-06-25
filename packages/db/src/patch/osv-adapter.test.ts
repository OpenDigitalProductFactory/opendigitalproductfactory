import { describe, expect, it } from "vitest";

import { assessPatchState } from "./patch-intel";
import {
  mapOsvSeverity,
  osvAliases,
  osvFixedVersion,
  osvVulnsToAdvisories,
  osvVulnToAdvisory,
  parseKevCatalog,
  type OsvVuln,
} from "./osv-adapter";

const VULN: OsvVuln = {
  id: "GHSA-aaaa-bbbb-cccc",
  aliases: ["CVE-2026-1234"],
  summary: "Prototype pollution in left-pad",
  database_specific: { severity: "HIGH" },
  affected: [
    {
      package: { ecosystem: "npm", name: "left-pad" },
      ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "1.3.0" }] }],
    },
  ],
};

describe("mapOsvSeverity", () => {
  it("maps GHSA bands, translating moderate -> medium", () => {
    expect(mapOsvSeverity({ id: "x", database_specific: { severity: "CRITICAL" } })).toBe("critical");
    expect(mapOsvSeverity({ id: "x", database_specific: { severity: "High" } })).toBe("high");
    expect(mapOsvSeverity({ id: "x", database_specific: { severity: "MODERATE" } })).toBe("medium");
    expect(mapOsvSeverity({ id: "x", database_specific: { severity: "low" } })).toBe("low");
  });

  it("returns null when only a CVSS vector is present", () => {
    expect(mapOsvSeverity({ id: "x", severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N" }] })).toBeNull();
    expect(mapOsvSeverity({ id: "x" })).toBeNull();
  });
});

describe("osvAliases", () => {
  it("extracts CVE and GHSA ids including the vuln id", () => {
    expect(osvAliases(VULN)).toEqual({ cve: ["CVE-2026-1234"], ghsa: ["GHSA-aaaa-bbbb-cccc"] });
  });
});

describe("osvFixedVersion", () => {
  it("returns the fixed version for the matching package", () => {
    expect(osvFixedVersion(VULN, "npm", "left-pad")).toBe("1.3.0");
  });

  it("filters by ecosystem and name", () => {
    expect(osvFixedVersion(VULN, "Debian", "left-pad")).toBeNull();
    expect(osvFixedVersion(VULN, "npm", "right-pad")).toBeNull();
  });

  it("returns the lowest of multiple fixed events", () => {
    const multi: OsvVuln = {
      id: "OSV-1",
      affected: [
        {
          package: { ecosystem: "npm", name: "pkg" },
          ranges: [
            { events: [{ introduced: "0" }, { fixed: "2.0.5" }] },
            { events: [{ introduced: "1.0.0" }, { fixed: "1.4.9" }] },
          ],
        },
      ],
    };
    expect(osvFixedVersion(multi, "npm", "pkg")).toBe("1.4.9");
  });

  it("returns null when no fix is published", () => {
    expect(osvFixedVersion({ id: "x", affected: [{ ranges: [{ events: [{ introduced: "0" }] }] }] })).toBeNull();
  });
});

describe("osvVulnToAdvisory", () => {
  it("prefers the CVE id and maps severity + fixed version", () => {
    const adv = osvVulnToAdvisory(VULN, { ecosystem: "npm", packageName: "left-pad" });
    expect(adv).toEqual({
      id: "CVE-2026-1234",
      severity: "high",
      fixedVersion: "1.3.0",
      cisaKev: false,
    });
  });

  it("marks cisaKev when a CVE alias is in the KEV set", () => {
    const kev = new Set(["CVE-2026-1234"]);
    const adv = osvVulnToAdvisory(VULN, { ecosystem: "npm", packageName: "left-pad", kevCves: kev });
    expect(adv.cisaKev).toBe(true);
  });

  it("falls back to GHSA then OSV id when no CVE alias exists", () => {
    expect(osvVulnToAdvisory({ id: "GHSA-zzzz" }).id).toBe("GHSA-zzzz");
    expect(osvVulnToAdvisory({ id: "OSV-2026-9" }).id).toBe("OSV-2026-9");
  });
});

describe("parseKevCatalog", () => {
  it("builds a CVE id set from the catalog", () => {
    const set = parseKevCatalog({
      vulnerabilities: [{ cveID: "CVE-2026-1234" }, { cveID: "CVE-2025-0001" }, {}],
    });
    expect(set.has("CVE-2026-1234")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("tolerates a missing or empty catalog", () => {
    expect(parseKevCatalog(null).size).toBe(0);
    expect(parseKevCatalog({}).size).toBe(0);
  });
});

describe("compose: OSV advisories -> classifier", () => {
  it("an OSV vuln in the KEV catalog drives an urgent vulnerability verdict", () => {
    const kev = parseKevCatalog({ vulnerabilities: [{ cveID: "CVE-2026-1234" }] });
    const advisories = osvVulnsToAdvisories([VULN], { ecosystem: "npm", packageName: "left-pad", kevCves: kev });
    const verdict = assessPatchState({
      installedVersion: "1.2.0",
      advisories,
      defaultApplyVia: "winget",
      now: new Date("2026-06-25T00:00:00.000Z"),
    });
    expect(verdict.findingKind).toBe("vulnerability");
    expect(verdict.cisaKev).toBe(true);
    expect(verdict.policySeverity).toBe("high");
    expect(verdict.primaryAdvisoryId).toBe("CVE-2026-1234");
    expect(verdict.remediationHint.targetVersion).toBe("1.3.0");
  });
});
