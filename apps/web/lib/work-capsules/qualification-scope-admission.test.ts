import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createQualificationExperimentAdmission,
  qualificationBindingDigest,
  type QualificationExperimentBinding,
} from "@/lib/backlog/initiative-readiness/qualification-research-admission";
import { qualificationStateForScopeClaim } from "./qualification-scope-admission";

const NOW = new Date("2025-06-18T12:00:00.000Z");

function binding(phase: "prepare" | "verify"): QualificationExperimentBinding {
  const protocolHead = "b".repeat(40);
  const candidateHead = "d".repeat(40);
  return {
    schemaVersion: 1, phase, itemId: "BI-QUAL", workroomId: "WC-MINE001",
    repositoryFullName: "owner/repo", baseSha: "a".repeat(40),
    headSha: phase === "prepare" ? protocolHead : candidateHead,
    protocol: { path: "docs/protocol.md", commitSha: protocolHead, providerBlobId: "c".repeat(40) },
    installationId: "install-dev", accountablePrincipalRef: "PRN-1", protocolReviewReceiptId: "review-protocol-1",
    shapeKey: "delivery-small-fix", shapeVersion: "1.0.0", stageKey: "reproduce", policyVersion: 1,
    targetProductionBlobIds: ["e".repeat(40)],
    permittedTools: phase === "prepare"
      ? ["write_sandbox_file", "record_workroom_evidence"]
      : ["run_sandbox_tests", "record_workroom_evidence"],
    allowedPaths: ["apps/web/lib/example.test.ts"], issuedAt: "2025-06-18T11:00:00.000Z",
    expiresAt: "2025-06-18T13:00:00.000Z", maxStarts: 1, maxDurationMs: 600_000,
    ...(phase === "verify" ? { candidate: { headSha: candidateHead,
      diffDigest: `sha256:${"f".repeat(64)}`, testBlobIds: ["1".repeat(40)],
      productionBytesUnchanged: true, reviewReceiptId: "review-1" } } : {}),
  };
}

describe("qualificationStateForScopeClaim", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("advances one settled preparation to a distinct one-start verification binding", () => {
    vi.stubEnv("DPF_QUALIFICATION_ADMISSION_SECRET", "qualification-test-secret");
    const prepare = binding("prepare");
    const prepareToken = createQualificationExperimentAdmission(prepare);
    const verify = binding("verify");
    const verifyToken = createQualificationExperimentAdmission(verify);
    const room = {
      capsuleId: "WC-MINE001", backlogItemId: "BI-QUAL", repositoryFullName: "owner/repo",
      baseSha: prepare.baseSha, headSha: verify.headSha,
      workspaceState: { qualificationExperimentAdmission: {
        schemaVersion: 1, status: "settled", token: prepareToken,
        bindingDigest: qualificationBindingDigest(prepare), startCount: 1, issuedAt: prepare.issuedAt,
        startedAt: "2025-06-18T11:05:00.000Z", taskId: "task-prepare", evidenceId: "evidence-prepare",
      } },
    };

    const result = qualificationStateForScopeClaim({ room, token: verifyToken,
      accountablePrincipalRef: "PRN-1", now: NOW });

    expect(result.state).toMatchObject({ status: "issued", token: verifyToken, startCount: 0,
      bindingDigest: qualificationBindingDigest(verify) });
  });

  it("refuses a token whose owner or immutable room identity changed", () => {
    vi.stubEnv("DPF_QUALIFICATION_ADMISSION_SECRET", "qualification-test-secret");
    const prepare = binding("prepare");
    const token = createQualificationExperimentAdmission(prepare);
    const room = { capsuleId: prepare.workroomId, backlogItemId: prepare.itemId,
      repositoryFullName: prepare.repositoryFullName, baseSha: prepare.baseSha,
      headSha: prepare.headSha, workspaceState: {} };

    expect(() => qualificationStateForScopeClaim({ room, token,
      accountablePrincipalRef: "PRN-FOREIGN", now: NOW })).toThrow("does not match");
  });
});
