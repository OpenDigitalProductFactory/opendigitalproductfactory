// Coworker definition contract + conformance checks (EP-COWORKER-LIFECYCLE
// Phase 1, BI-53ABC4A4).
//
// A coworker's definition is scattered across independently hand-edited
// sources: the roster (COWORKER_AGENT_SEEDS), the grants map
// (HARDCODED_COWORKER_GRANTS), the route persona map (ROUTE_AGENT_MAP), the
// unified route-context map, the model-floor defaults
// (AGENT_MODEL_CONFIG_DEFAULTS), the skill wildcard list, the registry mirror
// (agent_registry.json), and the curated self-task registry. Historically
// nothing cross-checked them, so a new coworker could ship with a persona but
// no model floor, grants no tool honors, or a skills list that never reached
// it — defects discovered live, one at a time (see the BI-PIR-* false-refusal
// cluster and docs/superpowers/specs/2026-04-28-eliminate-seed-as-data-load-design.md).
//
// This module assembles the scattered sources into one CoworkerDefinition
// view per coworker and checks conformance. The colocated vitest gate runs in
// the required Unit Tests CI job and fails on any NEW finding; known
// pre-existing gaps live in coworker-definition-baseline.json and may only
// shrink. Complementary to (not duplicating) the advisory static audits
// audit-coworker-personas.ts / audit-coworker-tool-grants.ts (registry↔persona
// and grant-catalog axes) and the seed.test.ts profession-binding invariant.
//
// The module is pure: all sources are injected so it stays importable from
// tests and future surfaces (roster UI, factory door) without dragging in
// prisma or filesystem access.

export type CoworkerRosterEntry = {
  agentId: string;
  slugId: string;
  name: string;
  sensitivity: string;
};

export type RoutePersonaEntry = {
  routePrefix: string;
  agentId: string;
  sensitivity: string;
};

export type RouteContextEntry = {
  routePrefix: string;
  sensitivity: string;
};

export type ModelFloorEntry = {
  agentId: string;
  minimumTier: string;
};

export type RegistryMirrorEntry = {
  agentId: string;
  agentName: string;
  executionRuntimeType?: string;
};

export type SelfTaskEntry = {
  agentId: string;
};

export type CoworkerDefinitionSources = {
  roster: readonly CoworkerRosterEntry[];
  /** Bootstrap-created agents that are legitimate grant/skill targets but not roster rows. */
  bootstrapAgentIds: readonly string[];
  grantsByAgent: Readonly<Record<string, readonly string[]>>;
  /** The closed grant vocabulary actually honored by at least one tool. */
  knownGrantKeys: readonly string[];
  routePersonas: readonly RoutePersonaEntry[];
  routeContexts: readonly RouteContextEntry[];
  modelFloors: readonly ModelFloorEntry[];
  skillWildcardAgentIds: readonly string[];
  registryMirrors: readonly RegistryMirrorEntry[];
  selfTasks: readonly SelfTaskEntry[];
};

/** The assembled single view of one coworker's definition. */
export type CoworkerDefinition = {
  agentId: string;
  displayName: string;
  sensitivity: string;
  grants: readonly string[];
  boundRoutes: readonly string[];
  modelFloor: ModelFloorEntry | null;
  inSkillWildcard: boolean;
  registryMirror: RegistryMirrorEntry | null;
  hasSelfTask: boolean;
};

export type ConformanceFinding = {
  /** Stable check id — LIFE-NNN. */
  checkId: string;
  /** The coworker (or source row) the finding is about. */
  subject: string;
  message: string;
};

/** Stable serialization used for baseline comparison. */
export function findingKey(finding: ConformanceFinding): string {
  return `${finding.checkId}:${finding.subject}`;
}

export function assembleCoworkerDefinitions(
  sources: CoworkerDefinitionSources,
): CoworkerDefinition[] {
  const mirrorByName = new Map<string, RegistryMirrorEntry>();
  for (const mirror of sources.registryMirrors) {
    mirrorByName.set(mirror.agentName, mirror);
  }
  const selfTaskAgents = new Set(sources.selfTasks.map((t) => t.agentId));

  return sources.roster.map((seed) => {
    const registryMirror = mirrorByName.get(seed.agentId) ?? null;
    const boundRoutes = sources.routePersonas
      .filter((p) => p.agentId === seed.agentId)
      .map((p) => p.routePrefix);
    // Every registry-backed in-process coworker is also reachable through its
    // canonical record route. agent-routing-server resolves that route by id,
    // loads the coworker's prompt and skills, and enforces its lifecycle gate.
    // External CLI participants deliberately have no in-portal invocation path.
    if (registryMirror?.executionRuntimeType === "in_process") {
      boundRoutes.push(`/platform/ai/agent/${encodeURIComponent(seed.agentId)}`);
    }
    return {
      agentId: seed.agentId,
      displayName: seed.name,
      sensitivity: seed.sensitivity,
      grants: sources.grantsByAgent[seed.agentId] ?? [],
      boundRoutes,
      modelFloor: sources.modelFloors.find((m) => m.agentId === seed.agentId) ?? null,
      inSkillWildcard: sources.skillWildcardAgentIds.includes(seed.agentId),
      registryMirror,
      hasSelfTask: selfTaskAgents.has(seed.agentId),
    };
  });
}

/**
 * Cross-source conformance. Every check answers one question a new coworker's
 * author would otherwise discover live:
 *
 * - LIFE-001 grants-present   — roster coworker has a grants entry.
 * - LIFE-002 grant-honored    — every granted key is honored by ≥1 tool
 *                               (dead grants authorize nothing; the coworker
 *                               refuses "available" tools at call time).
 * - LIFE-003 invocation-route — in-process roster coworker is reachable via a
 *                               static persona or canonical coworker record.
 * - LIFE-004 persona-real     — every route persona points at a real agent
 *                               (roster, bootstrap, or registry) so a route
 *                               never binds to a ghost.
 * - LIFE-005 model-floor      — roster coworker has a model-floor default
 *                               (missing floor = weak local model = the #2685
 *                               fabrication class).
 * - LIFE-006 model-floor-real — every model-floor row references a real agent.
 * - LIFE-007 sensitivity-agree— ROUTE_AGENT_MAP and ROUTE_CONTEXT_MAP agree on
 *                               sensitivity for shared routes (the unified-path
 *                               transition contract; divergence flips data
 *                               boundaries with USE_UNIFIED_COWORKER).
 * - LIFE-008 skill-wildcard   — wildcard skill assignment reaches every roster
 *                               coworker and targets only real agents.
 * - LIFE-009 self-task-real   — every curated self-task references a roster
 *                               coworker.
 */
export function checkDefinitionConformance(
  sources: CoworkerDefinitionSources,
): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  const definitions = assembleCoworkerDefinitions(sources);
  const rosterIds = new Set(sources.roster.map((seed) => seed.agentId));
  const knownAgentIds = new Set<string>([
    ...rosterIds,
    ...sources.bootstrapAgentIds,
    ...sources.registryMirrors.flatMap((m) => [m.agentId, m.agentName]),
  ]);
  const knownGrants = new Set(sources.knownGrantKeys);

  for (const def of definitions) {
    const isExternalCli =
      def.registryMirror?.executionRuntimeType === "external_cli";
    if (def.grants.length === 0) {
      findings.push({
        checkId: "LIFE-001",
        subject: def.agentId,
        message: `${def.agentId} has no entry in HARDCODED_COWORKER_GRANTS — it boots with no tool surface`,
      });
    }
    for (const grant of def.grants) {
      if (!knownGrants.has(grant)) {
        findings.push({
          checkId: "LIFE-002",
          subject: `${def.agentId}/${grant}`,
          message: `${def.agentId} is granted "${grant}" but no tool honors that key — dead grant, tools will refuse at call time`,
        });
      }
    }
    if (!isExternalCli && def.boundRoutes.length === 0) {
      findings.push({
        checkId: "LIFE-003",
        subject: def.agentId,
        message: `${def.agentId} has no static persona or canonical in-process coworker route — users can never reach it in a workspace`,
      });
    }
    if (!isExternalCli && !def.modelFloor) {
      findings.push({
        checkId: "LIFE-005",
        subject: def.agentId,
        message: `${def.agentId} has no AGENT_MODEL_CONFIG_DEFAULTS row — no minimum model tier, so a weak local model can serve it`,
      });
    }
    if (!def.inSkillWildcard) {
      findings.push({
        checkId: "LIFE-008",
        subject: def.agentId,
        message: `${def.agentId} is missing from SKILL_WILDCARD_AGENT_IDS — wildcard skills never reach it`,
      });
    }
  }

  for (const persona of sources.routePersonas) {
    if (!knownAgentIds.has(persona.agentId)) {
      findings.push({
        checkId: "LIFE-004",
        subject: `${persona.routePrefix}/${persona.agentId}`,
        message: `Route ${persona.routePrefix} binds persona agentId "${persona.agentId}" which exists in no roster, bootstrap list, or registry`,
      });
    }
  }

  for (const floor of sources.modelFloors) {
    if (!knownAgentIds.has(floor.agentId)) {
      findings.push({
        checkId: "LIFE-006",
        subject: floor.agentId,
        message: `AGENT_MODEL_CONFIG_DEFAULTS row "${floor.agentId}" references an agent that exists in no roster, bootstrap list, or registry`,
      });
    }
  }

  const contextByRoute = new Map(sources.routeContexts.map((c) => [c.routePrefix, c]));
  for (const persona of sources.routePersonas) {
    const context = contextByRoute.get(persona.routePrefix);
    if (context && context.sensitivity !== persona.sensitivity) {
      findings.push({
        checkId: "LIFE-007",
        subject: persona.routePrefix,
        message: `Route ${persona.routePrefix} sensitivity disagrees: ROUTE_AGENT_MAP=${persona.sensitivity} vs ROUTE_CONTEXT_MAP=${context.sensitivity} — the USE_UNIFIED_COWORKER flag would flip the data boundary`,
      });
    }
  }

  for (const wildcardId of sources.skillWildcardAgentIds) {
    if (!knownAgentIds.has(wildcardId)) {
      findings.push({
        checkId: "LIFE-008",
        subject: wildcardId,
        message: `SKILL_WILDCARD_AGENT_IDS contains "${wildcardId}" which exists in no roster, bootstrap list, or registry — wildcard skills assigned to a ghost`,
      });
    }
  }

  for (const task of sources.selfTasks) {
    if (!rosterIds.has(task.agentId)) {
      findings.push({
        checkId: "LIFE-009",
        subject: task.agentId,
        message: `COWORKER_SELF_TASKS entry "${task.agentId}" references a non-roster coworker`,
      });
    }
  }

  return findings.sort((a, b) => findingKey(a).localeCompare(findingKey(b)));
}
