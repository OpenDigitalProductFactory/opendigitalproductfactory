import { describe, expect, it } from "vitest";
import {
  decideFindingDisposition,
  linkedBacklogItemId,
  MODERATE_AUTO_FILE_PRIORITY,
  type ReconcileContext,
  type ReconcileFindingInput,
} from "./finding-reconcile";

function ctx(overrides: Partial<ReconcileContext> = {}): ReconcileContext {
  return {
    available: true,
    acceptedAdvisoryIds: new Set<string>(),
    resolvedVersionsByPackage: new Map<string, Set<string>>(),
    ...overrides,
  };
}

function finding(overrides: Partial<ReconcileFindingInput> = {}): ReconcileFindingInput {
  return {
    findingKey: "fk-1",
    vendorIdentifier: "GHSA-aaaa-bbbb-cccc",
    policySeverity: "high",
    evidence: { moduleName: "hono", observedVersion: "4.12.25", cves: ["CVE-2026-0001"] },
    ...overrides,
  };
}

describe("decideFindingDisposition", () => {
  it("fails closed (evidence-only) when the reconcile context is unavailable", () => {
    const d = decideFindingDisposition(finding(), ctx({ available: false }));
    expect(d.action).toBe("evidence-only");
    expect(d.reason).toContain("fail-closed");
  });

  it("never re-files an already-linked finding", () => {
    const d = decideFindingDisposition(
      finding({ evidence: { moduleName: "hono", observedVersion: "4.12.25", backlogItemId: "BI-EXISTING" } }),
      ctx({ resolvedVersionsByPackage: new Map([["hono", new Set(["4.12.25"])]]) }),
    );
    expect(d.action).toBe("evidence-only");
    expect(d.reason).toBe("already-linked:BI-EXISTING");
  });

  it("suppresses an advisory accepted in the baseline by vendor identifier", () => {
    const d = decideFindingDisposition(
      finding({ vendorIdentifier: "GHSA-h67p-54hq-rp68" }),
      ctx({ acceptedAdvisoryIds: new Set(["GHSA-h67p-54hq-rp68"]) }),
    );
    expect(d.action).toBe("suppress");
    expect(d.reason).toContain("accepted-in-baseline:GHSA-h67p-54hq-rp68");
  });

  it("suppresses an advisory accepted in the baseline by aliased CVE", () => {
    const d = decideFindingDisposition(
      finding({ vendorIdentifier: "GHSA-zzzz", evidence: { moduleName: "js-yaml", observedVersion: "3.14.2", cves: ["CVE-2026-53550"] } }),
      ctx({ acceptedAdvisoryIds: new Set(["CVE-2026-53550"]) }),
    );
    expect(d.action).toBe("suppress");
    expect(d.reason).toContain("CVE-2026-53550");
  });

  it("suppresses a stale-sandbox finding whose version main does not resolve", () => {
    const d = decideFindingDisposition(
      finding({ policySeverity: "high", evidence: { moduleName: "hono", observedVersion: "4.12.19" } }),
      ctx({ resolvedVersionsByPackage: new Map([["hono", new Set(["4.12.25"])]]) }),
    );
    expect(d.action).toBe("suppress");
    expect(d.reason).toContain("stale-sandbox");
    expect(d.reason).toContain("4.12.19");
  });

  it("files a genuine high finding whose version main actually resolves", () => {
    const d = decideFindingDisposition(
      finding({ policySeverity: "high", evidence: { moduleName: "hono", observedVersion: "4.12.25" } }),
      ctx({ resolvedVersionsByPackage: new Map([["hono", new Set(["4.12.25"])]]) }),
    );
    expect(d.action).toBe("file");
    expect(d.proposedOutcome).toBe("build");
  });

  it("does NOT suppress on staleness when main's versions for the package are unknown", () => {
    const d = decideFindingDisposition(
      finding({ policySeverity: "critical", evidence: { moduleName: "obscure-pkg", observedVersion: "1.0.0" } }),
      ctx(), // empty resolved map → cannot prove stale → must not hide
    );
    expect(d.action).toBe("file");
    expect(d.proposedOutcome).toBe("build");
  });

  it("files moderate findings as deferred, low-priority", () => {
    const d = decideFindingDisposition(
      finding({ policySeverity: "medium", evidence: { moduleName: "pkg", observedVersion: "1.0.0" } }),
      ctx({ resolvedVersionsByPackage: new Map([["pkg", new Set(["1.0.0"])]]) }),
    );
    expect(d.action).toBe("file");
    expect(d.proposedOutcome).toBe("defer");
    expect(d.priority).toBe(MODERATE_AUTO_FILE_PRIORITY);
  });

  it("keeps low/info findings as evidence only", () => {
    for (const severity of ["low", "info"] as const) {
      const d = decideFindingDisposition(
        finding({ policySeverity: severity, evidence: { moduleName: "pkg", observedVersion: "1.0.0" } }),
        ctx({ resolvedVersionsByPackage: new Map([["pkg", new Set(["1.0.0"])]]) }),
      );
      expect(d.action).toBe("evidence-only");
      expect(d.reason).toContain("below-auto-file-threshold");
    }
  });
});

describe("linkedBacklogItemId", () => {
  it("returns the id when present and null otherwise", () => {
    expect(linkedBacklogItemId(finding({ evidence: { backlogItemId: "BI-1" } }))).toBe("BI-1");
    expect(linkedBacklogItemId(finding({ evidence: {} }))).toBeNull();
  });
});
