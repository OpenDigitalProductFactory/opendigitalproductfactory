import { describe, expect, it, vi } from "vitest";
import { loadDeliveryOutcomes } from "./read-model";
import { type OutcomeRoom } from "./projection";
const now = new Date("2026-10-29T12:00:00Z");
const room: OutcomeRoom = { id: "r1", capsuleId: "WC-1", title: "Visible", status: "working", createdAt: new Date("2026-10-02"), updatedAt: now, repositoryFullName: "org/repo", headBranch: "feat/one", headSha: "a".repeat(40), backlogItemId: "BI-1", epicId: "EP-1", executorKind: "codex-desktop", executorRef: "thread1", featureBuildId: null, taskRunId: null, pullRequestNumber: 1 };
function fixture() {
    const many = () => ({ findMany: vi.fn().mockResolvedValue([]) });
    const db = { workroom: many(), workroomActivity: many(), runtimeVerification: many(), taskRun: many(), adapterRunTelemetry: many(), toolExecution: many(), queueTelemetryEvent: many(), contributorInventorySyncRun: { findFirst: vi.fn().mockResolvedValue(null) }, contributorInventorySnapshot: many() };
    db.workroom.findMany.mockResolvedValue([room, { ...room, id: "hidden", capsuleId: "WC-hidden", executorRef: "private-thread" }]);
    return { db, canReadRoom: vi.fn(async (id: string) => id === "r1") };
}
describe("bounded delivery outcome reader", () => {
    it("reads only explicit task roots and their descendants, retaining child build bindings", async () => {
        const f = fixture();
        f.db.workroom.findMany.mockResolvedValue([{ ...room, taskRunId: "root" }]);
        f.db.taskRun.findMany.mockResolvedValueOnce([{ id: "root", parentTaskRunId: null, threadId: "thread1", buildId: "build-root" }]).mockResolvedValueOnce([{ id: "child", parentTaskRunId: "root", threadId: null, buildId: "build-child" }]).mockResolvedValue([]);
        await loadDeliveryOutcomes({ ...f, now, userId: "user1" });
        expect(f.db.taskRun.findMany.mock.calls[0][0].where).toEqual({ userId: "user1", id: { in: ["root"] } });
        expect(f.db.taskRun.findMany.mock.calls[0][0].select.buildId).toBe(true);
        const query = f.db.adapterRunTelemetry.findMany.mock.calls[0][0];
        expect(query.where.OR).toContainEqual({ buildId: { in: expect.arrayContaining(["build-root", "build-child"]) } });
        expect(JSON.stringify(f.db.taskRun.findMany.mock.calls[0][0].where)).not.toContain("thread1");
    });
    it("authorizes each Workroom before querying facts or aggregating; hidden rooms never enter query scope", async () => {
        const f = fixture();
        const data = await loadDeliveryOutcomes({ ...f, now, userId: "user1" });
        expect(data.observations.map(r => r.capsuleId)).toEqual(["WC-1"]);
        expect(f.canReadRoom).toHaveBeenCalledWith("hidden");
        expect(JSON.stringify(f.db.runtimeVerification.findMany.mock.calls)).not.toContain("hidden");
        expect(JSON.stringify(f.db.adapterRunTelemetry.findMany.mock.calls)).not.toContain("private-thread");
        expect(f.db.workroom.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ createdAt: { gte: new Date("2026-09-29T12:00:00Z"), lte: now } }), take: 101 }));
    });
    it("returns independent failed/empty source states without erasing confirmed room facts", async () => {
        const f = fixture();
        f.db.toolExecution.findMany.mockRejectedValue(new Error("private database details"));
        const data = await loadDeliveryOutcomes({ ...f, now, userId: "user1" });
        expect(data.state).toBe("partial");
        expect(data.observations).toHaveLength(1);
        expect(data.sources.find(s => s.key === "tools")).toMatchObject({ state: "failed", note: "readUnavailable" });
        expect(JSON.stringify(data)).not.toContain("private database details");
        for (const key of ["workroomActivity", "runtimeVerification", "adapterRunTelemetry", "toolExecution", "queueTelemetryEvent"] as const)
            expect(f.db[key].findMany.mock.calls[0]?.[0]).toHaveProperty("take");
    });
    it("reads latest-successful PR source and retained holder pointer; exposes stale data", async () => {
        const f = fixture();
        f.db.contributorInventorySyncRun.findFirst.mockResolvedValue({ syncRunId: "new", startedAt: new Date("2026-10-01"), completedAt: null, perSourceResult: { "github-pr": { ok: true, snapshotRunId: "retained" } } });
        const data = await loadDeliveryOutcomes({ ...f, now, userId: "user1" });
        expect(f.db.contributorInventorySyncRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { perSourceResult: { path: ["github-pr", "ok"], equals: true } } }));
        expect(f.db.contributorInventorySnapshot.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ syncRunId: "retained", source: "github-pr" }), take: 1001 }));
        expect(data.sources.find(s => s.key === "pullRequests")?.state).toBe("stale");
    });
    it("fails closed for room visibility failure and performs no auxiliary reads", async () => {
        const f = fixture();
        f.canReadRoom.mockRejectedValue(new Error("access unavailable"));
        const data = await loadDeliveryOutcomes({ ...f, now, userId: "user1" });
        expect(data.observations).toEqual([]);
        expect(data.state).toBe("failed");
        expect(f.db.adapterRunTelemetry.findMany).not.toHaveBeenCalled();
    });
});
