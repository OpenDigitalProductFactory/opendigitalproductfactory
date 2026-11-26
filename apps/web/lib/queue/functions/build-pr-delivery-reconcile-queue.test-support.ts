import { expect, it, vi } from "vitest";
import { createBuildPrDeliveryState, writeBuildPrDeliveryState } from "@/lib/build/build-pr-delivery-state";

type QueueTransitionTestContext = {
  mocks: Record<"findMany" | "updateMany" | "observe" | "createIssue" | "fetch" | "publish" | "verdict", ReturnType<typeof vi.fn>>;
  room: (overrides: Record<string, unknown>) => unknown;
  observation: (checks: Array<Record<string, unknown>>, mergeStateStatus?: string) => Record<string, unknown>;
  runBuildPrDeliveryReconcile: typeof import("./build-pr-delivery-reconcile").runBuildPrDeliveryReconcile;
};

export function registerQueueTransitionTests({
  mocks, room, observation, runBuildPrDeliveryReconcile,
}: QueueTransitionTestContext) {
  it("routes a removed group's failure, records the receipt, and observes the next transition", async () => {
    let now = Date.parse("2026-11-25T23:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    let workspaceState: unknown = {};
    mocks.findMany.mockImplementation(async () => [room({ workspaceState })]);
    mocks.updateMany.mockImplementation(async ({ data }) => {
      workspaceState = data.workspaceState;
      return { count: 1 };
    });
    const healthy = observation([{ name: "UX Route Budget Sweep", status: "COMPLETED", conclusion: "SUCCESS" }], "CLEAN");
    mocks.observe.mockResolvedValue({
      ...healthy,
      queueEvent: { kind: "removed", id: "event-1", at: "2026-11-25T22:54:08Z", reason: "failed_checks",
        groupHeadSha: "group1", failingChecks: [{ name: "UX Route Budget Sweep", conclusion: "FAILURE",
          url: "https://github.com/o/r/actions/runs/9" }] },
    });
    try {
      await runBuildPrDeliveryReconcile();
      expect(workspaceState).toMatchObject({ prDelivery: { status: "removed", nextObservationAt: "2026-11-25T23:05:00.000Z",
        queueHold: { owner: "hosted-ci-owner", routeReportId: "PIR-1", groupHeadSha: "group1" } } });
      expect(mocks.createIssue).toHaveBeenCalledTimes(1);
      expect(mocks.createIssue).toHaveBeenCalledWith(expect.objectContaining({
        description: expect.stringContaining("https://github.com/o/r/actions/runs/9"),
      }));

      now += 60_000;
      vi.setSystemTime(now);
      await runBuildPrDeliveryReconcile();
      expect(mocks.observe).toHaveBeenCalledTimes(1);

      now += 4 * 60_000;
      vi.setSystemTime(now);
      mocks.observe.mockResolvedValue({ ...healthy, mergeQueueEntry: true });
      await runBuildPrDeliveryReconcile();
      expect(workspaceState).toMatchObject({ prDelivery: { status: "queued", queueHold: null } });

      mocks.observe.mockResolvedValue({ ...healthy, state: "MERGED", merged: true });
      await runBuildPrDeliveryReconcile();
      expect(workspaceState).toMatchObject({ prDelivery: { status: "awaiting-release" } });
      expect(mocks.createIssue).toHaveBeenCalledTimes(1);
      expect(mocks.fetch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([true, false])("carries enqueue intent only across the accepted base merge (%s)", async (matches) => {
    const from = "a".repeat(40), base = "b".repeat(40), updated = "c".repeat(40);
    let currentHead = from;
    let workspaceState: unknown = writeBuildPrDeliveryState({}, {
      ...createBuildPrDeliveryState({ repository: "o/r", prNumber: 9, prUrl: "https://github.com/o/r/pull/9" }),
      queueIntentHeadSha: from,
    });
    mocks.findMany.mockImplementation(async () => [room({ headSha: currentHead, workspaceState })]);
    mocks.updateMany.mockImplementation(async ({ data }) => {
      workspaceState = data.workspaceState;
      currentHead = data.headSha ?? currentHead;
      return { count: 1 };
    });
    const green = [{ name: "Failure Readiness", status: "COMPLETED", conclusion: "SUCCESS" }];
    mocks.observe.mockResolvedValue({ ...observation(green, "BEHIND"), headSha: from, baseSha: base });
    mocks.fetch.mockImplementation(async (_url, init) => init?.method === "PUT"
      ? new Response(null, { status: 202 })
      : Response.json({ data: { enablePullRequestAutoMerge: { pullRequest: { number: 9 } } } }));
    await runBuildPrDeliveryReconcile();
    expect(workspaceState).toMatchObject({ prDelivery: { status: "updating",
      pendingQueueUpdate: { fromHeadSha: from, baseSha: base } } });

    // The API is asynchronous. A green read of the old head cannot arm it while the update is pending.
    mocks.observe.mockResolvedValue({ ...observation(green, "CLEAN"), headSha: from, baseSha: base });
    await runBuildPrDeliveryReconcile();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.publish).not.toHaveBeenCalled();

    mocks.observe.mockResolvedValue({ ...observation(green, "CLEAN"), headSha: updated, baseSha: base,
      headParentShas: [from, matches ? base : "d".repeat(40)] });
    await runBuildPrDeliveryReconcile();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(workspaceState).toMatchObject({ prDelivery: { queueIntentHeadSha: matches ? updated : from } });

    mocks.verdict.mockImplementation(async () => {
      expect(currentHead).toBe(updated);
      return { mayPublish: true, reason: "reviewed" };
    });
    await runBuildPrDeliveryReconcile();
    if (matches) {
      expect(mocks.fetch).toHaveBeenCalledTimes(2);
      expect(String(mocks.fetch.mock.calls[1]?.[1]?.body)).toContain(`"expectedHeadOid":"${updated}"`);
      expect(workspaceState).toMatchObject({ prDelivery: { status: "armed" } });
    } else {
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
      expect(workspaceState).toMatchObject({ prDelivery: { lastError: "queue-intent-required" } });
    }
  });
}
