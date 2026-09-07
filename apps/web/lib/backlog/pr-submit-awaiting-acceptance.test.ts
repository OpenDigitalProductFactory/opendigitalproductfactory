import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockBacklogFindMany,
  mockBacklogFindUnique,
  mockBacklogFindFirst,
  mockBacklogCreate,
  mockBacklogUpdate,
  mockActivityCreate,
  mockWorkroomFindMany,
  mockWorkroomUpdateMany,
  mockTransaction,
} = vi.hoisted(() => ({
  mockBacklogFindMany: vi.fn(),
  mockBacklogFindUnique: vi.fn(),
  mockBacklogFindFirst: vi.fn(),
  mockBacklogCreate: vi.fn(),
  mockBacklogUpdate: vi.fn(),
  mockActivityCreate: vi.fn(),
  mockWorkroomFindMany: vi.fn(),
  mockWorkroomUpdateMany: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    backlogItem: {
      findMany: mockBacklogFindMany,
      findUnique: mockBacklogFindUnique,
      findFirst: mockBacklogFindFirst,
      create: mockBacklogCreate,
      update: mockBacklogUpdate,
    },
    backlogItemActivity: {
      create: mockActivityCreate,
      findMany: vi.fn(),
    },
    workroom: {
      findMany: mockWorkroomFindMany,
      updateMany: mockWorkroomUpdateMany,
    },
    $transaction: mockTransaction,
  },
}));

import {
  CODING_POOL_STATUSES,
  extractBacklogItemIdsFromText,
  fileAcceptanceMiss,
  parseGitHubPullRequestEvent,
  shouldMarkAwaitingAcceptance,
  shouldReopenFromWithdrawnPr,
  applyGitHubPullRequestToBacklog,
  sweepPrSubmittedBacklogItems,
} from "./pr-submit-awaiting-acceptance";

function prPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: "opened",
    number: 5126,
    pull_request: {
      number: 5126,
      html_url: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/5126",
      draft: false,
      merged: false,
      state: "open",
      title: "feat: close BI-CA54ACC8",
      body: "Closes BI-CA54ACC8",
      head: { ref: "feat/example", sha: "abc" },
    },
    repository: { full_name: "OpenDigitalProductFactory/opendigitalproductfactory" },
    ...overrides,
  };
}

describe("PR-submit awaiting-acceptance (BI-7161625D)", () => {
  beforeEach(() => {
    mockBacklogFindMany.mockReset();
    mockBacklogFindUnique.mockReset();
    mockBacklogFindFirst.mockReset();
    mockBacklogCreate.mockReset();
    mockBacklogUpdate.mockReset();
    mockActivityCreate.mockReset();
    mockWorkroomFindMany.mockReset();
    mockWorkroomUpdateMany.mockReset();
    mockTransaction.mockReset();
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        backlogItem: { update: mockBacklogUpdate },
        backlogItemActivity: { create: mockActivityCreate },
      }),
    );
  });

  it("extracts DPF item ids from PR title and body", () => {
    expect(extractBacklogItemIdsFromText("feat: BI-CA54ACC8 and BI-SIG-463E478D")).toEqual([
      "BI-CA54ACC8",
      "BI-SIG-463E478D",
    ]);
    expect(extractBacklogItemIdsFromText("no ids here")).toEqual([]);
  });

  it("marks non-draft opened/ready PRs as submit", () => {
    const opened = parseGitHubPullRequestEvent(prPayload());
    expect(opened).not.toBeNull();
    expect(shouldMarkAwaitingAcceptance(opened!)).toBe(true);
    expect(shouldReopenFromWithdrawnPr(opened!)).toBe(false);

    const draft = parseGitHubPullRequestEvent(prPayload({
      pull_request: { ...prPayload().pull_request, draft: true },
    }));
    expect(shouldMarkAwaitingAcceptance(draft!)).toBe(false);
  });

  it("reopens only when the PR is closed without merge", () => {
    const withdrawn = parseGitHubPullRequestEvent(prPayload({
      action: "closed",
      pull_request: { ...prPayload().pull_request, state: "closed", merged: false },
    }));
    expect(shouldMarkAwaitingAcceptance(withdrawn!)).toBe(false);
    expect(shouldReopenFromWithdrawnPr(withdrawn!)).toBe(true);

    const merged = parseGitHubPullRequestEvent(prPayload({
      action: "closed",
      pull_request: { ...prPayload().pull_request, state: "closed", merged: true },
    }));
    expect(shouldReopenFromWithdrawnPr(merged!)).toBe(false);
  });

  it("moves linked coding-pool items to awaiting-acceptance and stamps the Workroom PR", async () => {
    mockWorkroomFindMany.mockResolvedValue([
      { id: "room-1", backlogItemId: "BI-CA54ACC8", pullRequestNumber: null },
    ]);
    mockBacklogFindMany.mockResolvedValue([
      { id: "row-1", itemId: "BI-CA54ACC8", status: "open", claimStatus: "active" },
    ]);

    const result = await applyGitHubPullRequestToBacklog(prPayload());

    expect(mockWorkroomUpdateMany).toHaveBeenCalled();
    expect(result.moved).toEqual(["BI-CA54ACC8"]);
    expect(mockBacklogUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "awaiting-acceptance",
          claimStatus: "released",
        }),
      }),
    );
  });

  it("does not move items already awaiting-acceptance", async () => {
    mockWorkroomFindMany.mockResolvedValue([
      { id: "room-1", backlogItemId: "BI-CA54ACC8", pullRequestNumber: 5126 },
    ]);
    mockBacklogFindMany.mockResolvedValue([
      { id: "row-1", itemId: "BI-CA54ACC8", status: "awaiting-acceptance", claimStatus: "released" },
    ]);

    const result = await applyGitHubPullRequestToBacklog(prPayload());
    expect(result.moved).toEqual([]);
    expect(mockBacklogUpdate).not.toHaveBeenCalled();
  });

  it("returns a withdrawn PR from awaiting-acceptance to open", async () => {
    mockWorkroomFindMany.mockResolvedValue([
      { id: "room-1", backlogItemId: "BI-CA54ACC8", pullRequestNumber: 5126 },
    ]);
    mockBacklogFindMany.mockResolvedValue([
      { id: "row-1", itemId: "BI-CA54ACC8", status: "awaiting-acceptance", claimStatus: "released" },
    ]);

    const result = await applyGitHubPullRequestToBacklog(prPayload({
      action: "closed",
      pull_request: { ...prPayload().pull_request, state: "closed", merged: false },
    }));

    expect(result.moved).toEqual(["BI-CA54ACC8"]);
    expect(mockBacklogUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "open" }),
      }),
    );
  });

  it("sweeps workrooms that already have a PR number", async () => {
    mockWorkroomFindMany.mockResolvedValue([
      { id: "room-1", backlogItemId: "BI-E54F7F87", pullRequestNumber: 4972 },
    ]);
    mockBacklogFindMany.mockResolvedValue([
      { id: "row-2", itemId: "BI-E54F7F87", status: "in-progress", claimStatus: "active" },
    ]);

    const result = await sweepPrSubmittedBacklogItems();
    expect(result.moved).toEqual(["BI-E54F7F87"]);
    expect(CODING_POOL_STATUSES).toEqual(["triaging", "open", "in-progress"]);
  });

  it("creates one corrective BI and leaves the original awaiting-acceptance", async () => {
    mockBacklogFindUnique.mockResolvedValue({
      id: "row-1",
      itemId: "BI-CA54ACC8",
      status: "awaiting-acceptance",
      epicId: "epic-1",
      organizationId: null,
    });
    mockBacklogFindFirst.mockResolvedValue(null);
    mockBacklogCreate.mockResolvedValue({ itemId: "BI-ACC-TEST" });

    const result = await fileAcceptanceMiss({
      originalItemId: "BI-CA54ACC8",
      servedSha: "abc123",
      fingerprint: "fail-ui-login",
      title: "Acceptance miss: login",
      body: "Login failed on served SHA",
    });

    expect(result.action).toBe("created");
    expect(result.itemId).toBe("BI-ACC-TEST");
    expect(mockBacklogCreate).toHaveBeenCalled();
    expect(mockBacklogUpdate).not.toHaveBeenCalled();
  });
});
