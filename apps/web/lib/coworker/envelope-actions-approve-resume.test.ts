// BI-3907AF35 — approving a coworker action must resume the task waiting on it.

import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const update = vi.fn();
const resumeMock = vi.fn();

vi.mock("@dpf/db", () => ({
  prisma: {
    coworkerActionEnvelope: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));

vi.mock("@/lib/coworker/authority-approval-envelope", () => ({
  resumeAuthorityApprovalTask: (...a: unknown[]) => resumeMock(...a),
}));

const DELEGATE = "user-1";

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    id: "env-1",
    status: "proposed",
    delegatingUserId: DELEGATE,
    taskRunId: "TR-1",
    ...overrides,
  };
}

beforeEach(() => {
  findUnique.mockReset();
  update.mockReset();
  resumeMock.mockReset();
});

describe("approveEnvelope", () => {
  // The live deadlock: envelope approved, task left at input-required with no
  // retry, so the coworker's write never ran and spec-approval — which is
  // independent:true — could be recorded by nobody.
  it("resumes the task that was waiting on the approval", async () => {
    findUnique.mockResolvedValue(envelope());
    update.mockResolvedValue(envelope({ status: "approved" }));

    const { approveEnvelope } = await import("./envelope-actions");
    const result = await approveEnvelope("env-1", DELEGATE);

    expect(result.ok).toBe(true);
    expect(resumeMock).toHaveBeenCalledWith("TR-1");
  });

  it("does not try to resume an envelope with no task", async () => {
    findUnique.mockResolvedValue(envelope({ taskRunId: null }));
    update.mockResolvedValue(envelope({ status: "approved", taskRunId: null }));

    const { approveEnvelope } = await import("./envelope-actions");
    await approveEnvelope("env-1", DELEGATE);

    expect(resumeMock).not.toHaveBeenCalled();
  });

  // The employee has already given the approval; a resume failure must not
  // take it back.
  it("keeps the approval when the resume fails", async () => {
    findUnique.mockResolvedValue(envelope());
    update.mockResolvedValue(envelope({ status: "approved" }));
    resumeMock.mockRejectedValue(new Error("task service unavailable"));

    const { approveEnvelope } = await import("./envelope-actions");
    const result = await approveEnvelope("env-1", DELEGATE);

    expect(result.ok).toBe(true);
  });

  it("does not resume when the caller is not the delegate", async () => {
    findUnique.mockResolvedValue(envelope());

    const { approveEnvelope } = await import("./envelope-actions");
    const result = await approveEnvelope("env-1", "someone-else");

    expect(result.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(resumeMock).not.toHaveBeenCalled();
  });
});
