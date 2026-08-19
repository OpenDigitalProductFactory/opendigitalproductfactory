import { describe, expect, it } from "vitest";

import { parsePrismaSchema } from "../build/code-graph/extractors/prisma-schema-adapter";
import { detectDrift } from "./data-architecture-steward";
import { runDataArchitectureSteward, type StewardPrismaClient } from "./data-architecture-steward-apply";

type IssueRow = {
  id: string;
  issueType: string;
  message: string;
  severity: string;
  status: string;
  detailsJson: Record<string, unknown>;
};

const DRIFTY = `
model A {
  id String @id
  bs B[]
}
model B {
  id  String @id
  aId String
  a   A      @relation(fields: [aId], references: [id])
}
model Loner {
  id String @id
}
`;

function makeClient(seed: IssueRow[] = []) {
  const issues = new Map<string, IssueRow>(seed.map((r) => [r.id, r]));
  let seq = 0;
  const client: StewardPrismaClient = {
    eaView: { findFirst: async () => ({ id: "view-1" }) },
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

const facts = parsePrismaSchema(DRIFTY);

describe("runDataArchitectureSteward", () => {
  it("first run creates one open issue per finding", async () => {
    const m = makeClient();
    const result = await runDataArchitectureSteward({ prisma: m.client, facts });
    const findings = detectDrift(facts);

    expect(result.created).toBe(findings.length);
    expect(result.resolved).toBe(0);
    expect(m.issues.size).toBe(findings.length);
    // B.aId has no index -> fk-without-index present.
    expect([...m.issues.values()].some((i) => i.issueType === "fk-without-index")).toBe(true);
    // Loner has no relations -> orphan-model present.
    expect([...m.issues.values()].some((i) => i.issueType === "orphan-model")).toBe(true);
  });

  it("is idempotent — a second run creates and resolves nothing", async () => {
    const m = makeClient();
    await runDataArchitectureSteward({ prisma: m.client, facts });
    const sizeAfterFirst = m.issues.size;

    const second = await runDataArchitectureSteward({ prisma: m.client, facts });
    expect(second.created).toBe(0);
    expect(second.resolved).toBe(0);
    expect(m.issues.size).toBe(sizeAfterFirst);
  });

  it("auto-resolves an issue once its drift is fixed", async () => {
    const m = makeClient();
    await runDataArchitectureSteward({ prisma: m.client, facts });

    // Fixed schema: B.aId now indexed, Loner removed → no drift.
    const fixed = parsePrismaSchema(`
model A {
  id String @id
  bs B[]
}
model B {
  id  String @id
  aId String
  a   A      @relation(fields: [aId], references: [id])
  @@index([aId])
}
`);
    const result = await runDataArchitectureSteward({ prisma: m.client, facts: fixed });

    expect(result.created).toBe(0);
    expect(result.resolved).toBeGreaterThan(0);
    // No open steward issues remain.
    expect([...m.issues.values()].filter((i) => i.status === "open")).toHaveLength(0);
  });
});
