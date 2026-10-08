// Approval convergence A2 probe core (BI-C8EC05C9; AC-PROBE).
//
// For each live pending AgentActionProposal, dry-run what convert-and-run
// (spec D5) will do: the exact governed call, with exactly today's handler
// context `{ agentId, threadId }`, the approver (the thread owner) as user and
// `source: "rest"`. It runs the REAL authority resolver and evaluator, GAID
// principal resolution for the receipt, the pre-tool hooks and the alignment
// requirement, and reports one refusal code per row plus the owner's activity.
// It feeds waivers W2 and W6.
//
// It never executes a tool and never writes: every dependency is injected,
// and scripts/approval-convergence-probe.ts runs it on a session the database
// itself holds read-only. Anything that throws is reported, never retried.
import type { CoworkerAuthorityDecision, CoworkerAuthorityInput } from "@/lib/govern/authority/coworker-authority-decision";
import type { GovernedExecuteArgs, GovernedExecuteResult } from "@/lib/mcp-governed-execute-types";
import type { ToolDefinition } from "@/lib/mcp-tool-types";
import type { UserContext } from "@/lib/permissions";
import { getErrorMessage } from "@/lib/shared/get-error-message";

export type PendingProposalRow = {
  proposalId: string;
  actionType: string;
  parameters: unknown;
  agentId: string;
  threadId: string;
  taskRunId: string | null;
  proposedAt: Date;
  owner: { id: string; isActive: boolean; lastSeenAt: Date | null } | null;
};

export type ProbeDeps = {
  findTool(name: string): ToolDefinition | undefined;
  userContext(userId: string): Promise<UserContext | null>;
  agentGrantAllowed(agentId: string, toolName: string): Promise<boolean>;
  resolveAuthorityInput(args: { execution: GovernedExecuteArgs; tool: ToolDefinition; agentGrantAllowed: boolean }): Promise<CoworkerAuthorityInput>;
  evaluate(input: CoworkerAuthorityInput): CoworkerAuthorityDecision;
  resolveGaid(args: GovernedExecuteArgs): Promise<unknown>;
  preToolHooks(args: GovernedExecuteArgs): Promise<GovernedExecuteResult | null>;
  alignmentRequired(tool: ToolDefinition, toolName: string): boolean;
};

export type ProbeRowResult = {
  proposalId: string;
  actionType: string;
  agentId: string;
  ownerId: string | null;
  ownerActive: boolean | null;
  ownerLastSeenAt: string | null;
  ageDays: number;
  /** One code per row: what convert-and-run would hit first. */
  refusal: string;
  authorityOutcome: CoworkerAuthorityDecision["outcome"] | null;
  escalation: string | null;
  gaid: "resolved" | "missing" | "error";
  hook: "allow" | "deny" | "error";
  alignmentRequired: boolean | null;
  detail: string | null;
};

function asParams(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** The convert-and-run call for a pending row (spec D5 step 2), approved by its thread owner. */
export function convertAndRunArgs(row: PendingProposalRow, approverId: string, userContext: UserContext): GovernedExecuteArgs {
  return {
    toolName: row.actionType,
    rawParams: asParams(row.parameters),
    userId: approverId,
    userContext,
    context: { agentId: row.agentId, threadId: row.threadId },
    source: "rest",
  };
}

export async function probePendingProposal(row: PendingProposalRow, deps: ProbeDeps, now: Date): Promise<ProbeRowResult> {
  const base = {
    proposalId: row.proposalId,
    actionType: row.actionType,
    agentId: row.agentId,
    ownerId: row.owner?.id ?? null,
    ownerActive: row.owner?.isActive ?? null,
    ownerLastSeenAt: row.owner?.lastSeenAt?.toISOString() ?? null,
    ageDays: Math.floor((now.getTime() - row.proposedAt.getTime()) / 86_400_000),
  };
  const empty = { authorityOutcome: null, escalation: null, gaid: "error" as const, hook: "error" as const, alignmentRequired: null };
  const tool = deps.findTool(row.actionType);
  if (!tool) return { ...base, ...empty, refusal: "unknown-tool", detail: null };
  if (!row.owner) return { ...base, ...empty, refusal: "owner-missing", detail: null };
  const userContext = await deps.userContext(row.owner.id).catch(() => null);
  if (!userContext) return { ...base, ...empty, refusal: "owner-inactive", detail: null };

  const execution = convertAndRunArgs(row, row.owner.id, userContext);
  const alignmentRequired = deps.alignmentRequired(tool, row.actionType);
  const gaid: ProbeRowResult["gaid"] = await deps.resolveGaid(execution).then(
    (envelope): ProbeRowResult["gaid"] => (envelope ? "resolved" : "missing"),
    (): ProbeRowResult["gaid"] => "error",
  );
  const hookOutcome = await deps.preToolHooks(execution).then(
    (rejection) => ({ hook: (rejection ? "deny" : "allow") as "deny" | "allow", detail: rejection?.message ?? null }),
    (error: unknown) => ({ hook: "error" as const, detail: getErrorMessage(error) }),
  );

  let decision: CoworkerAuthorityDecision | null = null;
  let resolverError: string | null = null;
  try {
    const grantAllowed = await deps.agentGrantAllowed(row.agentId, row.actionType);
    decision = deps.evaluate(await deps.resolveAuthorityInput({ execution, tool, agentGrantAllowed: grantAllowed }));
  } catch (error) {
    resolverError = getErrorMessage(error);
  }

  const common = {
    ...base,
    authorityOutcome: decision?.outcome ?? null,
    escalation: decision && "escalation" in decision && decision.escalation ? decision.escalation.reasonCode : null,
    gaid,
    hook: hookOutcome.hook,
    alignmentRequired,
  };
  if (resolverError) return { ...common, refusal: "authority-evidence-unavailable", detail: resolverError };
  if (decision?.outcome === "deny") return { ...common, refusal: decision.reasonCode, detail: null };
  if (hookOutcome.hook === "deny") return { ...common, refusal: "hook-denied", detail: hookOutcome.detail };
  if (hookOutcome.hook === "error") return { ...common, refusal: "hook-error", detail: hookOutcome.detail };
  if (gaid !== "resolved" && tool.consequence) return { ...common, refusal: `gaid-${gaid}`, detail: null };
  return {
    ...common,
    refusal: decision?.outcome === "require-approval" ? "admissible-after-approval" : "admissible",
    detail: null,
  };
}

/** Counts per refusal code and per owner, for the evidence summary. */
export function summarizeProbe(rows: readonly ProbeRowResult[]): {
  rows: number;
  byRefusal: Record<string, number>;
  byOwner: Record<string, { rows: number; active: boolean | null; lastSeenAt: string | null }>;
} {
  const byRefusal: Record<string, number> = {};
  const byOwner: Record<string, { rows: number; active: boolean | null; lastSeenAt: string | null }> = {};
  for (const row of rows) {
    byRefusal[row.refusal] = (byRefusal[row.refusal] ?? 0) + 1;
    const key = row.ownerId ?? "(none)";
    const entry = byOwner[key] ?? { rows: 0, active: row.ownerActive, lastSeenAt: row.ownerLastSeenAt };
    entry.rows += 1;
    byOwner[key] = entry;
  }
  return { rows: rows.length, byRefusal, byOwner };
}
