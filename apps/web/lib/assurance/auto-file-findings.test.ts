import { describe, expect, it, vi } from "vitest";
import { autoFileFindingsFromScan } from "./auto-file-findings";
import type { ReconcileContext } from "./finding-reconcile";
import type { NormalizedAssuranceFinding } from "./types";

function ctx(overrides: Partial<ReconcileContext> = {}): ReconcileContext {
  return {
    available: true,
    acceptedAdvisoryIds: new Set<string>(),
    resolvedVersionsByPackage: new Map<string, Set<string>>(),
    ...overrides,
  };
}

function finding(overrides: Partial<NormalizedAssuranceFinding> = {}): NormalizedAssuranceFinding {
  return {
    adapterKey: "pnpm-audit",
    findingKind: "vulnerability",
    affectedType: "bom-component",
    affectedId: "pkg:npm/hono@4.12.25",
    vendorIdentifier: "GHSA-aaaa",
    findingKey: "fk-1",
    title: "hono: something",
    policySeverity: "high",
    releaseImpact: "block",
    reachability: "unknown",
    exposure: "unknown",
    identifierStability: "strong",
    evidence: { moduleName: "hono", observedVersion: "4.12.25", cves: ["CVE-1"] },
    remediationHint: { patchedVersions: ">=4.12.25" },
    ...overrides,
  };
}

function createDb() {
  return {
    assuranceFinding: { update: vi.fn(async () => ({ id: "x" })) },
  };
}

function fakeIngest() {
  let n = 0;
  return vi.fn(async () => ({ itemId: `BI-NEW-${++n}`, id: `cuid-${n}`, created: true }));
}

describe("autoFileFindingsFromScan", () => {
  it("files a genuine high finding through ingest and links it on the finding", async () => {
    const db = createDb();
    const ingest = fakeIngest();
    const totals = await autoFileFindingsFromScan({
      db: db as never,
      findings: [finding()],
      context: ctx({ resolvedVersionsByPackage: new Map([["hono", new Set(["4.12.25"])]]) }),
      buildId: "FB-1",
      digitalProductId: "prod-1",
      now: new Date("2026-06-22T00:00:00.000Z"),
      ingest,
    });

    expect(totals).toEqual({ filed: 1, suppressed: 0, evidenceOnly: 0 });
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Remediate: hono: something",
        workType: "bug",
        source: "automated-detection",
        proposedOutcome: "build",
        epicId: "EP-ASSURANCE-LEDGER",
        origin: { kind: "assuranceFinding", id: "fk-1" },
      }),
    );
    expect(db.assuranceFinding.update).toHaveBeenCalledWith({
      where: { findingKey: "fk-1" },
      data: expect.objectContaining({
        status: "planned",
        evidence: expect.objectContaining({ backlogItemId: "BI-NEW-1" }),
      }),
    });
  });

  it("suppresses a stale finding as false-positive without filing", async () => {
    const db = createDb();
    const ingest = fakeIngest();
    const totals = await autoFileFindingsFromScan({
      db: db as never,
      findings: [finding({ evidence: { moduleName: "hono", observedVersion: "4.12.19" } })],
      context: ctx({ resolvedVersionsByPackage: new Map([["hono", new Set(["4.12.25"])]]) }),
      buildId: "FB-1",
      now: new Date("2026-06-22T00:00:00.000Z"),
      ingest,
    });

    expect(totals).toEqual({ filed: 0, suppressed: 1, evidenceOnly: 0 });
    expect(ingest).not.toHaveBeenCalled();
    expect(db.assuranceFinding.update).toHaveBeenCalledWith({
      where: { findingKey: "fk-1" },
      data: expect.objectContaining({
        status: "false-positive",
        resolvedAt: new Date("2026-06-22T00:00:00.000Z"),
      }),
    });
  });

  it("suppresses an accepted-baseline finding as accepted (not terminal)", async () => {
    const db = createDb();
    const ingest = fakeIngest();
    const totals = await autoFileFindingsFromScan({
      db: db as never,
      findings: [finding({ vendorIdentifier: "GHSA-acc", evidence: { moduleName: "js-yaml", observedVersion: "3.14.2" } })],
      context: ctx({ acceptedAdvisoryIds: new Set(["GHSA-acc"]) }),
      buildId: "FB-1",
      now: new Date("2026-06-22T00:00:00.000Z"),
      ingest,
    });

    expect(totals).toEqual({ filed: 0, suppressed: 1, evidenceOnly: 0 });
    expect(ingest).not.toHaveBeenCalled();
    const call = db.assuranceFinding.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data.status).toBe("accepted");
    expect(call.data.resolvedAt).toBeUndefined();
  });

  it("keeps a low finding as evidence-only and never files", async () => {
    const db = createDb();
    const ingest = fakeIngest();
    const totals = await autoFileFindingsFromScan({
      db: db as never,
      findings: [finding({ policySeverity: "low", evidence: { moduleName: "pkg", observedVersion: "1.0.0" } })],
      context: ctx({ resolvedVersionsByPackage: new Map([["pkg", new Set(["1.0.0"])]]) }),
      buildId: "FB-1",
      now: new Date("2026-06-22T00:00:00.000Z"),
      ingest,
    });

    expect(totals).toEqual({ filed: 0, suppressed: 0, evidenceOnly: 1 });
    expect(ingest).not.toHaveBeenCalled();
    const call = db.assuranceFinding.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data.status).toBeUndefined();
    expect(call.data.evidence).toMatchObject({ autoFile: { action: "evidence-only" } });
  });

  it("fails closed: no filing when the reconcile context is unavailable", async () => {
    const db = createDb();
    const ingest = fakeIngest();
    const totals = await autoFileFindingsFromScan({
      db: db as never,
      findings: [finding(), finding({ findingKey: "fk-2", policySeverity: "critical" })],
      context: ctx({ available: false }),
      buildId: "FB-1",
      now: new Date("2026-06-22T00:00:00.000Z"),
      ingest,
    });

    expect(totals).toEqual({ filed: 0, suppressed: 0, evidenceOnly: 2 });
    expect(ingest).not.toHaveBeenCalled();
  });
});
