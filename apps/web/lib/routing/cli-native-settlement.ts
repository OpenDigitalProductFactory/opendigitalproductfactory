import { prisma } from "@dpf/db";
import { NativeCliExecutionUncertainError } from "./cli-owned-runner";
import { InferenceError } from "./inference-error";
import type { CliTerminalResultMetadata } from "../shared/execution-uncertainty";

/** Margin for portal/DB clock skew; a wider window only holds more executions. */
export const NATIVE_SETTLEMENT_SKEW_MS = 5_000;

type LedgerQuery = { taskRunId: string; threadId: string | null; since: Date };
type SettlementDeps = {
  countLedgerRows?: (query: LedgerQuery) => Promise<number>;
  log?: (line: string) => void;
};

async function countGovernedLedgerRows(query: LedgerQuery): Promise<number> {
  return prisma.toolExecution.count({ where: {
    createdAt: { gte: query.since },
    OR: [{ taskRunId: query.taskRunId }, ...(query.threadId ? [{ threadId: query.threadId }] : [])],
  } });
}

const CODE_BY_HINT: Record<CliTerminalResultMetadata["hint"], InferenceError["code"]> = {
  quota: "rate_limit", auth: "auth", overloaded: "overloaded", model: "model_not_found", unclassified: "provider_error",
};
const SUMMARY_BY_HINT: Record<CliTerminalResultMetadata["hint"], string> = {
  quota: "Claude CLI usage limit reached", auth: "Claude CLI auth error", overloaded: "Claude CLI overloaded",
  model: "Claude CLI model unavailable", unclassified: "Claude CLI reported an unsuccessful result",
};

/**
 * BI-29BB23F5: settle a native Claude CLI execution that provably changed nothing.
 *
 * Native filesystem tools are disallowed and only the platform MCP server is
 * mounted, so the governed ToolExecution ledger is the only effect channel:
 * every call writes its row (a consequential one reserves it before the side
 * effect) before the CLI receives the result. When the CLI ended its own loop
 * with a structured error envelope and exited by itself, and the ledger holds
 * no row for this TaskRun or thread since dispatch, nothing was applied. The
 * execution is settled as an ordinary provider error so fallback and capacity
 * holds apply. Every other case returns null and the uncertainty hold stands.
 * This reads server-side evidence only; child output is never settlement proof.
 */
export async function settleNativeCliWithoutEffects(
  input: { error: unknown; session: { taskRunId?: string | null; threadId?: string | null } | undefined; dispatchedAt: Date },
  deps: SettlementDeps = {},
): Promise<InferenceError | null> {
  const { error, session, dispatchedAt } = input;
  if (!(error instanceof NativeCliExecutionUncertainError)) return null;
  const d = error.diagnostics;
  const terminal = d?.terminalResult;
  const selfTerminated = !!d && d.outerProcessClosed && !d.timedOut && d.signal === null
    && typeof d.exitCode === "number" && d.exitCode !== 124;
  if (!selfTerminated || terminal?.type !== "result" || terminal.status !== "error") return null;
  const taskRunId = session?.taskRunId;
  if (!taskRunId) return null;
  const since = new Date(dispatchedAt.getTime() - NATIVE_SETTLEMENT_SKEW_MS);
  let rows: number;
  try {
    rows = await (deps.countLedgerRows ?? countGovernedLedgerRows)({ taskRunId, threadId: session?.threadId ?? null, since });
  } catch {
    return null; // An unreadable ledger is not evidence of no effects.
  }
  if (rows !== 0) return null;
  (deps.log ?? console.log)(
    `[cli-adapter] native execution settled-without-effects provider=${error.providerId} taskRunId=${taskRunId} `
    + `ledgerRows=0 since=${since.toISOString()} exitCode=${d!.exitCode} subtype=${terminal.subtype} hint=${terminal.hint}`,
  );
  return new InferenceError(
    `${SUMMARY_BY_HINT[terminal.hint]} (native execution settled with no governed effects).`,
    CODE_BY_HINT[terminal.hint], error.providerId,
  );
}
