import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/lib/jobs", () => ({ jobs: { send: mockSend } }));
vi.mock("@/lib/backlog/pr-submit-awaiting-acceptance", () => ({
  applyGitHubPullRequestToBacklog: mockApplyPullRequest,
}));

import { POST } from "./route";

const SECRET = "route-test-secret";
const REPO = "OpenDigitalProductFactory/opendigitalproductfactory";

const mergedBody = JSON.stringify({
  action: "closed",
  number: 5228,
  pull_request: {
    number: 5228,
    merged: true,
    merged_at: "2026-09-23T10:00:00Z",
    merge_commit_sha: "b".repeat(40),
    title: "fix: thing",
    head: { ref: "fix/thing", sha: "a".repeat(40) },
    base: { ref: "main" },
  },
  repository: { full_name: REPO },
});

function signed(body: string, secret = SECRET): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

function delivery(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://portal.test/api/platform/git/updates", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "pull_request",
      "x-github-delivery": "11111111-2222-3333-4444-555555555555",
      "x-hub-signature-256": signed(body),
      ...headers,
    },
    body,
  });
}

beforeEach(() => {
  vi.stubEnv("DPF_GIT_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("GITHUB_WEBHOOK_SECRET", "");
  for (const mock of [mockFindUnique, mockCreate, mockUpdateMany, mockSend, mockApplyPullRequest]) mock.mockReset();
  mockUpdateMany.mockResolvedValue({ count: 1 });
  mockSend.mockResolvedValue({ ids: ["evt"] });
  mockApplyPullRequest.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/platform/git/updates", () => {
  it("accepts a signed merged pull_request with 202 and announces build/pr-merged.received", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ candidateId: "GPC-PR", status: "emit-pending", statusReason: null });

    const response = await POST(delivery(mergedBody));

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ candidateId: "GPC-PR", duplicate: false });
    expect(mockSend).toHaveBeenCalledWith([expect.objectContaining({
      id: "build/pr-merged.received:github:11111111-2222-3333-4444-555555555555",
      name: "build/pr-merged.received",
      data: expect.objectContaining({ repositoryFullName: REPO, number: 5228, headRefName: "fix/thing" }),
    })]);
  });

  it("answers a redelivery of an announced merge with 200 and sends nothing", async () => {
    mockFindUnique.mockResolvedValue({ candidateId: "GPC-PR", status: "ignored", statusReason: null });

    const response = await POST(delivery(mergedBody));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ duplicate: true, reemitted: false });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("re-announces a redelivery whose first send failed", async () => {
    mockFindUnique.mockResolvedValue({ candidateId: "GPC-PR", status: "emit-pending", statusReason: null });

    const response = await POST(delivery(mergedBody));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ duplicate: true, reemitted: true });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0]![0][0]).toMatchObject({
      id: "build/pr-merged.received:github:11111111-2222-3333-4444-555555555555",
    });
  });

  it("answers 503 when the row was recorded but the send failed, so GitHub marks it for redelivery", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ candidateId: "GPC-PR", status: "emit-pending", statusReason: null });
    mockSend.mockRejectedValue(new Error("inngest unreachable"));

    const response = await POST(delivery(mergedBody));

    expect(response.status).toBe(503);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("refuses a bad signature with 401 and records nothing", async () => {
    const response = await POST(delivery(mergedBody, { "x-hub-signature-256": signed(mergedBody, "wrong-secret") }));

    expect(response.status).toBe(401);
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("refuses every delivery in production when the secret is blank, as compose passes it", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DPF_GIT_WEBHOOK_SECRET", "");

    const response = await POST(delivery(mergedBody));

    expect(response.status).toBe(503);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("falls back to the legacy secret name when the primary is blank", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DPF_GIT_WEBHOOK_SECRET", "  ");
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", SECRET);
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ candidateId: "GPC-PR", status: "emit-pending", statusReason: null });

    const response = await POST(delivery(mergedBody));

    expect(response.status).toBe(202);
  });
});
