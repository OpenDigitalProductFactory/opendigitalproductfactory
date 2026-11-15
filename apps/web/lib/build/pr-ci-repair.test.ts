// BI-085A37EC: a Build Studio PR that goes red on a required check is sent back
// to the build's own repair loop, and the repair lands as a follow-up commit.
// FB-2F2D46D5 / PR #6983 (2026-11-12) was red on Typecheck (mobile) and Unit
// tests (mobile jest) and its repair was only staged for a person.
import { describe, expect, it, vi } from "vitest";

import type { PrRepairPacket } from "./pr-follow-through";
import {
  PR_CI_REPAIR_TOOL,
  PR_FOLLOW_UP_PREFIX,
  PR_FOLLOW_UP_UNCHANGED,
  PR_FOLLOW_UP_UNCHANGED_PREFIX,
} from "./pr-ci-repair-markers";
import { dispatchBuildPrCiRepair, failingLogExcerpt, jobIdFromRunUrl, type PrCiRepairDeps } from "./pr-ci-repair";
import { pendingPrFollowUpHead, resolvePrFollowUpSource } from "./pr-ci-follow-up";

const HEAD = "29f7612a3a3f443fed43e3aa8b0e784b2e152021";

function packet(overrides: Partial<PrRepairPacket> = {}): PrRepairPacket {
  return {
    headSha: HEAD,
    failureClass: "post-push-ci-failure",
    attempt: 1,
    bound: 2,
    constraints: [],
    failingChecks: [
      {
        name: "Unit tests (mobile jest)",
        conclusion: "FAILURE",
        class: "defect",
        runUrl: "https://github.com/o/r/actions/runs/43175327549/job/131038076580",
        workflowRunId: 43175327549,
      },
      {
        name: "Policy Guards (recheck)",
        conclusion: "CANCELLED",
        class: "infrastructure",
        runUrl: "https://github.com/o/r/actions/runs/43175329260/job/131038082184",
        workflowRunId: 43175329260,
      },
    ],
    ...overrides,
  };
}

function deps(overrides: Partial<PrCiRepairDeps> = {}): PrCiRepairDeps {
  return {
    phaseOf: vi.fn().mockResolvedValue("ship"),
    readJobLog: vi.fn().mockResolvedValue(
      "setup\nFAIL src/features/visitor/cart.test.ts\n  Cannot find module '@/src/features/visitor/cart'\nTests: 1 failed\n",
    ),
    returnToReview: vi.fn().mockResolvedValue(true),
    routeToRepair: vi.fn().mockResolvedValue("repair-queued"),
    queueReview: vi.fn().mockResolvedValue(undefined),
    record: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("dispatchBuildPrCiRepair", () => {
  it("hands the failing required checks and their logs to the build's repair loop", async () => {
    const d = deps();
    await expect(dispatchBuildPrCiRepair({ buildId: "FB-2F2D46D5", packet: packet() }, d)).resolves.toBe("dispatched");

    expect(d.returnToReview).toHaveBeenCalledWith("FB-2F2D46D5");
    expect(d.readJobLog).toHaveBeenCalledWith(131038076580);
    const [, failure] = vi.mocked(d.routeToRepair).mock.calls[0];
    expect(failure.source).toBe("tests");
    // Only the defect is repaired; the infrastructure check is not code to fix.
    expect(failure.failedGuards).toEqual(["Unit tests (mobile jest)"]);
    const finding = failure.findings?.[0]?.description ?? "";
    expect(finding).toContain("Unit tests (mobile jest)");
    expect(finding).toContain("job/131038076580");
    expect(finding).toContain("Cannot find module '@/src/features/visitor/cart'");
    expect(d.record).toHaveBeenCalledWith("FB-2F2D46D5", expect.stringContaining(`[dispatched head=${HEAD}]`));
    expect(d.queueReview).not.toHaveBeenCalled();
  });

  it("dispatches nothing for a build that is not in ship", async () => {
    const d = deps({ phaseOf: vi.fn().mockResolvedValue("build") });
    await expect(dispatchBuildPrCiRepair({ buildId: "FB-1", packet: packet() }, d)).resolves.toBe("unavailable");
    expect(d.returnToReview).not.toHaveBeenCalled();
    expect(d.routeToRepair).not.toHaveBeenCalled();
  });

  it("dispatches nothing when no failing check is a defect", async () => {
    const d = deps();
    const infraOnly = packet({ failingChecks: packet().failingChecks.filter((c) => c.class !== "defect") });
    await expect(dispatchBuildPrCiRepair({ buildId: "FB-1", packet: infraOnly }, d)).resolves.toBe("unavailable");
    expect(d.returnToReview).not.toHaveBeenCalled();
  });

  it("still repairs when a job log cannot be read, naming the check and its run", async () => {
    const d = deps({ readJobLog: vi.fn().mockRejectedValue(new Error("HTTP 403 rate limit")) });
    await expect(dispatchBuildPrCiRepair({ buildId: "FB-1", packet: packet() }, d)).resolves.toBe("dispatched");
    const [, failure] = vi.mocked(d.routeToRepair).mock.calls[0];
    expect(failure.findings?.[0]?.description).toContain("job/131038076580");
  });

  it("re-verifies instead and reports unavailable when the repair loop does not take it", async () => {
    const d = deps({ routeToRepair: vi.fn().mockResolvedValue("escalated") });
    await expect(dispatchBuildPrCiRepair({ buildId: "FB-1", packet: packet() }, d)).resolves.toBe("unavailable");
    expect(d.queueReview).toHaveBeenCalledWith("FB-1");
    expect(d.record).not.toHaveBeenCalledWith("FB-1", expect.stringContaining("[dispatched"));
  });

  it("reports unavailable when the build cannot leave ship", async () => {
    const d = deps({ returnToReview: vi.fn().mockResolvedValue(false) });
    await expect(dispatchBuildPrCiRepair({ buildId: "FB-1", packet: packet() }, d)).resolves.toBe("unavailable");
    expect(d.routeToRepair).not.toHaveBeenCalled();
  });
});

describe("pendingPrFollowUpHead", () => {
  const dispatched = { tool: PR_CI_REPAIR_TOOL, summary: `[dispatched head=${HEAD}] attempt 1 of 2: Unit tests (mobile jest)` };

  it("is the dispatched head until a follow-up settles it", () => {
    expect(pendingPrFollowUpHead([])).toBeNull();
    expect(pendingPrFollowUpHead([dispatched])).toBe(HEAD);
    expect(pendingPrFollowUpHead([dispatched, { tool: "auto_open_pr", summary: `${PR_FOLLOW_UP_PREFIX} PR #6983 created.` }])).toBeNull();
    expect(pendingPrFollowUpHead([dispatched, { tool: "auto_open_pr", summary: `${PR_FOLLOW_UP_UNCHANGED_PREFIX} x` }])).toBeNull();
  });

  it("stays pending across a refused follow-up attempt and follows the latest dispatch", () => {
    const refused = { tool: "auto_open_pr", summary: "Pull request not opened; a publication guard refused: x" };
    expect(pendingPrFollowUpHead([dispatched, refused])).toBe(HEAD);
    const settled = { tool: "auto_open_pr", summary: `${PR_FOLLOW_UP_PREFIX} done` };
    const second = { tool: PR_CI_REPAIR_TOOL, summary: "[dispatched head=abc123def456] attempt 2 of 2: X" };
    expect(pendingPrFollowUpHead([dispatched, settled, second])).toBe("abc123def456");
  });
});

describe("log reading", () => {
  it("finds the job id in a check run URL", () => {
    expect(jobIdFromRunUrl("https://github.com/o/r/actions/runs/1/job/131038076580")).toBe(131038076580);
    expect(jobIdFromRunUrl("https://probot.github.io/apps/dco/")).toBeNull();
    expect(jobIdFromRunUrl(null)).toBeNull();
  });

  it("keeps the error lines and the tail, bounded", () => {
    const log = [
      ...Array.from({ length: 500 }, (_, i) => `2026-11-12T07:30:00.0000000Z noise ${i}`),
      "2026-11-12T07:30:01.0000000Z error TS2307: Cannot find module './cart'",
      ...Array.from({ length: 100 }, (_, i) => `2026-11-12T07:30:02.0000000Z more ${i}`),
    ].join("\n");
    const excerpt = failingLogExcerpt(log);
    expect(excerpt).toContain("error TS2307: Cannot find module './cart'");
    expect(excerpt).not.toContain("2026-11-12T07:30:01");
    expect(excerpt).toContain("more 99");
    expect(excerpt).not.toContain("noise 10\n");
    expect(excerpt.length).toBeLessThanOrEqual(4000);
  });
});

describe("resolvePrFollowUpSource", () => {
  function github(routes: Record<string, { status: number; body: unknown }>) {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      const hit = Object.entries(routes).find(([suffix]) => url.endsWith(suffix));
      const res = hit?.[1] ?? { status: 404, body: {} };
      return { ok: res.status < 300, status: res.status, json: async () => res.body, text: async () => "" } as Response;
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  }

  it("builds on the PR head and restores a path the repaired change no longer touches", async () => {
    const { fetchImpl } = github({
      [`/git/commits/${HEAD}`]: { status: 200, body: { tree: { sha: "head-tree" } } },
      [`/compare/main...${HEAD}`]: {
        status: 200,
        body: {
          merge_base_commit: { sha: "base-1" },
          files: [{ filename: "apps/mobile/a.ts" }, { filename: "apps/mobile/dropped.ts" }, { filename: "apps/mobile/added.ts" }],
        },
      },
      "/contents/apps/mobile/dropped.ts?ref=base-1": { status: 200, body: { sha: "blob-at-base", type: "file" } },
      "/contents/apps/mobile/added.ts?ref=base-1": { status: 404, body: {} },
    });
    const source = await resolvePrFollowUpSource({
      owner: "o", repo: "r", baseBranch: "main", headSha: HEAD, token: "t", fetchImpl,
      diffPaths: ["apps/mobile/a.ts"],
    });
    expect(source).toEqual({
      commitSha: HEAD,
      treeSha: "head-tree",
      restore: [
        { path: "apps/mobile/dropped.ts", sha: "blob-at-base" },
        { path: "apps/mobile/added.ts", sha: null },
      ],
    });
  });

  it("throws rather than guess when the PR head cannot be read", async () => {
    const { fetchImpl } = github({});
    await expect(resolvePrFollowUpSource({
      owner: "o", repo: "r", baseBranch: "main", headSha: HEAD, token: "t", fetchImpl, diffPaths: ["a"],
    })).rejects.toThrow(/could not read/i);
  });
});

it("names the unchanged-repair sentinel the publisher throws", () => {
  expect(PR_FOLLOW_UP_UNCHANGED).toMatch(/changed nothing/);
});
