// Repeated-tool runtime-issue detector for the agentic loop.
//
// Extracted from apps/web/lib/tak/agentic-loop.ts so both the existing
// "agent stuck" PlatformIssueReport write and the new reflection trigger
// in apps/web/lib/tak/reflection-triggers.ts share one detection site.

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
};

const DEFAULT_WINDOW = 40;
const DEFAULT_THRESHOLD = 3;

/**
 * Detect a tool that has been called with identical arguments at least
 * `threshold` times within the trailing `window` slice of executedTools.
 * Returns null when no repeated-call pattern is present.
 *
 * Hashing: sha1 over JSON.stringify with keys sorted for a stable canonical
 * form. This matches the historical inline behavior so existing
 * PlatformIssueReport rows correlate cleanly across the rename.
 */
export function detectRepeatedToolCall(input: {
  executedTools: ExecutedToolRecord[];
  iteration: number;
  window?: number;
  threshold?: number;
}): RepeatedToolIssue | null {
  const window = input.window ?? DEFAULT_WINDOW;
  const threshold = input.threshold ?? DEFAULT_THRESHOLD;

  const counts = new Map<string, number>();
  const lastResult = new Map<string, ExecutedToolRecord["result"]>();
  const slice = input.executedTools.slice(-window);
  for (const t of slice) {
    const argsJson = JSON.stringify(
      t.args ?? {},
      Object.keys((t.args as Record<string, unknown>) ?? {}).sort(),
    );
    const argsHash = createHash("sha1").update(argsJson).digest("hex").slice(0, 12);
    const sig = `${t.name}:${argsHash}`;
    counts.set(sig, (counts.get(sig) ?? 0) + 1);
    lastResult.set(sig, t.result);
  }

  // The historical inline check additionally requires iteration > 5 to give
  // the loop room to make legitimate progress before the guard fires; keep
  // the same guard here so behavior is byte-identical.
  if (input.iteration <= 5) return null;

  const repeated = [...counts.entries()].find(([, n]) => n >= threshold);
  if (!repeated) return null;

  const [signature, count] = repeated;
  const toolName = signature.split(":")[0] ?? signature;
  const lr = lastResult.get(signature);
  const reasonHint = lr && !lr.success && lr.error
    ? ` Last error: ${lr.error.slice(0, 120)}.`
    : "";
  return { toolName, count, signature, reasonHint };
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
