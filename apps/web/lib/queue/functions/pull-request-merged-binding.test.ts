import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindFirst, mockUpdateMany, mockActivityCreate } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockActivityCreate: vi.fn(),
}));

vi.mock("@dpf/db", () => {
  const tx = {
    workroom: { updateMany: mockUpdateMany },
    workroomActivity: { create: mockActivityCreate },
  };
  return {
    prisma: {
      workroom: { findFirst: mockFindFirst },
      $transaction: (fn: (client: typeof tx) => unknown) => fn(tx),
    },
  };
});

// Capture the handler instead of registering a real Inngest function.
vi.mock("@/lib/jobs", () => ({
  jobs: {
    createFunction: (_config: unknown, handler: unknown) => ({ handler }),
  },
}));

import {
  planMergeBinding,
  pullRequestMergedBinding,
  pullRequestUrlFor,
  type MergeBindingCandidate,
  type MergedPullRequest,
} from "./pull-request-merged-binding";

const REPO = "OpenDigitalProductFactory/opendigitalproductfactory";
const HEAD = "a".repeat(40);
const URL_5228 = `https://github.com/${REPO}/pull/5228`;

const room = (overrides: Partial<MergeBindingCandidate> = {}): MergeBindingCandidate => ({
  id: "row-1",
  capsuleId: "WC-1B73A988",
  repositoryFullName: REPO,
  headBranch: "fix/thing",
  headSha: null,
  pullRequestNumber: null,
  pullRequestUrl: null,
  ...overrides,
});

const merged = (overrides: Partial<MergedPullRequest> = {}): MergedPullRequest => ({
  repositoryFullName: REPO,
  number: 5228,
  headSha: HEAD,
  ...overrides,
});

describe("planMergeBinding", () => {
  it("binds an unbound room to the pull request that merged its branch, with its URL and head", () => {
    expect(planMergeBinding(room(), merged())).toEqual({
      bind: true,
      roomId: "row-1",
      capsuleId: "WC-1B73A988",
      pullRequestNumber: 5228,
      pullRequestUrl: URL_5228,
      headSha: HEAD,
    });
  });

  it("uses the canonical URL form the inventory observation requires", () => {
    expect(pullRequestUrlFor(REPO, 5228)).toBe(URL_5228);
  });

  // The room's recorded head is its own authored fact. The merge webhook may
  // fill a missing one; it never rewrites one.
  it("never overwrites a head the room already recorded", () => {
    const plan = planMergeBinding(room({ headSha: "b".repeat(40) }), merged());
    expect(plan).toMatchObject({ bind: true, headSha: null, pullRequestUrl: URL_5228 });
  });

  it("does not record a malformed head sha", () => {
    expect(planMergeBinding(room(), merged({ headSha: "abc1234" }))).toMatchObject({ bind: true, headSha: null });
  });

  // GitHub re-delivers webhooks. A second delivery must be a no-op, not a
  // second write — the subscriber has to be idempotent by construction rather
  // than by luck.
  it("is idempotent: a re-delivered webhook finds the room already bound", () => {
    expect(planMergeBinding(room({ pullRequestNumber: 5228, pullRequestUrl: URL_5228 }), merged())).toEqual({
      bind: false,
      reason: "already-bound",
    });
  });

  it("completes a binding that carries the number but not the URL", () => {
    expect(planMergeBinding(room({ pullRequestNumber: 5228 }), merged())).toMatchObject({
      bind: true,
      pullRequestNumber: 5228,
      pullRequestUrl: URL_5228,
    });
  });

  // Two answers is a conflict a person should see. Silently repointing would
  // erase the record of which PR actually delivered the room's work.
  it("never repoints a room already bound to a different pull request", () => {
    expect(planMergeBinding(room({ pullRequestNumber: 5001 }), merged())).toEqual({
      bind: false,
      reason: "bound-to-another-pull-request",
    });
    expect(
      planMergeBinding(room({ pullRequestUrl: `https://github.com/${REPO}/pull/5001` }), merged()),
    ).toEqual({ bind: false, reason: "bound-to-another-pull-request" });
  });

  it("reports plainly when no room claims the branch, which is normal", () => {
    expect(planMergeBinding(null, merged())).toEqual({
      bind: false,
      reason: "no-room-for-branch",
    });
  });
});

describe("pullRequestMergedBinding", () => {
  const handler = (pullRequestMergedBinding as unknown as {
    handler: (ctx: unknown) => Promise<Record<string, unknown>>;
  }).handler;
  const step = { run: (_name: string, fn: () => unknown) => fn() };
  const event = {
    data: {
      candidateId: "GPC-1",
      repositoryFullName: REPO,
      number: 5228,
      headRefName: "fix/thing",
      headSha: HEAD,
      mergeCommitSha: "c".repeat(40),
      mergedAt: "2026-09-23T10:00:00Z",
      baseRefName: "main",
      title: "fix: thing",
    },
  };

  beforeEach(() => {
    mockFindFirst.mockReset();
    mockUpdateMany.mockReset();
    mockActivityCreate.mockReset();
  });

  // A branch name alone is shared by every fork and every repository the
  // install tracks. `fix/thing` in another repository is not this room's work.
  it("looks the room up by repository and head branch, not branch alone", async () => {
    mockFindFirst.mockResolvedValue(null);
    const result = await handler({ event, step });
    expect(mockFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { repositoryFullName: REPO, headBranch: "fix/thing", archivedAt: null },
    }));
    expect(result).toMatchObject({ bound: false, reason: "no-room-for-branch" });
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("writes the number, the URL and a missing head, guarded by what it read", async () => {
    mockFindFirst.mockResolvedValue(room());
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockActivityCreate.mockResolvedValue({});

    const result = await handler({ event, step });

    expect(result).toEqual({ bound: true, capsuleId: "WC-1B73A988", number: 5228, headRefName: "fix/thing" });
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "row-1", archivedAt: null, pullRequestNumber: null, pullRequestUrl: null, headSha: null },
      data: { pullRequestNumber: 5228, pullRequestUrl: URL_5228, headSha: HEAD },
    });
    expect(mockActivityCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        workCapsuleId: "row-1",
        kind: "evidence",
        payload: expect.objectContaining({ repositoryFullName: REPO, pullRequestUrl: URL_5228, headShaRecorded: true }),
      }),
    }));
  });

  it("records nothing when the room changed between read and write", async () => {
    mockFindFirst.mockResolvedValue(room());
    mockUpdateMany.mockResolvedValue({ count: 0 });

    const result = await handler({ event, step });

    expect(result).toMatchObject({ bound: false, reason: "room-changed-before-bind" });
    expect(mockActivityCreate).not.toHaveBeenCalled();
  });
});
