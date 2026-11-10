import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindUnique, mockCreate, mockUpdateMany, mockSend, mockApplyPullRequest } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockSend: vi.fn(),
  mockApplyPullRequest: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    gitPromotionCandidate: {
      findUnique: mockFindUnique,
      create: mockCreate,
      updateMany: mockUpdateMany,
    },
  },
}));

vi.mock("@/lib/jobs", () => ({
  jobs: {
    send: mockSend,
  },
}));

vi.mock("@/lib/backlog/pr-submit-awaiting-acceptance", () => ({
  applyGitHubPullRequestToBacklog: mockApplyPullRequest,
}));

import crypto from "crypto";
import {
  GitIntakeEmitError,
  branchFromRef,
  evaluateGitHubPushForSandbox,
  handleGitHubWebhook,
  intakeEventId,
  recordGitPromotionCandidate,
  verifyGitHubSignature,
} from "./git-promotion-intake";

const REPO = "OpenDigitalProductFactory/opendigitalproductfactory";
const HEAD = "a".repeat(40);
const MERGE = "b".repeat(40);

beforeEach(() => {
  mockFindUnique.mockReset();
  mockCreate.mockReset();
  mockUpdateMany.mockReset();
  mockSend.mockReset();
  mockApplyPullRequest.mockReset();
  mockUpdateMany.mockResolvedValue({ count: 1 });
  mockSend.mockResolvedValue({ ids: ["evt"] });
  mockApplyPullRequest.mockResolvedValue(undefined);
});

function pushPayload(overrides: Record<string, unknown> = {}) {
  return {
    ref: "refs/heads/main",
    before: "abc",
    after: "def",
    repository: {
      full_name: REPO,
      clone_url: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git",
      default_branch: "main",
    },
    ...overrides,
  };
}

function mergedPullRequestPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: "closed",
    number: 5228,
    pull_request: {
      number: 5228,
      merged: true,
      merged_at: "2026-09-23T10:00:00Z",
      merge_commit_sha: MERGE,
      title: "fix: thing",
      head: { ref: "fix/thing", sha: HEAD },
      base: { ref: "main" },
    },
    repository: { full_name: REPO },
    ...overrides,
  };
}

function sign(rawBody: string, secret: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

describe("git promotion intake", () => {
  it("extracts branch names from Git refs", () => {
    expect(branchFromRef("refs/heads/main")).toBe("main");
    expect(branchFromRef("refs/tags/v1")).toBeNull();
  });

  it("verifies GitHub HMAC signatures", () => {
    const rawBody = JSON.stringify(pushPayload());
    const secret = "test-secret";

    expect(verifyGitHubSignature(rawBody, sign(rawBody, secret), secret)).toBe(true);
    expect(verifyGitHubSignature(rawBody, "sha256=bad", secret)).toBe(false);
  });

  it("queues default-branch push events", () => {
    expect(evaluateGitHubPushForSandbox(pushPayload())).toEqual({
      status: "queued",
      reason: null,
      branch: "main",
    });
  });

  it("ignores non-default branch pushes", () => {
    expect(evaluateGitHubPushForSandbox(pushPayload({ ref: "refs/heads/feature/test" }))).toEqual({
      status: "ignored",
      reason: "Push was for feature/test, not default branch main.",
      branch: "feature/test",
    });
  });

  it("records the candidate as emit-pending, sends with a delivery-derived id, then settles it", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({
      candidateId: "GPC-123",
      status: "emit-pending",
      statusReason: null,
    });

    const result = await recordGitPromotionCandidate({
      provider: "github",
      eventName: "push",
      deliveryId: "delivery-1",
      payload: pushPayload(),
    });

    expect(result).toMatchObject({ candidateId: "GPC-123", status: "queued", queued: true, duplicate: false });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        deliveryKey: "github:delivery-1",
        status: "emit-pending",
        repositoryFullName: REPO,
      }),
    }));
    expect(mockSend).toHaveBeenCalledWith([{
      id: "build/git-update.received:github:delivery-1",
      name: "build/git-update.received",
      data: { candidateId: "GPC-123" },
    }]);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { candidateId: "GPC-123", status: "emit-pending" },
      data: { status: "queued" },
    });
    // Recorded first, then announced: a subscriber must always find the row.
    expect(mockCreate.mock.invocationCallOrder[0]).toBeLessThan(mockSend.mock.invocationCallOrder[0]!);
  });

  it("writes a candidate that owes nothing in its final status and sends nothing", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ candidateId: "GPC-IGN", status: "ignored", statusReason: "x" });

    const result = await recordGitPromotionCandidate({
      provider: "github",
      eventName: "push",
      deliveryId: "delivery-2",
      payload: pushPayload({ ref: "refs/heads/feature/test" }),
    });

    expect(result).toMatchObject({ status: "ignored", queued: false });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "ignored" }),
    }));
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("does not re-announce a duplicate whose events were sent", async () => {
    mockFindUnique.mockResolvedValue({
      candidateId: "GPC-EXISTING",
      status: "queued",
      statusReason: null,
    });

    const result = await recordGitPromotionCandidate({
      provider: "github",
      eventName: "push",
      deliveryId: "delivery-1",
      payload: pushPayload(),
    });

    expect(result).toMatchObject({ candidateId: "GPC-EXISTING", duplicate: true, queued: false, reemitted: false });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("keeps the row emit-pending and raises a retryable error when the send fails", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ candidateId: "GPC-123", status: "emit-pending", statusReason: null });
    mockSend.mockRejectedValue(new Error("inngest unreachable"));

    await expect(recordGitPromotionCandidate({
      provider: "github",
      eventName: "push",
      deliveryId: "delivery-1",
      payload: pushPayload(),
    })).rejects.toBeInstanceOf(GitIntakeEmitError);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("re-announces a duplicate whose earlier send failed, under the same event id", async () => {
    mockFindUnique.mockResolvedValue({ candidateId: "GPC-123", status: "emit-pending", statusReason: null });

    const result = await recordGitPromotionCandidate({
      provider: "github",
      eventName: "push",
      deliveryId: "delivery-1",
      payload: pushPayload(),
    });

    expect(result).toMatchObject({ candidateId: "GPC-123", duplicate: true, reemitted: true, status: "queued" });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledWith([expect.objectContaining({
      id: intakeEventId("github:delivery-1", "build/git-update.received"),
      name: "build/git-update.received",
    })]);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { candidateId: "GPC-123", status: "emit-pending" },
      data: { status: "queued" },
    });
  });
});

describe("handleGitHubWebhook — pull_request", () => {
  const secret = "whsec-test";

  it("announces a merged pull request as build/pr-merged.received with a delivery-derived id", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ candidateId: "GPC-PR", status: "emit-pending", statusReason: "ignored" });
    const rawBody = JSON.stringify(mergedPullRequestPayload());

    const result = await handleGitHubWebhook({
      rawBody,
      eventName: "pull_request",
      deliveryId: "pr-delivery-1",
      signature: sign(rawBody, secret),
      secret,
    });

    expect(result).toMatchObject({ candidateId: "GPC-PR", duplicate: false, status: "ignored" });
    expect(mockSend).toHaveBeenCalledWith([{
      id: "build/pr-merged.received:github:pr-delivery-1",
      name: "build/pr-merged.received",
      data: {
        candidateId: "GPC-PR",
        repositoryFullName: REPO,
        number: 5228,
        headRefName: "fix/thing",
        headSha: HEAD,
        mergeCommitSha: MERGE,
        mergedAt: "2026-09-23T10:00:00Z",
        baseRefName: "main",
        title: "fix: thing",
      },
    }]);
    // Sandbox verification is for pushes; the merge row settles to ignored.
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { candidateId: "GPC-PR", status: "emit-pending" },
      data: { status: "ignored" },
    });
    // Every pull_request action still reaches the backlog actuator.
    expect(mockApplyPullRequest).toHaveBeenCalledWith(JSON.parse(rawBody));
  });

  it("never announces a pull request closed without merging, and still runs the backlog actuator", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ candidateId: "GPC-CLOSED", status: "ignored", statusReason: "x" });
    const payload = mergedPullRequestPayload();
    const rawBody = JSON.stringify({ ...payload, pull_request: { ...payload.pull_request, merged: false } });

    await handleGitHubWebhook({
      rawBody,
      eventName: "pull_request",
      deliveryId: "pr-delivery-2",
      signature: sign(rawBody, secret),
      secret,
    });

    expect(mockSend).not.toHaveBeenCalled();
    expect(mockApplyPullRequest).toHaveBeenCalledTimes(1);
  });

  it("runs the backlog actuator for a non-closing action such as opened", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ candidateId: "GPC-OPEN", status: "ignored", statusReason: "x" });
    const rawBody = JSON.stringify(mergedPullRequestPayload({ action: "opened" }));

    await handleGitHubWebhook({
      rawBody,
      eventName: "pull_request",
      deliveryId: "pr-delivery-3",
      signature: sign(rawBody, secret),
      secret,
    });

    expect(mockSend).not.toHaveBeenCalled();
    expect(mockApplyPullRequest).toHaveBeenCalledWith(JSON.parse(rawBody));
  });

  it("does not take the 'unknown' repository placeholder as the identity of a merge", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ candidateId: "GPC-NOREPO", status: "ignored", statusReason: "x" });
    const payload = mergedPullRequestPayload();
    delete (payload as { repository?: unknown }).repository;
    const rawBody = JSON.stringify(payload);

    await handleGitHubWebhook({
      rawBody,
      eventName: "pull_request",
      deliveryId: "pr-delivery-4",
      signature: sign(rawBody, secret),
      secret,
    });

    expect(mockSend).not.toHaveBeenCalled();
  });

  it("refuses a bad signature before recording anything", async () => {
    const rawBody = JSON.stringify(mergedPullRequestPayload());

    await expect(handleGitHubWebhook({
      rawBody,
      eventName: "pull_request",
      deliveryId: "pr-delivery-5",
      signature: "sha256=" + "0".repeat(64),
      secret,
    })).rejects.toThrow(/signature/);
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockApplyPullRequest).not.toHaveBeenCalled();
  });
});
