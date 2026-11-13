import {
  formatInstanceStanceBriefing,
  type InstanceStanceProfile,
} from "@dpf/db/installation-instance-stance";

import type { McpTokenScope } from "@/lib/auth/mcp-api-token";
import type { InstallHostProfile } from "@/lib/install/host-profile";
import { DEVELOPMENT_INVESTMENT_GUIDANCE } from "@/lib/platform-dev-policy";

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
  if (token.scope === "read") return "observer";
  if (token.scope === "admin" || token.scopes.includes("admin_write")) return "admin";
  if (token.scopes.some((scope) => DEVELOPMENT_GRANTS.has(scope))) return "development";
  return "employee";
}

const AUTHORITY_INSTRUCTIONS: Record<AgentAuthorityTier, string> = {
  observer: "Read and report only. Do not mutate, queue, approve, or administer anything.",
  employee: "Act only inside the granted business domains; use governed decision and approval boundaries.",
  development: "Use the backlog, Workroom, worktree, test, review, DCO, and PR gates for source changes.",
  admin: "Administrative grants remain action-specific. Reuse current delegation for authorized routine reads and reversible maintenance; do not request fresh approval solely because an action administers this install. Credential or authority changes, destructive actions and restricted data retain their required gates. A development label never grants additional authority.",
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
  const base = `DPF AGENT HOST — ${host} Your effective authority: ${authority}. ${AUTHORITY_INSTRUCTIONS[authority]}\n\n${DEVELOPMENT_INVESTMENT_GUIDANCE}`;
  // The stance briefing states what this installation *is* and which brakes apply.
  // It follows the host and authority lines so an agent reads identity before it
  // reads the tool catalogue.
  const identity = stance
    ? `${base}\n\n${formatInstanceStanceBriefing(stance, installationLabel)}`
    : `${base}\n\nINSTALLATION IDENTITY: unverified. Apply production caution until the canonical installation context can be read; do not infer DEV from a host path or coworker lifecycleStage.`;
  const bounds = "Environment class never grants authority: token scope, coworker grants, human capabilities and governed action gates still apply. A coworker's lifecycleStage describes that coworker, not this installation.";
  if (!stance || authority === "observer" || !["development", "test"].includes(stance.environmentClass)) {
    return `${identity}\n${bounds}`;
  }
  const sourceCredentialGuidance = "From your granted assistant-bound native connection, use issue_source_credentials_client for headless source verification. Keep or reuse a private file for that same verified assistant binding, pass DPF_MCP_CLIENT_CREDENTIALS_FILE to scripts/lib/mcp-credential.mjs, and verify the resulting get_my_coworker_profile. Conversations acting as the same assistant may reuse its file; do not create per-conversation copies or substitute another assistant or client-specific OAuth, Grok or browser credential.";
  return `${identity}\n${bounds}\nRoutine already-authorized work on this declared ${stance.environmentClass} installation belongs to the agent: exercise and verify granted capabilities, and handle local test credentials without another operator hand-off. ${sourceCredentialGuidance} For authenticated browser verification, use issue_ux_verification_sign_in when granted; keep its one-time link and all secrets out of transcripts and tracked artifacts. Preserve capture-before-teardown and paired-peer limits. A denied action stops that action; use its supported remedy, never bypass it.`;
}
