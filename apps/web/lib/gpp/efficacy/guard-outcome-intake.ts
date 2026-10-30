// BI-FEDD8F45 — guard outcome runs arrive on the existing external
// development evidence lane (`record_external_development_evidence`, optional
// `guardOutcomes` payload) rather than on a new MCP tool: no new tool, no
// growth of the shrink-only unclassified-tool baseline, the same grant and the
// same authenticated actor binding (DI-C7020CB136AA, design §5.1).
//
// The producer identity comes from the MCP caller, never from the payload, and
// this telemetry earns no gate pass, stage completion or approval credit.

import type { ToolResult } from "@/lib/mcp-tool-types";

import { recordGuardOutcomes, type GuardOutcomeWriteDb } from "./record-guard-outcomes";

export const GUARD_OUTCOMES_PARAM = "guardOutcomes";

export function hasGuardOutcomesPayload(params: Record<string, unknown>): boolean {
  return params[GUARD_OUTCOMES_PARAM] !== undefined;
}

export async function handleGuardOutcomesPayload(input: {
  params: Record<string, unknown>;
  userId: string;
  context?: { agentId?: string };
  db: GuardOutcomeWriteDb;
}): Promise<ToolResult> {
  const payload = input.params[GUARD_OUTCOMES_PARAM];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { success: false, error: "invalid_guard_outcomes", message: "guardOutcomes must be an object with a records array." };
  }
  const { records, declarations } = payload as { records?: unknown; declarations?: unknown };
  const agentId = input.context?.agentId;
  const result = await recordGuardOutcomes(
    {
      records,
      declarations,
      actorUserId: input.userId,
      provider: agentId ?? "external",
      routeContext: "/ops/gate-efficacy",
      ...(agentId ? { recordedByAgentId: agentId } : {}),
    },
    input.db,
  );
  if (!result.ok) {
    return { success: false, error: "invalid_guard_outcomes", message: result.error };
  }
  return {
    success: true,
    message: `Recorded ${result.data.acknowledged.length} guard outcome run(s); ${result.data.refused.length} refused.`,
    data: result.data,
  };
}
