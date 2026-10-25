import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockBacklogFindMany,
  mockBacklogFindUnique,
  mockBacklogFindFirst,
  mockBacklogCreate,
  mockBacklogUpdate,
  mockActivityCreate,
  mockActivityFindMany,
  mockItemLock,
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
  mockActivityFindMany: vi.fn(),
  mockItemLock: vi.fn(),
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
      findMany: mockActivityFindMany,
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
  extractDeliveredBacklogItemIds,
  fileAcceptanceMiss,
  parseGitHubPullRequestEvent,
  shouldMarkAwaitingAcceptance,
  shouldReopenFromWithdrawnPr,
  applyGitHubPullRequestToBacklog,
  applyObservedPullRequestsToBacklog,
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
    mockBacklogFindUnique.mockReset().mockResolvedValue({ status: "open" });
    mockBacklogFindFirst.mockReset();
    mockBacklogCreate.mockReset();
    mockBacklogUpdate.mockReset();
    mockActivityCreate.mockReset();
    mockActivityFindMany.mockReset().mockResolvedValue([]);
    mockItemLock.mockReset().mockResolvedValue([]);
    mockWorkroomFindMany.mockReset();
    mockWorkroomUpdateMany.mockReset();
    mockTransaction.mockReset();
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        backlogItem: { update: mockBacklogUpdate, findUnique: mockBacklogFindUnique },
        backlogItemActivity: { create: mockActivityCreate, findMany: mockActivityFindMany },
        $queryRaw: mockItemLock,
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

  it("counts a body id only where the PR declares it delivers that item", () => {
    expect(extractDeliveredBacklogItemIds(
      "fix(routing): bound retry windows",
      [
        "Backlog: BI-7792327A",
        "The lease pool admitted nothing on this host (BI-B0122A22), so the gate is unrun.",
        "Resolves BI-49B0C9C7 and BI-76334D21.",
        "This PR completes only BI-705F481D. Umbrella: BI-D5228299",
        "- Linked BI(s): BI-CA54ACC8, BI-SIG-463E478D",
        "Fixes #12, unrelated to BI-11111111.",
      ].join("\n"),
    ).sort()).toEqual([
      "BI-49B0C9C7",
      "BI-705F481D",
      "BI-76334D21",
      "BI-7792327A",
      "BI-CA54ACC8",
      "BI-SIG-463E478D",
    ]);
    expect(extractDeliveredBacklogItemIds("fix(x): pin the gate (BI-ABCDEF12)", "Context: BI-99999999 regressed it.")).toEqual(["BI-ABCDEF12"]);
  });

  it("loads only declared items, never incidental mentions", async () => {
    mockWorkroomFindMany.mockResolvedValue([]);
    mockBacklogFindMany.mockResolvedValue([]);
    await applyGitHubPullRequestToBacklog(prPayload({
      pull_request: { ...prPayload().pull_request, title: "fix: something", body: "Backlog: BI-AAAA1111\nSee BI-BBBB2222 for history." },
    }));
    expect(mockBacklogFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { itemId: { in: ["BI-AAAA1111"] } },
    }));
  });

  it("a doc PR advances a doc item but leaves feature and bug items it only designs or plans", async () => {
    mockWorkroomFindMany.mockResolvedValue([]);
    mockBacklogFindMany.mockResolvedValue([
      { id: "row-1", itemId: "BI-5201141C", status: "triaging", claimStatus: null, workType: "bug" },
      { id: "row-2", itemId: "BI-1AE9D368", status: "open", claimStatus: null, workType: "doc" },
    ]);
    const result = await applyGitHubPullRequestToBacklog(prPayload({
      pull_request: {
        ...prPayload().pull_request,
        title: "doc(mcp): canonical install address plan (BI-5201141C, BI-1AE9D368)",
        body: "",
      },
    }));
    expect(result.moved).toEqual(["BI-1AE9D368"]);
    expect(result.skipped).toBe(1);
  });

  it("never overwrites current Workroom PR identity from a branch-only delivery event", async () => {
    mockWorkroomFindMany.mockResolvedValue([]);
    mockBacklogFindMany.mockResolvedValue([]);
    await applyGitHubPullRequestToBacklog(prPayload());
    expect(mockWorkroomUpdateMany).not.toHaveBeenCalled();
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
    expect(shouldMarkAwaitingAcceptance(merged!)).toBe(true);
    expect(shouldReopenFromWithdrawnPr(merged!)).toBe(false);
  });

  it("moves linked coding-pool items without becoming another PR binding writer", async () => {
    mockWorkroomFindMany.mockResolvedValue([
      { id: "room-1", backlogItemId: "BI-CA54ACC8", pullRequestNumber: null },
    ]);
    mockBacklogFindMany.mockResolvedValue([
      { id: "row-1", itemId: "BI-CA54ACC8", status: "open", claimStatus: "active" },
    ]);

    const result = await applyGitHubPullRequestToBacklog(prPayload());

    expect(mockWorkroomUpdateMany).not.toHaveBeenCalled();
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

  it.each(["webhook", "observed", "sweep"])("preserves an explicit reopen when the old PR returns via %s", async (entry) => {
    const url = prPayload().pull_request.html_url;
    mockWorkroomFindMany.mockResolvedValue([
      { id: "room-1", backlogItemId: "BI-CA54ACC8", pullRequestNumber: 5126, pullRequestUrl: url },
    ]);
    mockBacklogFindMany.mockResolvedValue([
      { id: "row-1", itemId: "BI-CA54ACC8", status: "open", claimStatus: "active" },
    ]);
    mockBacklogFindUnique.mockResolvedValue({ status: "open" });
    mockActivityFindMany.mockResolvedValue([
      { id: "old-submit", recordedAt: new Date("2026-10-21T15:30:00Z"), payload: { actuator: "pr-submit-awaiting-acceptance", to: "awaiting-acceptance", pullRequestNumber: 5126, pullRequestUrl: url } },
      { id: "reopen", recordedAt: new Date("2026-10-25T17:07:00Z"), payload: { from: "done", to: "open", reason: "Original acceptance incomplete" } },
    ]);
    const result = entry === "sweep" ? await sweepPrSubmittedBacklogItems()
      : entry === "observed" ? await applyObservedPullRequestsToBacklog([{
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory", number: 5126,
        url, title: "fix: BI-CA54ACC8", headBranch: "feat/example", state: "merged", isDraft: false,
      }]) : await applyGitHubPullRequestToBacklog(prPayload());
    expect(result.moved).toEqual([]);
    expect(mockBacklogUpdate).not.toHaveBeenCalled();
    expect(mockActivityCreate).not.toHaveBeenCalled();
  });

  it.each(["different PR", "different repository", "withdrawal"])("still advances after %s history", async (historyCase) => {
    mockWorkroomFindMany.mockResolvedValue([]);
    mockBacklogFindMany.mockResolvedValue([
      { id: "row-1", itemId: "BI-CA54ACC8", status: "open", claimStatus: "active" },
    ]);
    mockActivityFindMany.mockResolvedValue([
      { id: "old-submit", recordedAt: new Date("2026-10-21T15:30:00Z"), payload: {
        actuator: "pr-submit-awaiting-acceptance", to: "awaiting-acceptance",
        pullRequestNumber: historyCase === "different PR" ? 100 : 5126,
        pullRequestUrl: historyCase === "different repository" ? "https://github.com/other/repo/pull/5126" : prPayload().pull_request.html_url,
      } },
      { id: "reopen", recordedAt: new Date("2026-10-25T17:07:00Z"), payload: {
        from: "awaiting-acceptance", to: "open",
        ...(historyCase === "withdrawal" ? { actuator: "pr-submit-awaiting-acceptance" } : {}),
      } },
    ]);
    const result = await applyGitHubPullRequestToBacklog(prPayload());
    expect(result.moved).toEqual(["BI-CA54ACC8"]);
    expect(mockActivityFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { backlogItemId: "row-1", kind: "status_change" },
    }));
  });

  it("preserves an explicit reopen when timestamps tie and legacy history has no PR URL", async () => {
    mockWorkroomFindMany.mockResolvedValue([]);
    mockBacklogFindMany.mockResolvedValue([
      { id: "row-1", itemId: "BI-CA54ACC8", status: "open", claimStatus: "active" },
    ]);
    const recordedAt = new Date("2026-10-25T17:07:00Z");
    mockActivityFindMany.mockResolvedValue([
      { id: "a-reopen", recordedAt, payload: { from: "done", to: "open" } },
      { id: "z-submit", recordedAt, payload: { actuator: "pr-submit-awaiting-acceptance", to: "awaiting-acceptance", pullRequestNumber: 5126 } },
    ]);
    expect((await applyGitHubPullRequestToBacklog(prPayload())).moved).toEqual([]);
    expect(mockBacklogUpdate).not.toHaveBeenCalled();
  });

  it("does not overwrite a status changed after the candidate was read", async () => {
    mockWorkroomFindMany.mockResolvedValue([]);
    mockBacklogFindMany.mockResolvedValue([
      { id: "row-1", itemId: "BI-CA54ACC8", status: "open", claimStatus: "active" },
    ]);
    mockBacklogFindUnique.mockResolvedValue({ status: "retired" });
    expect((await applyGitHubPullRequestToBacklog(prPayload())).moved).toEqual([]);
    expect(mockItemLock).toHaveBeenCalledOnce();
    expect(mockBacklogUpdate).not.toHaveBeenCalled();
    expect(mockActivityCreate).not.toHaveBeenCalled();
  });

  it("returns a withdrawn PR from awaiting-acceptance to open", async () => {
    mockBacklogFindUnique.mockResolvedValue({ status: "awaiting-acceptance" });
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
    mockBacklogFindUnique.mockResolvedValue({ status: "in-progress" });
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

  it("processes a CLI delivery without overwriting its current PR binding", async () => {
    mockWorkroomFindMany.mockResolvedValue([
      { id: "room-cli", backlogItemId: "BI-CA54ACC8", pullRequestNumber: null },
    ]);
    mockBacklogFindMany.mockResolvedValue([
      { id: "row-1", itemId: "BI-CA54ACC8", status: "open", claimStatus: "released" },
    ]);

    const result = await applyObservedPullRequestsToBacklog([
      {
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        number: 5126,
        url: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/5126",
        title: "feat: BI-CA54ACC8",
        headBranch: "feat/example",
        state: "merged",
        isDraft: false,
      },
    ]);

    expect(result.moved).toEqual(["BI-CA54ACC8"]);
    expect(mockWorkroomUpdateMany).not.toHaveBeenCalled();
  });

  it.each(["awaiting-acceptance", "done"])("creates corrective work while retaining original %s status", async (status) => {
    mockBacklogFindUnique.mockResolvedValue({
      id: "row-1",
      itemId: "BI-CA54ACC8",
      status,
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
