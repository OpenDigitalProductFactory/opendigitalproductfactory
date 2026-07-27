import { describe, expect, it } from "vitest";

import { runArchitectureParitySteward, type ArchitectureParityStewardClient } from "./architecture-parity-steward";
import type { SysmlProjectionsResult } from "./reconcile-sysml-projections";

type IssueRow = {
  id: string;
  issueType: string;
  message: string;
  severity: string;
  status: string;
  detailsJson: Record<string, unknown>;
};

const healthy = { status: "noop" as const, created: 0, updated: 0, removed: 0 };
const skipped = { status: "skipped" as const, created: 0, updated: 0, removed: 0 };
const healthyAiRouting = {
  ...healthy,
  bpmn: healthy,
  archimate: healthy,
  sysml: healthy,
};

function projectionResult(overrides: Partial<SysmlProjectionsResult> = {}): SysmlProjectionsResult {
  return {
    mcpAuthority: { ...healthy, toolCount: 3, grantCount: 2 },
    coworkerAuthority: healthy,
    valueStreams: healthy,
    routes: healthy,
    navigation: healthy,
    codeStructure: healthy,
    processModels: healthy,
    skillToolchain: healthy,
    operationalGraph: healthy,
    networkTopology: healthy,
    integrations: healthy,
    scheduledJobs: healthy,
    it4itCoverage: healthy,
    securityPosture: healthy,
    workPatternArchitecture: healthy,
    federatedDemandArchitecture: healthy,
    aiRoutingArchitecture: healthyAiRouting,
    ...overrides,
  };
}

function makeClient(seed: IssueRow[] = []) {
  const issues = new Map<string, IssueRow>(seed.map((r) => [r.id, r]));
  let seq = 0;
  const client: ArchitectureParityStewardClient = {
    eaConformanceIssue: {
      findMany: async (args: Record<string, unknown>) => {
        const where = (args.where ?? {}) as { status?: string; issueType?: { in?: string[] } };
        return [...issues.values()]
          .filter((r) => (where.status ? r.status === where.status : true))
          .filter((r) => (where.issueType?.in ? where.issueType.in.includes(r.issueType) : true))
          .map((r) => ({ id: r.id, issueType: r.issueType, message: r.message, severity: r.severity, detailsJson: r.detailsJson }));
      },
      create: async (args: Record<string, unknown>) => {
        const data = args.data as Record<string, unknown>;
        const id = `issue-${++seq}`;
        issues.set(id, {
          id,
          issueType: String(data.issueType),
          message: String(data.message),
          severity: String(data.severity),
          status: String(data.status ?? "open"),
          detailsJson: (data.detailsJson ?? {}) as Record<string, unknown>,
        });
        return { id };
      },
      update: async (args: Record<string, unknown>) => {
        const id = (args.where as { id: string }).id;
        const data = args.data as Record<string, unknown>;
        const row = issues.get(id);
        if (row) Object.assign(row, data);
        return { id };
      },
    },
  };
  return { client, issues };
}

describe("runArchitectureParitySteward", () => {
  it("creates one open conformance issue per skipped projection domain", async () => {
    const m = makeClient();
    const result = await runArchitectureParitySteward({
      prisma: m.client,
      reconcile: async () =>
        projectionResult({
          valueStreams: skipped,
          codeStructure: skipped,
        }),
    });

    expect(result.steward.created).toBe(2);
    expect([...m.issues.values()].map((i) => i.issueType)).toEqual([
      "parity-projection-unavailable",
      "parity-projection-unavailable",
    ]);
    expect([...m.issues.values()].map((i) => i.detailsJson.domain).sort()).toEqual(["codeStructure", "valueStreams"]);
  });

  it("is idempotent for unchanged skipped domains", async () => {
    const m = makeClient();
    const reconcile = async () => projectionResult({ valueStreams: skipped });

    await runArchitectureParitySteward({ prisma: m.client, reconcile });
    const second = await runArchitectureParitySteward({ prisma: m.client, reconcile });

    expect(second.steward.created).toBe(0);
    expect(second.steward.updated).toBe(0);
    expect(second.steward.resolved).toBe(0);
    expect([...m.issues.values()].filter((i) => i.status === "open")).toHaveLength(1);
  });

  it("auto-resolves prior parity steward issues when domains become healthy", async () => {
    const m = makeClient();
    await runArchitectureParitySteward({
      prisma: m.client,
      reconcile: async () => projectionResult({ valueStreams: skipped }),
    });

    const healed = await runArchitectureParitySteward({
      prisma: m.client,
      reconcile: async () => projectionResult(),
    });

    expect(healed.steward.resolved).toBe(1);
    expect([...m.issues.values()].filter((i) => i.status === "open")).toHaveLength(0);
  });
});
