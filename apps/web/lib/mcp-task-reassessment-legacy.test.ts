import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { currentUserContextFromRecord } from "./govern/current-user-context";
import { remoteTaskRequestDigest, remoteTaskRequestMatches } from "./mcp-task-capacity-contract";
import { parseDurableInferenceTaskMetadata } from "./mcp-task-durable-inference-contract";
import { reconstructPersistedRemoteTask, type PersistedRemoteTask } from "./mcp-task-persisted-request";
import { parseInitiativeReviewBinding } from "./mcp-task-review-contract";
import type { RemoteTaskSubmitParams } from "./mcp-task-submit-params";
import { ok } from "./shared/action-result";
import { isRecord } from "./shared/coerce";
import * as immutableReader from "./shared/immutable-review-reader";
import * as sourcePageLines from "./source-page-lines";

vi.mock("@dpf/db", () => ({ prisma: {} }));

// Exact, unedited published source from be62de7af3c35bbc69eea2861aaffd2875603cef.
// CI reads retained bytes, never Git history. Updating a fixture requires a new
// reviewed publication identity and digest; a hand-written old decoder is no proof.
const historicalSources = {
  review: { path: "../test-support/reassessment-legacy-review-contract-v1.txt",
    sha256: "79a2cdadc7a50623df29d8b7cf3d9f6713d072bddbdd6a4c89048ff1596dd73b" },
  persisted: { path: "../test-support/reassessment-legacy-persisted-request-v1.txt",
    sha256: "b9c91d159c01f5b31d79632f4b1b0deeff3e3aecafe093226a873bb72c9b4cf2" },
};
const publishedDigestOwnerSha256 = "d8030655237aa34499e6c055594d9c8ca6216027c611ffb36ae1d9ebaa1e945f";

function publishedModule<T>(source: { path: string; sha256: string }, ports: Record<string, unknown>): T {
  const filename = fileURLToPath(new URL(source.path, import.meta.url));
  const bytes = readFileSync(filename);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(source.sha256);
  const compiled = ts.transpileModule(bytes.toString("utf8"), {
    fileName: filename.replace(/\.txt$/, ".ts"), reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  expect(compiled.diagnostics?.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)).toEqual([]);
  const module = { exports: {} };
  // Only explicit pure owner ports exist. There is no process, fetch, filesystem,
  // database, dynamic import or general-purpose require in the historical module.
  new Script(compiled.outputText, { filename }).runInNewContext({
    module, exports: module.exports,
    require: (name: string) => {
      if (!Object.hasOwn(ports, name)) throw new Error(`Unapproved historical dependency: ${name}`);
      return ports[name];
    },
  }, { timeout: 1_000, contextCodeGeneration: { strings: false, wasm: false } });
  return module.exports as T;
}

function legacyOwners(matcher = remoteTaskRequestMatches) {
  const review = publishedModule<Pick<typeof import("./mcp-task-review-contract"), "parseInitiativeReviewBinding">>(
    historicalSources.review, {
      "./source-page-lines": sourcePageLines,
      "@/lib/tak/terminal-tool-policy": immutableReader,
    });
  const digestCheck = vi.fn(matcher);
  const persisted = publishedModule<Pick<typeof import("./mcp-task-persisted-request"), "reconstructPersistedRemoteTask">>(
    historicalSources.persisted, {
      "@dpf/db": { prisma: new Proxy({}, { get: () => { throw new Error("Historical proof must not access a database"); } }) },
      "./shared/coerce": { isRecord },
      "./govern/current-user-context": { currentUserContextFromRecord },
      "./shared/action-result": { ok },
      "./mcp-task-capacity-contract": { remoteTaskRequestMatches: digestCheck },
      "./mcp-task-durable-inference-contract": { parseDurableInferenceTaskMetadata },
      "./mcp-task-review-contract": review,
    });
  return { ...review, ...persisted, digestCheck };
}

function storedPacket(gate: "design-spec" | "spec-approval", present = true) {
  const artifactRef = { kind: "repo-blob-at-commit" as const, repositoryFullName: "fixture/repo",
    commitSha: "a".repeat(40), path: "docs/design.md", providerBlobId: "b".repeat(40) };
  const binding = parseInitiativeReviewBinding({ writerToolName: "record_initiative_design_review", itemId: "BI-285EF102", gate,
    expectedCurrentBaselineId: null,
    ...(present ? { presentReassessment: { schemaVersion: 1, authorizationItemId: "BI-7906C73E", baselineId: "baseline-fixture",
      policyDigest: "c".repeat(64), originalTaskRunId: "TR-fixture-original", originalRequestDigest: "d".repeat(64),
      predecessorTaskRunIds: ["TR-fixture-original"], authorityArtifact: artifactRef } } : {}),
    workroomRef: { kind: "workroom-head", workroomId: "WC-FIXTURE", repositoryFullName: artifactRef.repositoryFullName,
      branchName: "codex/fixture", headSha: artifactRef.commitSha }, artifactRef });
  if (!binding) throw new Error("Current decoder rejected the synthetic request fixture");
  const parsed: RemoteTaskSubmitParams = { agentId: "fixture-reviewer", routeContext: "/build", title: "Synthetic assessment",
    objective: "Review the exact synthetic artifact", prompt: "Read the immutable artifact, then record the assessment.",
    idempotencyKey: "synthetic-legacy-proof", riskClass: "bounded-write", threadId: null,
    collaborationKind: "handoff", authorityScope: ["backlog-item:BI-285EF102", "tool:read_source_at_version", "tool:record_initiative_design_review"],
    initiativeReviewBinding: binding };
  const row: PersistedRemoteTask = { id: "fixture-row", taskRunId: "TR-fixture-present", userId: "fixture-user", threadId: "fixture-thread",
    contextId: "fixture-context", status: "submitted", routeContext: parsed.routeContext, title: parsed.title, objective: parsed.objective,
    currentAgentId: parsed.agentId, authorityScope: parsed.authorityScope, progressPayload: null, updatedAt: new Date("2026-10-22T12:00:00.000Z"),
    a2aMetadata: { idempotencyKey: parsed.idempotencyKey, requestDigestVersion: 2, requestDigest: remoteTaskRequestDigest(parsed),
      riskClass: parsed.riskClass, apiTokenId: "fixture-token-row", tokenSource: "oauth", tokenCapability: "write", requestedAgentId: parsed.agentId,
      requestedThreadId: null, requestObjective: parsed.objective, collaborationKind: parsed.collaborationKind, initiativeReviewBinding: binding },
    messages: [{ parts: [{ type: "message", text: parsed.prompt }] }],
    user: { id: "fixture-user", isActive: true, isSuperuser: false, groups: [] } };
  return { parsed, row };
}

function continuationSentinels() {
  return { preparer: vi.fn(), qualificationGet: vi.fn(), inference: vi.fn() };
}
function continueOnlyAcceptedRequest(result: ReturnType<typeof reconstructPersistedRemoteTask>, effects: ReturnType<typeof continuationSentinels>) {
  if (result.ok) { effects.preparer(result.data); effects.qualificationGet(); effects.inference(); }
  return result;
}

describe("published old-worker request integrity", () => {
  it("uses the unchanged real published request-digest owner", () => {
    const source = readFileSync(new URL("./mcp-task-capacity-contract.ts", import.meta.url));
    expect(createHash("sha256").update(source).digest("hex")).toBe(publishedDigestOwnerSha256);
  });

  it.each(["design-spec", "spec-approval"] as const)("refuses a present %s request before preparation, qualification GET or inference", gate => {
    const legacy = legacyOwners(), { parsed, row } = storedPacket(gate), effects = continuationSentinels();
    const decoded = legacy.parseInitiativeReviewBinding(parsed.initiativeReviewBinding);
    expect(decoded).not.toBeNull();
    expect(decoded).not.toHaveProperty("presentReassessment");
    expect(decoded).toEqual((({ presentReassessment: _relation, ...oldBinding }) => oldBinding)(parsed.initiativeReviewBinding!));
    expect(remoteTaskRequestDigest({ ...parsed, initiativeReviewBinding: decoded! })).not.toBe(remoteTaskRequestDigest(parsed));

    const refusal = continueOnlyAcceptedRequest(legacy.reconstructPersistedRemoteTask(row), effects);
    expect(refusal).toEqual({ ok: false, code: "request_digest_mismatch",
      message: "Persisted remote task request does not match its immutable digest." });
    expect(legacy.digestCheck).toHaveBeenCalledOnce();
    expect(legacy.digestCheck.mock.results[0]!.value).toBe(false);
    for (const effect of Object.values(effects)) expect(effect).not.toHaveBeenCalled();

    // Positive control: the same stored bytes and digest survive the current
    // real decoder/reconstructor, without executing any continuation.
    const current = reconstructPersistedRemoteTask(row);
    expect(current.ok).toBe(true);
    if (!current.ok) throw new Error(current.message);
    expect(current.data.parsed).toEqual(parsed);
    expect(current.data.parsed.initiativeReviewBinding?.presentReassessment).toEqual(parsed.initiativeReviewBinding!.presentReassessment);
  });

  it("keeps an unchanged historical review reconstructable by both owners", () => {
    const legacy = legacyOwners(), { parsed, row } = storedPacket("design-spec", false);
    const old = legacy.reconstructPersistedRemoteTask(row), current = reconstructPersistedRemoteTask(row);
    expect(old.ok).toBe(true); expect(current.ok).toBe(true);
    if (!old.ok || !current.ok) throw new Error("Unchanged historical packet refused");
    expect(old.data.parsed).toEqual(parsed); expect(current.data.parsed).toEqual(parsed);
    expect(legacy.digestCheck.mock.results[0]!.value).toBe(true);
  });

  it("makes the refusal proof sensitive to a bypassed digest check", () => {
    // Mutation control only: the actual immutable old source runs unchanged;
    // replacing its integrity port with a false approval reaches every sentinel.
    const bypass = legacyOwners(() => true), { row } = storedPacket("design-spec"), effects = continuationSentinels();
    expect(continueOnlyAcceptedRequest(bypass.reconstructPersistedRemoteTask(row), effects).ok).toBe(true);
    for (const effect of Object.values(effects)) expect(effect).toHaveBeenCalledOnce();
  });
});
