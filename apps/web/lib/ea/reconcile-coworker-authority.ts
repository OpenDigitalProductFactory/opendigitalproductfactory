// apps/web/lib/ea/reconcile-coworker-authority.ts
//
// Reconcile the AI coworker workforce into a live SysML projection (Parity Engine,
// Slice 2). Thin IO shell: build the desired model from the registry (pure
// extractor) and apply it via the shared idempotent seeder. Re-derives from the
// registry every run, so it cannot drift. db + agents are injectable for tests.
//
// Not run at install; intended for the scheduled/on-demand reconcile path like the
// data-model mirror and the MCP-authority reconcile.

import agentRegistryData from "../../../../packages/db/data/agent_registry.json";
import { prisma } from "@dpf/db";
import { buildCoworkerAuthorityModel, type RegistryAgent } from "./coworker-authority-extract";
import { applySysmlModel, type SysmlSeedResult } from "./sysml-model-seed";

const registry = agentRegistryData as { agents: RegistryAgent[] };

export async function reconcileCoworkerAuthority(
  opts: { agents?: RegistryAgent[]; db?: typeof prisma } = {},
): Promise<SysmlSeedResult> {
  const model = buildCoworkerAuthorityModel(opts.agents ?? registry.agents);
  const result = await applySysmlModel(model, { db: opts.db });
  console.info(`[coworker-authority] reconcile ${result.status}: created=${result.created} updated=${result.updated} removed=${result.removed} (agents=${model.elements.length - 1})`);
  return result;
}
