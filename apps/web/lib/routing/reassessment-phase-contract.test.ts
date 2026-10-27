import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { describe, expect, it } from "vitest";
import { reassessmentBudgetFixture } from "../../test-support/reassessment-budget-fixture";
import { deriveReassessmentExecutionSealArtifactId, parseReassessmentExecutionSealV2, parseReassessmentRootLocatorV2,
  reassessmentQualificationPrefix, type ReassessmentExecutionSealV2 } from "./reassessment-phase-contract";

const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
function fixture(): ReassessmentExecutionSealV2 {
  const qualification = { schemaVersion: 1 as const, compositionVersion: "restricted-review-http-v1" as const,
    providerId: "fixture", providerConnectionId: "connection", providerConnectionVersion: "b".repeat(64), modelId: "model",
    executionPlan: { providerId: "fixture", providerConnectionId: "connection", providerConnectionVersion: "b".repeat(64),
      modelId: "model", accountAuthMethod: "none", executionChannel: "direct-api", recipeId: null, contractFamily: "review",
      executionAdapter: "chat", maxTokens: 100, providerSettings: {}, toolPolicy: { toolChoice: "required" as const }, responsePolicy: {} },
    providerConfigurationDigest: "c".repeat(64), toolSurfaceDigest: "d".repeat(64), budgetConfiguration: reassessmentBudgetFixture(),
    bounds: { maxProviderStarts: 3, maxDurationMs: 30_000, maxOutputTokens: 100 },
    nativeRuntime: { schemaVersion: 2 as const, catalogDigest: "e".repeat(64), observationDigest: "f".repeat(64),
      spendAwareBudgetClass: "balanced" as const, requestedBudgetClass: "quality_first" as const } };
  return { schemaVersion: 2, root: { schemaVersion: 2, manifestArtifactId: "ta-root", manifestDigest: "1".repeat(64) },
    taskRunId: "TR-fixture", userId: "user", agentId: "reviewer", requestDigest: "a".repeat(64),
    executionFence: { schemaVersion: 1, reservation: "reservation", dispatchClaim: "dispatch", authorityDigest: "2".repeat(64), requestDigest: "a".repeat(64) },
    binding: { writerToolName: "record_initiative_design_review", itemId: "BI-fixture", gate: "design-spec",
      expectedCurrentBaselineId: null, artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo", commitSha: "3".repeat(40), path: "design.md", providerBlobId: "4".repeat(40) } },
    qualificationPrefix: { eventCount: 4, digest: "5".repeat(64), providerReservations: 2, providerStarts: 2 },
    qualification: { ...qualification, qualificationDigest: hash(qualification) }, authorityDecisionId: "decision", sealedAt: "2026-10-22T00:00:00.000Z" };
}
function resign(seal: ReassessmentExecutionSealV2) {
  const { qualificationDigest: _, ...unsigned } = seal.qualification;
  seal.qualification.qualificationDigest = hash(unsigned);
}
function finiteFixture() {
  const seal = fixture(), budget = seal.qualification.budgetConfiguration;
  budget.registryLimits.perTaskTokenLimit = 500; budget.executionConfigLimits.perTaskTokenLimit = 800; budget.configuredPerTaskLimit = 500;
  const { configurationDigest: _, ...unsigned } = budget; budget.configurationDigest = hash(unsigned);
  seal.qualification.finiteTokenProof = { schemaVersion: 1, kind: "dmr-native-messages-v1", apiRoot: "http://fixture.invalid",
    runtimeVersion: "v1.2.8", modelDigest: "sha256:" + "6".repeat(64), engineIdentity: "llama.cpp", engineArtifactDigest: "sha256:" + "7".repeat(64),
    engineSourceCommit: "72874f5", templateDigest: "8".repeat(64), configDigest: "9".repeat(64) };
  resign(seal); return seal;
}

describe("phase contract V2", () => {
  it("accepts an exact root locator and qualification seal without conferring authority", () => {
    const seal = fixture();
    expect(parseReassessmentRootLocatorV2(seal.root)).toEqual(seal.root);
    expect(parseReassessmentExecutionSealV2(seal)).toEqual(seal);
  });
  it("parses finite-proof structure while refusing its omission without qualifying a live runtime", () => {
    const seal = finiteFixture(); expect(parseReassessmentExecutionSealV2(seal)).toEqual(seal);
    delete seal.qualification.finiteTokenProof; resign(seal);
    expect(parseReassessmentExecutionSealV2(seal)).toBeNull();
  });
  it.each([null, [], {}, { schemaVersion: 1, manifestArtifactId: "ta-root", manifestDigest: "1".repeat(64) },
    { schemaVersion: 2, manifestArtifactId: " ta-root", manifestDigest: "1".repeat(64) },
    { schemaVersion: 2, manifestArtifactId: "ta-root", manifestDigest: "sha256:" + "1".repeat(64) },
    { schemaVersion: 2, manifestArtifactId: "ta-root", manifestDigest: "A".repeat(64) },
    { schemaVersion: 2, manifestArtifactId: "ta-root", manifestDigest: "1".repeat(64), grant: true }])("refuses malformed or legacy root %j", value => {
    expect(parseReassessmentRootLocatorV2(value)).toBeNull();
  });
  it.each([
    ["legacy manifest", (s: any) => { s.schemaVersion = 1; }],
    ["extra authority key", (s: any) => { s.grants = ["*"]; }],
    ["blank identity", (s: any) => { s.taskRunId = " "; }],
    ["fence request mismatch", (s: any) => { s.executionFence.requestDigest = "6".repeat(64); }],
    ["extra fence key", (s: any) => { s.executionFence.generation = 1; }],
    ["invalid fence digest", (s: any) => { s.executionFence.authorityDigest = "sha256:" + "2".repeat(64); }],
    ["missing binding", (s: any) => { s.binding = null; }],
    ["negative prefix", (s: any) => { s.qualificationPrefix.eventCount = -1; }],
    ["unreserved start", (s: any) => { s.qualificationPrefix.providerStarts = 3; }],
    ["prefix exceeds events", (s: any) => { s.qualificationPrefix.eventCount = 1; }],
    ["unknown prefix field", (s: any) => { s.qualificationPrefix.closed = true; }],
    ["invalid decision", (s: any) => { s.authorityDecisionId = ""; }],
    ["invalid timestamp", (s: any) => { s.sealedAt = "tomorrow"; }],
  ])("refuses %s", (_label, mutate) => {
    const seal = fixture(); mutate(seal); expect(parseReassessmentExecutionSealV2(seal)).toBeNull();
  });
  it.each([
    ["model identity mismatch", (q: any) => { q.modelId = "changed"; }],
    ["unknown qualification key", (q: any) => { q.unsafe = true; }],
    ["plan provider mismatch", (q: any) => { q.executionPlan.providerId = "other"; }],
    ["plan connection mismatch", (q: any) => { q.executionPlan.providerConnectionId = "other"; }],
    ["plan version mismatch", (q: any) => { q.executionPlan.providerConnectionVersion = "6".repeat(64); }],
    ["CLI adapter", (q: any) => { q.executionPlan.executionAdapter = "codex-cli"; }],
    ["provider tools", (q: any) => { q.executionPlan.providerSettings.providerTools = []; }],
    ["output bound mismatch", (q: any) => { q.executionPlan.maxTokens = 101; }],
    ["extra bounds field", (q: any) => { q.bounds.unlimited = true; }],
    ["wrong budget owner", (q: any) => { q.budgetConfiguration.agentId = "other"; }],
    ["budget snapshot mismatch", (q: any) => { q.budgetConfiguration.configuredDailyLimit++; }],
    ["missing finite proof", (q: any) => { q.budgetConfiguration = reassessmentBudgetFixture({ configuredPerTaskLimit: 500 }); }],
    ["legacy token estimate", (q: any) => { q.finiteTokenProof = { schemaVersion: 1, estimatedTokens: 1 }; }],
    ["legacy qualification without native runtime", (q: any) => { delete q.nativeRuntime; }],
    ["native runtime version", (q: any) => { q.nativeRuntime.schemaVersion = 1; }],
    ["native catalog digest", (q: any) => { q.nativeRuntime.catalogDigest = "sha256:" + "e".repeat(64); }],
    ["unknown budget class", (q: any) => { q.nativeRuntime.spendAwareBudgetClass = "unlimited"; }],
    ["object budget class", (q: any) => { q.nativeRuntime.spendAwareBudgetClass = Object.create(null); }],
    ["unknown requested class", (q: any) => { q.nativeRuntime.requestedBudgetClass = "unlimited"; }],
    ["runtime extra key", (q: any) => { q.nativeRuntime.verified = true; }],
    ["non-JSON plan", (q: any) => { q.executionPlan.providerSettings = { fn: () => true }; }],
  ])("refuses qualified proof with %s even when resealed", (_label, mutate) => {
    const seal = fixture(); mutate(seal.qualification); resign(seal);
    expect(parseReassessmentExecutionSealV2(seal)).toBeNull();
  });
  it("refuses altered qualification bytes without a new qualification digest", () => {
    const seal = fixture(); seal.qualification.toolSurfaceDigest = "6".repeat(64);
    expect(parseReassessmentExecutionSealV2(seal)).toBeNull();
  });
  it("refuses accessors, non-enumerable fields, sparse arrays and cycles without executing accessors", () => {
    const seal = fixture(); let reads = 0;
    Object.defineProperty(seal, "root", { enumerable: true, get() { reads++; return {}; } });
    expect(parseReassessmentExecutionSealV2(seal)).toBeNull(); expect(reads).toBe(0);
    const hidden = fixture(); Object.defineProperty(hidden, "hidden", { value: true });
    expect(parseReassessmentExecutionSealV2(hidden)).toBeNull();
    const sparse = fixture(); sparse.qualification.executionPlan.providerSettings.tools = new Array(1);
    expect(parseReassessmentExecutionSealV2(sparse)).toBeNull();
    const cyclic = fixture(); cyclic.qualification.executionPlan.providerSettings.cycle = cyclic;
    expect(parseReassessmentExecutionSealV2(cyclic)).toBeNull();
  });
  it("derives one stable artifact identity from all three pinned root identities", () => {
    const input = { taskRunId: "TR-fixture", rootArtifactId: "ta-root", rootDigest: "1".repeat(64) };
    const expected = `ta-reassessment-execution-seal-${hash(input)}`;
    expect(deriveReassessmentExecutionSealArtifactId(input)).toBe(expected);
    expect(deriveReassessmentExecutionSealArtifactId({ rootDigest: input.rootDigest, rootArtifactId: input.rootArtifactId, taskRunId: input.taskRunId })).toBe(expected);
    for (const key of Object.keys(input) as (keyof typeof input)[]) {
      expect(deriveReassessmentExecutionSealArtifactId({ ...input, [key]: input[key] + "x" })).not.toBe(expected);
    }
  });
  it("binds the complete ordered qualification prefix without mutating observations", () => {
    const events = [{ event: { kind: "provider" as const, name: "native-messages", input: { operation: "configuration" },
      sequence: 1, providerReservationOrdinal: 1, observedAt: "2026-10-22T00:00:00.000Z" }, reservationId: "capture-1", output: { models: ["one"] } },
    { event: { kind: "tool" as const, name: "read", input: {}, sequence: 2, providerReservationOrdinal: null,
      observedAt: "2026-10-22T00:00:01.000Z" }, reservationId: "capture-2", output: "complete" }];
    const original = structuredClone(events);
    expect(reassessmentQualificationPrefix(events)).toEqual({ eventCount: 2, digest: hash(events), providerReservations: 1, providerStarts: 1 });
    expect(events).toEqual(original);
    expect(reassessmentQualificationPrefix([...events].reverse()).digest).not.toBe(hash(events));
    expect(reassessmentQualificationPrefix([])).toEqual({ eventCount: 0, digest: hash([]), providerReservations: 0, providerStarts: 0 });
  });
});
