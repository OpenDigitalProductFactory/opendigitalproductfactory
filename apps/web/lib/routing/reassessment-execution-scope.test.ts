import { describe, expect, it, vi } from "vitest";
import { reassessmentBudgetFixture } from "../../test-support/reassessment-budget-fixture";
import {
  assertReassessmentActive, assertReassessmentPlan, assertReassessmentProposedToolCall,
  assertReassessmentToolCall, currentReassessmentExecution, runReassessmentEffect,
  runReassessmentExecution, validateReassessmentToolCalls, matchesPersistedReassessmentScope, reassessmentToolSurfaceDigest,
  type ReassessmentCaptureHooks, type ReassessmentExecutionSeed,
} from "./reassessment-execution-scope";

const tools = ["read_source_at_version", "record_initiative_design_review"].map(name => ({
  type: "function", function: { name, description: `Restricted ${name}`, parameters: {
    type: "object", properties: { cursor: { type: "string" } }, additionalProperties: false,
  } },
}));

function fixture() {
  const startedAt = new Date().toISOString();
  const seed: ReassessmentExecutionSeed = {
    schemaVersion: 1, taskRunId: "TR-RESTRICTED", userId: "user", agentId: "reviewer",
    requestDigest: "a".repeat(64), executionFence: { schemaVersion: 1, reservation: "reservation",
      dispatchClaim: "dispatch", authorityDigest: "b".repeat(64), requestDigest: "a".repeat(64) },
    binding: { itemId: "BI-FIXTURE", gate: "design-spec", writerToolName: "record_initiative_design_review",
      expectedCurrentBaselineId: null, artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo",
        commitSha: "c".repeat(40), path: "design.md", providerBlobId: "d".repeat(40) } },
    qualification: { schemaVersion: 1, compositionVersion: "restricted-review-http-v1", providerId: "local",
      providerConnectionId: "connection", providerConnectionVersion: "v1", modelId: "model",
      providerConfigurationDigest: "e".repeat(64), toolSurfaceDigest: reassessmentToolSurfaceDigest(tools), qualificationDigest: "1".repeat(64),
      executionPlan: { providerId: "local", modelId: "model", recipeId: null, contractFamily: "review", executionAdapter: "chat",
        maxTokens: 100, providerSettings: {}, toolPolicy: { toolChoice: "required" }, responsePolicy: {} },
      budgetConfiguration: reassessmentBudgetFixture(), bounds: { maxProviderStarts: 2, maxDurationMs: 30_000, maxOutputTokens: 100 } },
    startedAt, deadlineAt: new Date(Date.parse(startedAt) + 30_000).toISOString(),
    manifest: { artifactId: "ta-sealed", digest: "3".repeat(64) },
  };
  const hooks: ReassessmentCaptureHooks = {
    open: vi.fn(async () => {}), reserve: vi.fn(async (_context, event) => ({ reservationId: `capture-${event.sequence}` })),
    complete: vi.fn(async () => {}), uncertain: vi.fn(async () => {}), close: vi.fn(async () => {}),
  };
  return { seed, hooks };
}
const writer = { decision: "pass", reason: "Evidence checked.", findings: [], resolvedFindingRefs: [] };

describe("reassessment tool surface digest", () => {
  it("uses deterministic object keys without changing the complete ordered input", () => {
    const surface = structuredClone(tools);
    const snapshot = structuredClone(surface);
    const reorderedKeys = surface.map(tool => ({ function: { parameters: {
      additionalProperties: false, properties: { cursor: { type: "string" } }, type: "object",
    }, description: tool.function.description, name: tool.function.name }, type: tool.type }));
    const digest = reassessmentToolSurfaceDigest(surface);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(reassessmentToolSurfaceDigest(reorderedKeys)).toBe(digest);
    expect(reassessmentToolSurfaceDigest(surface)).toBe(digest);
    expect(surface).toEqual(snapshot);
  });

  it.each([undefined, Number.NaN, Infinity, () => "hidden", 1n, new Date()])("refuses a non-JSON schema value before hashing: %s", invalid => {
    expect(() => reassessmentToolSurfaceDigest([{ ...tools[0], invalid }])).toThrow(/losslessly serializable JSON/i);
  });

  it("refuses a cyclic schema before hashing", () => {
    const cyclic: unknown[] = []; cyclic.push(cyclic);
    expect(() => reassessmentToolSurfaceDigest(cyclic)).toThrow(/losslessly serializable JSON/i);
  });

  it.each([
    ["sparse array", () => Array(1)],
    ["symbol property", () => ({ [Symbol("hidden")]: "lost" })],
    ["nonenumerable property", () => Object.defineProperty({}, "hidden", { value: "lost" })],
    ["extra array property", () => Object.assign([], { hidden: "lost" })],
  ] as const)("refuses a schema containing a %s instead of silently discarding it", (_name, invalid) => {
    expect(() => reassessmentToolSurfaceDigest([{ ...tools[0], invalid: invalid() }])).toThrow(/losslessly serializable JSON/i);
  });

  it("refuses an accessor without evaluating it while hashing", () => {
    const getter = vi.fn(() => "mutable");
    const invalid = Object.defineProperty({}, "value", { enumerable: true, get: getter });
    expect(() => reassessmentToolSurfaceDigest([{ ...tools[0], invalid }])).toThrow(/losslessly serializable JSON/i);
    expect(getter).not.toHaveBeenCalled();
  });
});

describe("restricted reassessment execution capture", () => {
  it("captures full provider, reader and genuine writer effects before exposing their results", async () => {
    const { seed, hooks } = fixture();
    const order: string[] = [];
    hooks.reserve = vi.fn(async (_context, event) => { order.push(`reserved:${event.name}`); return { reservationId: `r-${event.sequence}` }; });
    hooks.complete = vi.fn(async (_context, event, _reservation, output) => { order.push(`captured:${event.name}`); expect(output).toBeDefined(); });
    const result = await runReassessmentExecution(seed, hooks, async () => {
      await runReassessmentEffect({ kind: "provider", name: "http-post", input: { messages: ["full prompt"] } }, async () => { order.push("io:http-post"); return { full: "provider response" }; });
      const reader = assertReassessmentToolCall({ toolName: "read_source_at_version", params: { maxLines: 20 },
        userId: seed.userId, agentId: seed.agentId, taskRunId: seed.taskRunId, executionFence: seed.executionFence });
      expect(reader).toMatchObject({ repositoryFullName: "owner/repo", path: "design.md", expectedBlobId: "d".repeat(40) });
      await runReassessmentEffect({ kind: "tool", name: "read_source_at_version", input: reader }, async () => { order.push("io:read_source_at_version"); return { content: "entire page" }; });
      assertReassessmentToolCall({ toolName: seed.binding.writerToolName, params: writer,
        userId: seed.userId, agentId: seed.agentId, taskRunId: seed.taskRunId, executionFence: seed.executionFence });
      return runReassessmentEffect({ kind: "tool", name: seed.binding.writerToolName, input: writer }, async () => { order.push(`io:${seed.binding.writerToolName}`); return { success: true, receiptId: "real-domain-receipt" }; });
    });
    expect(result).toEqual({ success: true, receiptId: "real-domain-receipt" });
    expect(order).toEqual(["reserved:http-post", "io:http-post", "captured:http-post", "reserved:read_source_at_version", "io:read_source_at_version", "captured:read_source_at_version", `reserved:${seed.binding.writerToolName}`, `io:${seed.binding.writerToolName}`, `captured:${seed.binding.writerToolName}`]);
    expect(hooks.open).toHaveBeenCalledOnce();
    expect(hooks.close).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ providerStarts: 1, unknownEffects: 0 }));
    expect(currentReassessmentExecution()).toBeNull();
  });

  it.each(["run_shell", "tools/list", "tasks/call", "get_backlog_item", "read_build_artifact_revision"])("refuses %s before lookup", async toolName => {
    const { seed, hooks } = fixture(); const lookup = vi.fn();
    await runReassessmentExecution(seed, hooks, async () => {
      expect(() => { assertReassessmentProposedToolCall({ toolName, params: {} }); lookup(); }).toThrow(/tool/i);
    });
    expect(lookup).not.toHaveBeenCalled();
    expect(hooks.reserve).not.toHaveBeenCalled();
  });

  it("rejects changed reader identity, pagination, writer identity and captured actor/generation", async () => {
    for (const params of [{ version: "changed" }, { maxLines: 0 }, { run_shell: "hidden" }]) {
      const { seed, hooks } = fixture();
      await runReassessmentExecution(seed, hooks, async () => {
        expect(() => assertReassessmentProposedToolCall({ toolName: "read_source_at_version", params })).toThrow();
      });
    }
    const writerFixture = fixture();
    await runReassessmentExecution(writerFixture.seed, writerFixture.hooks, async () => {
      expect(() => assertReassessmentProposedToolCall({ toolName: writerFixture.seed.binding.writerToolName, params: { ...writer, itemId: "BI-OTHER" } })).toThrow(/binding/i);
    });
    for (const identity of ["user", "agent", "task", "generation"]) {
      const { seed, hooks } = fixture();
      const changed = identity === "user" ? { userId: "other" } : identity === "agent" ? { agentId: "other" }
        : identity === "task" ? { taskRunId: undefined } : { executionFence: { ...seed.executionFence, dispatchClaim: "new" } };
      await runReassessmentExecution(seed, hooks, async () => {
        expect(() => assertReassessmentToolCall({ toolName: seed.binding.writerToolName, params: writer,
          userId: seed.userId, agentId: seed.agentId, taskRunId: seed.taskRunId, executionFence: seed.executionFence, ...changed })).toThrow(/captured actor/i);
      });
    }
  });

  it.each(["providerId", "_meta", "shell", "nestedTool", "operation"])("rejects undeclared canonical writer argument %s before lookup and holds later IO", async key => {
    const { seed, hooks } = fixture(); const lookup = vi.fn(); const io = vi.fn(async () => "forbidden");
    await runReassessmentExecution(seed, hooks, async () => {
      expect(() => { assertReassessmentProposedToolCall({ toolName: seed.binding.writerToolName, params: { ...writer, [key]: "undeclared" } }); lookup(); }).toThrow();
      await expect(runReassessmentEffect({ kind: "provider", name: "post", input: {} }, io)).rejects.toThrow();
    });
    expect(lookup).not.toHaveBeenCalled(); expect(io).not.toHaveBeenCalled();
  });

  it("fails before any IO if a sealed manifest or pre-effect reservation cannot be captured", async () => {
    const io = vi.fn(async () => "must not run");
    for (const failing of ["open", "reserve"] as const) {
      const { seed, hooks } = fixture(); hooks[failing] = vi.fn(async () => { throw new Error("capture offline"); }) as never;
      await expect(runReassessmentExecution(seed, hooks, () => runReassessmentEffect({ kind: "provider", name: "post", input: {} }, io))).rejects.toThrow(/capture/i);
    }
    expect(io).not.toHaveBeenCalled();
  });

  it("holds all future IO after post-start capture loss and retains real committed evidence", async () => {
    const { seed, hooks } = fixture(); let durableReceipt: string | null = null;
    hooks.complete = vi.fn(async () => { throw new Error("capture offline"); });
    const later = vi.fn(async () => "forbidden");
    await runReassessmentExecution(seed, hooks, async () => {
      await expect(runReassessmentEffect({ kind: "tool", name: seed.binding.writerToolName, input: writer }, async () => {
        durableReceipt = "domain-committed"; return { receiptId: durableReceipt };
      })).rejects.toThrow(/capture/i);
      expect(durableReceipt).toBe("domain-committed");
      await expect(runReassessmentEffect({ kind: "provider", name: "post", input: {} }, later)).rejects.toThrow();
    });
    expect(later).not.toHaveBeenCalled();
    expect(hooks.uncertain).toHaveBeenCalledOnce();
    expect(hooks.close).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ unknownEffects: 1, held: true }));
  });

  it("counts actual transport retries against the same immutable start ceiling", async () => {
    const { seed, hooks } = fixture(); const io = vi.fn(async () => "response");
    await runReassessmentExecution(seed, hooks, async () => {
      await runReassessmentEffect({ kind: "provider", name: "post", input: {} }, io);
      await runReassessmentEffect({ kind: "provider", name: "post", input: {} }, io);
      await expect(runReassessmentEffect({ kind: "provider", name: "post", input: {} }, io)).rejects.toThrow(/allowance/i);
    });
    expect(io).toHaveBeenCalledTimes(2);
  });

  it("freezes the admitted configuration and refuses expired deadlines without resetting its window", async () => {
    const { seed, hooks } = fixture();
    await runReassessmentExecution(seed, hooks, async () => {
      const context = currentReassessmentExecution()!;
      expect(Object.isFrozen(context.qualification.bounds)).toBe(true);
      seed.qualification.bounds.maxProviderStarts = 100;
      expect(context.qualification.bounds.maxProviderStarts).toBe(2);
    });
    const expired = fixture(); expired.seed.startedAt = new Date(Date.now() - 40_000).toISOString();
    expired.seed.deadlineAt = new Date(Date.now() - 10_000).toISOString();
    await expect(runReassessmentExecution(expired.seed, expired.hooks, async () => "never")).rejects.toThrow(/deadline/i);
  });

  it("closes inherited async descendants once the owning execution returns", async () => {
    const { seed, hooks } = fixture(); let release!: () => void; let late!: Promise<unknown>;
    const released = new Promise<void>(resolve => { release = resolve; }); const io = vi.fn(async () => "late");
    await runReassessmentExecution(seed, hooks, async () => { late = released.then(() => runReassessmentEffect({ kind: "provider", name: "post", input: {} }, io)); });
    release(); await expect(late).rejects.toThrow(/closed/i); expect(io).not.toHaveBeenCalled();
  });

  it("validates the selected full plan and every structured proposed call before the loop", async () => {
    const { seed, hooks } = fixture();
    await runReassessmentExecution(seed, hooks, async () => {
      const plan = seed.qualification.executionPlan;
      expect(assertReassessmentPlan({ providerId: "local", modelId: "model", plan, tools })).toBeTruthy();
      validateReassessmentToolCalls([{ name: "read_source_at_version", arguments: { maxLines: 10 } }]);
    });
    for (const condition of ["native-plan", "extra-built-in", "returned-shell", "returned-changed-reader"]) {
      const f = fixture();
      await runReassessmentExecution(f.seed, f.hooks, async () => {
        const plan = f.seed.qualification.executionPlan;
        if (condition === "native-plan") expect(() => assertReassessmentPlan({ providerId: "local", modelId: "model", plan: { ...plan, executionAdapter: "codex-cli" }, tools })).toThrow(/composition/i);
        if (condition === "extra-built-in") expect(() => assertReassessmentPlan({ providerId: "local", modelId: "model", plan, tools: [...tools, { type: "web_search" }] })).toThrow(/function tools/i);
        if (condition === "returned-shell") expect(() => validateReassessmentToolCalls([{ function: { name: "run_shell", arguments: "{}" } }])).toThrow(/tool/i);
        if (condition === "returned-changed-reader") expect(() => validateReassessmentToolCalls([{ function: { name: "read_source_at_version", arguments: '{"path":"other.md"}' } }])).toThrow(/path/i);
      });
    }
  });

  it.each(["schema", "description", "order"])("rejects a changed %s with the same two tool names before any effect starts", async change => {
    const { seed, hooks } = fixture();
    const changed = structuredClone(tools);
    if (change === "schema") changed[0]!.function.parameters.properties.cursor.type = "number";
    if (change === "description") changed[0]!.function.description = "A different instruction";
    if (change === "order") changed.reverse();
    const io = vi.fn(async () => "forbidden");
    await runReassessmentExecution(seed, hooks, async () => {
      expect(() => assertReassessmentPlan({ providerId: "local", modelId: "model", plan: seed.qualification.executionPlan, tools: changed })).toThrow(/surface/i);
      await expect(runReassessmentEffect({ kind: "provider", name: "post", input: {} }, io)).rejects.toThrow(/held/i);
    });
    expect(io).not.toHaveBeenCalled(); expect(hooks.reserve).not.toHaveBeenCalled();
    expect(hooks.close).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ providerStarts: 0, held: true }));
  });

  it("never persists auth secrets or silently truncates an unserializable capture", async () => {
    const { seed, hooks } = fixture(); const io = vi.fn(async () => "never");
    await runReassessmentExecution(seed, hooks, async () => {
      await expect(runReassessmentEffect({ kind: "provider", name: "post", input: { headers: { Authorization: "secret" } } }, io)).rejects.toThrow(/capture/i);
    });
    expect(io).not.toHaveBeenCalled(); expect(hooks.reserve).not.toHaveBeenCalled();
  });

  it("leaves ordinary unscoped execution unchanged", async () => {
    expect(currentReassessmentExecution()).toBeNull(); expect(assertReassessmentActive()).toBeNull();
    expect(assertReassessmentPlan({ providerId: "ordinary", modelId: "ordinary", plan: fixture().seed.qualification.executionPlan,
      tools: [{ type: "web_search" }] })).toBeNull();
    expect(await runReassessmentEffect({ kind: "provider", name: "ordinary", input: {} }, async () => "ordinary-result")).toBe("ordinary-result");
  });

  it("allows marked task callbacks only inside their exact active sealed scope", async () => {
    const { seed, hooks } = fixture();
    const metadata = { requestDigest: seed.requestDigest, reassessmentExecution: {
      schemaVersion: 1, manifestArtifactId: seed.manifest.artifactId, manifestDigest: seed.manifest.digest,
    } };
    expect(matchesPersistedReassessmentScope({}, seed.taskRunId)).toBe(true);
    expect(matchesPersistedReassessmentScope(metadata, seed.taskRunId)).toBe(false);
    await runReassessmentExecution(seed, hooks, async () => {
      expect(matchesPersistedReassessmentScope(metadata, seed.taskRunId)).toBe(true);
      expect(matchesPersistedReassessmentScope(metadata, "TR-OTHER")).toBe(false);
      expect(matchesPersistedReassessmentScope({ ...metadata, requestDigest: "0".repeat(64) }, seed.taskRunId)).toBe(false);
      expect(matchesPersistedReassessmentScope({ reassessmentExecution: { ...metadata.reassessmentExecution, manifestArtifactId: "other" } }, seed.taskRunId)).toBe(false);
      expect(matchesPersistedReassessmentScope({ reassessmentExecution: null }, seed.taskRunId)).toBe(false);
      try { assertReassessmentProposedToolCall({ toolName: "run_shell", params: {} }); } catch { /* Held scope. */ }
      expect(matchesPersistedReassessmentScope(metadata, seed.taskRunId)).toBe(false);
    });
    expect(matchesPersistedReassessmentScope(metadata, seed.taskRunId)).toBe(false);
  });
});
