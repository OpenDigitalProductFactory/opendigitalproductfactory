// apps/web/lib/tak/chain-of-custody.ts
//
// EP-31815F97 S2 (BI-F82F4E04). Assemble the full chain-of-custody for a governed
// tool execution: the human principal → executing coworker → agent→agent
// delegation hops (if any) → the tool call. Realizes TAK §7.1 (auditable chain
// from human authority to agent action) + GAID §10 (chain-of-custody).
//
// The human origin lives on ToolExecution (userId / delegatingUserId); the
// agent→agent hops live in DelegationChain (getChainOfCustody). This module joins
// them via ToolExecution.delegationChainId. The pure assembler unit-tests without
// Prisma; a thin reader fetches the rows.

import type { DelegationLink } from "./delegation-authority";

export interface ToolExecutionCustodyRow {
  id: string;
  agentId: string;
  userId: string;
  delegatingUserId?: string | null;
  toolName: string;
  delegationChainId?: string | null;
}

export interface ChainOfCustody {
  /** The human principal at the root of this action's authority (INV-A3). */
  human: { userId: string; delegatingUserId: string | null };
  /** The executing coworker. */
  executingAgentId: string;
  /** The tool call this custody record is for. */
  toolCall: { toolExecutionId: string; toolName: string };
  /** The agent→agent delegation hops, origin (depth 0) → executing; empty for a
   *  direct human→coworker call. */
  chain: DelegationLink[];
  /** Delegation depth (0 = direct human→coworker, no hops). */
  depth: number;
  /** The human recorded at the chain origin, if a chain exists (equals the
   *  execution's human for a well-formed chain); null for a direct call. */
  originUserId: string | null;
}

/**
 * Assemble the chain-of-custody for one governed tool execution. Pure: the caller
 * supplies the ToolExecution row and, when `delegationChainId` is set, the ordered
 * links from `getChainOfCustody()`. Guarantees a human origin for every action
 * (INV-A3): even a direct call resolves to `human` from the execution row.
 */
export function assembleToolExecutionCustody(input: {
  execution: ToolExecutionCustodyRow;
  chainLinks?: readonly DelegationLink[];
}): ChainOfCustody {
  const links = [...(input.chainLinks ?? [])].sort((a, b) => a.depth - b.depth);
  return {
    human: {
      userId: input.execution.userId,
      delegatingUserId: input.execution.delegatingUserId ?? null,
    },
    executingAgentId: input.execution.agentId,
    toolCall: { toolExecutionId: input.execution.id, toolName: input.execution.toolName },
    chain: links,
    depth: links.length > 0 ? links[links.length - 1]!.depth : 0,
    originUserId: links.length > 0 ? links[0]!.originUserId : null,
  };
}

/**
 * True when the chain-of-custody is well-formed: it has a human origin, and when
 * a delegation chain exists its recorded origin human matches the execution's
 * human. Used by the S2 audit assertion — a mismatched origin is a custody break.
 */
export function isCustodyWellFormed(custody: ChainOfCustody): boolean {
  if (!custody.human.userId) return false;
  if (custody.chain.length === 0) return true;
  const origin = custody.originUserId;
  return origin === custody.human.userId || origin === custody.human.delegatingUserId;
}

/**
 * DB reader: fetch a ToolExecution and, when it is chain-linked, its ordered
 * DelegationChain links, then assemble the custody. Best-effort — returns null
 * only if the execution row is missing. Kept thin so the pure assembler carries
 * the logic. `deps` is injectable for tests.
 */
export async function getToolExecutionCustody(
  toolExecutionId: string,
  deps: {
    findExecution: (id: string) => Promise<ToolExecutionCustodyRow | null>;
    getChainOfCustody: (chainId: string) => Promise<DelegationLink[]>;
  },
): Promise<ChainOfCustody | null> {
  const execution = await deps.findExecution(toolExecutionId);
  if (!execution) return null;
  const chainLinks = execution.delegationChainId
    ? await deps.getChainOfCustody(execution.delegationChainId).catch(() => [] as DelegationLink[])
    : [];
  return assembleToolExecutionCustody({ execution, chainLinks });
}
