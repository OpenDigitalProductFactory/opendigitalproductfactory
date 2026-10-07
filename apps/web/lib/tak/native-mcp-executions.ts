// apps/web/lib/tak/native-mcp-executions.ts
//
// BI-2E479619 / BI-907D6878: a CLI execution adapter (claude-code-cli, and any
// other CLI that mounts the platform MCP server through --mcp-config) runs the
// platform tools ITSELF during the turn. The adapter deliberately drops those
// mcp__dpf__* calls from its parsed toolCalls so the loop never re-executes
// them, which left the loop judging the turn with zero tool records: a reviewer
// that read the artifact and minted its receipt was parked as
// "prose-without-required-writer".
//
// The server already records every such call as a ToolExecution row
// (executionMode "internal-mcp-session", this taskRunId). After each CLI turn
// the loop folds the rows created since this loop attempt started into its
// executed-tool records, so the terminal policy, the writer check and
// executedToolCount see one truth. Rows from earlier attempts on the same
// TaskRun (created before this attempt started) and rows of other runs are
// excluded; a row is folded at most once.
//
// Reader rows are auditClass=metrics_only and persist no result, so a native
// read cannot prove an immutable traversal complete. Those records are marked
// `nativeResultWithheld`; the terminal policy ignores them for evidence and the
// read budget, which keeps today's nudge behaviour for native-reads-only turns.

import { prisma } from "@dpf/db";
import type { ToolResult } from "@/lib/mcp-tool-types";
import { usesCliAdapter, usesCodexCli } from "@/lib/routing/provider-utils";

export const NATIVE_MCP_EXECUTION_MODE = "internal-mcp-session";

export type NativeFoldableRecord = {
  name: string;
  args?: Record<string, unknown>;
  result: ToolResult;
  nativeExecutionId?: string;
  nativeResultWithheld?: boolean;
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** True for the adapters whose platform tool calls run natively inside the CLI. */
export function runsPlatformToolsNatively(providerId: string | null | undefined): boolean {
  return !!providerId && (usesCliAdapter(providerId) || usesCodexCli(providerId));
}

/**
 * Append this TaskRun's natively executed tool calls (since `sinceMs`) to
 * `records`. Returns how many were folded. Never throws: a failed read leaves
 * the records as they were, which is today's behaviour.
 */
export async function foldNativeMcpExecutions(input: {
  taskRunId: string | null | undefined;
  providerId: string | null | undefined;
  sinceMs: number;
  records: NativeFoldableRecord[];
}): Promise<number> {
  if (!input.taskRunId || !runsPlatformToolsNatively(input.providerId)) return 0;
  let rows: Array<{ id: string; toolName: string; parameters: unknown; result: unknown; success: boolean }>;
  try {
    rows = await prisma.toolExecution.findMany({
      where: {
        taskRunId: input.taskRunId,
        executionMode: NATIVE_MCP_EXECUTION_MODE,
        createdAt: { gte: new Date(input.sinceMs) },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, toolName: true, parameters: true, result: true, success: true },
    });
  } catch (err) {
    console.warn(`[native-mcp] could not read native tool executions for ${input.taskRunId}: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
  const seen = new Set(input.records.map((entry) => entry.nativeExecutionId).filter(Boolean));
  let folded = 0;
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    const stored = record(row.result);
    const folding: NativeFoldableRecord = {
      name: row.toolName,
      args: record(row.parameters),
      result: { ...stored, success: row.success } as ToolResult,
      nativeExecutionId: row.id,
      ...(row.success && !("data" in stored) && !("message" in stored) ? { nativeResultWithheld: true } : {}),
    };
    input.records.push(folding);
    seen.add(row.id);
    folded += 1;
  }
  return folded;
}
