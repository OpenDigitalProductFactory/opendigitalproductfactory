// apps/web/lib/operate/scheduled-jobs/coworker-self-task-mandate.ts
//
// What a coworker's cadence is authorized to write (BI-6B3DA9DD). Split from
// the registry module, which the 800-LOC ceiling refused to let grow further.

import { COWORKER_SELF_TASKS, selfTaskRegistryKey } from "./coworker-self-tasks";

/**
 * The writes a coworker's cadence authorizes (BI-6B3DA9DD), or null when it
 * declares none. Resolved through the same alias handling as every other
 * registry lookup, because the scheduler passes the CANONICAL agent id
 * (AGT-WS-MARKETING) while the registry is keyed by slug — the gap that made
 * three earlier lookups silently return nothing.
 */
export function coworkerSelfTaskMandatedTools(
  rawAgentId: string,
): readonly string[] | null {
  const agentId = selfTaskRegistryKey(rawAgentId) ?? rawAgentId;
  const tools = COWORKER_SELF_TASKS[agentId]?.mandatedTools;
  return tools && tools.length > 0 ? tools : null;
}
