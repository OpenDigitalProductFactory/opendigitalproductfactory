// apps/web/lib/gpp/shape-language/resolve-sources.ts
//
// The seed-backed default sources for resolve (resolve.ts). Design:
// docs/superpowers/specs/2026-10-02-gpp-shape-notation-and-compiler-design.md
// §7.1 step 3; plan: docs/superpowers/plans/
// 2026-10-02-gpp-shape-notation-compiler-phase-3.md (PR-3b-1, BI-6DA17863;
// risks R5 and R6).
//
// Same registries as stage-tool-parity.test.ts, composed the same way (R5):
// - tools: PLATFORM_TOOLS; class: classifyConsequentialTool; grant
//   requirement: TOOL_TO_GRANTS.
// - grants: the runtime's getAgentToolGrantsAsync is DB-first (AgentToolGrant,
//   seeded on every boot from HARDCODED_COWORKER_GRANTS by slug), then falls
//   back to agent_registry.json. Here the seed stands in for the seeded table
//   — exactly the stand-in the parity test mocks in — and the fallback is the
//   runtime's own synchronous getAgentToolGrants. No grant rule is re-derived.
// - agents: agent_registry.json `agent_id`s and `agent_name`s (getAgentToolGrants
//   matches either; stages name some agents by name, e.g. onboarding-coo for
//   AGT-WS-ONBOARD), plus the seeded slugs.
// - sub-shapes: getWorkShapeVersion (current and frozen prior versions).
// - gate resolvers: a dynamic import of the named web-root module, the
//   bindings.test.ts rule (D-7), restricted to `lib/...` paths.
//
// R6 — "does this pull a database client into an offline script?" Measured:
// - `@dpf/db/workforce-seed` is safe: it re-exports HARDCODED_COWORKER_GRANTS
//   from `./coworker-grants` and imports PrismaClient as a TYPE only.
// - `@/lib/mcp-tools` (PLATFORM_TOOLS) is the coupling: it value-imports
//   `prisma` from `@dpf/db`, whose module body CONSTRUCTS a PrismaClient with
//   the pg adapter. There is no DB-free export of the tool list (the packs it
//   composes import `@dpf/db` themselves). Construction is lazy in Prisma: no
//   connection opens until the first query, and nothing here queries.
//   resolve-sources.test.ts proves it: across defaultResolveSources() and a
//   resolve of every registered shape, no socket connects and no Prisma
//   model or `$`-method is touched.
// - resolve.ts itself imports none of this, so a caller that injects its own
//   sources (every unit test, a future canvas) constructs no client at all;
//   resolve.test.ts proves that by making `@dpf/db` unimportable.
//
// OFFLINE TOOLING in Phase 3b: nothing in the running app imports this module.

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { HARDCODED_COWORKER_GRANTS } from "@dpf/db/workforce-seed";

import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import { getAgentToolGrants, TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";
import { classifyConsequentialTool } from "@/lib/tak/consequential-tool-policy";
import { getWorkShapeVersion } from "@/lib/work-management/work-shapes";

import agentRegistryData from "../../../../../packages/db/data/agent_registry.json";
import { WEB_ROOT } from "../source-files";
import { GPP_SHAPE_REF_PATTERN } from "./gpp-shape-schema";
import type { GppResolveSources } from "./resolve";

/** A gate resolver module: web-root relative, under lib/, no extension, no traversal. */
const RESOLVER_MODULE_PATTERN = /^lib\/[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/;
const EXPORT_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** The runtime's grant resolution with the seeded table standing in for the DB (see header). */
export function seededAgentToolGrants(agentId: string): string[] {
  const seeded = HARDCODED_COWORKER_GRANTS[agentId];
  if (seeded && seeded.length > 0) return [...seeded];
  return [...(getAgentToolGrants(agentId) ?? [])];
}

export function defaultResolveSources(): GppResolveSources {
  const tools = new Map(PLATFORM_TOOLS.map((tool) => [tool.name, tool]));
  const registry = agentRegistryData as { agents: Array<{ agent_id: string; agent_name: string }> };
  const knownAgents = new Set<string>([
    ...registry.agents.flatMap((agent) => [agent.agent_id, agent.agent_name]),
    ...Object.keys(HARDCODED_COWORKER_GRANTS),
  ]);

  return {
    platformTools: new Set(tools.keys()),
    grantsFor: seededAgentToolGrants,
    knownAgents,
    classify(toolName) {
      const tool = tools.get(toolName);
      return tool ? classifyConsequentialTool({ tool, toolName }) : null;
    },
    grantRequirement(toolName) {
      const requirement = Object.prototype.hasOwnProperty.call(TOOL_TO_GRANTS, toolName) ? TOOL_TO_GRANTS[toolName] : undefined;
      return requirement ? [...requirement] : null;
    },
    async importResolver(module, exportName) {
      if (!RESOLVER_MODULE_PATTERN.test(module) || !EXPORT_NAME_PATTERN.test(exportName)) return false;
      try {
        const loaded = (await import(pathToFileURL(join(WEB_ROOT, `${module}.ts`)).href)) as Record<string, unknown>;
        return typeof loaded[exportName] === "function";
      } catch {
        return false;
      }
    },
    shapeVersionExists(ref) {
      if (!GPP_SHAPE_REF_PATTERN.test(ref)) return false;
      const at = ref.lastIndexOf("@");
      return getWorkShapeVersion(ref.slice(0, at), ref.slice(at + 1)) !== null;
    },
  };
}
