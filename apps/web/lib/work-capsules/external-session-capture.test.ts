import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate, mockRecord } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockRecord: vi.fn(),
}));

vi.mock("./work-capsule-store", () => ({
  createWorkCapsule: mockCreate,
  recordWorkCapsuleEvidence: mockRecord,
}));

import {
  captureExternalSessionEvidence,
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
