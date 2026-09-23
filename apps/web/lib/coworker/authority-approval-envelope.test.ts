import { describe, expect, it, vi } from "vitest";

import type { CoworkerApprovalBinding } from "@/lib/govern/authority/coworker-authority-decision";

import {
  ensureAuthorityApprovalEnvelope,
  findApprovedAuthorityEnvelope,
  resumeAuthorityApprovalTask,
} from "./authority-approval-envelope";

const BINDING: CoworkerApprovalBinding = {
  actingHumanUserId: "user-1",
  actingAgentId: "AGT-1",
  chainId: "CHAIN-1",
  taskRunId: "TASK-1",
  toolName: "create_backlog_item",
  subject: { kind: "platform", id: "dpf" },
  routeContext: "/ops",
  inputFingerprint: "input-fingerprint",
  sensitivity: "internal",
  decisionVersionFingerprint: "policy-fingerprint",
};

function db() {
  return {
    coworkerActionEnvelope: {
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    taskRun: {
      updateMany: vi.fn(),
    },
    agentThread: {
      upsert: vi.fn(async (args: { where: { id: string } }) => ({ id: args.where.id })),
    },
  };
}

describe("authority approval envelopes", () => {
  it("creates one privacy-safe envelope and pauses only the exact task", async () => {
    const mockDb = db();
    mockDb.coworkerActionEnvelope.findFirst.mockResolvedValue(null);
    mockDb.coworkerActionEnvelope.create.mockResolvedValue({
      id: "ENV-1",
      status: "proposed",
      expiresAt: new Date("2026-07-27T11:15:00Z"),
    });

    const result = await ensureAuthorityApprovalEnvelope(
      {
        binding: BINDING,
        authorityDecisionId: "AUTH-1",
        threadId: "THREAD-1",
        explanation: "Approval is required.",
        now: new Date("2026-07-27T11:00:00Z"),
      },
      mockDb,
    );

    expect(result.id).toBe("ENV-1");
    expect(mockDb.coworkerActionEnvelope.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskRunId: "TASK-1",
        delegationChainId: "CHAIN-1",
        authorityDecisionId: "AUTH-1",
        inputFingerprint: "input-fingerprint",
        manifestActionId: "create_backlog_item",
        argsJson: { approvalBinding: BINDING },
      }),
    });
    expect(
      JSON.stringify(mockDb.coworkerActionEnvelope.create.mock.calls),
    ).not.toContain("private title");
    expect(mockDb.taskRun.updateMany).toHaveBeenCalledWith({
      where: {
        taskRunId: "TASK-1",
        status: { in: ["submitted", "working"] },
      },
      data: { status: "input-required" },
    });
  });

  it("reuses the active envelope for an identical binding", async () => {
    const mockDb = db();
    mockDb.coworkerActionEnvelope.findFirst.mockResolvedValue({
      id: "ENV-EXISTING",
      status: "proposed",
      expiresAt: new Date("2026-07-27T11:15:00Z"),
    });

    const result = await ensureAuthorityApprovalEnvelope(
      {
        binding: BINDING,
        authorityDecisionId: "AUTH-2",
        threadId: "THREAD-1",
        explanation: "Approval is required.",
        now: new Date("2026-07-27T11:00:00Z"),
      },
      mockDb,
    );

    expect(result.id).toBe("ENV-EXISTING");
    expect(mockDb.coworkerActionEnvelope.create).not.toHaveBeenCalled();
  });

  it("returns only an approved, unexpired envelope with its exact binding", async () => {
    const mockDb = db();
    mockDb.coworkerActionEnvelope.findFirst.mockResolvedValue({
      id: "ENV-APPROVED",
      status: "approved",
      expiresAt: new Date("2026-07-27T11:15:00Z"),
      argsJson: { approvalBinding: BINDING },
    });

    await expect(
      findApprovedAuthorityEnvelope(
        BINDING,
        new Date("2026-07-27T11:00:00Z"),
        mockDb,
      ),
    ).resolves.toEqual({
      envelopeId: "ENV-APPROVED",
      status: "approved",
      expiresAt: new Date("2026-07-27T11:15:00Z"),
      binding: BINDING,
    });
  });

  it("resumes only the task bound to the approved envelope", async () => {
    const markWorking = vi.fn().mockResolvedValue(undefined);
    await resumeAuthorityApprovalTask("TASK-1", markWorking);
    expect(markWorking).toHaveBeenCalledWith("TASK-1");
  });
});

describe("an approval raised outside a chat still gets an envelope", () => {
  it("creates a real AgentThread instead of a synthesized id that breaks the FK", async () => {
    // CoworkerActionEnvelope.threadId is NOT NULL with an FK to AgentThread.
    // The old fallback wrote `task:<id>` / `authority:<id>` — strings with no
    // matching row — so the insert violated the FK, this function threw, and
    // the caller reported authority_evidence_unavailable and retried forever.
    // 229 Build Studio research attestations failed exactly this way.
    const mockDb = db();
    mockDb.coworkerActionEnvelope.findFirst.mockResolvedValue(null);
    mockDb.coworkerActionEnvelope.create.mockImplementation(async (args: { data: { threadId: string } }) => ({
      id: "ENV-NEW",
      status: "proposed",
      expiresAt: new Date("2026-07-27T11:15:00Z"),
      threadId: args.data.threadId,
    }));

    await ensureAuthorityApprovalEnvelope(
      {
        binding: BINDING,
        authorityDecisionId: "AUTH-3",
        threadId: null,
        explanation: "Approval is required.",
        now: new Date("2026-07-27T11:00:00Z"),
      },
      mockDb,
    );

    expect(mockDb.agentThread.upsert).toHaveBeenCalledTimes(1);
    const created = mockDb.coworkerActionEnvelope.create.mock.calls[0]![0] as { data: { threadId: string } };
    expect(created.data.threadId).not.toMatch(/^task:/);
    expect(created.data.threadId).not.toMatch(/^authority:/);
    expect(created.data.threadId).toMatch(/^thr-authority-[0-9a-f]{24}$/);
  });

  it("derives the same thread for the same authority context, so retries do not spawn threads", async () => {
    const mockDb = db();
    mockDb.coworkerActionEnvelope.findFirst.mockResolvedValue(null);
    mockDb.coworkerActionEnvelope.create.mockResolvedValue({
      id: "ENV-NEW",
      status: "proposed",
      expiresAt: new Date("2026-07-27T11:15:00Z"),
    });

    const call = () =>
      ensureAuthorityApprovalEnvelope(
        { binding: BINDING, authorityDecisionId: "AUTH-4", threadId: null, explanation: "x", now: new Date("2026-07-27T11:00:00Z") },
        mockDb,
      );
    await call();
    await call();

    const ids = mockDb.agentThread.upsert.mock.calls.map((c) => (c[0] as { where: { id: string } }).where.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it("uses the supplied thread when there is one, and creates nothing", async () => {
    const mockDb = db();
    mockDb.coworkerActionEnvelope.findFirst.mockResolvedValue(null);
    mockDb.coworkerActionEnvelope.create.mockResolvedValue({
      id: "ENV-NEW",
      status: "proposed",
      expiresAt: new Date("2026-07-27T11:15:00Z"),
    });

    await ensureAuthorityApprovalEnvelope(
      { binding: BINDING, authorityDecisionId: "AUTH-5", threadId: "THREAD-REAL", explanation: "x", now: new Date("2026-07-27T11:00:00Z") },
      mockDb,
    );

    expect(mockDb.agentThread.upsert).not.toHaveBeenCalled();
    const created = mockDb.coworkerActionEnvelope.create.mock.calls[0]![0] as { data: { threadId: string } };
    expect(created.data.threadId).toBe("THREAD-REAL");
  });
});
