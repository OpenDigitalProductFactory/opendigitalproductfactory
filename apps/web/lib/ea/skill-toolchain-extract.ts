// apps/web/lib/ea/skill-toolchain-extract.ts
//
// Pure extractor for the Skill & Agent Toolchain SysML projection (Parity Engine,
// living-graph Phase A — substrate-spec §8 catch-up view #7). Derives a live SysML
// model from the seeded skill catalogue (SkillDefinition + SkillAssignment) so the
// agent toolchain — which skills exist, how they compose, which category they belong
// to, and how widely they are assigned — is a projection of the source of truth and
// cannot drift.
//
// SysML mapping (intra-model, like every other projection — cross-layer edges to the
// coworker/MCP-tool projections are deferred to the cross-layer phase):
//   - root package  skilltool:pkg              "Skill & Agent Toolchain"
//   - category pkg  skilltool:cat:<category>   contained by the root package
//   - each skill    skilltool:skill:<skillId>  part_definition, contained by its category
//   - composesFrom  skill A → skill B          traces edge (only when B is a live skill)
// Stable `skilltool:*` source keys; pure — the reconcile shell supplies IO via
// applySysmlModel.
//
// Design: docs/superpowers/specs/2026-06-16-living-architecture-graph-and-operational-bridge-design.md

import type { SysmlDesiredModel } from "./sysml-model-seed";

/** Source-of-truth facts for one skill, decoupled from the Prisma row shape (mirrors
 *  the RegistryAgent decoupling in the coworker extractor) so the pure builder is
 *  testable without a DB. */
export interface SkillFact {
  skillId: string;
  name: string;
  description: string;
  category: string;
  status: string;
  riskBand: string;
  taskType: string;
  capability: string | null;
  userInvocable: boolean;
  agentInvocable: boolean;
  allowedTools: string[];
  composesFrom: string[];
  /** Count of enabled SkillAssignment rows (how many coworkers carry this skill). */
  assignmentCount: number;
}

export const SKILL_TOOLCHAIN_PACKAGE_KEY = "skilltool:pkg";

// A deprecated skill is no longer part of the running toolchain — it is excluded from
// the desired set (and therefore soft-removed). Everything else (discovered → active)
// is carried with its status as a property so the view reflects the real catalogue.
const EXCLUDED_STATUSES = new Set(["deprecated"]);

function truncate(s: string | undefined, n = 240): string {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function categoryKey(category: string): string {
  const slug = category.trim() || "uncategorized";
  return `skilltool:cat:${slug}`;
}

export function buildSkillToolchainModel(skills: SkillFact[]): SysmlDesiredModel {
  const live = skills.filter((s) => !EXCLUDED_STATUSES.has(s.status));
  const elements: SysmlDesiredModel["elements"] = [];
  const relationships: SysmlDesiredModel["relationships"] = [];

  elements.push({
    sysmlKey: SKILL_TOOLCHAIN_PACKAGE_KEY,
    typeSlug: "package",
    name: "Skill & Agent Toolchain",
    description:
      "Live SysML projection of the agent skill toolchain — the skill catalogue, its categories, composition chains, and assignment breadth — derived from the seeded SkillDefinition/SkillAssignment catalogue so it cannot drift from the source of truth.",
    properties: { sourceKey: "prisma models SkillDefinition and SkillAssignment", skillCount: live.length },
  });

  // Category sub-packages (sorted, deduped) — mirrors the route extractor's segment
  // packages so the view is a readable hierarchy rather than a flat list.
  const categories = [...new Set(live.map((s) => s.category.trim() || "uncategorized"))].sort();
  for (const cat of categories) {
    const key = categoryKey(cat);
    elements.push({
      sysmlKey: key,
      typeSlug: "package",
      name: cat,
      description: `Skill category: ${cat}.`,
      properties: { sourceKey: `skill:category:${cat}`, category: cat },
    });
    relationships.push({ fromKey: SKILL_TOOLCHAIN_PACKAGE_KEY, toKey: key, relSlug: "contains" });
  }

  const known = new Set(live.map((s) => s.skillId));

  for (const s of [...live].sort((a, b) => a.skillId.localeCompare(b.skillId))) {
    const key = `skilltool:skill:${s.skillId}`;
    elements.push({
      sysmlKey: key,
      typeSlug: "part_definition",
      name: `${s.name} (${s.skillId})`,
      description: truncate(s.description) || `Skill ${s.name}.`,
      properties: {
        sourceKey: `SkillDefinition#${s.skillId}`,
        skillId: s.skillId,
        category: s.category,
        status: s.status,
        riskBand: s.riskBand,
        taskType: s.taskType,
        capability: s.capability ?? null,
        userInvocable: s.userInvocable,
        agentInvocable: s.agentInvocable,
        allowedToolCount: s.allowedTools.length,
        assignmentCount: s.assignmentCount,
      },
    });
    relationships.push({ fromKey: categoryKey(s.category), toKey: key, relSlug: "contains" });

    // Composition chains: this skill builds on its predecessors (intra-model only —
    // edge emitted just for live target skills, like coworker delegation to known agents).
    for (const dep of s.composesFrom) {
      if (dep !== s.skillId && known.has(dep)) {
        relationships.push({ fromKey: key, toKey: `skilltool:skill:${dep}`, relSlug: "traces" });
      }
    }
  }

  return {
    elements,
    relationships,
    elementTypeSlugs: ["package", "part_definition"],
    relTypeSlugs: ["contains", "traces"],
    view: {
      name: "Skill & Agent Toolchain — Live Projection",
      description: "Live, system-maintained projection of the agent skill catalogue, its categories, and composition chains.",
      viewpointName: "System Decomposition & Interfaces",
      scopeRef: "skill-toolchain",
    },
    softRemovePrefix: "skilltool:",
  };
}
