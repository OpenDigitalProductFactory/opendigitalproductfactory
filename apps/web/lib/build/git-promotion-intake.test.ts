import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindUnique, mockCreate, mockSend } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockCreate: vi.fn(),
  mockSend: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    gitPromotionCandidate: {
      findUnique: mockFindUnique,
      create: mockCreate,
    },
  },
}));

vi.mock("@/lib/queue/inngest-client", () => ({
  inngest: {
    send: mockSend,
  },
}));

import crypto from "crypto";
import {
  branchFromRef,
  evaluateGitHubPushForSandbox,
  recordGitPromotionCandidate,
  verifyGitHubSignature,
} from "./git-promotion-intake";

beforeEach(() => {
  mockFindUnique.mockReset();
  mockCreate.mockReset();
  mockSend.mockReset();
});

function pushPayload(overrides: Record<string, unknown> = {}) {
  return {
    ref: "refs/heads/main",
    before: "abc",
    after: "def",
    repository: {
      full_name: "OpenDigitalProductFactory/opendigitalproductfactory",
      clone_url: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git",
      default_branch: "main",
    },
    ...overrides,
  };
}

describe("git promotion intake", () => {
  it("extracts branch names from Git refs", () => {
    expect(branchFromRef("refs/heads/main")).toBe("main");
    expect(branchFromRef("refs/tags/v1")).toBeNull();
  });

  it("verifies GitHub HMAC signatures", () => {
    const rawBody = JSON.stringify(pushPayload());
    const secret = "test-secret";
    const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

    expect(verifyGitHubSignature(rawBody, `sha256=${digest}`, secret)).toBe(true);
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

  it("records and queues a new candidate", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({
      candidateId: "GPC-123",
      status: "queued",
      statusReason: null,
    });

    const result = await recordGitPromotionCandidate({
      provider: "github",
      eventName: "push",
      deliveryId: "delivery-1",
      payload: pushPayload(),
    });

    expect(result).toMatchObject({ candidateId: "GPC-123", queued: true, duplicate: false });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        deliveryKey: "github:delivery-1",
        status: "queued",
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      }),
    }));
    expect(mockSend).toHaveBeenCalledWith({
      name: "build/git-update.received",
      data: { candidateId: "GPC-123" },
    });
  });

  it("does not enqueue duplicate deliveries", async () => {
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

    expect(result).toMatchObject({ candidateId: "GPC-EXISTING", duplicate: true, queued: false });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });
});
