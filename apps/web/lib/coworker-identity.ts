/**
 * Coworker identity alias resolver.
 *
 * Looks up a coworker by its durable `agent_id` (e.g. `AGT-WS-INVENTORY`),
 * its persona/agent_name slug (e.g. `inventory-specialist`), or any alias
 * declared in the registry (e.g. a future `estate-specialist`). Backed by
 * `packages/db/data/agent_registry.json`. The fixture-injection path lets
 * Chunks 4-5 (enrichment & classification) wire through alias support before
 * Chunk 6 Task 6.1 patches the actual registry with `displayName` + `aliases`.
 *
 * Task 1.4 of plan: docs/superpowers/plans/2026-04-30-discovery-portfolio-gap-closure-plan.md
 */
import { resolveCanonicalAgentId } from "@dpf/db/agent-identity";
import registryData from "../../../packages/db/data/agent_registry.json";

export interface CoworkerIdentity {
  agentId: string;
  agentName: string;
  displayName?: string;
  aliases?: string[];
  // Other fields exist on the JSON (tier, value_stream, etc.) but the resolver
  // only surfaces the identity-relevant ones. Callers needing more pull from
  // the source themselves.
}

export interface CoworkerRegistry {
  agents: CoworkerIdentity[];
}

interface RawAgent {
  agent_id: string;
  agent_name: string;
  displayName?: string;
  aliases?: string[];
  // Other fields ignored.
}

interface RawRegistry {
  agents: RawAgent[];
}

let cachedRegistry: CoworkerRegistry | null = null;

function loadDefaultRegistry(): CoworkerRegistry {
  if (cachedRegistry) return cachedRegistry;
  // Bundle the source registry like agent-grants; standalone installs need no
  // source checkout or working-directory discovery to resolve identity.
  const raw = registryData as RawRegistry;
  const agents: CoworkerIdentity[] = raw.agents.map((a) => {
    const identity: CoworkerIdentity = {
      agentId: a.agent_id,
      agentName: a.agent_name,
    };
    if (a.displayName !== undefined) identity.displayName = a.displayName;
    if (a.aliases !== undefined) identity.aliases = a.aliases;
    return identity;
  });
  cachedRegistry = { agents };
  return cachedRegistry;
}

export function resolveCoworkerIdentity(
  input: string,
  registry?: CoworkerRegistry,
): CoworkerIdentity | null {
  if (!input) return null;
  const reg = registry ?? loadDefaultRegistry();

  // 1. Exact, case-sensitive match on agent_id.
  for (const agent of reg.agents) {
    if (agent.agentId === input) return agent;
  }

  // 2. Case-insensitive match on agent_name.
  const lowered = input.toLowerCase();
  for (const agent of reg.agents) {
    if (agent.agentName.toLowerCase() === lowered) return agent;
  }

  // 3. Case-insensitive match against any alias.
  for (const agent of reg.agents) {
    if (!agent.aliases) continue;
    for (const alias of agent.aliases) {
      if (alias.toLowerCase() === lowered) return agent;
    }
  }

  return null;
}

export function getCanonicalAgentId(
  alias: string,
  registry?: CoworkerRegistry,
): string | null {
  return resolveCoworkerIdentity(alias, registry)?.agentId ?? null;
}

/** Authority uses the registry identity; execution aliases remain valid FK handles. */
export function coworkerAuthorityAgentId(ref: string): string {
  const trimmed = ref.trim();
  return getCanonicalAgentId(trimmed) ?? resolveCanonicalAgentId(trimmed);
}

/** Known identities use an exact key, never an OR that can select a mirror. */
export function coworkerAuthorityWhere(ref: string) {
  const agentId = coworkerAuthorityAgentId(ref);
  return getCanonicalAgentId(ref.trim()) || agentId !== ref.trim() || /^AGT[-_]/i.test(agentId)
    ? { agentId }
    : { OR: [{ agentId }, { slugId: agentId }] };
}
