import type { prisma } from "@dpf/db";
import { parseVerifiedPullRequestObservation } from "@/lib/contributor-change-lanes/pull-request-observation";
import { isRecord } from "@/lib/shared/coerce";
import { readSmallAcceptanceBinding, SMALL_ACCEPTANCE_KEY } from "@/lib/runtime-coordination/small-acceptance-binding";
import { projectDeliveryOutcomes, type OutcomeInput, type OutcomeSource, type OutcomeTask } from "./projection";
type Model = "workroom" | "workroomActivity" | "runtimeVerification" | "taskRun" | "adapterRunTelemetry" | "toolExecution" | "queueTelemetryEvent" | "contributorInventorySyncRun" | "contributorInventorySnapshot";
type Db = {
    [K in Model]: Pick<(typeof prisma)[K], K extends "contributorInventorySyncRun" ? "findFirst" : "findMany">;
};
const ROOM_LIMIT = 100, FACT_LIMIT = 1000, DAY = 86400000;
const roomSelect = { id: true, capsuleId: true, title: true, status: true, createdAt: true, updatedAt: true, repositoryFullName: true, headBranch: true, headSha: true, backlogItemId: true, epicId: true, executorKind: true, executorRef: true, featureBuildId: true, taskRunId: true, pullRequestNumber: true,
    branchTaxonomy: true, featureBuild: { select: { buildId: true } }, workItem: { select: { claimedAt: true, effortClass: true } } } as const;
/** All source reads are bounded and scoped to rooms admitted to the actual user.
 * Never accepts a client-supplied room list or an administrator bypass flag.
 */
export async function loadDeliveryOutcomes(args: {
    db: Db;
    userId: string;
    now?: Date;
    filters?: OutcomeInput["filters"];
    canReadRoom: (id: string) => Promise<boolean>;
}) {
    const { db, userId } = args, now = args.now ?? new Date(), start = new Date(now.getTime() - 30 * DAY);
    const sources: OutcomeSource[] = [];
    const source = (key: string, count: number, state?: OutcomeSource["state"], note: string | null = null, observedAt = now.toISOString()) => {
        const row = { key, count, state: state ?? (count > FACT_LIMIT ? "partial" : count ? "ready" : "empty"), note: count > FACT_LIMIT ? "rowsLimited" : note, observedAt } satisfies OutcomeSource;
        const existing = sources.findIndex(s => s.key === key);
        if (existing < 0)
            sources.push(row);
        else {
            const rank = { empty: 0, ready: 1, stale: 2, partial: 3, failed: 4 };
            if (rank[row.state] >= rank[sources[existing].state])
                sources[existing] = row;
        }
    };
    const bounded = async <T>(key: string, read: () => Promise<T[]>): Promise<T[]> => {
        try {
            const rows = await read();
            source(key, Math.min(rows.length, FACT_LIMIT), rows.length > FACT_LIMIT ? "partial" : undefined, rows.length > FACT_LIMIT ? "rowsLimited" : null);
            return rows.slice(0, FACT_LIMIT);
        }
        catch {
            source(key, 0, "failed", "readUnavailable");
            return [];
        }
    };
    const empty: OutcomeInput = { now, filters: args.filters, rooms: [], activities: [], verifications: [], runs: [], tasks: [], tools: [], queue: [], pullRequests: [], sources };
    let rooms;
    try {
        const candidates = await db.workroom.findMany({ where: { createdAt: { gte: start, lte: now } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: ROOM_LIMIT + 1, select: roomSelect });
        // Bounded concurrency; visibility failures cannot broaden the cohort.
        const visible = [];
        for (const candidate of candidates.slice(0, ROOM_LIMIT))
            if (await args.canReadRoom(candidate.id))
                visible.push(candidate);
        rooms = visible;
        source("rooms", rooms.length, candidates.length > ROOM_LIMIT ? "partial" : rooms.length ? "ready" : "empty", candidates.length > ROOM_LIMIT ? "roomsLimited" : null);
    }
    catch {
        source("rooms", 0, "failed", "visibilityUnavailable");
        return projectDeliveryOutcomes(empty);
    }
    if (!rooms.length)
        return projectDeliveryOutcomes(empty);
    const ids = rooms.map(r => r.id), rootIds = rooms.flatMap(r => r.taskRunId ? [r.taskRunId] : []);
    const directThreads = rooms.flatMap(r => r.executorRef ? [r.executorRef] : []), buildIds = rooms.flatMap(r => r.featureBuild ? [r.featureBuild.buildId] : []);
    const window = { gte: start, lte: now };
    const [activities, verifications, queue, initialTasks] = await Promise.all([
        bounded("activities", () => db.workroomActivity.findMany({ where: { workCapsuleId: { in: ids }, recordedAt: window }, orderBy: [{ recordedAt: "asc" }, { id: "asc" }], take: FACT_LIMIT + 1, select: { id: true, workCapsuleId: true, kind: true, recordedAt: true } })),
        bounded("verifications", () => db.runtimeVerification.findMany({ where: { workCapsuleId: { in: ids }, completedAt: window }, orderBy: [{ completedAt: "asc" }, { id: "asc" }], take: FACT_LIMIT + 1, select: { id: true, workCapsuleId: true, kind: true, status: true, completedAt: true, evidenceUrl: true, result: true, runtimeTarget: { select: { targetId: true, acceptanceRole: true, servedCommitSha: true } } } })),
        bounded("queue", () => db.queueTelemetryEvent.findMany({ where: { itemKind: "workroom-stage", occurredAt: window, OR: rooms.map(r => ({ itemId: { startsWith: `${r.capsuleId}:` } })) }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }], take: FACT_LIMIT + 1, select: { queueKey: true, itemKind: true, itemId: true, transition: true, outcome: true, occurredAt: true, laneKey: true } })),
        bounded("tasks", () => db.taskRun.findMany({ where: { userId, OR: [{ id: { in: rootIds } }, { threadId: { in: directThreads } }] }, take: FACT_LIMIT + 1, orderBy: { id: "asc" }, select: { id: true, parentTaskRunId: true, threadId: true } })),
    ]);
    // Reconstruct only explicit ancestry. No build-name or title guessing. A finite
    // depth/row budget is disclosed rather than silently dropping descendants.
    const tasks: OutcomeTask[] = [...initialTasks];
    const seen = new Set(tasks.map(t => t.id));
    let frontier = tasks.map(t => t.id), depth = 0;
    while (frontier.length && tasks.length < FACT_LIMIT && depth < 8) {
        let children;
        try {
            children = await db.taskRun.findMany({ where: { userId, parentTaskRunId: { in: frontier } }, take: FACT_LIMIT - tasks.length + 1, orderBy: { id: "asc" }, select: { id: true, parentTaskRunId: true, threadId: true } });
        }
        catch {
            source("tasks", tasks.length, "failed", "descendantUnavailable");
            break;
        }
        frontier = [];
        for (const child of children)
            if (!seen.has(child.id)) {
                seen.add(child.id);
                tasks.push(child);
                frontier.push(child.id);
            }
        depth++;
    }
    if (frontier.length || tasks.length > FACT_LIMIT)
        source("tasks", Math.min(tasks.length, FACT_LIMIT), "partial", "descendantLimited");
    const retainedTasks = tasks.slice(0, FACT_LIMIT), threads = [...new Set([...directThreads, ...retainedTasks.flatMap(t => t.threadId ? [t.threadId] : [])])];
    const [runs, tools, pullRequests] = await Promise.all([
        bounded("runs", () => db.adapterRunTelemetry.findMany({ where: { startedAt: window, OR: [{ threadId: { in: threads } }, { buildId: { in: buildIds } }] }, take: FACT_LIMIT + 1, orderBy: [{ startedAt: "asc" }, { id: "asc" }], select: { id: true, threadId: true, buildId: true, startedAt: true, adapterKind: true, providerId: true, modelId: true, inputTokens: true, cachedInputTokens: true, cacheCreationInputTokens: true, outputTokens: true, reasoningTokens: true, estimatedCostUsd: true, investmentInstallationRef: true } })),
        bounded("tools", () => db.toolExecution.findMany({ where: { userId, createdAt: window, OR: [{ threadId: { in: threads } }, { taskRunId: { in: retainedTasks.map(t => t.id) } }] }, take: FACT_LIMIT + 1, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, threadId: true, taskRunId: true, toolName: true, success: true, envelopeId: true } })),
        (async () => {
            try {
                const latest = await db.contributorInventorySyncRun.findFirst({ where: { perSourceResult: { path: ["github-pr", "ok"], equals: true } }, orderBy: [{ startedAt: "desc" }, { id: "desc" }], select: { syncRunId: true, startedAt: true, completedAt: true, perSourceResult: true } });
                if (!latest) {
                    source("pullRequests", 0, "empty", "prMissing");
                    return [];
                }
                const result = isRecord(latest.perSourceResult) ? latest.perSourceResult["github-pr"] : null;
                const holder = isRecord(result) && typeof result.snapshotRunId === "string" ? result.snapshotRunId : latest.syncRunId;
                const snapshots = await db.contributorInventorySnapshot.findMany({ where: { source: "github-pr", syncRunId: holder, sourceKey: { in: rooms.flatMap(r => r.pullRequestNumber ? [String(r.pullRequestNumber)] : []) } }, take: FACT_LIMIT + 1, orderBy: { id: "asc" }, select: { payload: true } });
                const observed = latest.completedAt ?? latest.startedAt;
                const rows = snapshots.slice(0, FACT_LIMIT).flatMap(s => { const value = parseVerifiedPullRequestObservation(s.payload); return value ? [value] : []; });
                source("pullRequests", rows.length, snapshots.length > FACT_LIMIT || rows.length !== snapshots.length ? "partial" : now.getTime() - observed.getTime() > 20 * 60000 ? "stale" : rows.length ? "ready" : "empty", null, observed.toISOString());
                return rows;
            }
            catch {
                source("pullRequests", 0, "failed", "prUnavailable");
                return [];
            }
        })(),
    ]);
    const qualifiedVerifications = verifications.map(({ result, ...v }) => {
        const binding = readSmallAcceptanceBinding(isRecord(result) ? result[SMALL_ACCEPTANCE_KEY] : null);
        return { ...v, sourceBinding: binding ? { workCapsuleId: binding.workCapsuleId, headSha: binding.headSha, servedSha: binding.servedSha, completedAt: binding.completedAt, targetRef: binding.deploymentRunId } : null };
    });
    if (qualifiedVerifications.some(v => v.kind === "final-acceptance" && !v.sourceBinding))
        source("verifications", qualifiedVerifications.length, "partial", "verificationUnbound");
    return projectDeliveryOutcomes({ now, filters: args.filters, rooms: rooms.map(r => ({ ...r, featureBuildId: r.featureBuild?.buildId ?? null, claimedAt: r.workItem?.claimedAt ?? null, effort: r.workItem?.effortClass ?? null })), activities: activities.map(a => ({ ...a, payload: null })), verifications: qualifiedVerifications, queue, tasks: retainedTasks, tools, pullRequests,
        runs: runs.map(r => ({ ...r, estimatedCostUsd: r.estimatedCostUsd === null ? null : Number(r.estimatedCostUsd) })), sources });
}
