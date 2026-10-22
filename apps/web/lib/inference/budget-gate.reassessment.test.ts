import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@dpf/db";

const db = vi.hoisted(() => ({ agent: { findUnique: vi.fn() }, tokenUsage: { aggregate: vi.fn() } }));
vi.mock("@dpf/db", () => ({ prisma: db }));
import { checkReassessmentBudget, readReassessmentBudgetConfiguration } from "./budget-gate";

function registry(limit: unknown = 200000, perTask: unknown = 50000) {
  return { agents: [{ agent_id: "AGT-REVIEW", agent_name: "reviewer", config_profile: {
    token_budget: { daily_limit: limit, per_task_limit: perTask },
    execution_runtime: { type: "in_process", timeout_seconds: 300 },
    model_binding: { max_tokens: 8192 },
  } }] };
}
function currentRow(overrides: Record<string, unknown> = {}) {
  return { id: "canonical-reviewer-row", agentId: "AGT-REVIEW", executionConfig: {
    id: "reviewer-execution-config", agentId: "canonical-reviewer-row", executionType: "in_process",
    dailyTokenLimit: 200000, perTaskTokenLimit: 50000, timeoutSeconds: 300, maxTokens: 8192, ...overrides,
  } };
}
const read = (limits = registry()) => readReassessmentBudgetConfiguration("reviewer", () => limits);

describe("restricted review current normal budget", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.agent.findUnique.mockResolvedValue(currentRow());
  });
  it("reads the canonical execution row and retains both origins with stable digests", async () => {
    const config = await read();
    expect(db.agent.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { agentId: "AGT-REVIEW" } }));
    expect(config).toMatchObject({ source: "registry-and-execution-config", agentId: "reviewer", registryAgentId: "AGT-REVIEW",
      configuredDailyLimit: 200000, configuredPerTaskLimit: 50000, configuredTimeoutMs: 300000,
      configuredMaxOutputTokens: 8192, executionAgentRowId: "canonical-reviewer-row", executionConfigId: "reviewer-execution-config" });
    expect(config.configurationDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(config.configurationDigest).toBe((await read()).configurationDigest);
    // A wider recorded policy is still an identity change even if the other ceiling wins.
    expect(config.configurationDigest).not.toBe((await read(registry(200001))).configurationDigest);
  });
  it("uses the supplied transaction for current configuration and observed daily totals", async () => {
    const owner = { agent: { findUnique: vi.fn(async () => currentRow({ perTaskTokenLimit: 40000 })) },
      tokenUsage: { aggregate: vi.fn(async () => ({ _sum: { inputTokens: 150000, outputTokens: 10000 } })) } };
    const tx = owner as unknown as Pick<Prisma.TransactionClient, "agent" | "tokenUsage">;
    const loadRegistry = vi.fn(() => registry());
    const config = await readReassessmentBudgetConfiguration("reviewer", loadRegistry, tx);
    expect(config.configuredPerTaskLimit).toBe(40000);
    expect(await checkReassessmentBudget(config, tx)).toMatchObject({ status: "warning_80", actualTokens: 160000 });
    expect(owner.agent.findUnique).toHaveBeenCalledOnce(); expect(owner.tokenUsage.aggregate).toHaveBeenCalledOnce();
    expect(loadRegistry).toHaveBeenCalledOnce(); expect(db.agent.findUnique).not.toHaveBeenCalled(); expect(db.tokenUsage.aggregate).not.toHaveBeenCalled();
  });
  it("refuses transaction-local exhaustion even when ambient usage is below the ceiling", async () => {
    const config = await read(registry(100));
    db.tokenUsage.aggregate.mockResolvedValue({ _sum: { inputTokens: 0, outputTokens: 0 } });
    const owner = { tokenUsage: { aggregate: vi.fn(async () => ({ _sum: { inputTokens: 100, outputTokens: 0 } })) } };
    await expect(checkReassessmentBudget(config, owner as unknown as Pick<Prisma.TransactionClient, "tokenUsage">)).rejects.toThrow(/exhausted/);
    expect(db.tokenUsage.aggregate).not.toHaveBeenCalled();
  });
  it("intersects narrowed live limits without widening any registry ceiling", async () => {
    db.agent.findUnique.mockResolvedValue(currentRow({ dailyTokenLimit: 120000, perTaskTokenLimit: 40000,
      timeoutSeconds: 120, maxTokens: 4096 }));
    expect(await read()).toMatchObject({ configuredDailyLimit: 120000, configuredPerTaskLimit: 40000,
      configuredTimeoutMs: 120000, configuredMaxOutputTokens: 4096 });
    db.agent.findUnique.mockResolvedValue(currentRow({ dailyTokenLimit: 400000, perTaskTokenLimit: 80000,
      timeoutSeconds: 600, maxTokens: 16384 }));
    expect(await read()).toMatchObject({ configuredDailyLimit: 200000, configuredPerTaskLimit: 50000,
      configuredTimeoutMs: 300000, configuredMaxOutputTokens: 8192 });
  });
  it("retains a finite ceiling when only one source explicitly records unlimited", async () => {
    expect(await read(registry(0, 0))).toMatchObject({ configuredDailyLimit: 200000, configuredPerTaskLimit: 50000 });
    db.agent.findUnique.mockResolvedValue(currentRow({ dailyTokenLimit: 0, perTaskTokenLimit: 0 }));
    expect(await read()).toMatchObject({ configuredDailyLimit: 200000, configuredPerTaskLimit: 50000 });
    expect(await read(registry(0, 0))).toMatchObject({ configuredDailyLimit: 0, configuredPerTaskLimit: 0 });
  });
  it("reads the current row again and binds changes even when the effective ceiling stays equal", async () => {
    const config = await read();
    db.agent.findUnique.mockResolvedValue(currentRow({ maxTokens: 16384 }));
    const changed = await read();
    expect(changed.configuredMaxOutputTokens).toBe(config.configuredMaxOutputTokens);
    expect(changed.configurationDigest).not.toBe(config.configurationDigest);
    expect(db.agent.findUnique).toHaveBeenCalledTimes(2);
  });
  it.each([undefined, null, -1, 1.5, Infinity, "200000"])("refuses malformed registry daily limit %s instead of unlimited", async limit => {
    const invalid = registry(); invalid.agents[0].config_profile.token_budget.daily_limit = limit;
    await expect(read(invalid)).rejects.toThrow(/budget/i);
    expect(db.agent.findUnique).not.toHaveBeenCalled();
  });
  it.each([
    { dailyTokenLimit: undefined }, { dailyTokenLimit: -1 }, { perTaskTokenLimit: null }, { maxTokens: 0 },
    { timeoutSeconds: 1.5 }, { timeoutSeconds: Number.MAX_SAFE_INTEGER }, { executionType: "external_cli" },
    { agentId: "different-agent-row" }, { id: "" },
  ])("refuses missing, malformed or conflicting current execution policy %j", async override => {
    db.agent.findUnique.mockResolvedValue(currentRow(override));
    await expect(read()).rejects.toThrow(/budget|execution/i);
  });
  it("refuses unavailable or missing canonical rows and mismatched identities", async () => {
    db.agent.findUnique.mockRejectedValueOnce(new Error("current execution owner unavailable"));
    await expect(read()).rejects.toThrow(/unavailable/);
    for (const row of [null, { ...currentRow(), executionConfig: null }, { ...currentRow(), agentId: "other-reviewer" }]) {
      db.agent.findUnique.mockResolvedValue(row);
      await expect(read()).rejects.toThrow(/budget|execution/i);
    }
  });
  it("refuses a missing, ambiguous or unavailable registry identity", async () => {
    await expect(readReassessmentBudgetConfiguration("missing", () => registry())).rejects.toThrow(/budget/i);
    await expect(readReassessmentBudgetConfiguration("reviewer", () => ({}))).rejects.toThrow(/budget/i);
    const duplicate = registry(); duplicate.agents.push(duplicate.agents[0]);
    await expect(readReassessmentBudgetConfiguration("reviewer", () => duplicate)).rejects.toThrow(/budget/i);
    await expect(readReassessmentBudgetConfiguration("reviewer", () => { throw new Error("unavailable"); })).rejects.toThrow(/unavailable/);
  });
  it("checks actual current usage even when both sources explicitly record unlimited", async () => {
    db.agent.findUnique.mockResolvedValue(currentRow({ dailyTokenLimit: 0 }));
    db.tokenUsage.aggregate.mockResolvedValue({ _sum: { inputTokens: 34, outputTokens: 16 } });
    const result = await checkReassessmentBudget(await read(registry(0)));
    expect(result.actualTokens).toBe(50); expect(result.status).toBe("ok");
    expect(db.tokenUsage.aggregate).toHaveBeenCalled();
  });
  it("propagates an unavailable usage owner and rejects exhausted current limits", async () => {
    const config = await read(registry(100));
    db.tokenUsage.aggregate.mockRejectedValueOnce(new Error("usage unavailable"));
    await expect(checkReassessmentBudget(config)).rejects.toThrow(/unavailable/);
    db.tokenUsage.aggregate.mockResolvedValue({ _sum: { inputTokens: 60, outputTokens: 40 } });
    await expect(checkReassessmentBudget(config)).rejects.toThrow(/exhausted/i);
  });
  it.each(["reviewer", "AGT-REVIEW"])("includes both current recorded identities in daily usage for %s", async requestedId => {
    const config = await readReassessmentBudgetConfiguration(requestedId, () => registry(100));
    const rows = [{ agentId: "reviewer", inputTokens: 30 }, { agentId: "AGT-REVIEW", inputTokens: 80 }];
    db.tokenUsage.aggregate.mockImplementation(async ({ where }: { where: { agentId: string | { in: string[] } } }) => {
      const selector = where.agentId;
      const matches = rows.filter(row => typeof selector === "string" ? row.agentId === selector : selector.in.includes(row.agentId));
      return { _sum: { inputTokens: matches.reduce((total, row) => total + row.inputTokens, 0), outputTokens: 0 } };
    });
    await expect(checkReassessmentBudget(config)).rejects.toThrow(/exhausted/);
    expect(db.tokenUsage.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      agentId: { in: [...new Set([requestedId, "AGT-REVIEW", "reviewer"])] },
    }) }));
  });
  it("refuses malformed usage instead of treating an unavailable amount as zero", async () => {
    const config = await read();
    db.tokenUsage.aggregate.mockResolvedValue({ _sum: { inputTokens: -1, outputTokens: null } });
    await expect(checkReassessmentBudget(config)).rejects.toThrow(/usage/i);
  });
});
