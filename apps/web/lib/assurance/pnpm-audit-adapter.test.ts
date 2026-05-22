import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PNPM_AUDIT_ADAPTER_KEY,
  parsePnpmAuditJson,
  runPnpmAuditAdapter,
} from "./pnpm-audit-adapter";

async function loadFixture(): Promise<string> {
  return readFile(join(__dirname, "__fixtures__/pnpm-audit-sample.json"), "utf8");
}

describe("parsePnpmAuditJson", () => {
  it("returns empty array for empty or invalid input", () => {
    expect(parsePnpmAuditJson("")).toEqual([]);
    expect(parsePnpmAuditJson("not-json")).toEqual([]);
    expect(parsePnpmAuditJson("{}")).toEqual([]);
  });

  it("flattens the advisories map into advisory + occurrence groups", async () => {
    const json = await loadFixture();
    const groups = parsePnpmAuditJson(json);

    expect(groups).toHaveLength(2);
    const critical = groups.find((entry) => entry.advisory.severity === "critical");
    expect(critical).toBeDefined();
    expect(critical?.advisory.module_name).toBe("vulnerable-lib");
    expect(critical?.occurrences).toEqual([
      { moduleName: "vulnerable-lib", version: "1.2.0", path: "apps/web>vulnerable-lib" },
    ]);
  });

  it("emits one synthetic occurrence when no findings are listed", () => {
    const json = JSON.stringify({
      advisories: {
        "ghsa-x": {
          id: 1,
          ghsa_id: "GHSA-x",
          severity: "high",
          title: "Issue",
          module_name: "only-name",
        },
      },
    });

    const [group] = parsePnpmAuditJson(json);
    expect(group.occurrences).toEqual([{ moduleName: "only-name", version: null, path: null }]);
  });
});

describe("runPnpmAuditAdapter", () => {
  it("returns failed status when there is a blocking finding", async () => {
    const json = await loadFixture();
    const result = runPnpmAuditAdapter({
      jsonText: json,
      lookup: {
        "vulnerable-lib@1.2.0": {
          componentId: "component-vulnerable",
          componentKey: "key-vulnerable",
          name: "vulnerable-lib",
          version: "1.2.0",
          packageUrl: "pkg:npm/vulnerable-lib@1.2.0",
        },
      },
    });

    expect(result.status).toBe("failed");
    expect(result.findings).toHaveLength(2);
    expect(result.summary).toEqual({
      adapter: PNPM_AUDIT_ADAPTER_KEY,
      adapterVersion: "1",
      advisoryCount: 2,
      findingCount: 2,
      blockingCount: 1,
    });

    const critical = result.findings.find((finding) => finding.policySeverity === "critical");
    expect(critical).toBeDefined();
    expect(critical?.releaseImpact).toBe("block");
    expect(critical?.affectedType).toBe("bom-component");
    expect(critical?.affectedId).toBe("key-vulnerable");
    expect(critical?.vendorIdentifier).toBe("GHSA-2222-aaaa-bbbb");
    expect(critical?.identifierStability).toBe("strong");
    expect(critical?.evidence).toMatchObject({
      moduleName: "vulnerable-lib",
      observedVersion: "1.2.0",
      matchedComponentKey: "key-vulnerable",
    });
    expect(critical?.remediationHint).toEqual({
      patchedVersions: ">=1.2.4",
      recommendation: "Upgrade vulnerable-lib to 1.2.4 or later.",
    });

    expect(result.componentIdsByAffectedId).toEqual({ "key-vulnerable": "component-vulnerable" });
  });

  it("returns partial status when only warn-level findings remain", async () => {
    const json = JSON.stringify({
      advisories: {
        "ghsa-low": {
          id: 9,
          ghsa_id: "GHSA-low",
          severity: "moderate",
          title: "Moderate issue",
          module_name: "another-pkg",
        },
      },
    });

    const result = runPnpmAuditAdapter({ jsonText: json });

    expect(result.status).toBe("partial");
    expect(result.summary.blockingCount).toBe(0);
    expect(result.findings[0]?.policySeverity).toBe("medium");
    expect(result.findings[0]?.releaseImpact).toBe("warn");
  });

  it("returns passed status when no advisories are present", () => {
    const result = runPnpmAuditAdapter({ jsonText: "{}" });
    expect(result.status).toBe("passed");
    expect(result.findings).toHaveLength(0);
    expect(result.summary.advisoryCount).toBe(0);
  });

  it("falls back to package URL affectedId when lookup misses", () => {
    const json = JSON.stringify({
      advisories: {
        "ghsa-miss": {
          id: 5,
          ghsa_id: "GHSA-miss",
          severity: "high",
          title: "Unmatched module",
          module_name: "ghost-pkg",
          findings: [{ version: "0.1.0" }],
        },
      },
    });

    const result = runPnpmAuditAdapter({ jsonText: json });
    expect(result.findings[0]?.affectedId).toBe("pkg:npm/ghost-pkg@0.1.0");
    expect(result.componentIdsByAffectedId).toEqual({});
  });

  it("deduplicates occurrences that resolve to the same affected component", () => {
    const json = JSON.stringify({
      advisories: {
        "ghsa-dup": {
          id: 7,
          ghsa_id: "GHSA-dup",
          severity: "high",
          title: "Duplicate paths",
          module_name: "dup-pkg",
          findings: [
            { version: "1.0.0", paths: ["apps/web>dup-pkg", "apps/web>foo>dup-pkg"] },
          ],
        },
      },
    });

    const result = runPnpmAuditAdapter({
      jsonText: json,
      lookup: {
        "dup-pkg@1.0.0": {
          componentId: "dup-component",
          componentKey: "dup-key",
          name: "dup-pkg",
          version: "1.0.0",
          packageUrl: "pkg:npm/dup-pkg@1.0.0",
        },
      },
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.affectedId).toBe("dup-key");
    expect(result.componentIdsByAffectedId).toEqual({ "dup-key": "dup-component" });
  });
});
