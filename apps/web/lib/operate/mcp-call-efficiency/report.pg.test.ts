import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@dpf/db";

// Explicit opt-in and the existing isolated development PostgreSQL only.
// Obtain the active-candidate lease before setting RUN_MCP_EFFICIENCY_PG=1.
// Never infer permission from DATABASE_URL or touch the live ToolExecution ledger.
const run = process.env.RUN_MCP_EFFICIENCY_PG === "1";
const integrationUrl = process.env.INTEGRATION_DATABASE_URL ?? "";
if (run) {
  const target = new URL(integrationUrl);
  if (!["localhost", "127.0.0.1"].includes(target.hostname) || target.port !== "5433" ||
    !/^NPEL-/.test(process.env.DPF_NONPROD_LEASE_ID ?? "")) {
    throw new Error("MCP efficiency integration requires the admitted isolated development database lease on localhost:5433");
  }
}

describe.skipIf(!run)("MCP efficiency real PostgreSQL snapshot", () => {
  const prefix = `efficiency-pg-${randomUUID()}-`;
  const end = new Date("2000-01-02T00:00:00.000Z");
  const start = new Date("2000-01-01T00:00:00.000Z");
  let prisma: PrismaClient;
  let scan: typeof import("./report").scanCallEfficiencyWindow;
  const fixture = (id: string, overrides: Partial<Prisma.ToolExecutionCreateManyInput> = {}) => ({
    id: prefix + id, threadId: prefix, agentId: "integration-agent", userId: "integration-user",
    toolName: "get_workroom", parameters: {}, result: {}, success: true,
    executionMode: "external-jsonrpc", createdAt: new Date(start.getTime() + 10_000), ...overrides,
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = integrationUrl;
    ({ prisma } = await import("@dpf/db"));
    ({ scanCallEfficiencyWindow: scan } = await import("./report"));
    expect(await prisma.toolExecution.count({ where: { createdAt: { gte: start, lt: end } } }),
      "the dedicated fixture interval must be empty before testing").toBe(0);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(end);
  }, 30_000);
  afterEach(async () => {
    if (prisma) await prisma.toolExecution.deleteMany({ where: { id: { startsWith: prefix } } });
  });
  afterAll(async () => {
    vi.useRealTimers();
    if (prisma) {
      await prisma.toolExecution.deleteMany({ where: { id: { startsWith: prefix } } });
      await prisma.$disconnect();
    }
  });

  it("excludes a backdated insert committed after count and includes it on a fresh scan", async () => {
    const rows = Array.from({ length: 5_001 }, (_, index) => fixture(String(index).padStart(6, "0"), {
      createdAt: new Date(start.getTime() + 10_000 + Math.floor(index / 3)),
      success: index !== 5_000, toolName: index === 5_000 ? "newest_failure" : "get_workroom",
    }));
    await prisma.toolExecution.createMany({ data: rows });
    let inserted = false;
    const observedDb = new Proxy(prisma, { get(target, property) {
      if (property !== "$transaction") return Reflect.get(target, property);
      return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options: {
        isolationLevel: Prisma.TransactionIsolationLevel; timeout: number; maxWait: number;
      }) => target.$transaction(async (tx) => {
        const observedTx = new Proxy(tx, { get(transaction, key) {
          if (key !== "toolExecution") return Reflect.get(transaction, key);
          return new Proxy(transaction.toolExecution, { get(delegate, operation) {
            if (operation !== "count") return Reflect.get(delegate, operation);
            return async (args: Prisma.ToolExecutionCountArgs) => {
              const count = await delegate.count(args);
              expect(await tx.$queryRaw`SHOW transaction_isolation`).toEqual([{ transaction_isolation: "repeatable read" }]);
              expect(await tx.$queryRaw`SHOW transaction_read_only`).toEqual([{ transaction_read_only: "on" }]);
              await prisma.toolExecution.create({ data: fixture("late", {
                toolName: "late_backdated_call", createdAt: new Date(start.getTime() + 5_000),
              }) });
              inserted = true;
              return count;
            };
          } });
        } });
        return callback(observedTx);
      }, options);
    } });
    const first = await scan({ windowHours: 24, pageSize: 500 }, observedDb);
    expect(inserted).toBe(true);
    expect(first.coverage).toMatchObject({ complete: true, includedCount: 5_001, populationCount: 5_001, pagesRead: 11 });
    expect(first.topTools.find((tool) => tool.toolName === "newest_failure")?.failCount).toBe(1);
    expect(first.topTools.some((tool) => tool.toolName === "late_backdated_call")).toBe(false);
    const second = await scan({ windowHours: 24 });
    expect(second.coverage).toMatchObject({ complete: true, includedCount: 5_002, populationCount: 5_002 });
    expect(second.topTools.find((tool) => tool.toolName === "late_backdated_call")?.count).toBe(1);
    console.log("[efficiency-pg] snapshot evidence", JSON.stringify({ first: first.coverage, second: second.coverage }));
  }, 30_000);

  it("projects only typed scalar JSON while preserving refusal and owner correlation semantics", async () => {
    const hugeUnusedValue = "x".repeat(1_000_000);
    await prisma.toolExecution.createMany({ data: Array.from({ length: 20 }, (_, index) => fixture(
      String(index).padStart(3, "0"), {
        threadId: "", agentId: "unknown", success: false,
        parameters: index < 10 ? { ownerSessionId: " owner-one ", unused: index === 0 ? hugeUnusedValue : "" }
          : { ownerSessionId: 123 },
        result: index < 10 ? { error: "approval_required" } : { error: 123 },
      },
    )) });
    const report = await scan({ windowHours: 24, pageSize: 3 });
    expect(report.coverage.complete).toBe(true);
    expect(report.topTools[0]).toMatchObject({ count: 20, refusalCount: 10, failCount: 10, successRate: 0 });
    expect(report.findings.find((finding) => finding.kind === "thrash")?.evidence.correlationId)
      .toBe("owner-session:owner-one");
    expect(JSON.stringify(report).length).toBeLessThan(20_000);
  });

  it("stops before an oversized database field and keeps the preceding checkpoint", async () => {
    await prisma.toolExecution.createMany({ data: [fixture("a"), fixture("b", { toolName: "x".repeat(10_000) })] });
    const report = await scan({ windowHours: 24 });
    expect(report.coverage).toMatchObject({ complete: false, includedCount: 1, populationCount: 2, stopReason: "field-budget" });
    expect(report.coverage.lastProcessed?.id).toBe(prefix + "a");
  });
});
