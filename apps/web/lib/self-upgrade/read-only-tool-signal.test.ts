/**
 * BI-2C7F51BA Defect 3 — an observation is not activity.
 *
 * Proves the B-class `request.recent-tool-execution` signal no longer counts
 * read-only tool calls, so a waiter polling the drain cannot re-arm the very
 * blocker it is waiting on, while mutating calls block exactly as before.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  taskRunFindMany: vi.fn(),
  taskRunUpdateMany: vi.fn(),
  buildPhaseRunFindMany: vi.fn(),
  buildPhaseRunUpdateMany: vi.fn(),
  executeRaw: vi.fn(),
  toolExecutionFindMany: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    taskRun: {
      findMany: (...args: unknown[]) => prismaMock.taskRunFindMany(...args),
      updateMany: (...args: unknown[]) => prismaMock.taskRunUpdateMany(...args),
    },
    buildPhaseRun: {
      findMany: (...args: unknown[]) => prismaMock.buildPhaseRunFindMany(...args),
      updateMany: (...args: unknown[]) => prismaMock.buildPhaseRunUpdateMany(...args),
    },
    $executeRaw: (...args: unknown[]) => prismaMock.executeRaw(...args),
    toolExecution: {
      findMany: (...args: unknown[]) => prismaMock.toolExecutionFindMany(...args),
    },
  },
}));

vi.mock("@/lib/queue/inngest-client", () => ({ inngest: { send: vi.fn() } }));
vi.mock("@/lib/tak/agent-event-bus", () => ({
  agentEventBus: { broadcastSystem: vi.fn() },
}));

import { captureActiveSessionBlockers } from "./quiescence";
import { resolveReadOnlyToolNames } from "./read-only-tool-signal";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.taskRunFindMany.mockResolvedValue([]);
  prismaMock.taskRunUpdateMany.mockResolvedValue({ count: 0 });
  prismaMock.buildPhaseRunFindMany.mockResolvedValue([]);
  prismaMock.buildPhaseRunUpdateMany.mockResolvedValue({ count: 0 });
  prismaMock.executeRaw.mockResolvedValue(0);
  prismaMock.toolExecutionFindMany.mockResolvedValue([]);
});

describe("recent-tool-execution excludes read-only observers (BI-2C7F51BA)", () => {
  type Row = { agentId: string; toolName: string; createdAt: Date };

  /** Minimal stand-in for the NOT/OR clause the B-class query now carries. */
  function excluded(where: Record<string, any>, row: Row): boolean {
    const clauses = where?.NOT?.OR ?? (where?.NOT ? [where.NOT] : []);
    return clauses.some((clause: Record<string, any>) => {
      if (clause.agentId?.startsWith) return row.agentId.startsWith(clause.agentId.startsWith);
      if (clause.toolName?.in) return clause.toolName.in.includes(row.toolName);
      return false;
    });
  }

  function serveToolExecutions(rows: Row[]) {
    prismaMock.toolExecutionFindMany.mockImplementation(async (args: any) =>
      rows
        .filter((row) => row.createdAt >= args.where.createdAt.gte)
        .filter((row) => !excluded(args.where, row))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, args.take)
        .map((row) => ({ toolName: row.toolName, createdAt: row.createdAt })),
    );
  }

  const now = new Date("2026-08-04T22:00:00.000Z");
  const justNow = new Date(now.getTime() - 1_000);

  it("a waiter polling quiescence does not re-arm the blocker it is waiting on", async () => {
    // The observed deadlock: a coordinator at ready-to-swap with exactly ONE
    // drain blocker — request.recent-tool-execution, count 1 — which was the
    // waiting local-CI gate's own liveness poll. The gate waits for the drain;
    // the waiting is what prevents it from clearing. get_quiescence_status is a
    // read explicitly permitted during quiescence, so observing the drain must
    // never extend it.
    serveToolExecutions([
      { agentId: "gate-observer", toolName: "get_quiescence_status", createdAt: justNow },
      { agentId: "gate-observer", toolName: "list_nonprod_environment_leases", createdAt: justNow },
    ]);

    const snapshot = await captureActiveSessionBlockers({ now });

    expect(
      snapshot.surfaces.find((s) => s.surface === "request.recent-tool-execution"),
    ).toBeUndefined();
  });

  it("a mutating tool call still blocks the drain", async () => {
    // The narrowing is to the SIGNAL, not to the protocol: the scheduled /
    // unattended path stays conservative about soft blockers (BI-F36E7510).
    serveToolExecutions([
      { agentId: "coworker", toolName: "create_backlog_item", createdAt: justNow },
    ]);

    const snapshot = await captureActiveSessionBlockers({ now });

    const surface = snapshot.surfaces.find((s) => s.surface === "request.recent-tool-execution");
    expect(surface?.kind).toBe("soft");
    expect((surface?.evidence as { recentToolNames: string[] }).recentToolNames).toEqual([
      "create_backlog_item",
    ]);
  });

  it("excludes read-only rows in the QUERY so they cannot hide a mutating call", async () => {
    // Post-filtering a `take: 5` page of read-only rows would let a sixth,
    // genuinely mutating call fall off the end and stop blocking the drain.
    serveToolExecutions([
      ...Array.from({ length: 8 }, (_, i) => ({
        agentId: "gate-observer",
        toolName: "get_quiescence_status",
        createdAt: new Date(now.getTime() - 1_000 - i),
      })),
      {
        agentId: "coworker",
        toolName: "create_backlog_item",
        createdAt: new Date(now.getTime() - 60_000),
      },
    ]);

    const snapshot = await captureActiveSessionBlockers({ now });

    const surface = snapshot.surfaces.find((s) => s.surface === "request.recent-tool-execution");
    expect((surface?.evidence as { recentToolNames: string[] }).recentToolNames).toEqual([
      "create_backlog_item",
    ]);
  });

  it("classifies the observing tools as read-only from the canonical annotations", async () => {
    const names = await resolveReadOnlyToolNames();
    expect(names).toContain("get_quiescence_status");
    expect(names).toContain("list_nonprod_environment_leases");
    expect(names).not.toContain("create_backlog_item");
  });
});
