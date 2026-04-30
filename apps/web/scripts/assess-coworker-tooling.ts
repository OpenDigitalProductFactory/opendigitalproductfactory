/**
 * Phase 1 — Coworker tooling self-assessment runner.
 *
 * Walks every coworker in agent_registry.json and renders a self-assessment
 * prompt that asks the role-holder to identify gaps in its tool envelope.
 * Output: one self-contained prompt per coworker, written to a JSON pack
 * file that downstream tooling (or a human review session) consumes.
 *
 * Usage:
 *   pnpm --filter web exec tsx scripts/assess-coworker-tooling.ts \
 *     --out docs/superpowers/audits/2026-04-28-coworker-self-assessment-prompts.json
 *
 * Optional filters:
 *   --filter <value-stream>    only coworkers in that VS (e.g. 'integrate')
 *   --tier <orchestrator|specialist|infrastructure>
 *   --agent <agent_id>         single coworker (repeatable)
 *   --limit <N>                cap output count (for incremental runs)
 *
 * Why this script renders prompts instead of dispatching them
 * -----------------------------------------------------------
 * The platform's production inference path (`routeAndCall`) requires a
 * configured provider, a healthy routing layer, and meaningful spend per
 * call. Phase 1's job is to *find* gaps in coworker tooling — running it
 * through a routing layer that itself may be the source of gaps would
 * conflate signals. Phase 1 ships the prompts; an in-conversation review
 * session (or a Phase 3 successor that uses `routeAndCall` once routing
 * is solid) consumes them and produces the responses. Aggregation is a
 * separate step.
 *
 * The render is deterministic on inputs: same registry + same catalog +
 * same persona files produce the same prompt pack. Prompts are designed
 * to elicit a strict JSON response shape (see SELF_ASSESSMENT_RESPONSE_SHAPE
 * below) so aggregation is mechanical.
 */

import { readFileSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

// ─── Repo root ─────────────────────────────────────────────────────────────

function repoRoot(): string {
  let dir = process.cwd();
  while (dir !== "/" && dir !== resolve(dir, "..")) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = resolve(dir, "..");
  }
  return process.cwd();
}
const ROOT = repoRoot();

// ─── Types ─────────────────────────────────────────────────────────────────

interface RegistryAgent {
  agent_id: string;
  agent_name: string;
  tier: string;
  value_stream: string;
  capability_domain: string;
  human_supervisor_id: string;
  hitl_tier_default: number;
  delegates_to: string[];
  escalates_to: string;
  it4it_sections: string[];
  config_profile: { tool_grants: string[] };
}

interface CatalogGrant {
  key: string;
  description: string;
  category: string;
  sensitivity: string;
  honored_by_tools: string[];
  implies: string[];
}

interface PersonaSummary {
  filePath: string;
  body: string;
}

// ─── Loaders ───────────────────────────────────────────────────────────────

function loadRegistry(): RegistryAgent[] {
  const raw = readFileSync(join(ROOT, "packages/db/data/agent_registry.json"), "utf8");
  return (JSON.parse(raw) as { agents: RegistryAgent[] }).agents;
}

function loadCatalog(): CatalogGrant[] {
  return JSON.parse(
    readFileSync(join(ROOT, "packages/db/data/grant_catalog.json"), "utf8"),
  ).grants as CatalogGrant[];
}

function loadPersonaForAgent(agentId: string): PersonaSummary | null {
  // Persona files don't yet have agent_id frontmatter (PR #316 backfill is in
  // progress at time of this run). Fall back to slug-matching by capability
  // domain heuristic: if any persona file's slug appears in the agent_name,
  // use that. Otherwise no persona — the prompt notes this and asks the role
  // to reason from the registry's capability_domain string only.
  void agentId;
  return null; // Phase 1: explicit no-persona until #316 backfill ships.
}

// ─── Effective grant resolution ────────────────────────────────────────────

function effectiveGrants(direct: string[], catalog: CatalogGrant[]): {
  effective: string[];
  authorizedTools: { tool: string; viaGrant: string }[];
  unhonored: string[];
} {
  const byKey = new Map(catalog.map((g) => [g.key, g]));
  const effective = new Set<string>();
  const stack = [...direct];
  while (stack.length > 0) {
    const k = stack.pop()!;
    if (effective.has(k)) continue;
    effective.add(k);
    const def = byKey.get(k);
    if (def) for (const i of def.implies) stack.push(i);
  }

  const tools: { tool: string; viaGrant: string }[] = [];
  const seen = new Set<string>();
  const unhonored: string[] = [];
  for (const k of effective) {
    const def = byKey.get(k);
    if (!def) continue;
    if (def.honored_by_tools.length === 0) {
      unhonored.push(k);
      continue;
    }
    for (const t of def.honored_by_tools) {
      if (seen.has(t)) continue;
      seen.add(t);
      tools.push({ tool: t, viaGrant: k });
    }
  }
  return {
    effective: [...effective].sort(),
    authorizedTools: tools.sort((a, b) => a.tool.localeCompare(b.tool)),
    unhonored: unhonored.sort(),
  };
}

// ─── Prompt rendering ──────────────────────────────────────────────────────

const SELF_ASSESSMENT_RESPONSE_SHAPE = `{
  "agent_id": "<the agent_id you were assigned>",
  "verdict": "adequate" | "gaps" | "blocked",
  "missing_tools": [
    {
      "need": "<one-sentence description of the capability you need but don't have>",
      "blocks": "<one-sentence description of what your job description requires that this prevents>",
      "severity": "blocker" | "important" | "minor"
    }
  ],
  "over_allocated_tools": [
    {
      "grant_key": "<a grant key from your effective list>",
      "reason": "<why your job description does NOT require this grant>"
    }
  ],
  "ambiguous_boundaries": [
    {
      "with_agent_id": "<an AGT-… you delegate to or interface with>",
      "tool_or_capability": "<the tool/capability whose ownership is ambiguous>",
      "your_view": "<one sentence on which side should own it and why>"
    }
  ],
  "unhonored_grants_self_check": [
    {
      "grant_key": "<a grant on your effective list with no honoring tool>",
      "needed": true | false,
      "reason": "<one-sentence rationale>"
    }
  ],
  "confidence": "high" | "medium" | "low",
  "notes": "<optional: anything else relevant in 1-2 sentences>"
}`;

function renderPrompt(
  agent: RegistryAgent,
  resolution: ReturnType<typeof effectiveGrants>,
  persona: PersonaSummary | null,
  catalog: CatalogGrant[],
): string {
  const personaBlock = persona
    ? `## YOUR PERSONA (from prompts/${persona.filePath})\n\n${persona.body.trim()}`
    : `## YOUR PERSONA\n\nNo persona file exists yet for this coworker — the persona-audit backfill (PR #316) is in progress. For this self-assessment, reason from your registry capability_domain alone:\n\n> ${agent.capability_domain}`;

  const grantsBlock = resolution.authorizedTools.length === 0
    ? "**You currently have NO authorized tools.** Every grant on your registry list is unhonored — there is no tool implementation that requires any of your grant keys. You cannot perform any platform action."
    : resolution.authorizedTools
        .map((t) => `- \`${t.tool}\` (via \`${t.viaGrant}\`)`)
        .join("\n");

  const unhonoredBlock = resolution.unhonored.length === 0
    ? "(none)"
    : resolution.unhonored.map((g) => {
        const def = catalog.find((c) => c.key === g);
        return `- \`${g}\`${def ? ` — ${def.description}` : ""} — **no tool implements this**`;
      }).join("\n");

  const delegatesBlock = agent.delegates_to.length === 0
    ? "(none)"
    : agent.delegates_to.map((id) => `- ${id}`).join("\n");

  return `You are ${agent.agent_id} (${agent.agent_name}), a coworker in the Digital Product Factory platform.

The platform is doing a tooling self-assessment to identify gaps before scaling further work. **Your task: review your job description, your effective tool envelope, and your interfaces with peers, then identify (a) tools you need but don't have, (b) tools you have but don't need, (c) ambiguous ownership boundaries with peers.**

You will produce a strict JSON response — no preamble, no commentary outside the JSON. The aggregator parses your response by structure.

---

## YOUR REGISTRY ENTRY

- **agent_id:** ${agent.agent_id}
- **agent_name:** ${agent.agent_name}
- **tier:** ${agent.tier}
- **value_stream:** ${agent.value_stream}
- **capability_domain:** ${agent.capability_domain}
- **hitl_tier_default:** ${agent.hitl_tier_default}
- **escalates_to:** ${agent.escalates_to}
- **it4it_sections:** ${agent.it4it_sections.join(", ")}

${personaBlock}

## WHO YOU INTERFACE WITH

You delegate to:
${delegatesBlock}

You escalate to: ${agent.escalates_to}

## YOUR TOOL ENVELOPE

You have the following grant keys on your registry record:
${agent.config_profile.tool_grants.map((g) => `- \`${g}\``).join("\n")}

Through those grants (with transitive \`implies\` resolution against the grant catalog), you are authorized to invoke these platform tools:

${grantsBlock}

The following grants are on your record but **no tool implementation honors them** — they are aspirational scope you cannot exercise:

${unhonoredBlock}

---

## SELF-ASSESSMENT QUESTIONS

Answer these as a strict JSON object matching this exact shape:

\`\`\`json
${SELF_ASSESSMENT_RESPONSE_SHAPE}
\`\`\`

Verdict guidance:
- **adequate** — your tools cover your job description; no significant gaps.
- **gaps** — your job description implies workflows your tools don't fully cover, but you can do meaningful work.
- **blocked** — you cannot perform core duties of your role with the current envelope.

For \`missing_tools\`: list specific capabilities. Examples: "ability to query the deployment status of a release", "ability to trigger a rollback", "ability to read incident timelines I'm being escalated to act on." Don't list tool names you'd invent — describe the capability and what your job requires that it would enable.

For \`over_allocated_tools\`: only list grants that you can clearly justify NOT needing. If you're unsure, leave it out and note the ambiguity in \`notes\`.

For \`ambiguous_boundaries\`: pick at most 3. Focus on real ownership questions, not edge cases.

For \`unhonored_grants_self_check\`: for each unhonored grant on your record, say whether your job actually needs that capability. This drives the GRANT-002 reconciliation in the tool-grant audit.

Set \`confidence\` honestly:
- **high** — you have a persona and the capability_domain is specific.
- **medium** — capability_domain alone, but the role is recognizable.
- **low** — capability_domain is vague or your job is hard to reason about without more context.

Return ONLY the JSON object. No markdown fence, no commentary.`;
}

// ─── Main ──────────────────────────────────────────────────────────────────

interface PromptPack {
  generated_at: string;
  spec: string;
  registry_path: string;
  catalog_path: string;
  total_coworkers: number;
  prompts: Array<{
    agent_id: string;
    agent_name: string;
    tier: string;
    value_stream: string;
    has_persona: boolean;
    direct_grants: string[];
    effective_grants: string[];
    authorized_tool_count: number;
    unhonored_grant_count: number;
    prompt: string;
  }>;
}

function main(): void {
  const args = process.argv.slice(2);
  let outPath: string | null = null;
  let filterVS: string | null = null;
  let filterTier: string | null = null;
  const filterAgents: string[] = [];
  let limit: number | null = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--out" && args[i + 1]) { outPath = args[++i]; }
    else if (a === "--filter" && args[i + 1]) { filterVS = args[++i]; }
    else if (a === "--tier" && args[i + 1]) { filterTier = args[++i]; }
    else if (a === "--agent" && args[i + 1]) { filterAgents.push(args[++i]); }
    else if (a === "--limit" && args[i + 1]) { limit = parseInt(args[++i], 10); }
  }

  if (!outPath) {
    console.error("Usage: assess-coworker-tooling.ts --out <path> [--filter <vs>] [--tier <t>] [--agent <id>]+ [--limit N]");
    process.exit(2);
  }
  if (outPath && !outPath.match(/^([a-zA-Z]:[\\/]|\/)/)) {
    outPath = join(ROOT, outPath);
  }

  const registry = loadRegistry();
  const catalog = loadCatalog();

  let agents = registry;
  if (filterVS) agents = agents.filter((a) => a.value_stream === filterVS);
  if (filterTier) agents = agents.filter((a) => a.tier === filterTier);
  if (filterAgents.length > 0) agents = agents.filter((a) => filterAgents.includes(a.agent_id));
  if (limit !== null) agents = agents.slice(0, limit);

  const pack: PromptPack = {
    generated_at: new Date().toISOString(),
    spec: "docs/superpowers/audits/2026-04-28-coworker-self-assessment.md",
    registry_path: "packages/db/data/agent_registry.json",
    catalog_path: "packages/db/data/grant_catalog.json",
    total_coworkers: agents.length,
    prompts: agents.map((agent) => {
      const resolution = effectiveGrants(agent.config_profile.tool_grants, catalog);
      const persona = loadPersonaForAgent(agent.agent_id);
      const prompt = renderPrompt(agent, resolution, persona, catalog);
      return {
        agent_id: agent.agent_id,
        agent_name: agent.agent_name,
        tier: agent.tier,
        value_stream: agent.value_stream,
        has_persona: persona !== null,
        direct_grants: agent.config_profile.tool_grants,
        effective_grants: resolution.effective,
        authorized_tool_count: resolution.authorizedTools.length,
        unhonored_grant_count: resolution.unhonored.length,
        prompt,
      };
    }),
  };

  writeFileSync(outPath, JSON.stringify(pack, null, 2) + "\n", "utf8");
  console.error(`[assess] wrote ${outPath} (${pack.prompts.length} prompts)`);
}

main();
