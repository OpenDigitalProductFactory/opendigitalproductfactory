// Where a coworker runs: in the platform, or only as an external CLI session.
//
// The runtime is declared per agent in packages/db/data/agent_registry.json
// (`config_profile.execution_runtime.type`) and persisted by the seed as
// `AgentExecutionConfig.executionType` (packages/db/src/seed.ts). Two values are
// in use: `in_process` for every in-portal coworker and `external_cli` for the
// governed external participants (AGT-EXT-CLAUDE, AGT-EXT-CODEX, AGT-EXT-GROK).
//
// An `external_cli` agent has no in-portal invocation path: it acts only when a
// person runs its CLI and connects over MCP. coworker-definition.ts binds a
// canonical in-portal route only to `in_process` agents and exempts
// `external_cli` agents from the reachable-route check for exactly that reason.
// A dispatcher that hands work to the platform's own agent loop (a Workroom
// drive stage, a ScheduledAgentTask) can therefore only hand it to an
// `in_process` agent; anything else is work nobody will pick up.
//
// Pure except for the one loader, which reads the persisted field.

export const IN_PROCESS_EXECUTION_TYPE = "in_process";
export const EXTERNAL_CLI_EXECUTION_TYPE = "external_cli";

/**
 * True when the platform's own agent loop can run this agent. Only a declared
 * `in_process` runtime qualifies: an agent with no recorded runtime is not
 * proven runnable, and the platform does not guess.
 */
export function runsInPlatform(executionType: string | null | undefined): boolean {
  return executionType === IN_PROCESS_EXECUTION_TYPE;
}

export type ExecutionRuntimeDb = {
  agent: {
    findMany(args: unknown): Promise<Array<{ agentId: string; executionConfig: { executionType: string } | null }>>;
  };
};

/** The subset of `agentIds` the platform's own agent loop can run. */
export async function loadInPlatformAgentIds(
  db: ExecutionRuntimeDb,
  agentIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(agentIds)];
  if (ids.length === 0) return new Set();
  const rows = await db.agent.findMany({
    where: { agentId: { in: ids } },
    select: { agentId: true, executionConfig: { select: { executionType: true } } },
  });
  return new Set(rows.filter((row) => runsInPlatform(row.executionConfig?.executionType)).map((row) => row.agentId));
}
