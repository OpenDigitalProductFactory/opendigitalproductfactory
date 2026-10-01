// Contributor inventory pack: read-only doors over the recorded contributor
// inventory (ContributorInventorySnapshot rows the contributor-inventory-sync
// cron writes for pull requests, branches and worktrees).
//
// The rows are resolved by the change-lanes read model's own
// latest-successful-per-source rule (loadContributorInventorySource), so these
// tools and /platform/development/change-lanes can never disagree about what
// is recorded. Nothing here reaches the forge or writes: dispatching a fresh
// sync stays trigger_contributor_inventory_sync, behind admin_write.
//
// An absent or unconfigured source is reported as such, never as an empty
// queue: a standing stage that reads nothing records inconclusive, not clear.

import { getErrorMessage } from "@/lib/shared/get-error-message";
import type {
  GitBranchSnapshot,
  GitWorktreeSnapshot,
  PullRequestSnapshot,
} from "@/lib/contributor-change-lanes/types";
import type { ContributorInventorySource } from "@/lib/contributor-change-lanes/read-model";

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tool-types";
import type { ToolPack } from "../tool-pack";

const PR_DEFAULT_LIMIT = 20;
const PR_MAX_LIMIT = 100;
const ROWS_DEFAULT_LIMIT = 25;
const ROWS_MAX_LIMIT = 100;
const DEFAULT_ACTIVE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

const PR_STATES = ["open", "merged", "closed", "all"] as const;
type PrStateFilter = (typeof PR_STATES)[number];
const INVENTORY_SOURCES: readonly ContributorInventorySource[] = ["git-branch", "git-worktree", "github-pr"];

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const definitions: ToolDefinition[] = [
  {
    name: "list_pull_requests",
    description:
      "List pull requests from the recorded contributor inventory (the last successful forge sync), " +
      "newest update first, with compact fields: number, title, state, draft flag, merge state " +
      "(e.g. CLEAN, DIRTY for conflicted, BLOCKED), head branch, last update, and URL. Filters: state " +
      "(open by default, merged, closed, or all), updatedSince (ISO date), and limit. The recorded " +
      "inventory does not carry the pull-request author. Read-only; it never contacts the forge. " +
      "When the forge sync is not configured or has not run, the result says so: report the queue as " +
      "unknown, never as clear. Call once per review with the filters you need.",
    inputSchema: {
      type: "object",
      properties: {
        state: { type: "string", enum: [...PR_STATES], description: "Which pull requests to list (default open)." },
        updatedSince: { type: "string", description: "Optional ISO date; only pull requests updated on or after it." },
        limit: { type: "number", description: `Rows to return (default ${PR_DEFAULT_LIMIT}, max ${PR_MAX_LIMIT}).` },
      },
      required: [],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    annotations: READ_ONLY,
  },
  {
    name: "read_contributor_inventory",
    description:
      "Summarize the recorded contributor inventory: the latest sync run, per-kind counts and freshness " +
      "for branches, worktrees and pull requests, how many were active recently, and pull requests by " +
      "state. Optionally pages the recorded rows of one kind (source), most recent first. The inventory " +
      "records branches, worktrees and pull requests only; it does not record contributor identities, " +
      "sign-off or licence facts, and the result says so, so a review reports those as unknown. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          enum: [...INVENTORY_SOURCES],
          description: "Optional. Page the recorded rows of this kind.",
        },
        activeWithinDays: {
          type: "number",
          description: `Window for 'recently active' counts (default ${DEFAULT_ACTIVE_DAYS}, max 365).`,
        },
        offset: { type: "number", description: "Rows to skip when paging a source (default 0)." },
        limit: { type: "number", description: `Rows per page (default ${ROWS_DEFAULT_LIMIT}, max ${ROWS_MAX_LIMIT}).` },
      },
      required: [],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    annotations: READ_ONLY,
  },
];

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(min, Math.min(max, n));
}

function toTime(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value !== "string" || !value.trim()) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

function prUpdatedAt(row: PullRequestSnapshot): string | null {
  return row.providerUpdatedAt ?? row.observedAt ?? row.mergedAt ?? null;
}

function byNewest<T>(rows: readonly T[], at: (row: T) => unknown): T[] {
  return [...rows].sort((a, b) => (toTime(at(b)) ?? 0) - (toTime(at(a)) ?? 0));
}

function freshnessView(freshness: { state: string; fetchedAt: Date; message: string | null; count: number }) {
  return {
    state: freshness.state,
    fetchedAt: freshness.fetchedAt.toISOString(),
    message: freshness.message,
    count: freshness.count,
  };
}

/** Resolved once per call, then shared: one module load, never one per source. */
async function inventoryLoader() {
  const { loadContributorInventorySource } = await import("@/lib/contributor-change-lanes/read-model");
  return loadContributorInventorySource;
}

async function listPullRequests(params: Record<string, unknown>): Promise<ToolResult> {
  const state = (params["state"] ?? "open") as PrStateFilter;
  if (!PR_STATES.includes(state)) {
    return { success: false, error: "invalid_state", message: `state must be one of: ${PR_STATES.join(", ")}.` };
  }
  let since: number | null = null;
  if (params["updatedSince"] !== undefined) {
    since = toTime(params["updatedSince"]);
    if (since === null) {
      return { success: false, error: "invalid_updated_since", message: "updatedSince must be an ISO date such as 2026-09-01." };
    }
  }
  const limit = clampInt(params["limit"], PR_DEFAULT_LIMIT, 1, PR_MAX_LIMIT);

  try {
    const load = await inventoryLoader();
    const { rows, freshness } = await load<PullRequestSnapshot>("github-pr");
    if (freshness.state === "error") {
      return {
        success: false,
        error: "inventory_read_failed",
        message: `The pull-request inventory could not be read: ${freshness.message ?? "unknown error"}.`,
      };
    }
    if (freshness.state === "not-configured" || freshness.state === "warming-up") {
      const note =
        `No pull-request inventory is recorded (${freshness.state}: ${freshness.message ?? "no sync yet"}). ` +
        "The queue is unknown, not clear.";
      return { success: true, message: note, data: { items: [], totalMatching: 0, note, freshness: freshnessView(freshness) } };
    }

    const matching = byNewest(
      rows.filter((row) => (state === "all" || row.state === state) && (since === null || (toTime(prUpdatedAt(row)) ?? 0) >= since)),
      prUpdatedAt,
    );
    const items = matching.slice(0, limit).map((row) => ({
      number: row.number,
      title: row.title,
      state: row.state,
      isDraft: row.isDraft,
      mergeStateStatus: row.mergeStateStatus ?? null,
      headBranch: row.headBranch,
      updatedAt: prUpdatedAt(row),
      url: row.url ?? null,
    }));
    const scope = `${state === "all" ? "" : `${state} `}pull requests${since === null ? "" : ` updated since ${new Date(since).toISOString().slice(0, 10)}`}`;
    const note = matching.length === 0 ? `No ${scope} are recorded in the last successful sync.` : undefined;
    return {
      success: true,
      message: note ?? `${matching.length} ${scope} recorded; returning ${items.length}.`,
      data: {
        items,
        totalMatching: matching.length,
        truncated: matching.length > items.length,
        ...(note ? { note } : {}),
        freshness: freshnessView(freshness),
      },
    };
  } catch (error) {
    return { success: false, error: "inventory_read_failed", message: getErrorMessage(error) };
  }
}

function sourceActivityAt(source: ContributorInventorySource, row: unknown): unknown {
  if (source === "git-branch") return (row as GitBranchSnapshot).lastCommitAt;
  if (source === "github-pr") return prUpdatedAt(row as PullRequestSnapshot);
  return null; // a worktree records no activity time
}

async function readContributorInventory(params: Record<string, unknown>): Promise<ToolResult> {
  const pageSource = params["source"];
  if (pageSource !== undefined && !INVENTORY_SOURCES.includes(pageSource as ContributorInventorySource)) {
    return { success: false, error: "invalid_source", message: `source must be one of: ${INVENTORY_SOURCES.join(", ")}.` };
  }
  const activeDays = clampInt(params["activeWithinDays"], DEFAULT_ACTIVE_DAYS, 1, 365);
  const activeSince = Date.now() - activeDays * DAY_MS;

  try {
    const { prisma } = await import("@dpf/db");
    const load = await inventoryLoader();
    const [latestRun, ...reads] = await Promise.all([
      prisma.contributorInventorySyncRun.findFirst({
        orderBy: { startedAt: "desc" },
        select: { syncRunId: true, status: true, startedAt: true, completedAt: true, triggeredBy: true },
      }),
      ...INVENTORY_SOURCES.map((source) => load<unknown>(source)),
    ]);
    const bySource = new Map(INVENTORY_SOURCES.map((source, i) => [source, reads[i]!]));

    const contributorFacts = {
      recorded: false,
      note:
        "The inventory records branches, worktrees and pull requests only. Contributor identities, " +
        "sign-off (DCO) and licence facts are not recorded, so report them as unknown, not as missing or present.",
    };
    const latestSync = latestRun
      ? {
          syncRunId: latestRun.syncRunId,
          status: latestRun.status,
          startedAt: latestRun.startedAt.toISOString(),
          completedAt: latestRun.completedAt?.toISOString() ?? null,
          triggeredBy: latestRun.triggeredBy,
        }
      : null;
    const sources = INVENTORY_SOURCES.map((source) => {
      const read = bySource.get(source)!;
      const recentlyActive =
        source === "git-worktree"
          ? null
          : read.rows.filter((row) => (toTime(sourceActivityAt(source, row)) ?? 0) >= activeSince).length;
      return { source, ...freshnessView(read.freshness), recentlyActive };
    });

    if (!latestRun && sources.every((s) => s.count === 0)) {
      const note = "No contributor inventory has been recorded yet; the inventory is unknown, not empty.";
      return { success: true, message: note, data: { items: [], note, latestSync, sources, contributorFacts } };
    }

    const prRows = bySource.get("github-pr")!.rows as PullRequestSnapshot[];
    const pullRequestsByState = {
      open: prRows.filter((row) => row.state === "open").length,
      merged: prRows.filter((row) => row.state === "merged").length,
      closed: prRows.filter((row) => row.state === "closed").length,
    };

    let rows: Record<string, unknown> | undefined;
    if (pageSource !== undefined) {
      const source = pageSource as ContributorInventorySource;
      const offset = clampInt(params["offset"], 0, 0, Number.MAX_SAFE_INTEGER);
      const limit = clampInt(params["limit"], ROWS_DEFAULT_LIMIT, 1, ROWS_MAX_LIMIT);
      const all = bySource.get(source)!.rows;
      const ordered =
        source === "git-worktree"
          ? [...(all as GitWorktreeSnapshot[])].sort((a, b) => a.path.localeCompare(b.path))
          : byNewest(all, (row) => sourceActivityAt(source, row));
      rows = { source, offset, limit, total: ordered.length, items: ordered.slice(offset, offset + limit) };
    }

    const summary = sources.map((s) => `${s.count} ${s.source} (${s.state})`).join(", ");
    return {
      success: true,
      message: `Contributor inventory: ${summary}. Latest sync ${latestSync?.status ?? "none"}${latestSync ? ` at ${latestSync.completedAt ?? latestSync.startedAt}` : ""}.`,
      data: {
        latestSync,
        sources,
        activeWithinDays: activeDays,
        pullRequestsByState,
        contributorFacts,
        ...(rows ? { rows } : {}),
      },
    };
  } catch (error) {
    return { success: false, error: "inventory_read_failed", message: getErrorMessage(error) };
  }
}

export const contributorInventoryPack: ToolPack = {
  packId: "contributor-inventory",
  definitions,
  handlers: {
    list_pull_requests: (params) => listPullRequests(params),
    read_contributor_inventory: (params) => readContributorInventory(params),
  },
  grants: {
    list_pull_requests: ["contributor_inventory_read"],
    read_contributor_inventory: ["contributor_inventory_read"],
  },
};
