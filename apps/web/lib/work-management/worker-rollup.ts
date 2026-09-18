/**
 * Named workers and delegated subagents on a room (PWA-03, PWA-06).
 *
 * An executor is a teammate, not a surface. The same worker reached through
 * Claude Code, Codex, Grok or the portal is one identity with one session on the
 * room, so a roster must deduplicate by identity rather than listing a row per
 * connection. Multi-agent orchestration rolls up the same way: a planner and its
 * specialists are one worker with subagents beneath it, never N peers.
 *
 * A hundred subagents must stay inspectable without either extreme. Hiding them
 * behind a running count answers nothing, and giving each its own top-level
 * destination floods navigation. They are grouped under the worker that
 * delegated them, paged, and searchable.
 *
 * Delegation is not dependency. A worker's parent is the worker that delegated
 * it, recorded at delegation time. Where that was never recorded it stays
 * `unknown` — inferring a parent from timing or co-membership would invent a
 * chain of command that nobody established.
 *
 * Pure and DB-free: the server action reads rows and applies authorization, then
 * calls this.
 */

export const WORKER_STATES = ["working", "waiting", "idle", "unknown"] as const;
export type WorkerState = (typeof WORKER_STATES)[number];

/** How recent a progress observation must be to report a worker as working. */
export const WORKER_PROGRESS_FRESH_WINDOW_MS = 120_000;

export type WorkerSessionInput = {
  /** Canonical worker identity. The same worker on two surfaces shares this. */
  workerId: string;
  displayName: string;
  /** Which surface observed this session; never part of identity. */
  executorKind: string;
  state: WorkerState;
  /** What this worker is doing right now, in words. */
  currentTask: string | null;
  lastProgressAt: Date | string | null;
  /**
   * The worker that delegated this one. `null` means it is a root worker;
   * `undefined` means nobody recorded it and it must stay unknown.
   */
  delegatedByWorkerId?: string | null;
};

export type NamedWorker = {
  workerId: string;
  displayName: string;
  /** Every surface this one identity was observed on, sorted and deduplicated. */
  executorKinds: string[];
  state: WorkerState;
  currentTask: string | null;
  lastProgressAt: string | null;
  /** Explicitly one of: a parent id, no parent, or not recorded. */
  parentage: { kind: "root" } | { kind: "delegated"; byWorkerId: string } | { kind: "unknown" };
  /** Direct subagents delegated by this worker. */
  subagentCount: number;
};

function toMs(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function laterOf(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/** A recorded parent wins over an absent one; conflicting parents collapse to unknown. */
function mergeParentage(
  current: NamedWorker["parentage"] | undefined,
  next: WorkerSessionInput["delegatedByWorkerId"],
): NamedWorker["parentage"] {
  const incoming: NamedWorker["parentage"] =
    next === undefined ? { kind: "unknown" } : next === null ? { kind: "root" } : { kind: "delegated", byWorkerId: next };
  if (!current) return incoming;
  if (current.kind === "unknown") return incoming;
  if (incoming.kind === "unknown") return current;
  if (current.kind === "delegated" && incoming.kind === "delegated") {
    // Two surfaces naming different delegators is a conflict, not a vote.
    return current.byWorkerId === incoming.byWorkerId ? current : { kind: "unknown" };
  }
  return current.kind === "delegated" ? current : incoming;
}

/** Working is a claim about now, so it needs a recent observation to survive. */
function reconcileState(state: WorkerState, lastProgressMs: number | null, nowMs: number): WorkerState {
  if (state !== "working") return state;
  if (lastProgressMs === null) return "unknown";
  return nowMs - lastProgressMs <= WORKER_PROGRESS_FRESH_WINDOW_MS ? "working" : "idle";
}

/**
 * Roll sessions up into one entry per worker identity.
 *
 * Ordering is deterministic: attention-bearing states first, then most recent
 * progress, then worker id.
 */
export function rollUpNamedWorkers(
  sessions: readonly WorkerSessionInput[],
  now: Date | number,
): NamedWorker[] {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const byId = new Map<string, NamedWorker & { _progressMs: number | null }>();

  for (const session of sessions) {
    const existing = byId.get(session.workerId);
    const progressMs = toMs(session.lastProgressAt);
    if (!existing) {
      byId.set(session.workerId, {
        workerId: session.workerId,
        displayName: session.displayName,
        executorKinds: [session.executorKind],
        state: session.state,
        currentTask: session.currentTask,
        lastProgressAt: null,
        parentage: mergeParentage(undefined, session.delegatedByWorkerId),
        subagentCount: 0,
        _progressMs: progressMs,
      });
      continue;
    }
    if (!existing.executorKinds.includes(session.executorKind)) existing.executorKinds.push(session.executorKind);
    // The freshest observation describes what the worker is doing.
    if (progressMs !== null && (existing._progressMs === null || progressMs > existing._progressMs)) {
      existing.state = session.state;
      existing.currentTask = session.currentTask;
    }
    existing._progressMs = laterOf(existing._progressMs, progressMs);
    existing.parentage = mergeParentage(existing.parentage, session.delegatedByWorkerId);
  }

  for (const worker of byId.values()) {
    if (worker.parentage.kind === "delegated") {
      const parent = byId.get(worker.parentage.byWorkerId);
      if (parent) parent.subagentCount += 1;
    }
  }

  const priority: Record<WorkerState, number> = { waiting: 0, working: 1, idle: 2, unknown: 3 };
  return [...byId.values()]
    .map(({ _progressMs, ...worker }) => ({
      ...worker,
      executorKinds: [...worker.executorKinds].sort((a, b) => a.localeCompare(b, "en-US")),
      state: reconcileState(worker.state, _progressMs, nowMs),
      lastProgressAt: _progressMs === null ? null : new Date(_progressMs).toISOString(),
      _progressMs,
    }))
    .sort((a, b) =>
      priority[a.state] !== priority[b.state] ? priority[a.state] - priority[b.state]
        : (b._progressMs ?? -1) !== (a._progressMs ?? -1) ? (b._progressMs ?? -1) - (a._progressMs ?? -1)
          : a.workerId.localeCompare(b.workerId, "en-US"),
    )
    .map(({ _progressMs, ...worker }) => worker);
}

export type WorkerGroup = {
  /** The delegating worker, or null for the unknown-parentage group. */
  parent: NamedWorker | null;
  /** Present only on the unknown group, so the UI can label it honestly. */
  unknownParentage: boolean;
  members: NamedWorker[];
};

/**
 * Group workers under whoever delegated them, keeping unrecorded parentage in
 * its own labelled group rather than folded under a plausible parent.
 */
export function groupDelegatedWorkers(workers: readonly NamedWorker[]): WorkerGroup[] {
  const byId = new Map(workers.map((worker) => [worker.workerId, worker]));
  const roots = workers.filter((worker) => worker.parentage.kind === "root");
  const unknown = workers.filter((worker) => worker.parentage.kind === "unknown");
  const groups: WorkerGroup[] = roots.map((parent) => ({
    parent,
    unknownParentage: false,
    members: workers.filter((w) => w.parentage.kind === "delegated" && w.parentage.byWorkerId === parent.workerId),
  }));
  // A delegator that is itself delegated still owns its own group.
  for (const worker of workers) {
    if (worker.parentage.kind !== "delegated") continue;
    if (worker.subagentCount === 0) continue;
    groups.push({
      parent: worker,
      unknownParentage: false,
      members: workers.filter((w) => w.parentage.kind === "delegated" && w.parentage.byWorkerId === worker.workerId),
    });
  }
  // A recorded parent we cannot see (filtered by authorization, or not loaded)
  // must not silently promote its children to roots.
  const orphaned = workers.filter(
    (w) => w.parentage.kind === "delegated" && !byId.has(w.parentage.byWorkerId),
  );
  if (unknown.length > 0 || orphaned.length > 0) {
    groups.push({ parent: null, unknownParentage: true, members: [...unknown, ...orphaned] });
  }
  return groups;
}

export type WorkerPage = {
  workers: NamedWorker[];
  nextCursor: string | null;
  partial: boolean;
  /** Total matching the query before paging, so the UI can say "12 of 100". */
  matched: number;
};

/**
 * One bounded, searchable page of workers.
 *
 * Search matches the worker's name or what it is currently doing, which is how
 * an operator actually looks for one among a hundred.
 */
export function selectWorkerPage(input: {
  workers: readonly NamedWorker[];
  pageSize?: number;
  cursor?: string | null;
  query?: string | null;
}): WorkerPage {
  const pageSize = Math.max(1, input.pageSize ?? 20);
  const needle = input.query?.trim().toLocaleLowerCase("en-US") ?? "";
  const matched = needle
    ? input.workers.filter((w) =>
        w.displayName.toLocaleLowerCase("en-US").includes(needle)
        || (w.currentTask ?? "").toLocaleLowerCase("en-US").includes(needle))
    : [...input.workers];
  const startIndex = input.cursor ? matched.findIndex((w) => w.workerId === input.cursor) + 1 : 0;
  const slice = matched.slice(startIndex, startIndex + pageSize);
  const partial = startIndex + slice.length < matched.length;
  return {
    workers: slice,
    nextCursor: partial ? slice[slice.length - 1]?.workerId ?? null : null,
    partial,
    matched: matched.length,
  };
}
