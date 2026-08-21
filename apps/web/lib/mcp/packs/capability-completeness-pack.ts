// Capability-completeness tool pack.
//
// Design: docs/architecture/2026-08-20-assurance-operating-loop-and-capability-completeness.md
//
// A coworker capability is complete only when all SEVEN planes resolve —
// identity, corpus/WSID, governance/WWWD, shape, cadence, tools+skills,
// evidence. All seven are built platform-wide; nothing asserted they resolve
// TOGETHER, which is how `compliance-officer` ended up the only roster coworker
// unable to reach its own profession corpus and how 8 of 67 skills ended up
// assigned to identities that are not coworkers.
//
// scripts/measure-capability-completeness.mjs measures that mechanically and
// commits the result as a derived artifact. This pack is the door that lets a
// COWORKER read the same measure and act on it — the point being that the
// platform closes its own gaps rather than a human doing it from outside.
//
// READ-ONLY, deliberately. It reports gaps and names the concrete next action
// for each; it never edits grants, skills, or registries. Changing a coworker's
// authority is a consequential act that belongs behind the governance gate and
// a human decision, not behind a read tool.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import {
  capabilityCompletenessReport,
  capabilityCompletenessFor,
  type AgentCompleteness,
  type CapabilityPlane,
} from "@/lib/coworker-lifecycle/capability-completeness";

/** Plane -> the concrete action that raises it. Keeps the tool actionable
 *  rather than merely diagnostic: a coworker reading a gap gets the next move. */
const definitions: ToolDefinition[] = [
  {
    name: "get_capability_completeness",
    description:
      "Read the platform's own capability-completeness measure across EVERY agent identity — the " +
      "canonical AGT-* agent registry, the workforce roster, and the profession registry, joined into " +
      "one inventory. Reports which of the seven planes that make a capability real (identity, " +
      "corpus/WSID, governance/WWWD, shape, cadence, tools+skills, evidence) resolve for each agent, " +
      "graded 0-3 (absent / declared / reachable / proven) rather than pass-fail, because 'declared " +
      "but unreachable' is the failure mode a binary check cannot see. Also reports repo-level " +
      "defects: skills whose assignTo reaches nobody, and services citing skills that do not exist. " +
      "Every gap carries the concrete next action. Scores come in two forms — attainable (against " +
      "what the substrate currently permits) and absolute (against the full design); a plane whose " +
      "ceiling is below 3 is capped by missing platform substrate, not by the agent. Use this to find " +
      "and prioritise the platform's own evolution work. Read-only: it reports, it never changes authority.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description:
            "Optional. Scope to one identity — a canonical AGT-* id or any handle it answers to " +
            "(e.g. 'compliance-officer', 'AGT-ORCH-000', 'coo').",
        },
        plane: {
          type: "string",
          enum: ["identity", "corpus", "governance", "shape", "cadence", "toolsAndSkills", "evidence"],
          description: "Optional. Return only agents whose level on this plane is below its ceiling.",
        },
        identityClass: {
          type: "string",
          enum: ["active-roster", "active-registry-only", "roster-only", "defined-roster", "declared-only"],
          description:
            "Optional. Scope by identity class — e.g. 'active-roster' for agents actually running, " +
            "'declared-only' for canonical agents declared but never seeded anywhere.",
        },
        includeOrphans: {
          type: "boolean",
          description:
            "Include repo-level defects that belong to no single agent (assignTo health, stranded " +
            "skills, unbacked skill ids). Defaults to true.",
        },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
  },
];

const REMEDIATION: Record<CapabilityPlane, string> = {
  identity:
    "Reconcile the identity across namespaces: seed the canonical AGT-* agent onto the workforce " +
    "roster, or add its slug to COWORKER_SLUG_TO_CANONICAL_AGENT_ID in packages/db/src/agent-identity.ts.",
  corpus:
    "Grant the tool-grant that reaches evaluate_profession_decision (see missingGrants), or author " +
    "corpus pages under docs/professions/<professionKey>/wiki/.",
  governance:
    "Grant the tool-grant that reaches principle_decide (see missingGrants), and declare an " +
    "escalates_to / human_supervisor_id in packages/db/data/agent_registry.json. Without both, the " +
    "agent cannot consult the kernel and has nowhere to escalate.",
  shape:
    "Blocked platform-wide: no room-shape registry exists (design §4). Not an agent-level defect.",
  cadence:
    "Add a COWORKER_SELF_TASKS entry (apps/web/lib/operate/scheduled-jobs/coworker-self-tasks.ts) " +
    "describing one idempotent, non-destructive unit of recurring work. Until then any Proactivity " +
    "setting on this agent is a silent no-op.",
  toolsAndSkills:
    "Author or repoint a skill whose `assignTo` names a handle this agent actually answers to, and " +
    "resolve any unbacked backingSkillIds on its services. Note assignTo is written verbatim into " +
    "SkillAssignment.agentId — it is NOT bridged through agent-identity.ts.",
  evidence:
    "Add a curated golden journey (apps/web/lib/coworker-lifecycle/golden-journeys.ts) exercising a " +
    "real domain act. Without one the agent falls back to derivedReadProbe, which passes with zero " +
    "domain capability.",
};

function projectAgent(a: AgentCompleteness) {
  return {
    key: a.key,
    displayName: a.displayName,
    identityClass: a.identityClass,
    handles: a.handles,
    registryStatus: a.registryStatus,
    score: {
      attainablePct: a.score.attainablePct,
      absolutePct: a.score.absolutePct,
      note: "attainable = against what the substrate currently permits; absolute = against the full design.",
    },
    gaps: a.gaps.map((g) => ({
      plane: g.plane,
      level: g.level,
      ceiling: g.ceiling,
      detail: g.detail,
      missingGrants: a.planes[g.plane]?.missingGrants ?? [],
      nextAction: REMEDIATION[g.plane],
    })),
    cappedByPlatform: a.blockedPlanes.filter((b) => b.ceiling < 3),
  };
}

async function getCapabilityCompleteness(params: Record<string, unknown>): Promise<ToolResult> {
  try {
    const report = capabilityCompletenessReport();
    const agentId = typeof params["agentId"] === "string" ? params["agentId"] : null;
    const plane = typeof params["plane"] === "string" ? (params["plane"] as CapabilityPlane) : null;
    const identityClass = typeof params["identityClass"] === "string" ? params["identityClass"] : null;
    const includeOrphans = params["includeOrphans"] !== false;

    if (agentId) {
      const one = capabilityCompletenessFor(agentId);
      if (!one) {
        return {
          success: false,
          error: "unknown_agent",
          message:
            `No agent identity "${agentId}" in the measured inventory of ${report.summary.agents}. ` +
            "Pass a canonical AGT-* id or any handle it answers to.",
        };
      }
      return {
        success: true,
        message: `${one.key} (${one.identityClass}): ${one.score.attainablePct}% attainable, ${one.gaps.length} gap(s).`,
        data: { schemaVersion: report.schemaVersion, contract: report.contract, agent: projectAgent(one) },
      };
    }

    let scoped = report.agents;
    if (identityClass) scoped = scoped.filter((a) => a.identityClass === identityClass);
    if (plane) scoped = scoped.filter((a) => a.planes[plane].level < a.planes[plane].ceiling);

    return {
      success: true,
      message:
        `${scoped.length} of ${report.summary.agents} agent identities reported. ` +
        `Median attainable ${report.summary.medianAttainablePct}%, median absolute ` +
        `${report.summary.medianAbsolutePct}%; ${report.summary.atFullAttainable} at full attainable.`,
      data: {
        schemaVersion: report.schemaVersion,
        design: report.design,
        contract: report.contract,
        summary: report.summary,
        agents: scoped.map(projectAgent),
        ...(includeOrphans ? { orphans: report.orphans } : {}),
        provenance:
          "Derived artifact from scripts/measure-capability-completeness.mjs over committed source. " +
          "Regenerate with `pnpm measure:capability-completeness`.",
      },
    };
  } catch (error) {
    return { success: false, error: "read_failed", message: getErrorMessage(error) };
  }
}

export const capabilityCompletenessPack: ToolPack = {
  packId: "capability-completeness",
  definitions,
  handlers: {
    get_capability_completeness: (params) => getCapabilityCompleteness(params),
  },
  grants: {
    // Read-only platform introspection, keyed on `registry_read` — the same
    // grant that gates principle_decide and evaluate_profession_decision.
    get_capability_completeness: ["registry_read"],
  },
};
