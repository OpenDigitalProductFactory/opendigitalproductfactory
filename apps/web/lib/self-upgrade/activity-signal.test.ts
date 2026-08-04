/**
 * B-class activity signal — what counts as activity for the quiescence drain.
 *
 * Split from quiescence.test.ts: the exclusion set is a policy with its own
 * module (activity-signal.ts) and its own failure history, and it deserves a
 * suite that is read on its own.
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
    quiescenceRun: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("@/lib/queue/inngest-client", () => ({ inngest: { send: vi.fn() } }));
vi.mock("@/lib/tak/agent-event-bus", () => ({
  agentEventBus: { broadcastSystem: vi.fn() },
}));

import { captureActiveSessionBlockers } from "./quiescence";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.taskRunFindMany.mockResolvedValue([]);
  prismaMock.taskRunUpdateMany.mockResolvedValue({ count: 0 });
  prismaMock.buildPhaseRunFindMany.mockResolvedValue([]);
  prismaMock.buildPhaseRunUpdateMany.mockResolvedValue({ count: 0 });
  prismaMock.executeRaw.mockResolvedValue(0);
  prismaMock.toolExecutionFindMany.mockResolvedValue([]);
});

describe("B-class activity signal: a waiter must not count as activity (BI-2C7F51BA)", () => {
  // The deadlock this fixes: a local-CI gate waits for the drain to clear, and
  // the waiting is what keeps it armed. Every MCP call writes a ToolExecution
  // row, INCLUDING read-only ones, so the gate's own get_quiescence_status poll
  // — and the diagnostic call used to inspect the stall — re-armed the single
  // soft blocker both were waiting on (observed: coordinator at ready-to-swap,
  // one soft blocker, count 1).
  //
  // These drive the REAL where-clause through an in-memory row store, so the
  // assertion is about which rows survive the filter, not about its shape.
  type Row = {
    toolName: string;
    agentId: string;
    auditClass: string | null;
    createdAt: Date;
  };

  const NOW = new Date("2026-08-04T22:00:00.000Z");
  const recently = (secondsAgo: number) => new Date(NOW.getTime() - secondsAgo * 1000);

  /** A gate polling for admission, plus the diagnostic that inspects the stall.
   *  All read-only: no side effect, no external access -> `metrics_only`. */
  const WAITER_ROWS: Row[] = [
    { toolName: "get_quiescence_status", agentId: "claude-thread", auditClass: "metrics_only", createdAt: recently(5) },
    { toolName: "list_nonprod_environment_leases", agentId: "claude-thread", auditClass: "metrics_only", createdAt: recently(35) },
    { toolName: "get_quiescence_status", agentId: "codex-thread", auditClass: "metrics_only", createdAt: recently(70) },
  ];

  function seedToolExecutions(rows: Row[]) {
    prismaMock.toolExecutionFindMany.mockImplementation((args: unknown) => {
      const where = (args as { where: Record<string, unknown> }).where;
      const gte = (where.createdAt as { gte: Date }).gte;
      const notPrefix = ((where.NOT as { agentId: { startsWith: string } }).agentId).startsWith;
      const or = where.OR as Array<Record<string, unknown>> | undefined;
      const matched = rows.filter((row) => {
        if (row.createdAt < gte) return false;
        if (row.agentId.startsWith(notPrefix)) return false;
        if (!or) return true;
        return or.some((clause) => {
          if ("auditClass" in clause && clause.auditClass === null) return row.auditClass === null;
          const nested = clause.auditClass as { not?: string } | undefined;
          if (nested && typeof nested.not === "string") {
            return row.auditClass !== null && row.auditClass !== nested.not;
          }
          return false;
        });
      });
      matched.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return Promise.resolve(matched.slice(0, 5));
    });
  }

  it("a gate polling for admission raises no blocker, so the drain reaches swap", async () => {
    seedToolExecutions(WAITER_ROWS);

    const snapshot = await captureActiveSessionBlockers({ now: NOW });

    expect(snapshot.surfaces.find((s) => s.surface === "request.recent-tool-execution"))
      .toBeUndefined();
    // Both gates the run has to pass are now clear. The conservative unattended
    // path (self-upgrade.ts precheck) skips when ANY surface — soft included —
    // is present, so an empty list is what lets it start the drain at all…
    expect(snapshot.surfaces).toHaveLength(0);
    // …and the drain loop itself breaks out on zero HARD blockers, i.e. it
    // reaches ready-to-swap rather than sitting behind the waiter forever.
    expect(snapshot.surfaces.filter((s) => s.kind === "hard")).toHaveLength(0);
  });

  it("still blocks on a MUTATING call — the scheduled path stays conservative (BI-F36E7510)", async () => {
    seedToolExecutions([
      ...WAITER_ROWS,
      { toolName: "update_backlog_item", agentId: "claude-thread", auditClass: "ledger", createdAt: recently(20) },
    ]);

    const snapshot = await captureActiveSessionBlockers({ now: NOW });
    const blocker = snapshot.surfaces.find((s) => s.surface === "request.recent-tool-execution");

    expect(blocker).toBeDefined();
    expect(blocker!.kind).toBe("soft");
    // Only the real write is counted; the waiter's polls are not inflating it.
    expect(blocker!.evidence).toEqual({ recentToolNames: ["update_backlog_item"] });
  });

  it("still blocks on an EXTERNAL-reaching read (journal), which is real activity", async () => {
    seedToolExecutions([
      ...WAITER_ROWS,
      { toolName: "search_mcp_registry", agentId: "claude-thread", auditClass: "journal", createdAt: recently(15) },
    ]);

    const snapshot = await captureActiveSessionBlockers({ now: NOW });

    expect(snapshot.surfaces.find((s) => s.surface === "request.recent-tool-execution")).toBeDefined();
  });

  it("fails closed on unclassified pre-Phase-3 rows", async () => {
    // Rows written before auditClass existed carry null. A bare `NOT auditClass
    // = 'metrics_only'` would evaluate to NULL for them in SQL and silently
    // discard them; they must keep counting.
    seedToolExecutions([
      ...WAITER_ROWS,
      { toolName: "legacy_tool", agentId: "claude-thread", auditClass: null, createdAt: recently(10) },
    ]);

    const snapshot = await captureActiveSessionBlockers({ now: NOW });
    const blocker = snapshot.surfaces.find((s) => s.surface === "request.recent-tool-execution");

    expect(blocker).toBeDefined();
    expect(blocker!.evidence).toEqual({ recentToolNames: ["legacy_tool"] });
  });

  it("keeps excluding edge-node agents (the exclusion this one extends)", async () => {
    seedToolExecutions([
      { toolName: "record_agent_activity", agentId: "edge-node:tractor-7", auditClass: "ledger", createdAt: recently(5) },
    ]);

    const snapshot = await captureActiveSessionBlockers({ now: NOW });

    expect(snapshot.surfaces.find((s) => s.surface === "request.recent-tool-execution")).toBeUndefined();
  });
});
