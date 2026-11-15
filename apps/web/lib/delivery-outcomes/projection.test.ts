import { describe, expect, it } from "vitest";
import { projectDeliveryOutcomes, type OutcomeInput, type OutcomeRoom } from "./projection";
const now = new Date("2026-10-29T12:00:00Z");
const at = (day: number) => new Date(`2026-10-${String(day).padStart(2, "0")}T12:00:00Z`);
const head = "a".repeat(40);
const room = (overrides: Partial<OutcomeRoom> = {}): OutcomeRoom => ({
    id: "row1", capsuleId: "WC-1", title: "Deliver outcome", status: "complete",
    repositoryFullName: "org/repo", headBranch: "feat/one", headSha: head,
    backlogItemId: "BI-1", epicId: "EP-1", executorKind: "codex-desktop", executorRef: "thread1",
    featureBuildId: null, taskRunId: "task1", createdAt: at(2), claimedAt: at(2), updatedAt: at(20),
    pullRequestNumber: 1, ...overrides,
});
const input = (overrides: Partial<OutcomeInput> = {}): OutcomeInput => ({
    now, rooms: [room()], activities: [], verifications: [], runs: [], tasks: [], tools: [], queue: [],
    pullRequests: [], sources: [], ...overrides,
});
describe("delivery outcome observations", () => {
    it("counts tool calls only through the explicit task tree, even when chats are shared", () => {
        const tool = (id: string, taskRunId: string) => ({ id, taskRunId, threadId: "thread1", toolName: "fixture", success: id !== "child", envelopeId: id });
        const result = projectDeliveryOutcomes(input({ tasks: [{ id: "task1", parentTaskRunId: null, threadId: "thread1" }, { id: "child-task", parentTaskRunId: "task1", threadId: "child" }], tools: [tool("root", "task1"), tool("child", "child-task"), tool("foreign", "other-room-task")] }));
        expect(result.observations[0].attention).toMatchObject({ toolCalls: 2, failedToolCalls: 1, approvals: 2 });
    });
    it.each(["partial", "failed"] as const)("withholds costs when run coverage is %s", state => {
        const run = { id: "qualified", threadId: "thread1", buildId: "build-one", modelId: "m", providerId: "p", adapterKind: "claude-cli", startedAt: at(10), inputTokens: 100, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 10, reasoningTokens: 0, estimatedCostUsd: 1, investmentInstallationRef: null };
        const result = projectDeliveryOutcomes(input({ rooms: [room({ featureBuildId: "build-one", taskRunId: null })], runs: [run], sources: [{ key: "runs", state, count: 1, observedAt: now.toISOString(), note: state === "partial" ? "rowsLimited" : "readUnavailable" }] }));
        expect(result.observations[0].economy.runIds).toEqual(["qualified"]);
        expect(result.observations[0].economy.exclusive).toMatchObject({ inputTokens: null, apiEquivalentUsd: null, complete: false });
    });
    it.each(["partial", "failed"] as const)("withholds inclusive cost when descendant history is %s", state => {
        const run = { id: "qualified", threadId: "thread1", buildId: "build-one", modelId: "m", providerId: "p", adapterKind: "claude-cli", startedAt: at(10), inputTokens: 100, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 10, reasoningTokens: 0, estimatedCostUsd: 1, investmentInstallationRef: null };
        const result = projectDeliveryOutcomes(input({ rooms: [room({ featureBuildId: "build-one" })], runs: [run], tasks: [{ id: "task1", parentTaskRunId: null, threadId: "thread1", buildId: "build-one" }], sources: [{ key: "tasks", state, count: 1, observedAt: now.toISOString(), note: state === "partial" ? "rowsLimited" : "readUnavailable" }] }));
        expect(result.observations[0].economy.exclusive.apiEquivalentUsd).toBe(1);
        expect(result.observations[0].economy.inclusive).toMatchObject({ inputTokens: null, apiEquivalentUsd: null, complete: false });
    });
    it("does not infer exclusive thread ownership from a single visible room", () => {
        const run = { id: "unbound", threadId: "thread1", buildId: null, modelId: "m", providerId: "p", adapterKind: "claude-cli", startedAt: at(10), inputTokens: 100, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 10, reasoningTokens: 0, estimatedCostUsd: 1, investmentInstallationRef: null };
        const result = projectDeliveryOutcomes(input({ rooms: [room({ taskRunId: null })], runs: [run] }));
        expect(result.observations[0].economy.runIds).toEqual([]);
        expect(result.observations[0].economy.inclusive.apiEquivalentUsd).toBeNull();
        expect(result.state).toBe("partial");
    });
    it("does not override an explicit build binding with a shared executor thread", () => {
        const run = { id: "bound-run", threadId: "thread1", buildId: "build-A", modelId: "model", providerId: "anthropic", adapterKind: "claude-cli", startedAt: at(10), inputTokens: 100, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 10, reasoningTokens: 0, estimatedCostUsd: 1, investmentInstallationRef: null };
        const result = projectDeliveryOutcomes(input({ rooms: [room({ featureBuildId: "build-A" }), room({ id: "row2", capsuleId: "WC-2", featureBuildId: "build-B" })], runs: [run] }));
        expect(result.observations[0].economy.runIds).toEqual(["bound-run"]);
        expect(result.observations[1].economy.runIds).toEqual([]);
        expect(result.observations[1].economy.descendantRunIds).toEqual([]);
        expect(result.observations[1].economy.exclusive.apiEquivalentUsd).toBeNull();
    });
    it("does not assign a thread-only run to two Workrooms sharing that executor", () => {
        const run = { id: "unbound-run", threadId: "thread1", buildId: null, modelId: "model", providerId: "anthropic", adapterKind: "claude-cli", startedAt: at(10), inputTokens: 100, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 10, reasoningTokens: 0, estimatedCostUsd: 1, investmentInstallationRef: null };
        const result = projectDeliveryOutcomes(input({ rooms: [room(), room({ id: "row2", capsuleId: "WC-2" })], runs: [run] }));
        expect(result.observations.every(o => o.economy.runIds.length === 0 && o.economy.descendantRunIds.length === 0)).toBe(true);
        expect(result.observations.every(o => o.economy.exclusive.apiEquivalentUsd === null && !o.economy.exclusive.complete)).toBe(true);
        expect(result.state).toBe("partial");
    });
    it("reports milestone denominators without converting room creation into a claim", () => {
        const result = projectDeliveryOutcomes(input({ rooms: [room({ claimedAt: null })] }));
        expect(result.milestoneCounts.find(m => m.key === "claimed")).toEqual({ key: "claimed", count: 0, missing: 1 });
        expect(result.milestoneCounts.find(m => m.key === "firstCommit")).toEqual({ key: "firstCommit", count: 0, missing: 1 });
    });
    it("does not qualify historical verification using a mutable target's current SHA", () => {
        const result = projectDeliveryOutcomes(input({ verifications: [{ id: "rv-old", workCapsuleId: "row1", kind: "final-acceptance", status: "passed", completedAt: at(22), evidenceUrl: "https://example.test/acceptance", runtimeTarget: { targetId: "RT-1", acceptanceRole: "final-acceptance", servedCommitSha: head } }] }));
        expect(result.verified).toBe(0);
    });
    it("filters normalized model/campaign cohorts before aggregation and preserves the fixed period", () => {
        const result = projectDeliveryOutcomes(input({ rooms: [room(), room({ id: "r2", capsuleId: "WC-2", epicId: "EP-other" })], filters: { dimension: "campaign", query: "EP-other" } }));
        expect(result.observations.map(r => r.capsuleId)).toEqual(["WC-2"]);
        expect(result.stages[0].incomplete).toBe(1);
        expect(result.cohort.start).toBe("2026-09-29T12:00:00.000Z");
    });
    it("does not double count held time already included in canonical wait", () => {
        const queue = [
            { queueKey: "wr:medium@1:plan", itemKind: "workroom-stage", itemId: "WC-1:run", transition: "enqueued", outcome: null, occurredAt: at(10) },
            { queueKey: "wr:medium@1:plan", itemKind: "workroom-stage", itemId: "WC-1:run", transition: "started", outcome: null, occurredAt: at(10) },
            { queueKey: "wr:medium@1:plan", itemKind: "workroom-stage", itemId: "WC-1:run", transition: "held", outcome: null, occurredAt: at(11) },
            { queueKey: "wr:medium@1:plan", itemKind: "workroom-stage", itemId: "WC-1:run", transition: "released", outcome: null, occurredAt: at(12) },
            { queueKey: "wr:medium@1:plan", itemKind: "workroom-stage", itemId: "WC-1:run", transition: "finished", outcome: "success", occurredAt: at(13) },
        ];
        const result = projectDeliveryOutcomes(input({ queue }));
        expect(result.observations[0].durations.wait).toBe(86400000);
        expect(result.observations[0].durations.process).toBe(2 * 86400000);
    });
    it("withholds merged-to-verified duration for reversed or future verification", () => {
        const result = projectDeliveryOutcomes(input({ verifications: [{ id: "future", workCapsuleId: "row1", kind: "final-acceptance", status: "passed", completedAt: new Date("2026-11-01"), evidenceUrl: "https://example.test", runtimeTarget: { targetId: "RT", acceptanceRole: "final-acceptance", servedCommitSha: head } }] }));
        expect(result.verified).toBe(0);
    });
    it("freezes a created-in-window cohort, deduplicates rooms and excludes future/old claims", () => {
        const result = projectDeliveryOutcomes(input({ rooms: [room(), room(), room({ id: "old", capsuleId: "WC-old", createdAt: new Date("2026-08-01") }), room({ id: "future", capsuleId: "WC-future", createdAt: new Date("2026-11-01") })] }));
        expect(result.observations.map(r => r.capsuleId)).toEqual(["WC-1"]);
        expect(result.version).toBe("DeliveryOutcomeObservation@1");
        expect(result.cohort.start).toBe("2026-09-29T12:00:00.000Z");
        expect(result.stages.find(s => s.key === "cycle")).toMatchObject({ sample: 0, incomplete: 1, p50Ms: null, p90Ms: null });
    });
    it("does not mistake a completed room, preview or generic passed check for verified delivery", () => {
        const result = projectDeliveryOutcomes(input({ verifications: [
                { id: "rv1", workCapsuleId: "row1", kind: "test", status: "passed", completedAt: at(20), evidenceUrl: "https://example.test/check", runtimeTarget: { targetId: "RT-1", acceptanceRole: "preview", servedCommitSha: head } },
                { id: "rv2", workCapsuleId: "row1", kind: "final-acceptance", status: "passed", completedAt: at(21), evidenceUrl: "https://example.test/check", runtimeTarget: { targetId: "RT-2", acceptanceRole: "final-acceptance", servedCommitSha: "b".repeat(40) } },
            ] }));
        expect(result.verified).toBe(0);
        expect(result.observations[0].milestones.verified).toBeNull();
        expect(result.quality.firstPass).toMatchObject({ numerator: 0, denominator: 0, unknown: 1 });
    });
    it("qualifies final acceptance to source and target and uses only valid duration pairs", () => {
        const result = projectDeliveryOutcomes(input({ rooms: [room(), room({ id: "row2", capsuleId: "WC-2" })],
            verifications: [{ id: "rv", workCapsuleId: "row1", kind: "final-acceptance", status: "passed", completedAt: at(22), evidenceUrl: "https://example.test/acceptance", sourceBinding: { workCapsuleId: "row1", headSha: head, servedSha: head, completedAt: at(22).toISOString(), targetRef: "upgrade-proof" }, runtimeTarget: { targetId: "RT-1", acceptanceRole: "final-acceptance", servedCommitSha: head } }] }));
        expect(result.verified).toBe(1);
        expect(result.stages.find(s => s.key === "cycle")).toMatchObject({ sample: 1, incomplete: 1, p50Ms: 20 * 86400000, p90Ms: 20 * 86400000 });
        expect(result.observations[0].evidence).toContainEqual({ label: "Final acceptance", href: "https://example.test/acceptance" });
    });
    it("deduplicates descendant run identity, prevents cyclic ancestry and keeps money classes separate", () => {
        const run = { id: "run1", threadId: "thread1", buildId: "build-parent", modelId: "model", providerId: "anthropic", adapterKind: "claude-cli", startedAt: at(10), inputTokens: 17, cachedInputTokens: 300, cacheCreationInputTokens: 120, outputTokens: 50, reasoningTokens: null, estimatedCostUsd: 0.02, investmentInstallationRef: "install1" };
        const child = { ...run, id: "run2", threadId: "child", buildId: "build-child", inputTokens: 3 };
        const result = projectDeliveryOutcomes(input({ rooms: [room({ featureBuildId: "build-parent" })], runs: [run, run, child], tasks: [{ id: "task1", parentTaskRunId: "task2", threadId: "thread1", buildId: "build-parent" }, { id: "task2", parentTaskRunId: "task1", threadId: "child", buildId: "build-child" }] }));
        const economy = result.observations[0].economy;
        expect(economy.exclusive.runCount).toBe(1);
        expect(economy.inclusive.runCount).toBe(2);
        expect(economy.inclusive.inputTokens).toBe(20);
        expect(economy.inclusive.cachedInputTokens).toBe(600);
        expect(economy.inclusive.reasoningTokens).toBeNull();
        expect(economy.inclusive.apiEquivalentUsd).toBe(0.04);
        expect(economy.inclusive.invoicedUsd).toBeNull();
        expect(economy.inclusive.subscriptionUsd).toBeNull();
    });
    it("reuses queue reconstruction for process/wait, retains missing and failed sources", () => {
        const queue = [
            { queueKey: "wr:delivery-medium@1.0.0:implement", itemKind: "workroom-stage", itemId: "WC-1:run", transition: "enqueued", outcome: null, occurredAt: at(10) },
            { queueKey: "wr:delivery-medium@1.0.0:implement", itemKind: "workroom-stage", itemId: "WC-1:run", transition: "started", outcome: null, occurredAt: at(11) },
            { queueKey: "wr:delivery-medium@1.0.0:implement", itemKind: "workroom-stage", itemId: "WC-1:run", transition: "finished", outcome: "success", occurredAt: at(13) },
        ];
        const result = projectDeliveryOutcomes(input({ queue, sources: [{ key: "tools", state: "failed", count: 0, observedAt: now.toISOString(), note: "readUnavailable" }] }));
        expect(result.stages.find(s => s.key === "process")).toMatchObject({ p50Ms: 2 * 86400000 });
        expect(result.stages.find(s => s.key === "wait")).toMatchObject({ p50Ms: 86400000 });
        expect(result.state).toBe("partial");
        expect(result.observations[0].attention.toolCalls).toBeNull();
    });
    it("does not invent uncached tokens for ambiguous providers or sum incomplete runs as complete", () => {
        const result = projectDeliveryOutcomes(input({ rooms: [room({ featureBuildId: "build-one", taskRunId: null })], runs: [{ id: "r", threadId: "thread1", buildId: "build-one", modelId: "m", providerId: "unknown", adapterKind: "unknown", startedAt: at(10), inputTokens: 100, cachedInputTokens: 20, cacheCreationInputTokens: null, outputTokens: 5, reasoningTokens: null, estimatedCostUsd: null, investmentInstallationRef: null }] }));
        expect(result.observations[0].economy.exclusive.inputTokens).toBeNull();
        expect(result.observations[0].economy.exclusive.complete).toBe(false);
    });
});
