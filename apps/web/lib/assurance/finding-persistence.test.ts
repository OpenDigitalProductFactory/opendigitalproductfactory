import { describe, expect, it, vi } from "vitest";
import type { NormalizedAssuranceFinding } from "./types";
import { persistAssuranceFindings } from "./finding-persistence";

function normalizedFinding(overrides: Partial<NormalizedAssuranceFinding> = {}): NormalizedAssuranceFinding {
  return {
    adapterKey: "fixture-vuln",
    findingKind: "vulnerability",
    affectedType: "bom-component",
    affectedId: "pkg:npm/next@16.2.6",
    vendorIdentifier: "CVE-2026-0001",
    findingKey: "finding-key-1",
    title: "next has a vulnerable transitive dependency",
    description: "Fixture vulnerability",
    sourceSeverity: "HIGH",
    policySeverity: "high",
    releaseImpact: "block",
    reachability: "unknown",
    exposure: "internal",
    identifierStability: "strong",
    evidence: { packageUrl: "pkg:npm/next@16.2.6" },
    remediationHint: { upgradeTo: "16.2.7" },
    ...overrides,
  };
}

describe("persistAssuranceFindings", () => {
  it("creates new normalized findings with run, BOM, component, build, and product scope", async () => {
    const db = {
      assuranceFinding: {
        findMany: vi.fn(async () => []),
        create: vi.fn(async () => ({ id: "af_1" })),
        update: vi.fn(),
      },
    };
    const observedAt = new Date("2026-05-22T04:30:00.000Z");

    const result = await persistAssuranceFindings(db, {
      assuranceRunId: "run_1",
      bomDocumentId: "bom_1",
      buildId: "BUILD-1",
      digitalProductId: "prod-1",
      componentIdsByAffectedId: { "pkg:npm/next@16.2.6": "component_1" },
      findings: [normalizedFinding()],
      observedAt,
    });

    expect(result).toEqual({ created: 1, updated: 0, reopened: 0, resolved: 0, resolvedBacklogItemIds: [] });
    expect(db.assuranceFinding.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        findingKey: "finding-key-1",
        assuranceRunId: "run_1",
        bomDocumentId: "bom_1",
        bomComponentId: "component_1",
        buildId: "BUILD-1",
        digitalProductId: "prod-1",
        status: "open",
        firstSeenAt: observedAt,
        lastSeenAt: observedAt,
        policySeverity: "high",
        releaseImpact: "block",
      }),
    });
  });

  it("updates recurring findings without overwriting accepted or planned lifecycle state", async () => {
    const db = {
      assuranceFinding: {
        findMany: vi.fn(async () => [{ findingKey: "finding-key-1", status: "accepted", reopenCount: 0 }]),
        create: vi.fn(),
        update: vi.fn(async () => ({ id: "af_1" })),
      },
    };
    const observedAt = new Date("2026-05-22T04:45:00.000Z");

    const result = await persistAssuranceFindings(db, {
      assuranceRunId: "run_2",
      findings: [normalizedFinding({ title: "Updated title" })],
      observedAt,
    });

    expect(result).toEqual({ created: 0, updated: 1, reopened: 0, resolved: 0, resolvedBacklogItemIds: [] });
    expect(db.assuranceFinding.update).toHaveBeenCalledWith({
      where: { findingKey: "finding-key-1" },
      data: expect.not.objectContaining({ status: expect.any(String) }),
    });
  });

  it("reopens resolved findings when the same scanner identity appears again", async () => {
    const db = {
      assuranceFinding: {
        findMany: vi.fn(async () => [{ findingKey: "finding-key-1", status: "resolved", reopenCount: 2 }]),
        create: vi.fn(),
        update: vi.fn(async () => ({ id: "af_1" })),
      },
    };

    const result = await persistAssuranceFindings(db, {
      assuranceRunId: "run_3",
      findings: [normalizedFinding()],
      observedAt: new Date("2026-05-22T05:00:00.000Z"),
    });

    expect(result).toEqual({ created: 0, updated: 1, reopened: 1, resolved: 0, resolvedBacklogItemIds: [] });
    expect(db.assuranceFinding.update).toHaveBeenCalledWith({
      where: { findingKey: "finding-key-1" },
      data: expect.objectContaining({
        status: "open",
        resolvedAt: null,
        reopenCount: { increment: 1 },
      }),
    });
  });

  it("auto-resolves findings absent from the latest scan and returns their linked BIs (P3)", async () => {
    const update = vi.fn();
    const db = {
      assuranceFinding: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([]) // main upsert query (present finding is new)
          .mockResolvedValueOnce([   // absent sweep
            { findingKey: "gone-1", evidence: { backlogItemId: "BI-OLD-1" } },
            { findingKey: "gone-2", evidence: {} },
          ]),
        create: vi.fn(async () => ({ id: "af" })),
        update,
      },
    };
    const observedAt = new Date("2026-06-23T03:00:00.000Z");

    const result = await persistAssuranceFindings(db, {
      assuranceRunId: "run",
      buildId: "FB-1",
      findings: [normalizedFinding({ findingKey: "present-1" })],
      observedAt,
      resolveAbsent: { adapterKey: "pnpm-audit" },
    });

    expect(result.resolved).toBe(2);
    expect(result.resolvedBacklogItemIds).toEqual(["BI-OLD-1"]);
    expect(update).toHaveBeenCalledWith({
      where: { findingKey: "gone-1" },
      data: expect.objectContaining({ status: "resolved", resolvedAt: observedAt }),
    });
    expect(db.assuranceFinding.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          buildId: "FB-1",
          adapterKey: "pnpm-audit",
          findingKey: { notIn: ["present-1"] },
        }),
      }),
    );
  });

  it("resolves all active findings on an empty all-clear scan", async () => {
    const db = {
      assuranceFinding: {
        findMany: vi.fn(async () => [{ findingKey: "gone-1", evidence: {} }]),
        create: vi.fn(),
        update: vi.fn(),
      },
    };
    const result = await persistAssuranceFindings(db, {
      assuranceRunId: "run",
      buildId: "FB-1",
      findings: [],
      observedAt: new Date("2026-06-23T03:00:00.000Z"),
      resolveAbsent: { adapterKey: "pnpm-audit" },
    });
    expect(result.resolved).toBe(1);
    expect(result.created).toBe(0);
  });

  it("skips the absent-sweep without resolveAbsent or without a buildId", async () => {
    const noOpts = {
      assuranceFinding: { findMany: vi.fn(async () => []), create: vi.fn(async () => ({ id: "x" })), update: vi.fn() },
    };
    const r1 = await persistAssuranceFindings(noOpts, {
      assuranceRunId: "r",
      buildId: "FB-1",
      findings: [normalizedFinding()],
      observedAt: new Date(),
    });
    expect(r1.resolved).toBe(0);
    expect(noOpts.assuranceFinding.findMany).toHaveBeenCalledTimes(1);

    const noBuild = {
      assuranceFinding: { findMany: vi.fn(async () => []), create: vi.fn(async () => ({ id: "x" })), update: vi.fn() },
    };
    const r2 = await persistAssuranceFindings(noBuild, {
      assuranceRunId: "r",
      findings: [normalizedFinding()],
      observedAt: new Date(),
      resolveAbsent: { adapterKey: "pnpm-audit" },
    });
    expect(r2.resolved).toBe(0);
    expect(noBuild.assuranceFinding.findMany).toHaveBeenCalledTimes(1);
  });
});
