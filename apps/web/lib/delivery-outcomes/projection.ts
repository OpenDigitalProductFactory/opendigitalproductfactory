import { computeFlowDurations, percentile } from "@/lib/queue/flow-metrics";
import { reconstructTimelines, type QueueTelemetryRow } from "@/lib/queue/queue-metrics-rollup";
export type SourceState = "ready" | "empty" | "partial" | "stale" | "failed";
export type OutcomeSource = {
    key: string;
    state: SourceState;
    count: number;
    observedAt: string;
    note: string | null;
};
export type OutcomeRoom = {
    id: string;
    capsuleId: string;
    title: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    repositoryFullName: string | null;
    headBranch: string | null;
    headSha: string | null;
    backlogItemId: string | null;
    epicId: string | null;
    executorKind: string | null;
    executorRef: string | null;
    featureBuildId: string | null;
    taskRunId: string | null;
    pullRequestNumber: number | null;
    branchTaxonomy?: string | null;
    claimedAt?: Date | null;
    effort?: string | null;
};
export type OutcomeActivity = {
    id: string;
    workCapsuleId: string;
    kind: string;
    recordedAt: Date;
    payload: unknown;
};
export type OutcomeVerification = {
    sourceBinding?: {workCapsuleId:string;headSha:string;servedSha:string;completedAt:string;targetRef:string}|null;
    id: string;
    workCapsuleId: string | null;
    kind: string;
    status: string;
    completedAt: Date | null;
    evidenceUrl: string | null;
    runtimeTarget: {
        targetId: string;
        acceptanceRole: string | null;
        servedCommitSha: string | null;
    } | null;
};
export type OutcomeRun = {
    id: string;
    threadId: string | null;
    buildId: string | null;
    startedAt: Date;
    adapterKind: string;
    providerId: string;
    modelId: string;
    inputTokens: number | null;
    cachedInputTokens: number | null;
    cacheCreationInputTokens: number | null;
    outputTokens: number | null;
    reasoningTokens: number | null;
    estimatedCostUsd: number | null;
    investmentInstallationRef: string | null;
};
export type OutcomeTask = {
    id: string;
    threadId: string | null;
    parentTaskRunId: string | null;
};
export type OutcomeTool = {
    id: string;
    threadId: string;
    taskRunId: string | null;
    toolName: string;
    success: boolean;
    envelopeId: string | null;
};
export type OutcomePr = {
    repositoryFullName: string;
    number: number;
    headSha: string;
    mergedAt: string | null;
    mergeCommitSha: string | null;
    url: string;
};
export type OutcomeInput = {
    filters?: {
        dimension: string;
        query: string;
    };
    now: Date;
    rooms: readonly OutcomeRoom[];
    activities: readonly OutcomeActivity[];
    verifications: readonly OutcomeVerification[];
    runs: readonly OutcomeRun[];
    tasks: readonly OutcomeTask[];
    tools: readonly OutcomeTool[];
    queue: readonly QueueTelemetryRow[];
    pullRequests: readonly OutcomePr[];
    sources: OutcomeSource[];
};
type Milestone = "claimed" | "firstCommit" | "prOpen" | "reviewReady" | "merged" | "verified";
export type Economy = {
    runCount: number;
    inputTokens: number | null;
    cachedInputTokens: number | null;
    cacheCreationInputTokens: number | null;
    outputTokens: number | null;
    reasoningTokens: number | null;
    apiEquivalentUsd: number | null;
    subscriptionUsd: null;
    invoicedUsd: null;
    complete: boolean;
};
export type OutcomeObservation = {
    capsuleId: string;
    title: string;
    href: string;
    status: string;
    campaign: string | null;
    repository: string | null;
    workKind: string | null;
    riskTier: null;
    profile: string | null;
    packageBreadth: null;
    models: string[];
    installations: string[];
    milestones: Record<Milestone, string | null>;
    durations: Record<"cycle" | "claimedToPr" | "prToReady" | "readyToMerge" | "mergeToVerified" | "wait" | "process", number | null>;
    quality: {
        firstPass: null;
        blockingFindingsPerKloc: null;
        postOpenCommits: null;
        regressions: number | null;
        reopens: number | null;
        abandoned: boolean;
        superseded: boolean;
    };
    attention: {
        toolCalls: number | null;
        failedToolCalls: number | null;
        nonProgressCalls: null;
        approvals: number | null;
        takeovers: number | null;
        interventions: null;
        retries: number | null;
    };
    economy: {
        exclusive: Economy;
        inclusive: Economy;
        method: string;
        runIds: string[];
        descendantRunIds: string[];
    };
    evidence: {
        label: string;
        href: string;
    }[];
};
export type DurationSummary = {
    key: keyof OutcomeObservation["durations"];
    sample: number;
    incomplete: number;
    p50Ms: number | null;
    p90Ms: number | null;
};
export type DeliveryOutcomeScorecard = {
    milestoneCounts:{key:Milestone;count:number;missing:number}[];
    version: "DeliveryOutcomeObservation@1";
    observedAt: string;
    state: SourceState;
    cohort: {
        start: string;
        end: string;
        definition: string;
        confidence: string;
    };
    sources: OutcomeSource[];
    observations: OutcomeObservation[];
    stages: DurationSummary[];
    verified: number;
    campaigns: number;
    quality: {
        firstPass: {
            numerator: number;
            denominator: number;
            unknown: number;
        };
    };
};
const DAY = 86400000;
const unique = <T extends {
    id: string;
}>(rows: readonly T[]) => [...new Map(rows.map(row => [row.id, row])).values()];
const iso = (date: Date | null | undefined) => date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
const pair = (start: string | null, end: string | null) => {
    const value = start && end ? Date.parse(end) - Date.parse(start) : NaN;
    return Number.isFinite(value) && value >= 0 ? value : null;
};
const number = (v: number | null) => v !== null && Number.isFinite(v) && v >= 0 ? v : null;
/** A partial total is not a complete total. Preserve zero only when observed. */
function total<T>(rows: readonly T[], read: (row: T) => number | null): number | null {
    if (!rows.length)
        return null;
    const values = rows.map(read);
    return values.some(v => v === null) ? null : (values as number[]).reduce((a, b) => a + b, 0);
}
function economy(rows: readonly OutcomeRun[]): Economy {
    // Claude's adapter persists incremental uncached input separately from cache
    // reads/writes. Other adapters have different input semantics: leave unknown
    // rather than subtracting a cache estimate from provider cumulative input.
    const inputTokens = total(rows, r => r.adapterKind === "claude-cli" ? number(r.inputTokens) : null);
    const cachedInputTokens = total(rows, r => number(r.cachedInputTokens));
    const cacheCreationInputTokens = total(rows, r => number(r.cacheCreationInputTokens));
    const outputTokens = total(rows, r => number(r.outputTokens));
    const reasoningTokens = total(rows, r => number(r.reasoningTokens));
    const apiEquivalentUsd = total(rows, r => number(r.estimatedCostUsd));
    return { runCount: rows.length, inputTokens, cachedInputTokens, cacheCreationInputTokens, outputTokens, reasoningTokens,
        apiEquivalentUsd, subscriptionUsd: null, invoicedUsd: null,
        complete: [inputTokens, cachedInputTokens, cacheCreationInputTokens, outputTokens, reasoningTokens, apiEquivalentUsd].every(v => v !== null) };
}
function lineage(room: OutcomeRoom, tasks: readonly OutcomeTask[]) {
    const ids = new Set<string>(room.taskRunId ? [room.taskRunId] : []);
    const threads = new Set<string>(room.executorRef ? [room.executorRef] : []);
    for (const task of tasks)
        if (task.threadId && threads.has(task.threadId))
            ids.add(task.id);
    let grew = true;
    while (grew) {
        grew = false;
        for (const task of tasks)
            if (task.parentTaskRunId && ids.has(task.parentTaskRunId) && !ids.has(task.id)) {
                ids.add(task.id);
                grew = true;
            }
    }
    for (const task of tasks)
        if (ids.has(task.id) && task.threadId)
            threads.add(task.threadId);
    return { ids, threads };
}
const healthy = (sources: OutcomeSource[], key: string) => !sources.some(s => s.key === key && ["failed", "partial"].includes(s.state));
/** Pure, bounded-input projection. Never derives delivery success from room status. */
export function projectDeliveryOutcomes(input: OutcomeInput): DeliveryOutcomeScorecard {
    const start = new Date(input.now.getTime() - 30 * DAY);
    const inWindow = (date: Date) => date >= start && date <= input.now;
    const rooms = unique(input.rooms).filter(r => inWindow(r.createdAt)).sort((a, b) => a.capsuleId.localeCompare(b.capsuleId));
    const allObservations = rooms.map((room): OutcomeObservation => {
        const activities = unique(input.activities).filter(a => a.workCapsuleId === room.id && a.recordedAt <= input.now);
        const pr = input.pullRequests.find(p => p.repositoryFullName === room.repositoryFullName && p.number === room.pullRequestNumber && p.headSha === room.headSha);
        const verification = input.verifications.filter(v => v.workCapsuleId === room.id && v.kind === "final-acceptance" && v.status === "passed"
            && v.completedAt && v.completedAt <= input.now && v.completedAt >= room.createdAt && v.evidenceUrl
            && v.sourceBinding?.workCapsuleId===room.id && v.sourceBinding.headSha===room.headSha
            && v.sourceBinding.completedAt===iso(v.completedAt) && v.sourceBinding.targetRef.length>0)
            .sort((a, b) => a.completedAt!.getTime() - b.completedAt!.getTime())[0];
        // The retained PR inventory has no first-commit/open/ready timestamps or
        // protected-check history. Its observedAt is not any of those milestones.
        const milestones = { claimed: iso(room.claimedAt), firstCommit: null, prOpen: null, reviewReady: null, merged: pr?.mergedAt ?? null, verified: iso(verification?.completedAt) };
        const relation = lineage(room, input.tasks);
        const direct = (r: OutcomeRun) => (room.executorRef !== null && r.threadId === room.executorRef) || (room.featureBuildId !== null && r.buildId === room.featureBuildId);
        const runs = unique(input.runs).filter(r => inWindow(r.startedAt));
        const exclusive = runs.filter(direct);
        const inclusive = runs.filter(r => direct(r) || (r.threadId !== null && relation.threads.has(r.threadId)));
        const tools = unique(input.tools).filter(t => relation.threads.has(t.threadId) || (t.taskRunId !== null && relation.ids.has(t.taskRunId)));
        const groups = new Map<string, QueueTelemetryRow[]>();
        for (const row of input.queue)
            if (row.itemKind === "workroom-stage" && row.itemId.startsWith(`${room.capsuleId}:`) && row.occurredAt <= input.now) {
                const key = `${row.queueKey}\u0000${row.itemId}`;
                const group = groups.get(key) ?? [];
                group.push(row);
                groups.set(key, group);
            }
        const spans = [...groups.values()].flatMap(g => reconstructTimelines(g)).map(t => computeFlowDurations(t));
        const observedQueue = healthy(input.sources, "queue");
        const durations = { cycle: pair(milestones.claimed, milestones.verified), claimedToPr: pair(milestones.claimed, milestones.prOpen), prToReady: pair(milestones.prOpen, milestones.reviewReady), readyToMerge: pair(milestones.reviewReady, milestones.merged), mergeToVerified: pair(milestones.merged, milestones.verified),
            wait: observedQueue ? total(spans, s => s.waitMs) : null, process: observedQueue ? total(spans, s => s.processMs) : null };
        const activityCount = (kind: string) => healthy(input.sources, "activities") && activities.length ? activities.filter(a => a.kind === kind).length : null;
        const observedTools = healthy(input.sources, "tools") && healthy(input.sources, "tasks") && tools.length > 0;
        const evidence = [{ label: "Workroom", href: `/build/work/${encodeURIComponent(room.capsuleId)}` }];
        if (pr)
            evidence.push({ label: "Pull request", href: pr.url });
        if (verification?.evidenceUrl)
            evidence.push({ label: "Final acceptance", href: verification.evidenceUrl });
        return { capsuleId: room.capsuleId, title: room.title, href: evidence[0].href, status: room.status, campaign: room.epicId, repository: room.repositoryFullName, workKind: room.branchTaxonomy ?? null, riskTier: null, profile: room.effort ?? null, packageBreadth: null,
            models: [...new Set(inclusive.map(r => r.modelId))].sort(), installations: [...new Set(inclusive.flatMap(r => r.investmentInstallationRef ? [r.investmentInstallationRef] : []))].sort(), milestones, durations,
            quality: { firstPass: null, blockingFindingsPerKloc: null, postOpenCommits: null, regressions: null, reopens: null, abandoned: room.status === "abandoned", superseded: room.status === "superseded" },
            attention: { toolCalls: observedTools ? tools.length : null, failedToolCalls: observedTools ? tools.filter(t => !t.success).length : null, nonProgressCalls: null, approvals: observedTools ? new Set(tools.flatMap(t => t.envelopeId ? [t.envelopeId] : [])).size : null, takeovers: activityCount("executor-changed"), interventions: null, retries: null },
            economy: { exclusive: economy(exclusive), inclusive: economy(inclusive), method: "Exact thread/build identity; unique descendant task threads. Retained adapter rows only; cumulative child transcript totals excluded.", runIds: exclusive.map(r => r.id), descendantRunIds: inclusive.map(r => r.id) }, evidence };
    });
    const query = input.filters?.query.trim().slice(0, 120).toLowerCase();
    const observations = !query ? allObservations : allObservations.filter(o => {
        const dimensions: Record<string, (string | null)[]> = { campaign: [o.campaign], model: o.models, installation: o.installations, kind: [o.workKind], repository: [o.repository], risk: [o.riskTier], profile: [o.profile] };
        const values = dimensions[input.filters?.dimension ?? ""] ?? [o.capsuleId, o.title, o.campaign, o.repository, o.workKind, ...o.models, ...o.installations];
        return values.some(v => (v ?? "Unavailable").toLowerCase().includes(query));
    });
    const keys: DurationSummary["key"][] = ["cycle", "claimedToPr", "prToReady", "readyToMerge", "mergeToVerified", "process", "wait"];
    const stages = keys.map(key => { const values = observations.flatMap(o => o.durations[key] === null ? [] : [o.durations[key]!]); return { key, sample: values.length, incomplete: observations.length - values.length, p50Ms: percentile(values, 0.5), p90Ms: percentile(values, 0.9) }; });
    const degraded = input.sources.some(s => ["partial", "stale", "failed"].includes(s.state));
    const milestoneKeys:Milestone[]=["claimed","firstCommit","prOpen","reviewReady","merged","verified"];
    const milestoneCounts=milestoneKeys.map(key=>{const count=observations.filter(o=>o.milestones[key]!==null).length;return {key,count,missing:observations.length-count};});
    return { milestoneCounts,version: "DeliveryOutcomeObservation@1", observedAt: input.now.toISOString(), state: input.sources.find(s => s.key === "rooms")?.state === "failed" ? "failed" : degraded ? "partial" : observations.length ? "ready" : "empty",
        cohort: { start: start.toISOString(), end: input.now.toISOString(), definition: "Visible Workrooms created in this fixed 30-day window; one slice per Workroom. Campaigns are distinct recorded epic identities.", confidence: "Descriptive observations only. Incomplete pairs are excluded. Cohort and telemetry coverage must match before comparing periods; correlation does not establish improvement." }, sources: input.sources, observations, stages, verified: observations.filter(o => o.milestones.verified).length, campaigns: new Set(observations.flatMap(o => o.campaign ? [o.campaign] : [])).size,
        quality: { firstPass: { numerator: 0, denominator: 0, unknown: observations.length } } };
}
