import {
  formatInstanceStanceBriefing,
  type InstanceStanceProfile,
} from "@dpf/db/installation-instance-stance";

import type { McpTokenScope } from "@/lib/auth/mcp-api-token";
import type { InstallHostProfile } from "@/lib/install/host-profile";

export type AgentAuthorityTier = "observer" | "employee" | "development" | "admin";

type EffectiveTokenAuthority = {
  scope: McpTokenScope;
  scopes: readonly string[];
};

const DEVELOPMENT_GRANTS = new Set([
  "sandbox_execute",
  "iac_execute",
  "work_capsule_adopt",
  "build_promote",
  "build_plan_write",
  "deployment_plan_create",
  "release_plan_create",
]);

export function resolveAgentAuthorityTier(token: EffectiveTokenAuthority): AgentAuthorityTier {
  if (token.scope === "admin" || token.scopes.includes("admin_write")) return "admin";
  if (token.scopes.some((scope) => DEVELOPMENT_GRANTS.has(scope))) return "development";
  if (token.scope === "read") return "observer";
  return "employee";
}

const AUTHORITY_INSTRUCTIONS: Record<AgentAuthorityTier, string> = {
  observer: "Read and report only. Do not mutate, queue, approve, or administer anything.",
  employee: "Act only inside the granted business domains; use governed decision and approval boundaries.",
  development: "Use the backlog, Workroom, worktree, test, review, DCO, and PR gates for source changes.",
  admin: "Administrative grants remain action-specific; inspect consequences and use explicit approval gates for risky changes.",
};

export function buildAgentHostInstructions(
  profile: InstallHostProfile,
  token: EffectiveTokenAuthority,
  stance?: InstanceStanceProfile,
  /** Which installation this is — see formatInstanceStanceBriefing (BI-C7151B1B). */
  installationLabel?: string,
): string {
  const authority = resolveAgentAuthorityTier(token);
  const host = profile.kind === "consumer"
    ? "CONSUMER RUNTIME HOST: this directory is installed runtime material, not a source checkout. MCP is authoritative for platform and business operations. Never edit installed Compose or scripts as source; for code, use a separate source checkout and governed worktree."
    : profile.kind === "source"
      ? "SOURCE-CAPABLE HOST: a Git-backed checkout is present. MCP is authoritative for coordination and governance; follow the repository rulebook for source work."
      : "UNVERIFIED HOST: source capability could not be established. MCP is authoritative. Do not edit host files or run source-based upgrade work until install identity is verified.";
  const base = `DPF AGENT HOST — ${host} Your effective authority: ${authority}. ${AUTHORITY_INSTRUCTIONS[authority]}`;
  // The stance briefing states what this installation *is* and which brakes apply.
  // It follows the host and authority lines so an agent reads identity before it
  // reads the tool catalogue.
  return stance
    ? `${base}\n\n${formatInstanceStanceBriefing(stance, installationLabel)}`
    : base;
}

