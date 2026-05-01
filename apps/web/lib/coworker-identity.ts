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
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

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

function findRepoRoot(): string {
  let dir = process.cwd();
  while (dir !== resolve(dir, "..")) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = resolve(dir, "..");
  }
  return process.cwd();
}

function loadDefaultRegistry(): CoworkerRegistry {
  if (cachedRegistry) return cachedRegistry;
  const root = findRepoRoot();
  const path = join(root, "packages/db/data/agent_registry.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as RawRegistry;
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
