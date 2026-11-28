import { expect, it, type Mock } from "vitest";

export function registerRepairHandoffTests({
  mocks, buildRoom, red, runBuildPrDeliveryReconcile,
}: {
  mocks: Record<"dispatch" | "createIssue" | "findMany" | "observe" | "updateMany" | "fetch" | "resolveRecipient" | "notifyStrict", Mock>;
  buildRoom: (overrides?: Record<string, unknown>) => unknown;
  red: () => unknown;
  runBuildPrDeliveryReconcile: () => Promise<unknown>;
}) {
  const latestWorkspace = () => mocks.updateMany.mock.calls
    .filter(([write]) => write.where.id === "build-room").at(-1)?.[0].data.workspaceState;
  const persist = (overrides?: Record<string, unknown>) => {
    mocks.findMany.mockResolvedValue([buildRoom({ workspaceState: latestWorkspace(), ...overrides })]);
  };

  it("retries an undelivered same-head repair handoff without replaying the repair", async () => {
    mocks.dispatch.mockResolvedValue("unavailable");
    mocks.createIssue.mockRejectedValueOnce(new Error("report store unavailable"));
    mocks.resolveRecipient.mockResolvedValue("operator-1");
    mocks.notifyStrict.mockResolvedValue({ created: true });
    mocks.findMany.mockResolvedValue([buildRoom()]);
    mocks.observe.mockResolvedValue(red());
    await runBuildPrDeliveryReconcile();

    expect(latestWorkspace().prDelivery.followThrough.hold).toBe("awaiting-person");
    expect(latestWorkspace().prDelivery.followThrough.attempts.attempts["post-push-ci-failure"]).toBeUndefined();
    expect(latestWorkspace().prFollowThroughHandoff).toMatchObject({ headSha: "sha1", disposition: { kind: "route-error" } });
    expect(mocks.createIssue).toHaveBeenCalledTimes(1);
    persist();
    await runBuildPrDeliveryReconcile();
    expect(latestWorkspace().prFollowThroughHandoff).toMatchObject({
      disposition: { kind: "routed", route: "human", reportId: "PIR-1", ownerUserId: "operator-1" },
    });
    persist();
    await runBuildPrDeliveryReconcile();

    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.createIssue).toHaveBeenCalledTimes(2);
    expect(mocks.createIssue.mock.calls[0][0].dedupeKey).toBe(mocks.createIssue.mock.calls[1][0].dedupeKey);
    expect(mocks.notifyStrict).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ itemKey: "PIR-1", userId: "operator-1" }));
  });

  it("keeps a report with no recipient or failed notice pending until the same-head recipient is reached", async () => {
    mocks.dispatch.mockResolvedValue("unavailable");
    mocks.resolveRecipient.mockResolvedValueOnce(null).mockResolvedValue("operator-1");
    mocks.notifyStrict.mockRejectedValueOnce(new Error("notification store unavailable")).mockResolvedValue({ created: true });
    mocks.findMany.mockResolvedValue([buildRoom()]);
    mocks.observe.mockResolvedValue(red());
    await runBuildPrDeliveryReconcile();
    expect(latestWorkspace().prFollowThroughHandoff.disposition).toEqual({ kind: "no-recipient" });
    expect(mocks.notifyStrict).not.toHaveBeenCalled();
    persist();
    await runBuildPrDeliveryReconcile();
    expect(latestWorkspace().prFollowThroughHandoff.disposition).toEqual({ kind: "route-error" });
    persist();
    await runBuildPrDeliveryReconcile();
    expect(latestWorkspace().prFollowThroughHandoff.disposition).toMatchObject({ kind: "routed", ownerUserId: "operator-1" });
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("does not route a persisted ask after its head is stale or the room authority changes", async () => {
    mocks.dispatch.mockResolvedValue("unavailable");
    mocks.resolveRecipient.mockResolvedValueOnce(null).mockResolvedValue("operator-1");
    mocks.findMany.mockResolvedValue([buildRoom({ leaseHolderPrincipalId: "owner-1" })]);
    mocks.observe.mockResolvedValue(red());
    await runBuildPrDeliveryReconcile();
    const workspaceState = latestWorkspace();
    mocks.findMany.mockResolvedValue([buildRoom({ workspaceState, headSha: "sha2", leaseHolderPrincipalId: "owner-1" })]);
    await runBuildPrDeliveryReconcile();
    mocks.findMany.mockResolvedValue([buildRoom({ workspaceState, leaseHolderPrincipalId: "owner-2" })]);
    await runBuildPrDeliveryReconcile();
    expect(latestWorkspace().prFollowThroughHandoff).toBeNull();
    expect(mocks.createIssue).toHaveBeenCalledTimes(1);
    expect(mocks.notifyStrict).not.toHaveBeenCalled();
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
}
