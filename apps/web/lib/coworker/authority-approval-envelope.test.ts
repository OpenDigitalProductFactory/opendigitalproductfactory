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
