// Approval convergence probe run (BI-129EFFD1; AC-PROBE). READ-ONLY.
//
// Wires the real dependencies into the shared probe core
// (approval-convergence-probe.ts) and returns the report. One implementation,
// two callers: the `probe_pending_approval_conversion` MCP tool inside the
// server, and scripts/approval-convergence-probe.ts for local use.
//
// Read-only by construction. The pending rows are read through the caller's
// client. Every evaluation step that can reach the database — owner context,
// GAID principal resolution, the pre-tool hooks and the authority resolver —
// runs inside its own interactive transaction whose FIRST statement is
// `SET TRANSACTION READ ONLY`, with that transaction as its client: the hooks
// are the server's governance hooks bound to it (buildServerToolGovernanceHooks,
// reached through the runtime the boot registration installs, see
// approval-convergence-probe-runtime.ts), and the resolver and GAID resolver
// take it as their `db`. PostgreSQL refuses
// any write there, and the probe core reports it on the row as `hook-error` or
// `authority-evidence-unavailable`. One transaction per step keeps a refused
// write from aborting the next step's reads. The attention notification the
// completion-evidence hook can send writes through its own client, so it is
// replaced by a refusal here (that hook swallows notification failures, so the
// verdict is unchanged). The remaining shared-client calls are reads only: the
// agent's grant list (getAgentToolGrantsAsync) and lookups inside the resolver
// that do not take a client. No tool handler is ever called.
import type { Prisma, prisma } from "@dpf/db";

import { evaluateCoworkerAuthority } from "@/lib/govern/authority/coworker-authority-decision";
import { resolveCoworkerToolAuthorityInput } from "@/lib/govern/authority/resolve-coworker-tool-authority";
import { currentUserContext } from "@/lib/govern/current-user-context";
import { getAgentToolGrantsAsync, isToolAllowedByGrants } from "@/lib/tak/agent-grants";
import { classifyConsequentialTool } from "@/lib/tak/consequential-tool-policy";
import { resolveGaidActorEnvelope } from "@/lib/tak/gaid-actor-envelope";

import {
  probePendingProposal,
  summarizeProbe,
  type ProbeDeps,
  type ProbeRowResult,
} from "./approval-convergence-probe";
import { requireApprovalProbeRuntime } from "./approval-convergence-probe-runtime";

export const READ_ONLY_STATEMENT = "SET TRANSACTION READ ONLY";

export type ApprovalConvergenceProbeReport = {
  probedAt: string;
  summary: ReturnType<typeof summarizeProbe>;
  rows: ProbeRowResult[];
};

/** The client the probe needs: the pending-row read, and interactive transactions. */
export type ApprovalProbeDb = Pick<typeof prisma, "agentActionProposal" | "$transaction">;

/** Run `work` in a transaction PostgreSQL holds read-only from its first statement. */
export async function withReadOnlyTransaction<T>(
  db: Pick<ApprovalProbeDb, "$transaction">,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(READ_ONLY_STATEMENT);
    return work(tx);
  }, { maxWait: 5_000, timeout: 20_000 });
}

async function refuseAttentionNotification(): Promise<never> {
  throw new Error("The approval convergence probe is read-only; no attention notification is sent.");
}

export async function runApprovalConvergenceProbe(
  db: ApprovalProbeDb,
  now: Date = new Date(),
): Promise<ApprovalConvergenceProbeReport> {
  const runtime = requireApprovalProbeRuntime();
  const pending = await db.agentActionProposal.findMany({
    where: { status: "proposed" },
    orderBy: [{ actionType: "asc" }, { proposedAt: "asc" }],
    select: {
      proposalId: true, actionType: true, parameters: true, agentId: true, threadId: true, taskRunId: true, proposedAt: true,
      thread: { select: { user: { select: { id: true, isActive: true, lastSeenAt: true } } } },
    },
  });

  const readOnly = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => withReadOnlyTransaction(db, work);
  const deps: ProbeDeps = {
    findTool: (name) => runtime.findTool(name),
    userContext: (userId) => readOnly((tx) => currentUserContext(userId, tx)),
    agentGrantAllowed: async (agentId, toolName) => isToolAllowedByGrants(toolName, await getAgentToolGrantsAsync(agentId)),
    resolveAuthorityInput: (args) => readOnly((tx) => resolveCoworkerToolAuthorityInput(args, tx as never)),
    evaluate: evaluateCoworkerAuthority,
    resolveGaid: (args) => readOnly((tx) => resolveGaidActorEnvelope(args, tx)),
    preToolHooks: (args) => readOnly((tx) => runtime.runGovernanceHooks(args, tx, { notifyCircuit: refuseAttentionNotification })),
    alignmentRequired: (tool, toolName) => classifyConsequentialTool({ tool, toolName }).alignmentRequired,
  };

  const rows: ProbeRowResult[] = [];
  for (const { thread, ...row } of pending) {
    rows.push(await probePendingProposal({ ...row, owner: thread.user ?? null }, deps, now));
  }
  return { probedAt: now.toISOString(), summary: summarizeProbe(rows), rows };
}
