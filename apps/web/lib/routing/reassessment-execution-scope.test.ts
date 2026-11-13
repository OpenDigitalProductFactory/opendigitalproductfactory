import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import type { ReassessmentQualificationPrefix } from "./reassessment-phase-contract";
import { REASSESSMENT_NATIVE_COMPOSITION, reassessmentNativeCatalogDigest } from "../shared/reassessment-native-composition";
import { reassessmentBudgetFixture } from "../../test-support/reassessment-budget-fixture";
import {
  runReassessmentQualification, currentReassessmentQualification, runReassessmentQualificationRequest,
  getReassessmentQualificationPrefix, promoteReassessmentExecution,
  currentFiniteReassessmentExecution,
  assertReassessmentActive, assertReassessmentPlan, assertReassessmentProposedToolCall,
  assertReassessmentToolCall, currentReassessmentExecution, runReassessmentEffect,
  runReassessmentExecution, validateReassessmentToolCalls, matchesPersistedReassessmentScope, reassessmentToolSurfaceDigest,
  withReassessmentTokenReservation, reassessmentTokenReservationFor,
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

function qualificationFixture() {
  const f = fixture(); const { qualification, ...identity } = f.seed;
  qualification.providerConnectionVersion = "9".repeat(64);
  Object.assign(qualification.executionPlan, { providerConnectionId: qualification.providerConnectionId,
    providerConnectionVersion: qualification.providerConnectionVersion, accountAuthMethod: "none", executionChannel: "direct-api" });
  const root = { ...identity, schemaVersion: 2 as const, phase: "qualification" as const,
    compatibility: { schemaVersion: 1 as const, configDigest: "sha256:" + "1".repeat(64), sourceSha: "2".repeat(40), sourceContentHash: "3".repeat(64), contractSha256: "4".repeat(64),
      owners: { transport: { version: 2, sourceSha256: "5".repeat(64) }, approval: { version: 2, sourceSha256: "6".repeat(64) },
        worker: { version: 2, sourceSha256: "7".repeat(64) }, writer: { version: 2, sourceSha256: "8".repeat(64) } } },
    budgetConfiguration: qualification.budgetConfiguration, bounds: { ...qualification.bounds, maxProviderStarts: 4 },
    nativeObservationUrls: ["http://dmr.invalid/version", "http://dmr.invalid/engines/status"] };
  const hooks = { open: vi.fn(async () => {}), close: vi.fn(async () => {}), uncertain: vi.fn(async () => {}),
    readExecutionSeal: vi.fn(async (_context: unknown, prefix: ReassessmentQualificationPrefix) => {
    const q = { ...qualification, bounds: root.bounds, nativeRuntime: { schemaVersion: 2 as const, catalogDigest: "4".repeat(64),
      observationDigest: prefix.digest, spendAwareBudgetClass: "balanced" as const } };
    q.qualificationDigest = createHash("sha256").update(canonicalJson(Object.fromEntries(Object.entries(q).filter(([key]) => key !== "qualificationDigest")))).digest("hex");
    return { schemaVersion: 2 as const, root: { schemaVersion: 2 as const, manifestArtifactId: root.manifest.artifactId, manifestDigest: root.manifest.digest },
      taskRunId: root.taskRunId, userId: root.userId, agentId: root.agentId, requestDigest: root.requestDigest, executionFence: root.executionFence,
      binding: root.binding, qualificationPrefix: prefix, qualification: q, authorityDecisionId: "server-authority", sealedAt: new Date().toISOString() };
  }), reserve: vi.fn(async (_context: unknown, event: import("./reassessment-execution-scope").ReassessmentCaptureEvent) => ({ reservationId: `capture-${event.sequence}` })),
  complete: vi.fn(async () => {}) };
  return { root, hooks };
}

describe("two-phase reassessment authority", () => {
  it.each(["missing-bound", "extra-bound", "changed-budget", "normalized-url", "old-owner", "extra-owner"])("refuses malformed Q %s before opening capture", async condition => {
    const { root, hooks } = qualificationFixture();
    if (condition === "missing-bound") delete (root.bounds as Partial<typeof root.bounds>).maxOutputTokens;
    if (condition === "extra-bound") Object.assign(root.bounds, { extra: 20 });
    if (condition === "changed-budget") root.budgetConfiguration.configuredPerTaskLimit = 999;
    if (condition === "normalized-url") root.nativeObservationUrls[0] = "http://dmr.invalid/../version";
    if (condition === "old-owner") root.compatibility.owners.writer.version = 1;
    if (condition === "extra-owner") Object.assign(root.compatibility.owners, { extra: { version: 2, sourceSha256: "9".repeat(64) } });
    await expect(runReassessmentQualification(root, hooks, async () => "never")).rejects.toThrow(/root-invalid|compatibility-unproven/i);
    expect(hooks.open).not.toHaveBeenCalled();
  });
  it("requires actual promotion and the audited catalog for finite activation", async () => {
    expect(currentFiniteReassessmentExecution()).toBeNull();
    const legacy = fixture();
    await runReassessmentExecution(legacy.seed, legacy.hooks, async () => { expect(currentFiniteReassessmentExecution()).toBeNull(); });
    const { root, hooks } = qualificationFixture(); const original = hooks.readExecutionSeal.getMockImplementation()!;
    hooks.readExecutionSeal.mockImplementation(async (context, prefix) => {
      const seal = await original(context, prefix); const q = seal.qualification; const c = REASSESSMENT_NATIVE_COMPOSITION;
      q.executionPlan.executionChannel = "local-runtime";
      q.nativeRuntime.catalogDigest = reassessmentNativeCatalogDigest();
      Object.assign(q, { finiteTokenProof: { schemaVersion: 1, kind: c.kind, apiRoot: "http://dmr.invalid", runtimeVersion: c.runtimeVersion,
        modelDigest: c.modelDigest, engineIdentity: `Running: llama.cpp ${c.engineBuild} (sha256:${c.engineArchiveDigest}) ${c.engineSourceCommit.slice(0, 7)}`,
        engineArtifactDigest: `sha256:${c.engineArchiveDigest}`, engineSourceCommit: "72874f5", templateDigest: c.templateDigest, configDigest: "a".repeat(64) } });
      const { qualificationDigest: _digest, ...unsigned } = q;
      q.qualificationDigest = createHash("sha256").update(canonicalJson(unsigned)).digest("hex"); return seal;
    });
    await runReassessmentQualification(root, hooks, async () => {
      expect(() => currentFiniteReassessmentExecution()).toThrow(/qualification/i);
      for (const url of root.nativeObservationUrls) await runReassessmentQualificationRequest({ method: "GET", url }, async () => ({}));
      await promoteReassessmentExecution(async () => {
        expect(currentReassessmentQualification()).toBeNull();
        expect(currentFiniteReassessmentExecution()?.taskRunId).toBe(root.taskRunId);
      });
    });
  });
  it("opens once and promotes without resetting starts, sequence or root", async () => {
    const { root, hooks } = qualificationFixture(); const io = vi.fn(async () => ({ complete: "bytes" }));
    await runReassessmentQualification(root, hooks, async () => {
      expect(currentReassessmentQualification()?.deadlineAt).toBe(root.deadlineAt);
      expect(() => currentReassessmentExecution()).toThrow(/qualification/i);
      for (const url of root.nativeObservationUrls) await runReassessmentQualificationRequest({ method: "GET", url }, io);
      expect(getReassessmentQualificationPrefix()).toMatchObject({ eventCount: 2, providerStarts: 2, providerReservations: 2 });
      await promoteReassessmentExecution(async () => {
        expect(currentReassessmentExecution()?.manifest).toEqual(root.manifest);
        expect(matchesPersistedReassessmentScope({ requestDigest: root.requestDigest, reassessmentExecution: { schemaVersion: 2,
          manifestArtifactId: root.manifest.artifactId, manifestDigest: root.manifest.digest } }, root.taskRunId)).toBe(true);
        await runReassessmentEffect({ kind: "provider", name: "generation", input: {} }, io);
      });
    });
    expect(io).toHaveBeenCalledTimes(3); expect(hooks.open).toHaveBeenCalledOnce(); expect(hooks.close).toHaveBeenCalledOnce();
    expect(hooks.reserve.mock.calls.map(call => call[1].sequence)).toEqual([1, 2, 3]);
    expect(hooks.close).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ providerStarts: 3, providerReservations: 3, closed: true }));
  });
  it.each(["tool", "provider", "wrong-url", "wrong-method", "out-of-order"])("refuses Q %s without I/O", async kind => {
    const { root, hooks } = qualificationFixture(); const io = vi.fn(async () => ({}));
    await runReassessmentQualification(root, hooks, async () => {
      const effect = kind === "tool" ? () => runReassessmentEffect({ kind: "tool", name: "read_source_at_version", input: {} }, io)
        : kind === "provider" ? () => runReassessmentEffect({ kind: "provider", name: "generation", input: {} }, io)
        : () => runReassessmentQualificationRequest({ method: kind === "wrong-method" ? "POST" as "GET" : "GET",
          url: kind === "out-of-order" ? root.nativeObservationUrls[1]! : "http://dmr.invalid/count_tokens" }, io);
      await expect(effect()).rejects.toThrow();
    });
    expect(io).not.toHaveBeenCalled(); expect(hooks.reserve).not.toHaveBeenCalled();
  });
  it("cannot promote an incomplete prefix", async () => {
    const { root, hooks } = qualificationFixture();
    await runReassessmentQualification(root, hooks, async () => {
      await expect(promoteReassessmentExecution(async () => "never")).rejects.toThrow(/prefix|observation/i);
    });
    expect(hooks.readExecutionSeal).not.toHaveBeenCalled();
  });
  it("refuses an old Q callback after seal", async () => {
    const { root, hooks } = qualificationFixture(); const io = vi.fn(async () => ({}));
    await runReassessmentQualification(root, hooks, async () => {
      let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
      const delayed = barrier.then(() => expect(runReassessmentQualificationRequest({ method: "GET", url: root.nativeObservationUrls[0]! }, io)).rejects.toThrow(/phase|sealed|qualification/i));
      for (const url of root.nativeObservationUrls) await runReassessmentQualificationRequest({ method: "GET", url }, io);
      await promoteReassessmentExecution(async () => { release(); await delayed; });
    });
    expect(io).toHaveBeenCalledTimes(2);
  });
  it("requires a server-read seal without reopening the root", async () => {
    const { root, hooks } = qualificationFixture(); const io = vi.fn(async () => ({})); hooks.readExecutionSeal.mockResolvedValue(null as never);
    await runReassessmentQualification(root, hooks, async () => {
      for (const url of root.nativeObservationUrls) await runReassessmentQualificationRequest({ method: "GET", url }, io);
      await expect(promoteReassessmentExecution(io)).rejects.toThrow(/seal/i);
    });
    expect(io).toHaveBeenCalledTimes(2); expect(hooks.open).toHaveBeenCalledOnce();
  });
});

function finiteFixture() {
  const f = fixture();
  f.seed.qualification.budgetConfiguration = reassessmentBudgetFixture({ configuredPerTaskLimit: 50_000 });
  f.seed.qualification.bounds.maxProviderStarts = 20;
  Object.assign(f.seed.qualification, { finiteTokenProof: { schemaVersion: 1, kind: "dmr-native-messages-v1", apiRoot: "http://dmr.invalid",
    runtimeVersion: "v1.2.8", modelDigest: "sha256:" + "5".repeat(64), engineIdentity: "llama.cpp",
    engineArtifactDigest: "sha256:" + "6".repeat(64), engineSourceCommit: "72874f5", templateDigest: "7".repeat(64), configDigest: "8".repeat(64) } });
  return f;
}
function finiteGeneration(bodyUtf8: string, inputTokens: number, io: () => Promise<unknown>, maxOutputTokens = 100) {
  return withReassessmentTokenReservation({ bodyUtf8, inputTokens, maxOutputTokens }, () => runReassessmentEffect({ kind: "provider", name: "native-messages",
    input: { operation: "generation", bodyUtf8, tokenReservation: reassessmentTokenReservationFor(bodyUtf8) } }, io));
}

describe("finite whole-generation token reservations", () => {
  it.each(["missing-proof", "runtime-version", "engine-artifact", "engine-commit", "credential-url", "extra-proof-key"])("refuses %s before any capture or provider start", async condition => {
    const { seed, hooks } = finiteFixture(); const proof = seed.qualification.finiteTokenProof!;
    if (condition === "missing-proof") delete seed.qualification.finiteTokenProof;
    if (condition === "runtime-version") Object.assign(proof, { runtimeVersion: "v1.2.9" });
    if (condition === "engine-artifact") proof.engineArtifactDigest = "unproven";
    if (condition === "engine-commit") Object.assign(proof, { engineSourceCommit: "other" });
    if (condition === "credential-url") proof.apiRoot = "http://credential@dmr.invalid";
    if (condition === "extra-proof-key") Object.assign(proof, { bypass: true });
    const io = vi.fn(async () => "never");
    await expect(runReassessmentExecution(seed, hooks, () => finiteGeneration("body", 1, io))).rejects.toMatchObject({ code: "reassessment-manifest-invalid" });
    expect(hooks.open).not.toHaveBeenCalled(); expect(io).not.toHaveBeenCalled();
  });
  it("admits two exact generations within 50K and retains every input plus maximum output charge", async () => {
    const { seed, hooks } = finiteFixture(); const io = vi.fn(async () => ({ usage: { outputTokens: 1 } }));
    await runReassessmentExecution(seed, hooks, async () => {
      await finiteGeneration('{"generation":1}', 24_900, io);
      await finiteGeneration('{"generation":2}', 24_900, io);
    });
    expect(io).toHaveBeenCalledTimes(2);
    expect(hooks.reserve).toHaveBeenCalledTimes(2);
    expect(hooks.close).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reservedTokens: 50_000, providerStarts: 2 }));
  });
  it("refuses cumulative overrun before capture or I/O even when prior actual output was smaller", async () => {
    const { seed, hooks } = finiteFixture(); const io = vi.fn(async () => ({ outputTokens: 0 }));
    await runReassessmentExecution(seed, hooks, async () => {
      await finiteGeneration("first", 24_900, io);
      await expect(finiteGeneration("second", 25_000, io)).rejects.toThrow(/token.*limit|allowance/i);
    });
    expect(io).toHaveBeenCalledOnce(); expect(hooks.reserve).toHaveBeenCalledOnce();
  });
  it("refuses an initially oversized whole generation before the callback, capture or provider I/O", async () => {
    const { seed, hooks } = finiteFixture(); const io = vi.fn(async () => "never");
    await runReassessmentExecution(seed, hooks, async () => {
      await expect(finiteGeneration("oversized", 49_901, io)).rejects.toMatchObject({ code: "reassessment-token-limit" });
    });
    expect(io).not.toHaveBeenCalled(); expect(hooks.reserve).not.toHaveBeenCalled();
  });
  it("charges before the callback and never replenishes an unused reservation", async () => {
    const { seed, hooks } = finiteFixture(); const callback = vi.fn(async () => "never");
    await runReassessmentExecution(seed, hooks, async () => {
      await withReassessmentTokenReservation({ bodyUtf8: "unused", inputTokens: 49_900, maxOutputTokens: 100 }, async () => "unused");
      await expect(withReassessmentTokenReservation({ bodyUtf8: "next", inputTokens: 0, maxOutputTokens: 100 }, callback)).rejects.toThrow(/token.*limit|allowance/i);
    });
    expect(callback).not.toHaveBeenCalled(); expect(hooks.reserve).not.toHaveBeenCalled();
  });
  it("accepts an authenticated zero-input count while reserving its complete output cap", async () => {
    const { seed, hooks } = finiteFixture(); const io = vi.fn(async () => "response");
    await runReassessmentExecution(seed, hooks, () => finiteGeneration("zero-input", 0, io));
    expect(io).toHaveBeenCalledOnce();
    expect(hooks.close).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reservedTokens: 100 }));
  });
  it("retains the full generation charge after post-start capture loss", async () => {
    const { seed, hooks } = finiteFixture(); const io = vi.fn(async () => "observed"); hooks.complete = vi.fn(async () => { throw Error("capture lost"); });
    await runReassessmentExecution(seed, hooks, async () => {
      await expect(finiteGeneration("first", 49_900, io)).rejects.toThrow(/capture/i);
      await expect(finiteGeneration("second", 0, io)).rejects.toThrow(/held/i);
    });
    expect(io).toHaveBeenCalledOnce();
    expect(hooks.close).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reservedTokens: 50_000, unknownEffects: 1, held: true }));
  });
  it.each(["changed-body", "duplicate-handoff", "forged-effect", "output-cap"])("refuses %s before capture or I/O", async condition => {
    const { seed, hooks } = finiteFixture(); const io = vi.fn(async () => "never");
    await runReassessmentExecution(seed, hooks, async () => {
      await expect(withReassessmentTokenReservation({ bodyUtf8: "bound", inputTokens: 10, maxOutputTokens: condition === "output-cap" ? 99 : 100 }, async () => {
        const tokenReservation = reassessmentTokenReservationFor(condition === "changed-body" ? "changed" : "bound");
        if (condition === "duplicate-handoff") reassessmentTokenReservationFor("bound");
        await runReassessmentEffect({ kind: "provider", name: "post", input: { operation: "generation", tokenReservation:
          condition === "forged-effect" ? { ...tokenReservation, inputTokens: 0, reservedTokens: 100 } : tokenReservation } }, io);
      })).rejects.toThrow(/reservation|token|bound|cap|handoff/i);
    });
    expect(io).not.toHaveBeenCalled(); expect(hooks.reserve).not.toHaveBeenCalled();
  });
  it("serializes in-memory whole-generation charges across parallel callbacks", async () => {
    const { seed, hooks } = finiteFixture(); const io = vi.fn(async () => "response");
    await runReassessmentExecution(seed, hooks, async () => {
      const results = await Promise.allSettled([finiteGeneration("first", 29_900, io), finiteGeneration("second", 29_900, io)]);
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(0);
    });
    // The refused second reservation holds the shared execution before either effect starts.
    expect(io).not.toHaveBeenCalled();
  });
  it("labels count/configuration operations without charging fictional generation tokens, while consuming provider starts", async () => {
    const { seed, hooks } = finiteFixture(); const io = vi.fn(async () => "evidence");
    await runReassessmentExecution(seed, hooks, async () => {
      for (const operation of ["configuration", "count"]) await runReassessmentEffect({ kind: "provider", name: operation, input: { operation } }, io);
      await expect(runReassessmentEffect({ kind: "provider", name: "unlabeled", input: {} }, io)).rejects.toThrow(/operation|reservation/i);
    });
    expect(io).toHaveBeenCalledTimes(2);
    expect(hooks.close).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ providerStarts: 2, reservedTokens: 0 }));
  });
});

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

  it("holds a started effect with undefined output instead of recording an observed success", async () => {
    const { seed, hooks } = fixture(), io = vi.fn(async () => undefined), later = vi.fn(async () => "forbidden");
    await runReassessmentExecution(seed, hooks, async () => {
      await expect(runReassessmentEffect({ kind: "provider", name: "post", input: {} }, io))
        .rejects.toMatchObject({ code: "reassessment-capture-incomplete" });
      await expect(runReassessmentEffect({ kind: "provider", name: "later", input: {} }, later)).rejects.toThrow(/held/i);
    });
    expect(io).toHaveBeenCalledOnce(); expect(later).not.toHaveBeenCalled(); expect(hooks.complete).not.toHaveBeenCalled();
    expect(hooks.uncertain).toHaveBeenCalledOnce();
    expect(hooks.close).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ providerStarts: 1, unknownEffects: 1, held: true }));
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
    const expired = fixture(), now = Date.now(), execute = vi.fn(async () => "never");
    expired.seed.startedAt = new Date(now - 40_000).toISOString();
    expired.seed.deadlineAt = new Date(now - 10_000).toISOString();
    await expect(runReassessmentExecution(expired.seed, expired.hooks, execute)).rejects.toMatchObject({ code: "reassessment-deadline-exhausted" });
    expect(execute).not.toHaveBeenCalled(); expect(expired.hooks.open).not.toHaveBeenCalled();
    expect(expired.hooks.reserve).not.toHaveBeenCalled();
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
