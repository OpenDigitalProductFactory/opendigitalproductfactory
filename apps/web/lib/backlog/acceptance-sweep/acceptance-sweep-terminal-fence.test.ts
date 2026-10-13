import { describe, expect, it, vi } from "vitest";
import { claimSweep, emptySweepCheckpoint } from "./acceptance-sweep-checkpoint";
import { productionAcceptanceSweepPorts } from "./acceptance-sweep-task";

// Keep the production close adapter, terminal transition, and owner fence real.
// Only external preparation and unrelated readiness policy are isolated here.
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("./prepare-completion-signals", () => ({ prepareSweepCompletionSignals: async () => ({
  assertCurrent: async () => {}, dependencies: { resolveMergeDelivery: async () => "merged" },
}) }));
vi.mock("@/lib/backlog/initiative-readiness/backlog-completion-evaluation", () => ({
  BACKLOG_COMPLETION_ITEM_SELECT: {},
  evaluateBacklogItemCompletion: async () => ({
    governed: true, decision: { verdict: "allowed", profile: "fix", blockers: [], unmet: [], satisfied: [] },
    reconciliation: { baselineId: "baseline-test", state: "pass", evidenceRefs: [] },
    deployment: null, acceptanceState: "pass",
  }),
}));

describe("production acceptance close terminal CAS audit fence", () => {
  it.each(["unchanged", "takeover", "expiry"] as const)("handles CAS audit retry with %s ownership", async mode => {
    const start = Date.parse("2026-10-12T18:00:00Z");
    const a = claimSweep(emptySweepCheckpoint(), "owner-a", start);
    let checkpoint = a.checkpoint;
    let clock = start;
    let transactions = 0;
    const committed: string[] = [];
    const attempted: string[] = [];
    const item = { id: "row-test", itemId: "BI-TERMINAL-FENCE", status: "awaiting-acceptance", organizationId: null, claimedByAgentId: null, agentId: null };
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const db = {
      backlogItem: { findUnique: async () => item },
      async $transaction<T>(work: (tx: unknown) => Promise<T>) {
        transactions++;
        const staged: string[] = [];
        const write = (kind: string) => { attempted.push(kind); staged.push(kind); return Promise.resolve({}); };
        const tx = {
          $queryRawUnsafe: async (sql: string) => sql.includes('FROM "ScheduledAgentTask"')
            ? [{ taskConfig: { acceptanceSweep: checkpoint }, isActive: true }]
            : sql.includes("clock_timestamp") ? [{ now: new Date(clock) }] : [],
          backlogItem: { findFirst: async () => item, findUnique: async () => item, updateMany },
          authorizationDecisionLog: { create: () => write("authority") },
          backlogItemActivity: { create: () => write("audit") },
        };
        try {
          const result = await work(tx);
          committed.push(...staged);
          return result;
        } catch (error) {
          // First transaction's real terminal CAS failure rolls back both audit
          // writes. Simulate expiry/takeover before its real audit retry starts.
          expect((error as Error).message).toMatch(/compare-and-set|ownership lost/);
          if (transactions === 1 && mode !== "unchanged") {
            clock = start + 300_000;
            if (mode === "takeover") checkpoint = claimSweep(checkpoint, "owner-b", clock).checkpoint;
          }
          throw error;
        }
      },
    };
    const ports = productionAcceptanceSweepPorts(db as never, new Date(start), "test-agent", "test-task", a.claim);
    const result = ports.close(item, { verdict: "allowed", satisfied: [] } as never, {
      state: "enabled", setByUserId: "test-user", setAt: new Date(start).toISOString(),
      agentGrant: "initiative_completion", reason: "test", limit: 1,
    } as never);
    if (mode === "unchanged") {
      expect(await result).toMatchObject({ outcome: "refused", code: "STALE_EVIDENCE" });
      expect(committed).toEqual(["authority", "audit"]);
      expect(attempted).toEqual(["authority", "audit", "authority", "audit"]);
    } else {
      await expect(result).rejects.toThrow("ownership lost");
      expect(committed).toEqual([]);
      expect(attempted).toEqual(["authority", "audit"]);
    }
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(transactions).toBe(2);
  });
});
