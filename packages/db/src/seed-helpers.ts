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

const SUPERVISOR_TO_PORTFOLIO: Record<string, string> = {
  "HR-100": "products_and_services_sold",
  "HR-200": "for_employees",
  "HR-300": "foundational",
  "HR-500": "manufacturing_and_delivery",
  // HR-000, HR-400 omitted — cross-cutting agents, no single portfolio
};

export function parseAgentPortfolioSlug(supervisorId: string): string | null {
  return SUPERVISOR_TO_PORTFOLIO[supervisorId] ?? null;
}
