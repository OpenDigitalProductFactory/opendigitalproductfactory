import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate, mockRecord, mockAdopt } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockRecord: vi.fn(),
  mockAdopt: vi.fn(),
}));

vi.mock("./work-capsule-store", () => ({
  createWorkCapsule: mockCreate,
  recordWorkCapsuleEvidence: mockRecord,
  adoptWorktreeCapsule: mockAdopt,
}));

import {
  captureExternalSessionEvidence,
  ensureExternalSessionCapsule,
  providerToExecutorKind,
} from "./external-session-capture";

const actor = { userId: "user-1", agentId: null, principalId: null };
const db = {} as never;

describe("captureExternalSessionEvidence (durable auto-capture / BI-636A11B3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({ capsuleId: "WC-AUTO", id: "row-auto" });
    mockRecord.mockResolvedValue({});
  });

  it("creates-or-reuses a capsule keyed by externalSessionId and records the evidence on it", async () => {
    const capsuleId = await captureExternalSessionEvidence({
      db,
      externalSessionId: "sess-9",
      provider: "claude",
      summary: "Wrote the parser",
      actor,
    });

    expect(capsuleId).toBe("WC-AUTO");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          idempotencyKey: "external-session:sess-9",
          executorKind: "claude-desktop",
          executorRef: "sess-9",
          source: "external-adoption",
          objective: "Wrote the parser",
        }),
        actor,
      }),
    );
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        capsuleId: "WC-AUTO",
        evidence: expect.objectContaining({ kind: "note", summary: "Wrote the parser" }),
      }),
    );
  });

  it("falls back to a generic objective when the summary is blank", async () => {
    await captureExternalSessionEvidence({
      db,
      externalSessionId: "s",
      provider: "codex",
      summary: "   ",
      actor,
    });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ objective: "External codex development session" }),
      }),
    );
  });
});

describe("providerToExecutorKind", () => {
  it("maps known providers and defaults unknown to human", () => {
    expect(providerToExecutorKind("claude")).toBe("claude-desktop");
    expect(providerToExecutorKind("Codex CLI")).toBe("codex-desktop");
    expect(providerToExecutorKind("grok-4")).toBe("grok-desktop");
    expect(providerToExecutorKind("something-else")).toBe("human");
  });
});

describe("ensureExternalSessionCapsule work-start signal (BI-5FDBF786)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({ capsuleId: "WC-START", id: "row-start" });
    mockAdopt.mockResolvedValue({ capsuleId: "WC-ADOPTED", id: "row-adopted" });
    mockRecord.mockResolvedValue({});
  });

  it("creates a tracked capsule at start WITHOUT recording any evidence (no summary required)", async () => {
    const capsuleId = await ensureExternalSessionCapsule({
      db,
      externalSessionId: "sess-start",
      provider: "codex",
      actor,
    });

    expect(capsuleId).toBe("WC-START");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          idempotencyKey: "external-session:sess-start",
          executorKind: "codex-desktop",
          executorRef: "sess-start",
          source: "external-adoption",
        }),
      }),
    );
    // the whole point: starting work is not recording evidence
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("uses the adopt path (keyed on repo+branch) when a worktree location is supplied", async () => {
    const capsuleId = await ensureExternalSessionCapsule({
      db,
      externalSessionId: "sess-loc",
      provider: "grok",
      actor,
      worktreePath: "/tmp/wt",
      branchName: "feat/x",
    });

    expect(capsuleId).toBe("WC-ADOPTED");
    expect(mockAdopt).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ headBranch: "feat/x", worktreePath: "/tmp/wt", executorRef: "sess-loc" }),
      }),
    );
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("provider-verifies a published commit before synchronizing the adopted Workroom head", async () => {
    const sha = "a".repeat(40);
    const resolvePublishedHead = vi.fn().mockResolvedValue(sha);
    await ensureExternalSessionCapsule({
      db,
      externalSessionId: "sess-published",
      provider: "codex",
      actor,
      backlogItemId: "BI-F0715C9C",
      worktreePath: "/tmp/wt",
      branchName: "fix/initiative-readiness-bootstrap",
      repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      publishedCommitSha: sha,
      resolvePublishedHead,
    });

    expect(resolvePublishedHead).toHaveBeenCalledWith(expect.objectContaining({
      branchName: "fix/initiative-readiness-bootstrap",
      expectedCommitSha: sha,
    }));
    expect(mockAdopt).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ headSha: sha }),
    }));
  });

  it("does not mutate Workroom identity when provider verification mismatches", async () => {
    await expect(ensureExternalSessionCapsule({
      db,
      externalSessionId: "sess-mismatch",
      provider: "codex",
      actor,
      worktreePath: "/tmp/wt",
      branchName: "fix/x",
      publishedCommitSha: "a".repeat(40),
      resolvePublishedHead: vi.fn().mockResolvedValue(null),
    })).rejects.toThrow("did not verify");
    expect(mockAdopt).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
