import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveQualificationAdmission } from "./qualification-terminal-admission";

const NOW = new Date("2025-06-18T12:00:00.000Z");
const HEAD = "a".repeat(40);
const BLOB = "b".repeat(40);
const PROD = "c".repeat(40);
const PATH = "docs/qualification-protocol.md";
const TEST_PATH = "scripts/qualification.test.ts";

function semanticReview(id: string, headSha = HEAD, diffDigest = `sha256:${"4".repeat(64)}`,
  specialistIds = ["AGT-INDEPENDENT"]) {
  return { id, details: {
    schemaVersion: "semantic-change-review-receipt.v3", artifactType: "code-change",
    capsuleId: "WC-QUAL", baseTreeHash: "1".repeat(40), headTreeHash: "2".repeat(40), diffDigest,
    policyVersion: "semantic-change-review-policy.v3", reviewerVersion: "change-reviewer.v2",
    specialistIds, sourceHeadSha: headSha, disposition: "reviewed", risk: "low",
    result: { decision: "pass", issues: [], summary: "Independent review passed." },
  } };
}

function fixture() {
  const db = {
    backlogItem: { findUnique: vi.fn().mockResolvedValue({ id: "row-item", itemId: "BI-QUAL",
      body: `Canonical design is now published at ${PATH} from signed commit ${HEAD}, blob ${BLOB}.\nwriter blob is ${"f".repeat(40)}\n${"scripts/tampered.test.ts"}` }) },
    workroom: { findUnique: vi.fn().mockResolvedValue({ id: "row-room", capsuleId: "WC-QUAL", status: "working",
      archivedAt: null, backlogItemId: "BI-QUAL", repositoryFullName: "owner/repo", headBranch: "fix/qual",
      baseSha: "e".repeat(40), headSha: HEAD, scopeClaims: {}, leaseHolderPrincipalId: "principal-row-1",
      leaseExpiresAt: new Date("2025-06-18T13:00:00.000Z"), workspaceState: {} }) },
    workroomActivity: { findUnique: vi.fn() },
    externalEvidenceRecord: { findMany: vi.fn().mockResolvedValue([semanticReview("review-protocol-1")]) },
  };
  const protocol = Buffer.from(`# BI-QUAL qualification-only Windows protocol\nProduction: [writer](../../../scripts/lib/local-ci-gate-state.mjs)\nwriter blob is ${PROD}\nAllowed: ${TEST_PATH}\n`);
  const ports = {
    db: db as never, now: () => NOW,
    readBlob: vi.fn().mockResolvedValue({ ok: true, data: protocol }),
    resolveIdentity: vi.fn().mockResolvedValue({ installationId: "install-dev" }),
    resolveLeasePrincipalId: vi.fn().mockResolvedValue("principal-row-1"),
    resolveShape: vi.fn().mockReturnValue({ key: "delivery-small-fix", version: "1.0.0",
      stages: [{ key: "reproduce" }] }),
  };
  return { db, ports };
}

describe("resolveQualificationAdmission", () => {
  beforeEach(() => vi.stubEnv("DPF_QUALIFICATION_ADMISSION_SECRET", "qualification-test-secret"));

  it("issues source-only preparation without treating it as host execution", async () => {
    const { ports } = fixture();
    const result = await resolveQualificationAdmission({ itemId: "BI-QUAL",
      refusedWorkroomId: "WC-QUAL", currentAgentId: "AGT-OWNER" }, ports);

    expect(result?.binding).toMatchObject({ phase: "prepare", executorMode: "sandbox-build",
      requiredPlatform: "win32", allowedPaths: [TEST_PATH] });
  });

  it("issues the canonical BI-B3 Windows preparation token", async () => {
    const f = fixture();
    f.ports.readBlob.mockResolvedValue({ ok: true, data: Buffer.from([
      "# BI-B3DEC077 qualification-only recovery protocol",
      "Run the controlled FileShare handle test on Windows PowerShell.",
      "The [shared writer](../../../scripts/lib/local-ci-gate-state.mjs) at this worktree's base has the same blob, f74e1b0c1b41be4cdc8b6a1b25ec946cd7f45618.",
      "Exact edit scope is this document and scripts/lib/local-ci-gate-state.test.mjs.",
    ].join("\n")) });
    f.db.backlogItem.findUnique.mockResolvedValue({ id: "row-item", itemId: "BI-B3DEC077",
      body: `Canonical design is now published at ${PATH} from signed commit ${HEAD}, blob ${BLOB}.` });
    f.db.workroom.findUnique.mockResolvedValue({ id: "row-room", capsuleId: "WC-QUAL", status: "working",
      archivedAt: null, backlogItemId: "BI-B3DEC077", repositoryFullName: "owner/repo", headBranch: "fix/qual",
      baseSha: "e".repeat(40), headSha: HEAD, scopeClaims: {}, leaseHolderPrincipalId: "principal-row-1",
      leaseExpiresAt: new Date("2025-06-18T13:00:00.000Z"), workspaceState: {} });

    const result = await resolveQualificationAdmission({ itemId: "BI-B3DEC077",
      refusedWorkroomId: "WC-QUAL", currentAgentId: "AGT-OWNER" }, f.ports);

    expect(result?.binding).toMatchObject({ itemId: "BI-B3DEC077", phase: "prepare",
      executorMode: "sandbox-build", requiredPlatform: "win32",
      targetProductionPaths: ["scripts/lib/local-ci-gate-state.mjs"],
      targetProductionBlobIds: ["f74e1b0c1b41be4cdc8b6a1b25ec946cd7f45618"] });
    expect(f.ports.readBlob).toHaveBeenCalledWith(expect.objectContaining({
      expectedBlobId: BLOB,
    }));
  });

  it("issues preparation without consuming the later verification start", async () => {
    const f = fixture();
    await expect(resolveQualificationAdmission({ itemId: "BI-QUAL",
      refusedWorkroomId: "WC-QUAL", currentAgentId: "AGT-OWNER" }, f.ports)).resolves.toMatchObject({
        binding: { phase: "prepare", executorMode: "sandbox-build" },
      });
    expect(f.db.workroomActivity.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ["missing protocol review", (f: ReturnType<typeof fixture>) => {
      f.db.externalEvidenceRecord.findMany.mockResolvedValue([]); }],
    ["failed protocol review", (f: ReturnType<typeof fixture>) => {
      const review = semanticReview("review-protocol-1");
      review.details.result.decision = "fail";
      f.db.externalEvidenceRecord.findMany.mockResolvedValue([review]); }],
    ["self review", (f: ReturnType<typeof fixture>) => {
      f.db.externalEvidenceRecord.findMany.mockResolvedValue([
        semanticReview("review-protocol-1", HEAD, undefined, ["AGT-OWNER"]),
      ]); }],
    ["newer failed review on the same head", (f: ReturnType<typeof fixture>) => {
      const failed = semanticReview("review-failed");
      failed.details.result.decision = "fail";
      f.db.externalEvidenceRecord.findMany.mockResolvedValue([
        failed, semanticReview("review-protocol-1"),
      ]); }],
    ["stale room head", (f: ReturnType<typeof fixture>) => { f.db.workroom.findUnique.mockResolvedValue({
      id: "row-room", capsuleId: "WC-QUAL", status: "working", archivedAt: null, backlogItemId: "BI-QUAL",
      repositoryFullName: "owner/repo", headBranch: "fix/qual", baseSha: "e".repeat(40), headSha: "8".repeat(40),
      scopeClaims: {}, leaseHolderPrincipalId: "principal-row-1", leaseExpiresAt: new Date("2025-06-18T13:00:00.000Z"), workspaceState: {},
    }); }],
  ])("refuses %s before issuing a token", async (_label, mutate) => {
    const f = fixture();
    mutate(f);
    await expect(resolveQualificationAdmission({ itemId: "BI-QUAL", refusedWorkroomId: "WC-QUAL",
      currentAgentId: "AGT-OWNER" }, f.ports)).resolves.toBeNull();
  });

  it("uses the exact protocol review despite an unrelated-head failure", async () => {
    const f = fixture();
    const failed = semanticReview("review-other-head", "9".repeat(40));
    failed.details.result.decision = "fail";
    f.db.externalEvidenceRecord.findMany.mockResolvedValue([failed, semanticReview("review-protocol-1")]);

    await expect(resolveQualificationAdmission({ itemId: "BI-QUAL", refusedWorkroomId: "WC-QUAL",
      currentAgentId: "AGT-OWNER" }, f.ports)).resolves.toMatchObject({ binding: { phase: "prepare" } });
  });

  it("refuses unreadable or scope-incomplete immutable protocol bytes", async () => {
    const f = fixture();
    f.ports.readBlob.mockResolvedValue({ ok: true, data: Buffer.from("BI-QUAL qualification-only") });
    await expect(resolveQualificationAdmission({ itemId: "BI-QUAL", refusedWorkroomId: "WC-QUAL",
      currentAgentId: "AGT-OWNER" }, f.ports)).resolves.toBeNull();
  });

  it("admits Linux preparation without claiming a verification result", async () => {
    const f = fixture();
    f.ports.readBlob.mockResolvedValue({ ok: true, data: Buffer.from(
      `# BI-QUAL qualification-only protocol\nProduction: [writer](../../../scripts/lib/local-ci-gate-state.mjs)\nwriter blob is ${PROD}\nAllowed: ${TEST_PATH}\n`,
    ) });
    await expect(resolveQualificationAdmission({ itemId: "BI-QUAL", refusedWorkroomId: "WC-QUAL",
      currentAgentId: "AGT-OWNER" }, f.ports)).resolves.toMatchObject({
        binding: { phase: "prepare", executorMode: "sandbox-build", requiredPlatform: "linux" },
      });
  });
});
