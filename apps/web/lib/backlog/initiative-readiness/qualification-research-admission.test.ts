import { describe, expect, it } from "vitest";

import {
  advanceQualificationExperimentState,
  parseQualificationExperimentBinding,
  createQualificationExperimentAdmission,
  qualificationBindingDigest,
  qualificationExecutionEvidenceAllowed,
  qualificationToolEffectAllowed,
  issueQualificationExperimentState,
  verifyQualificationExperimentAdmission,
  validateQualificationExperimentAdmission,
} from "./qualification-research-admission";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const BLOB = "c".repeat(40);
const NOW = new Date("2026-01-28T20:00:00.000Z");

const binding = {
  schemaVersion: 1,
  phase: "prepare",
  itemId: "BI-B3DEC077",
  workroomId: "WC-7036EB63",
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  baseSha: SHA_A,
  headSha: SHA_B,
  protocol: {
    path: "docs/superpowers/specs/diagnostic.md",
    commitSha: SHA_B,
    providerBlobId: BLOB,
  },
  installationId: "install-dev",
  accountablePrincipalRef: "principal:owner",
  protocolReviewReceiptId: "review-protocol-1",
  shapeKey: "delivery-small-fix",
  shapeVersion: "1.0.0",
  stageKey: "qualification-research",
  policyVersion: 1,
  targetProductionBlobIds: ["d".repeat(40)],
  permittedTools: ["read_source_at_version", "write_sandbox_file", "record_workroom_evidence"],
  allowedPaths: ["apps/web/lib/example.test.ts", "apps/web/lib/example.test-helper.ts"],
  issuedAt: "2026-01-28T19:55:00.000Z",
  expiresAt: "2026-01-28T20:25:00.000Z",
  maxStarts: 1,
  maxDurationMs: 600_000,
} as const;

const context = {
  itemId: binding.itemId,
  workroomId: binding.workroomId,
  repositoryFullName: binding.repositoryFullName,
  baseSha: binding.baseSha,
  headSha: binding.headSha,
  protocol: binding.protocol,
  installationId: binding.installationId,
  accountablePrincipalRef: binding.accountablePrincipalRef,
  protocolReviewReceiptId: binding.protocolReviewReceiptId,
  startCount: 0,
  now: NOW,
};

describe("qualification research admission", () => {
  it("admits one exact bounded preparation without turning it into research PASS", () => {
    const parsed = parseQualificationExperimentBinding(binding);
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) throw new Error(parsed.error);
    expect(validateQualificationExperimentAdmission(parsed.data, context)).toEqual({
      ok: true,
      data: {
        binding: parsed.data,
        researchSatisfied: false,
        ordinaryImplementationAuthorized: false,
      },
    });
  });

  it.each([
    ["item", { itemId: "BI-OTHER" }],
    ["workroom", { workroomId: "WC-OTHER" }],
    ["repository", { repositoryFullName: "other/repo" }],
    ["base", { baseSha: "d".repeat(40) }],
    ["head", { headSha: "d".repeat(40) }],
    ["protocol path", { protocol: { ...binding.protocol, path: "other.md" } }],
    ["protocol blob", { protocol: { ...binding.protocol, providerBlobId: "d".repeat(40) } }],
    ["installation", { installationId: "install-prod" }],
    ["owner", { accountablePrincipalRef: "principal:other" }],
    ["protocol review", { protocolReviewReceiptId: "review-protocol-2" }],
    ["duplicate start", { startCount: 1 }],
    ["expiry", { now: new Date("2026-01-28T20:25:00.001Z") }],
  ])("fails closed when %s changes", (_name, change) => {
    const parsed = parseQualificationExperimentBinding(binding);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(validateQualificationExperimentAdmission(parsed.data, { ...context, ...change })).toMatchObject({ ok: false });
  });

  it("requires a separately reviewed candidate for final verification", () => {
    const parsed = parseQualificationExperimentBinding({ ...binding, phase: "verify" });
    expect(parsed).toMatchObject({ ok: false, error: expect.stringMatching(/binding/i) });

    const verified = parseQualificationExperimentBinding({
      ...binding,
      phase: "verify",
      headSha: "d".repeat(40),
      permittedTools: ["read_source_at_version", "run_sandbox_tests", "record_workroom_evidence"],
      candidate: {
        headSha: "d".repeat(40),
        diffDigest: `sha256:${"e".repeat(64)}`,
        testBlobIds: ["f".repeat(40)],
        productionBytesUnchanged: true,
        reviewReceiptId: "review-1",
      },
    });
    expect(verified).toMatchObject({ ok: true });
  });

  it("keeps preparation authoring-only and verification execution-only", () => {
    expect(parseQualificationExperimentBinding({ ...binding,
      permittedTools: [...binding.permittedTools, "run_sandbox_tests"] })).toMatchObject({ ok: false });
    expect(parseQualificationExperimentBinding({ ...binding, phase: "verify", headSha: "d".repeat(40),
      permittedTools: ["write_sandbox_file", "run_sandbox_tests", "record_workroom_evidence"],
      candidate: { headSha: "d".repeat(40), diffDigest: `sha256:${"e".repeat(64)}`,
        testBlobIds: ["f".repeat(40)], productionBytesUnchanged: true, reviewReceiptId: "review-1" } }))
      .toMatchObject({ ok: false });
  });

  it("rejects caller widening and malformed bounds", () => {
    expect(parseQualificationExperimentBinding({ ...binding, permittedTools: [...binding.permittedTools, "deploy_feature"] }))
      .toMatchObject({ ok: false });
    expect(parseQualificationExperimentBinding({ ...binding, maxStarts: 2 })).toMatchObject({ ok: false });
    expect(parseQualificationExperimentBinding({ ...binding, allowedPaths: ["apps/web/lib/production.ts"] }))
      .toMatchObject({ ok: false });
  });

  it("signs the exact server-owned binding and rejects tampering or expiry", () => {
    const parsed = parseQualificationExperimentBinding(binding);
    if (!parsed.ok) throw new Error(parsed.error);
    const token = createQualificationExperimentAdmission(parsed.data, { secret: "test-secret" });
    expect(verifyQualificationExperimentAdmission(token, { secret: "test-secret", now: NOW })).toEqual({
      ok: true,
      data: {
        schemaVersion: 1,
        purpose: "qualification-research-admission",
        binding: parsed.data,
        bindingDigest: qualificationBindingDigest(parsed.data),
      },
    });
    expect(verifyQualificationExperimentAdmission(`${token}x`, { secret: "test-secret", now: NOW })).toMatchObject({ ok: false });
    expect(verifyQualificationExperimentAdmission(token, { secret: "test-secret", now: new Date(binding.expiresAt) }))
      .toMatchObject({ ok: false });
  });

  it("enforces exact test/helper paths and the start-duration bound", () => {
    const parsed = parseQualificationExperimentBinding(binding);
    if (!parsed.ok) throw new Error(parsed.error);
    const state = { schemaVersion: 1 as const, status: "started" as const, token: "opaque.signed",
      bindingDigest: qualificationBindingDigest(parsed.data), startCount: 1 as const,
      issuedAt: binding.issuedAt, startedAt: NOW.toISOString(), taskId: "task-1" };
    expect(qualificationToolEffectAllowed({ binding: parsed.data, state, toolName: "write_sandbox_file",
      params: { path: binding.allowedPaths[0] }, now: NOW })).toBe(true);
    expect(qualificationToolEffectAllowed({ binding: parsed.data, state, toolName: "edit_sandbox_file",
      params: { path: "apps/web/lib/production.ts" }, now: NOW })).toBe(false);
    expect(qualificationToolEffectAllowed({ binding: parsed.data, state, toolName: "write_sandbox_file",
      params: { path: "apps/web/lib/other.test-helper.ts" }, now: NOW })).toBe(false);
    expect(qualificationToolEffectAllowed({ binding: parsed.data, state, toolName: "record_workroom_evidence",
      params: { capsuleId: binding.workroomId, stageKey: binding.stageKey, outcome: "completed", summary: "candidate",
        result: { qualificationBindingDigest: qualificationBindingDigest(parsed.data), qualificationOutcome: "positive" } },
      now: NOW })).toBe(false);
  });

  it("refuses sandbox verification until the executor proves exact build and test identity", () => {
    const parsed = parseQualificationExperimentBinding({ ...binding, phase: "verify", headSha: "d".repeat(40),
      permittedTools: ["read_source_at_version", "run_sandbox_tests", "record_workroom_evidence"],
      candidate: { headSha: "d".repeat(40), diffDigest: `sha256:${"e".repeat(64)}`,
        testBlobIds: ["f".repeat(40)], productionBytesUnchanged: true, reviewReceiptId: "review-1" } });
    if (!parsed.ok) throw new Error(parsed.error);
    const state = { schemaVersion: 1 as const, status: "started" as const, token: "opaque.signed",
      bindingDigest: qualificationBindingDigest(parsed.data), startCount: 1 as const,
      issuedAt: binding.issuedAt, startedAt: NOW.toISOString(), taskId: "task-verify" };
    expect(qualificationToolEffectAllowed({ binding: parsed.data, state, toolName: "run_sandbox_tests",
      params: { auto_fix: true }, now: NOW })).toBe(false);
    expect(qualificationToolEffectAllowed({ binding: parsed.data, state, toolName: "run_sandbox_tests",
      params: { auto_fix: false }, now: NOW })).toBe(false);
    const evidence = { capsuleId: binding.workroomId, stageKey: binding.stageKey, outcome: "completed",
      summary: "Observed the bounded result", result: { qualificationBindingDigest: qualificationBindingDigest(parsed.data),
        qualificationOutcome: "positive", command: "run_sandbox_tests", outputDigest: `sha256:${"2".repeat(64)}`,
        executorMode: "sandbox-build", requiredPlatform: "linux", headSha: "d".repeat(40),
        testBlobIds: ["f".repeat(40)],
        taskRunId: "TR-QUAL", toolExecutionReceiptIds: ["receipt-1"],
        startedAt: NOW.toISOString(), completedAt: new Date(NOW.getTime() + 1_000).toISOString() } };
    expect(qualificationToolEffectAllowed({ binding: parsed.data, state, toolName: "record_workroom_evidence",
      params: evidence, now: NOW })).toBe(false);
    expect(qualificationToolEffectAllowed({ binding: parsed.data, state, toolName: "record_workroom_evidence",
      params: { ...evidence, result: { ...evidence.result, outputDigest: undefined } }, now: NOW })).toBe(false);
  });

  it("rejects perfectly matching host metadata when no executor-attested run exists", () => {
    const parsed = parseQualificationExperimentBinding({ ...binding, phase: "verify", headSha: "d".repeat(40),
      executorMode: "workroom-host", requiredPlatform: "win32",
      permittedTools: ["read_source_at_version", "record_execution_evidence", "record_workroom_evidence"],
      candidate: { headSha: "d".repeat(40), diffDigest: `sha256:${"e".repeat(64)}`,
        testBlobIds: ["f".repeat(40)], productionBytesUnchanged: true, reviewReceiptId: "review-1" } });
    if (!parsed.ok) throw new Error(parsed.error);
    const state = { schemaVersion: 1 as const, status: "started" as const, token: "opaque.signed",
      bindingDigest: qualificationBindingDigest(parsed.data), startCount: 1 as const,
      issuedAt: binding.issuedAt, startedAt: NOW.toISOString(), taskId: `workroom-host:${binding.workroomId}` };
    const evidence = { workroomId: binding.workroomId,
      qualificationBindingDigest: qualificationBindingDigest(parsed.data), executorMode: "workroom-host",
      platform: "win32", headSha: "d".repeat(40), testBlobIds: ["f".repeat(40)],
      command: "pnpm exec vitest run scripts/lib/local-ci-gate-state.test.mjs",
      outputDigest: `sha256:${"2".repeat(64)}`, startedAt: NOW.toISOString(),
      completedAt: new Date(NOW.getTime() + 1_000).toISOString(), exitCode: 0, skipped: false };
    const allowed = (change: Record<string, unknown> = {}, principal: string = binding.accountablePrincipalRef) =>
      qualificationExecutionEvidenceAllowed({ binding: parsed.data, state,
        evidence: { ...evidence, ...change }, accountablePrincipalRef: principal,
        now: new Date(NOW.getTime() + 2_000) });

    expect(allowed()).toBe(false);
    expect(allowed({ platform: "linux" })).toBe(false);
    expect(allowed({ skipped: true })).toBe(false);
    expect(allowed({ headSha: "9".repeat(40) })).toBe(false);
    expect(allowed({ testBlobIds: ["8".repeat(40)] })).toBe(false);
    expect(allowed({}, "principal:other")).toBe(false);
    expect(allowed({ completedAt: new Date(NOW.getTime() + parsed.data.maxDurationMs + 1).toISOString() })).toBe(false);
  });

  it.each(["started", "settled"] as const)("never rearms a %s admission from the same signed token", (status) => {
    const parsed = parseQualificationExperimentBinding(binding);
    if (!parsed.ok) throw new Error(parsed.error);
    const token = createQualificationExperimentAdmission(parsed.data, { secret: "test-secret" });
    const existing = { schemaVersion: 1 as const, status, token, bindingDigest: qualificationBindingDigest(parsed.data),
      startCount: 1 as const, issuedAt: binding.issuedAt, startedAt: NOW.toISOString(), taskId: "task-1",
      ...(status === "settled" ? { evidenceId: "evidence-1" } : {}) };
    expect(issueQualificationExperimentState({ existing, token, binding: parsed.data })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/cannot be rearmed/i),
    });
  });

  it("advances only when immutable protocol review and scope constraints are unchanged", () => {
    const prepare = parseQualificationExperimentBinding(binding);
    const verify = parseQualificationExperimentBinding({ ...binding, phase: "verify", headSha: "d".repeat(40),
      permittedTools: ["read_source_at_version", "run_sandbox_tests", "record_workroom_evidence"],
      candidate: { headSha: "d".repeat(40), diffDigest: `sha256:${"e".repeat(64)}`,
        testBlobIds: ["f".repeat(40)], productionBytesUnchanged: true, reviewReceiptId: "review-1" } });
    if (!prepare.ok || !verify.ok) throw new Error("fixture must parse");
    const existing = { schemaVersion: 1 as const, status: "settled" as const, token: "prepare-token",
      bindingDigest: qualificationBindingDigest(prepare.data), startCount: 1 as const,
      issuedAt: prepare.data.issuedAt, startedAt: NOW.toISOString(), taskId: "task-1", evidenceId: "evidence-1" };

    expect(advanceQualificationExperimentState({ existing, existingBinding: prepare.data,
      token: "verify-token", binding: verify.data })).toMatchObject({ ok: true });
    expect(advanceQualificationExperimentState({ existing, existingBinding: prepare.data, token: "verify-token",
      binding: { ...verify.data, protocolReviewReceiptId: "review-protocol-2" } })).toMatchObject({ ok: false });
    expect(advanceQualificationExperimentState({ existing, existingBinding: prepare.data, token: "verify-token",
      binding: { ...verify.data, allowedPaths: ["apps/web/lib/other.test.ts"] } })).toMatchObject({ ok: false });
  });
});
