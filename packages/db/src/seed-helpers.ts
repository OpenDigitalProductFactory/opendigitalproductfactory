// packages/db/src/seed-helpers.ts
const VALID_ROLE_RE = /^HR-\d{3}$/;

export function parseRoleId(raw: string): string {
  if (!VALID_ROLE_RE.test(raw)) throw new Error(`Invalid role ID: ${raw}`);
  return raw;
}

export function parseAgentTier(agentId: string): number {
  if (agentId.startsWith("AGT-ORCH")) return 1;
  const num = parseInt(agentId.replace("AGT-", ""), 10);
  if (num >= 900) return 3;
  return 2;
}

export function parseAgentType(agentId: string): "orchestrator" | "specialist" | "cross-cutting" {
  if (agentId.startsWith("AGT-ORCH")) return "orchestrator";
  if (parseInt(agentId.replace("AGT-", ""), 10) >= 900) return "cross-cutting";
  return "specialist";
}
