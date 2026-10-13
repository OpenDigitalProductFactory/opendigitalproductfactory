// AC-PROBE run (BI-129EFFD1): the shared runner the script and the MCP tool
// both call. Proves it is read-only by construction: every evaluation step that
// can reach the database runs inside a transaction whose FIRST statement is
// SET TRANSACTION READ ONLY, a write attempted there is refused and reported on
// its row, and no tool handler is ever called.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handler: vi.fn(),
  governedExecuteTool: vi.fn(),
  currentUserContext: vi.fn(),
  resolveAuthority: vi.fn(),
  evaluate: vi.fn(),
  resolveGaid: vi.fn(),
  buildHooks: vi.fn(),
  agentGrants: vi.fn(),
}));

// Any tool execution path the runner could reach is a spy that must stay untouched.
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: mocks.governedExecuteTool, runPreToolHooks: mocks.governedExecuteTool }));
vi.mock("@/lib/mcp-tools", () => ({ executeTool: mocks.handler, PLATFORM_TOOLS: [] }));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: mocks.currentUserContext }));
vi.mock("@/lib/govern/authority/resolve-coworker-tool-authority", () => ({ resolveCoworkerToolAuthorityInput: mocks.resolveAuthority }));
vi.mock("@/lib/govern/authority/coworker-authority-decision", () => ({ evaluateCoworkerAuthority: mocks.evaluate }));
vi.mock("@/lib/tak/gaid-actor-envelope", () => ({ resolveGaidActorEnvelope: mocks.resolveGaid }));
vi.mock("@/lib/tak/agent-grants", () => ({
  getAgentToolGrantsAsync: mocks.agentGrants,
  isToolAllowedByGrants: (tool: string, grants: string[]) => grants.includes(tool),
}));
vi.mock("@/lib/tak/consequential-tool-policy", () => ({ classifyConsequentialTool: () => ({ alignmentRequired: true }) }));
import { READ_ONLY_STATEMENT, runApprovalConvergenceProbe, withReadOnlyTransaction } from "./approval-convergence-probe-run";
import { installApprovalProbeRuntime } from "./approval-convergence-probe-runtime";

type Hook = { onPreToolUse?: (event: unknown) => Promise<{ decision: string; reason?: string }> };
const TOOL = { name: "run_hive_scout_ingest", consequence: "outward", sideEffect: true, requiredCapability: null };

/** The runtime the boot registration installs: the catalog lookup, and the hooks bound to the db it is given. */
function installRuntime() {
  installApprovalProbeRuntime({
    findTool: (name) => (name === TOOL.name ? TOOL as never : undefined),
    runGovernanceHooks: async (event, db, options) => {
      for (const hook of mocks.buildHooks(db, options) as Hook[]) {
        const decision = await hook.onPreToolUse?.(event);
        if (decision?.decision === "deny") return { success: false, message: decision.reason ?? "" };
      }
      return null;
    },
  });
}

const READ_ONLY_ERROR = "cannot execute INSERT in a read-only transaction";
const NOW = new Date("2026-10-13T12:00:00Z");

/** A fake client with PostgreSQL's rule: after SET TRANSACTION READ ONLY, a write is refused. */
function fakeDb() {
  const transactions: Array<{ statements: string[] }> = [];
  const globalWrites: string[] = [];
  const db = {
    agentActionProposal: {
      findMany: vi.fn(async () => [{
        proposalId: "prop-1", actionType: "run_hive_scout_ingest", parameters: { limit: 5 }, agentId: "AGT-SCOUT",
        threadId: "thread-1", taskRunId: null, proposedAt: new Date("2026-10-01T12:00:00Z"),
        thread: { user: { id: "user-1", isActive: true, lastSeenAt: new Date("2026-10-13T09:00:00Z") } },
      }]),
    },
    workroomActivity: { create: vi.fn(async () => { globalWrites.push("workroomActivity.create"); }) },
    $transaction: vi.fn(async <T,>(work: (tx: unknown) => Promise<T>) => {
      const record = { statements: [] as string[] };
      transactions.push(record);
      const readOnly = () => record.statements[0] === READ_ONLY_STATEMENT;
      const tx = {
        $executeRawUnsafe: vi.fn(async (sql: string) => { record.statements.push(sql); return 0; }),
        workroomActivity: {
          create: vi.fn(async () => {
            record.statements.push("INSERT workroomActivity");
            if (readOnly()) throw new Error(READ_ONLY_ERROR);
          }),
        },
      };
      return work(tx);
    }),
  };
  return { db, transactions, globalWrites };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUserContext.mockResolvedValue({ userId: "user-1", platformRole: "HR-000", isSuperuser: true });
  mocks.resolveAuthority.mockResolvedValue({});
  mocks.evaluate.mockReturnValue({ outcome: "require-approval", reasonCode: "approval-required" });
  mocks.resolveGaid.mockResolvedValue({ gaid: "gaid:x" });
  mocks.agentGrants.mockResolvedValue(["run_hive_scout_ingest"]);
  mocks.buildHooks.mockReturnValue([]);
  installRuntime();
});

describe("approval convergence probe run (AC-PROBE, BI-129EFFD1)", () => {
  it("opens every transaction with SET TRANSACTION READ ONLY before the work runs", async () => {
    const { db, transactions } = fakeDb();
    const seen: string[][] = [];
    await withReadOnlyTransaction(db as never, async () => { seen.push([...transactions[0].statements]); });
    expect(seen).toEqual([[READ_ONLY_STATEMENT]]);
  });

  it("evaluates each row on read-only transactions and returns { probedAt, summary, rows }", async () => {
    const { db, transactions } = fakeDb();
    const report = await runApprovalConvergenceProbe(db as never, NOW);

    expect(report.probedAt).toBe(NOW.toISOString());
    expect(report.rows).toEqual([expect.objectContaining({ proposalId: "prop-1", refusal: "admissible-after-approval" })]);
    expect(report.summary).toMatchObject({ rows: 1, byRefusal: { "admissible-after-approval": 1 } });
    expect(transactions.length).toBeGreaterThan(0);
    for (const tx of transactions) expect(tx.statements[0]).toBe(READ_ONLY_STATEMENT);

    // Every step that can reach the database received a read-only transaction client, never the outer client.
    const txClient = expect.objectContaining({ $executeRawUnsafe: expect.any(Function) });
    expect(mocks.currentUserContext).toHaveBeenCalledWith("user-1", txClient);
    expect(mocks.resolveAuthority).toHaveBeenCalledWith(expect.objectContaining({ agentGrantAllowed: true }), txClient);
    expect(mocks.resolveGaid).toHaveBeenCalledWith(expect.objectContaining({ toolName: "run_hive_scout_ingest" }), txClient);
    expect(mocks.buildHooks).toHaveBeenCalledWith(txClient, expect.objectContaining({ notifyCircuit: expect.any(Function) }));
  });

  it("refuses a write a hook attempts and reports it on the row; no handler runs", async () => {
    const { db, transactions, globalWrites } = fakeDb();
    mocks.buildHooks.mockImplementation((hookDb: { workroomActivity: { create(): Promise<void> } }) => [{
      id: "writes-an-audit-row",
      onPreToolUse: async () => { await hookDb.workroomActivity.create(); return { decision: "allow" }; },
    }]);

    const report = await runApprovalConvergenceProbe(db as never, NOW);

    expect(report.rows[0]).toMatchObject({ refusal: "hook-error", hook: "error", detail: READ_ONLY_ERROR });
    expect(transactions.some((tx) => tx.statements.join("|") === `${READ_ONLY_STATEMENT}|INSERT workroomActivity`)).toBe(true);
    expect(globalWrites).toEqual([]);
    expect(mocks.handler).not.toHaveBeenCalled();
    expect(mocks.governedExecuteTool).not.toHaveBeenCalled();
  });

  it("refuses to run before the server has installed its governance runtime", async () => {
    const { db } = fakeDb();
    installApprovalProbeRuntime(null);
    await expect(runApprovalConvergenceProbe(db as never, NOW)).rejects.toThrow("not available");
    expect(db.agentActionProposal.findMany).not.toHaveBeenCalled();
  });

  it("a write the resolver attempts is reported as authority-evidence-unavailable", async () => {
    const { db } = fakeDb();
    mocks.resolveAuthority.mockImplementation(async (_args: unknown, tx: { workroomActivity: { create(): Promise<void> } }) => {
      await tx.workroomActivity.create();
      return {};
    });
    const report = await runApprovalConvergenceProbe(db as never, NOW);
    expect(report.rows[0]).toMatchObject({ refusal: "authority-evidence-unavailable", detail: READ_ONLY_ERROR });
    expect(mocks.handler).not.toHaveBeenCalled();
  });

  it("cannot reach a tool executor: it imports no catalog, executor or handler registry", () => {
    const source = readFileSync(resolve(__dirname, "approval-convergence-probe-run.ts"), "utf8");
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    for (const banned of ["@/lib/mcp-tools", "@/lib/mcp-governed-execute", "@/lib/mcp/tool-registry"]) {
      expect(imports).not.toContain(banned);
    }
    expect(source).not.toMatch(/executeTool|getHandler|\.handlers\b/);
  });
});
