// Repeated-tool runtime-issue detector for the agentic loop.
//
// Extracted from apps/web/lib/tak/agentic-loop.ts so both the existing
// "agent stuck" PlatformIssueReport write and the new reflection trigger
// in apps/web/lib/tak/reflection-triggers.ts share one detection site.
//
// BI-PIR-2fc2106c: progress-aware. Identical args + identical successful
// results = no progress — hard-stop without waiting for the iteration>5
// warm-up. Approaching repeats (count == threshold-1) surface a soft nudge
// so the model can change strategy before the hard stop.

import { createHash, randomUUID } from "crypto";

import { prisma } from "@dpf/db";

export type ExecutedToolRecord = {
  name: string;
  args?: Record<string, unknown>;
  result: { success: boolean; error?: string; message?: string };
};

export type RepeatedToolIssue = {
  toolName: string;
  count: number;
  signature: string;
  reasonHint: string;
  /** True when every matching call returned the same successful outcome. */
  noProgress: boolean;
};

const DEFAULT_WINDOW = 40;
const DEFAULT_THRESHOLD = 3;

function stableArgsHash(args: Record<string, unknown> | undefined): string {
  const obj = args ?? {};
  const argsJson = JSON.stringify(obj, Object.keys(obj).sort());
  return createHash("sha1").update(argsJson).digest("hex").slice(0, 12);
}

/** Fingerprint of the tool *outcome* used for progress detection. */
export function toolResultFingerprint(result: ExecutedToolRecord["result"]): string {
  const payload = JSON.stringify({
    success: result.success,
    error: result.error ?? null,
    message: result.message ?? null,
  });
  return createHash("sha1").update(payload).digest("hex").slice(0, 12);
}

type SigStats = {
  count: number;
  lastResult: ExecutedToolRecord["result"];
  /** Distinct outcome fingerprints seen for this args signature. */
  resultFingerprints: Set<string>;
  successCount: number;
};

function collectSignatureStats(
  executedTools: ExecutedToolRecord[],
  window: number,
): Map<string, SigStats> {
  const stats = new Map<string, SigStats>();
  const slice = executedTools.slice(-window);
  for (const t of slice) {
    const sig = `${t.name}:${stableArgsHash(t.args)}`;
    const fp = toolResultFingerprint(t.result);
    const existing = stats.get(sig);
    if (!existing) {
      stats.set(sig, {
        count: 1,
        lastResult: t.result,
        resultFingerprints: new Set([fp]),
        successCount: t.result.success ? 1 : 0,
      });
    } else {
      existing.count += 1;
      existing.lastResult = t.result;
      existing.resultFingerprints.add(fp);
      if (t.result.success) existing.successCount += 1;
    }
  }
  return stats;
}

function isNoProgress(stats: SigStats): boolean {
  // All successes and a single outcome fingerprint → re-reading the same answer.
  return (
    stats.successCount === stats.count &&
    stats.resultFingerprints.size === 1 &&
    stats.count >= 2
  );
}

/** Read/list tools where identical success means no new information (BI-PIR-2fc2106c). */
export function isReadLikeToolName(toolName: string): boolean {
  return /^(query_|list_|get_|search_|read_|describe_|find_|wiki_)/i.test(toolName);
}

function toIssue(
  signature: string,
  stats: SigStats,
  noProgress: boolean,
): RepeatedToolIssue {
  const toolName = signature.split(":")[0] ?? signature;
  const lr = stats.lastResult;
  let reasonHint = "";
  if (noProgress) {
    reasonHint =
      " Identical successful results — no progress (same data returned each time).";
  } else if (lr && !lr.success && lr.error) {
    reasonHint = ` Last error: ${lr.error.slice(0, 120)}.`;
  }
  return { toolName, count: stats.count, signature, reasonHint, noProgress };
}

/**
 * Detect a tool that has been called with identical arguments at least
 * `threshold` times within the trailing `window` slice of executedTools.
 * Returns null when no repeated-call pattern is present.
 *
 * Progress-aware (BI-PIR-2fc2106c):
 * - Same args + same successful results → hard stop even during the early
 *   iteration warm-up (the agent is stuck, not exploring).
 * - Same args with changing results (e.g. retries after failure) still
 *   respect iteration > 5 so legitimate recovery has room.
 */
export function detectRepeatedToolCall(input: {
  executedTools: ExecutedToolRecord[];
  iteration: number;
  window?: number;
  threshold?: number;
}): RepeatedToolIssue | null {
  const window = input.window ?? DEFAULT_WINDOW;
  const threshold = input.threshold ?? DEFAULT_THRESHOLD;
  const statsMap = collectSignatureStats(input.executedTools, window);

  const repeated = [...statsMap.entries()].find(([, s]) => s.count >= threshold);
  if (!repeated) return null;

  const [signature, stats] = repeated;
  const toolName = signature.split(":")[0] ?? signature;
  const noProgress = isNoProgress(stats) && isReadLikeToolName(toolName);

  // Warm-up only applies when the agent might still be making progress
  // (changing outcomes or non-read tools like review/save). Read-like
  // no-progress loops stop immediately.
  if (!noProgress && input.iteration <= 5) return null;

  return toIssue(signature, stats, noProgress);
}

/**
 * Soft-nudge signal: same args repeated `threshold - 1` times with no
 * progress. The loop injects a user message so the model can change tools
 * before the hard stop at `threshold`.
 */
export function detectApproachingRepeatedToolCall(input: {
  executedTools: ExecutedToolRecord[];
  window?: number;
  threshold?: number;
}): RepeatedToolIssue | null {
  const window = input.window ?? DEFAULT_WINDOW;
  const threshold = input.threshold ?? DEFAULT_THRESHOLD;
  const approachAt = Math.max(2, threshold - 1);
  const statsMap = collectSignatureStats(input.executedTools, window);

  // Prefer read-like no-progress signatures (query_backlog etc.).
  for (const [signature, stats] of statsMap) {
    if (stats.count !== approachAt) continue;
    const toolName = signature.split(":")[0] ?? signature;
    if (!isReadLikeToolName(toolName) || !isNoProgress(stats)) continue;
    return toIssue(signature, stats, true);
  }
  return null;
}

/** User-message content injected when a no-progress repeat is approaching. */
export function buildNoProgressNudgeMessage(issue: RepeatedToolIssue): string {
  return (
    `[System notice] You already called ${issue.toolName} ${issue.count} times with the same arguments ` +
    `and got the same successful result — there is no new information. Do NOT call ${issue.toolName} again ` +
    `with those arguments. Use the data you already have, change the arguments, or call a different tool. ` +
    `Repeating the same call will stop the run.`
  );
}

const BUILD_ROUTE_PATTERN = /^\/build(\/|$)/;

/**
 * Persist a PlatformIssueReport row describing a repeated-tool issue.
 * Returns the new report's id on success, null on either skip (build route)
 * or DB failure. Build routes are skipped — Build Studio has its own
 * verification/replay machinery and would otherwise double-file.
 *
 * Threading: when the originating run has a threadId or taskRunId, both are
 * persisted so the reflection trigger can correlate precisely. Both fields
 * are nullable on the schema; older callers that pass null degrade to the
 * agent/route time-window heuristic.
 */
export async function recordRepeatedToolIssue(input: {
  repeated: RepeatedToolIssue;
  routeContext: string | null;
  userId: string;
  agentId: string | null;
  threadId: string | null;
  taskRunId: string | null;
  featureBuildId?: string | null;
}): Promise<{ reportId: string } | null> {
  if (input.routeContext && BUILD_ROUTE_PATTERN.test(input.routeContext)) {
    return null;
  }
  const reportId = `PIR-${randomUUID().slice(0, 5).toUpperCase()}`;
  try {
    await prisma.platformIssueReport.create({
      data: {
        reportId,
        type: "agent_stuck",
        severity: "medium",
        status: "open",
        title: `Coworker repeated ${input.repeated.toolName} without progress`,
        description: [
          `The coworker called ${input.repeated.toolName} ${input.repeated.count} times with the same arguments and the agentic loop stopped the run.`,
          input.repeated.reasonHint ? input.repeated.reasonHint.trim() : null,
          `Route: ${input.routeContext ?? "unknown"}`,
        ]
          .filter(Boolean)
          .join("\n"),
        routeContext: input.routeContext ?? null,
        reportedById: input.userId,
        agentId: input.agentId,
        threadId: input.threadId,
        taskRunId: input.taskRunId,
        featureBuildId: input.featureBuildId ?? null,
        source: "coworker_runtime",
      },
    });
    return { reportId };
  } catch (err) {
    console.warn("[runtime-issues] failed to record repeated-tool issue:", err);
    return null;
  }
}
