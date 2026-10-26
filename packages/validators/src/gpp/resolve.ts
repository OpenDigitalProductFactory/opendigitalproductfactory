// apps/web/lib/gpp/shape-language/resolve.ts
//
// Pipeline step 3: resolve. Design: docs/superpowers/specs/
// 2026-10-02-gpp-shape-notation-and-compiler-design.md §7.1 ("tool names →
// PLATFORM_TOOLS; agents → agent_registry.json; consequence class via
// classifyConsequentialTool; subShape refs; gate resolvers → exported
// functions"); plan: docs/superpowers/plans/
// 2026-10-02-gpp-shape-notation-compiler-phase-3.md (PR-3b-1, BI-6DA17863;
// risks R5, R6).
//
// Facts, not verdicts. This step looks every name in a schema-valid document
// up in the platform's own registries and returns what it found: each tool's
// registration, consequence class (O/A/I = `consequential`) and grant
// requirement; each accountable agent's existence and resolved grants; each
// sub-shape reference's and gate resolver's existence; and, for a sub-shape
// (GPP Phase 3c PR-3c-5), the child's grants and stage tools and the first
// cycle in the sub-shape call graph. Whether a fact is a
// violation (C-2 unregistered tool, C-4 grant not held, D-7 missing resolver,
// ...) is the DRC's call (PR-3b-3), made over these facts.
//
// Every source is INJECTED (GppResolveSources), and this module imports none
// of them: it never reaches `@dpf/db`, a Prisma client or the network, so it
// gives the same answer on every host and in any test. The seed-backed
// default sources are in resolve-sources.ts (plan R6; see that file).
//
// OFFLINE TOOLING in Phase 3b: nothing in the running app imports this module.

import type { ConsequenceClass, GppToolClassification as ConsequentialToolClassification, ToolConsequence } from "./tool-facts.ts";

import { bindingElementId, gateElementId, shapeElementId, stageElementId, toolElementId } from "./element-ids.ts";
import type { GppShapeDocument } from "./gpp-shape-schema.ts";

/** What resolve reads. Each member is one registry the runtime already owns. */
export type GppResolveSources = {
  /** Names of every registered platform tool (PLATFORM_TOOLS). */
  platformTools: ReadonlySet<string>;
  /** The agent's resolved tool grants, as the runtime resolves them (seed first, registry JSON fallback). */
  grantsFor(agentId: string): readonly string[];
  /** Agent ids the platform knows. */
  knownAgents: ReadonlySet<string>;
  /** classifyConsequentialTool for a registered tool; null for a name that is not registered. */
  classify(toolName: string): ConsequentialToolClassification | null;
  /**
   * The tool's declared `consequence` (outward / irreversible / authority, the
   * O / I / A letters of spec §5 construct 3); null when it declares none or
   * is not registered. classify alone cannot tell A from I: both classify as
   * "declared-irreversible".
   */
  consequence(toolName: string): ToolConsequence | null;
  /** TOOL_TO_GRANTS: the grants any one of which allows the tool; null when the tool has no mapping. */
  grantRequirement(toolName: string): readonly string[] | null;
  /** True when `module` (web-root relative, no extension) exports a function named `exportName`. */
  importResolver(module: string, exportName: string): Promise<boolean>;
  /** True when `<key>@<version>` names a registered current or frozen prior shape version. */
  shapeVersionExists(ref: string): boolean;
  /**
   * The registered shape version's grants and stages (GPP Phase 3c PR-3c-5,
   * D-9 and D-10), or null when it is not registered. Optional: a source
   * without it can preview the document, but compilation holds existing child
   * references whose grant, stage or transitive graph facts are unavailable.
   */
  shapeDefinition?(ref: string): GppSubShapeDefinition | null;
};

/** What D-9 and D-10 read of a registered shape version. */
export type GppSubShapeDefinition = {
  grants: readonly string[];
  stages: ReadonlyArray<{ key: string; tools?: readonly string[]; subShape?: string }>;
};

export type GppResolvedTool = {
  elementId: string;
  stageKey: string;
  toolName: string;
  registered: boolean;
  /** null when the tool is not registered. */
  consequenceClass: ConsequenceClass | null;
  /** The O/A/I fact: classifyConsequentialTool(...).consequential. null when not registered. */
  consequential: boolean | null;
  alignmentRequired: boolean | null;
  /** The declared consequence (O / I / A); null when none is declared or the tool is not registered. */
  consequence: ToolConsequence | null;
  /** null when TOOL_TO_GRANTS has no entry (the runtime denies such a tool by default). */
  grantRequirement: readonly string[] | null;
};

export type GppResolvedPrincipal =
  | { kind: "agent"; ref: string; agentId: string; known: boolean; grants: readonly string[] }
  | { kind: "role" | "person"; ref: string };

export type GppResolvedStage = {
  elementId: string;
  stageKey: string;
  principal: GppResolvedPrincipal;
  /** Absent when the stage declares no `tools` (undeclared, as today). */
  tools?: GppResolvedTool[];
  gate?: { elementId: string; resolver?: { module: string; exportName: string; exists: boolean } };
  binding?: { elementId: string; egress: Array<{ toolName: string; registered: boolean }> };
  /**
   * `exists`: the ref names a registered shape version. When the source can
   * read the version (shapeDefinition), `grants` and `tools` are the child's
   * declared ceiling and stage tools (D-9), and `cycle` is the first sub-shape
   * call path from this document that returns to a shape already on it, or
   * null (D-10). A ref that does not resolve carries none of them.
   */
  subShape?: {
    ref: string;
    exists: boolean;
    grants?: readonly string[];
    tools?: ReadonlyArray<{ stageKey: string; toolName: string }>;
    cycle?: readonly string[] | null;
    /** Unread or traversal-bounded refs: absence of a cycle is not established. */
    unavailableRefs?: readonly string[];
  };
};

export type GppResolution = {
  shapeElementId: string;
  stages: GppResolvedStage[];
};

function resolvePrincipal(ref: string, sources: GppResolveSources): GppResolvedPrincipal {
  if (ref.startsWith("agent:")) {
    const agentId = ref.slice("agent:".length);
    return { kind: "agent", ref, agentId, known: sources.knownAgents.has(agentId), grants: [...sources.grantsFor(agentId)] };
  }
  return { kind: ref.startsWith("role:") ? "role" : "person", ref };
}

function resolveTool(stageKey: string, toolName: string, sources: GppResolveSources): GppResolvedTool {
  const registered = sources.platformTools.has(toolName);
  const classification = registered ? sources.classify(toolName) : null;
  const requirement = sources.grantRequirement(toolName);
  return {
    elementId: toolElementId(stageKey, toolName),
    stageKey,
    toolName,
    registered,
    consequenceClass: classification?.class ?? null,
    consequential: classification ? classification.consequential : null,
    alignmentRequired: classification ? classification.alignmentRequired : null,
    consequence: registered ? sources.consequence(toolName) : null,
    grantRequirement: requirement ? [...requirement] : null,
  };
}

/**
 * The first sub-shape call path from `root` through `ref` that reaches a shape
 * already on the path (the root included), or null. Walked depth-first over the
 * registered versions' own `subShape` refs; a ref the source cannot read ends
 * its branch. Bounded by the number of distinct refs met.
 */
function subShapeCycle(root: string, ref: string, sources: GppResolveSources): { cycle: string[] | null; unavailableRefs: string[] } {
  const seen = new Set<string>();
  const unavailableRefs = new Set<string>();
  const pending = [{ path: [root], next: ref }];
  // Source adapters may expose an unbounded registry. Exhaustion is unknown,
  // never a successful cycle check; the stack also avoids recursive overflow.
  while (pending.length) {
    const { path, next } = pending.pop()!;
    if (path.includes(next)) return { cycle: [...path, next], unavailableRefs: [...unavailableRefs] };
    if (seen.has(next)) continue;
    if (seen.size >= 1024) {
      unavailableRefs.add(next);
      break;
    }
    seen.add(next);
    const definition = sources.shapeVersionExists(next) ? sources.shapeDefinition?.(next) ?? null : null;
    if (!definition) { unavailableRefs.add(next); continue; }
    // Reverse push preserves the incumbent depth-first, stage-order result.
    for (const stage of [...definition.stages].reverse()) {
      if (stage.subShape === undefined) continue;
      pending.push({ path: [...path, next], next: stage.subShape });
    }
  }
  return { cycle: null, unavailableRefs: [...unavailableRefs] };
}

/** Step 3. Pure over its sources; returns facts in document order. */
export async function resolveShapeDocument(document: GppShapeDocument, sources: GppResolveSources): Promise<GppResolution> {
  const stages: GppResolvedStage[] = [];
  for (const stage of document.stages) {
    const resolved: GppResolvedStage = {
      elementId: stageElementId(stage.key),
      stageKey: stage.key,
      principal: resolvePrincipal(stage.accountablePrincipalRef, sources),
    };
    if (stage.tools !== undefined) resolved.tools = stage.tools.map((toolName) => resolveTool(stage.key, toolName, sources));
    if (stage.advance.kind === "governed-decision") {
      const gate = stage.advance.gate;
      resolved.gate = { elementId: gateElementId(stage.key) };
      if (gate?.resolver) {
        const { module, exportName } = gate.resolver;
        resolved.gate.resolver = { module, exportName, exists: await sources.importResolver(module, exportName) };
      }
    }
    if (stage.binding) {
      resolved.binding = {
        elementId: bindingElementId(stage.binding.id, stage.binding.version),
        egress: (stage.binding.egress ?? []).map((toolName) => ({ toolName, registered: sources.platformTools.has(toolName) })),
      };
    }
    if (stage.subShape !== undefined) {
      const exists = sources.shapeVersionExists(stage.subShape);
      const child = exists ? sources.shapeDefinition?.(stage.subShape) ?? null : null;
      const traversal = subShapeCycle(`${document.key}@${document.version}`, stage.subShape, sources);
      resolved.subShape = {
        ref: stage.subShape,
        exists,
        ...(child
          ? {
            grants: [...child.grants],
            tools: child.stages.flatMap((entry) => (entry.tools ?? []).map((toolName) => ({ stageKey: entry.key, toolName }))),
          }
          : {}),
        cycle: traversal.cycle,
        ...(exists && traversal.unavailableRefs.length ? { unavailableRefs: traversal.unavailableRefs } : {}),
      };
    }
    stages.push(resolved);
  }
  return { shapeElementId: shapeElementId(document.key, document.version), stages };
}
