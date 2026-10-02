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
// sub-shape reference's and gate resolver's existence. Whether a fact is a
// violation (C-2 unregistered tool, C-4 grant not held, D-7 missing resolver,
// ...) is the DRC's call (PR-3b-3), made over these facts.
//
// Every source is INJECTED (GppResolveSources), and this module imports none
// of them: it never reaches `@dpf/db`, a Prisma client or the network, so it
// gives the same answer on every host and in any test. The seed-backed
// default sources are in resolve-sources.ts (plan R6; see that file).
//
// OFFLINE TOOLING in Phase 3b: nothing in the running app imports this module.

import type { ConsequenceClass, ConsequentialToolClassification } from "@/lib/tak/consequential-tool-policy";

import { bindingElementId, gateElementId, shapeElementId, stageElementId, toolElementId } from "./element-ids";
import type { GppShapeDocument } from "./gpp-shape-schema";

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
  /** TOOL_TO_GRANTS: the grants any one of which allows the tool; null when the tool has no mapping. */
  grantRequirement(toolName: string): readonly string[] | null;
  /** True when `module` (web-root relative, no extension) exports a function named `exportName`. */
  importResolver(module: string, exportName: string): Promise<boolean>;
  /** True when `<key>@<version>` names a registered current or frozen prior shape version. */
  shapeVersionExists(ref: string): boolean;
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
  subShape?: { ref: string; exists: boolean };
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
    grantRequirement: requirement ? [...requirement] : null,
  };
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
      resolved.subShape = { ref: stage.subShape, exists: sources.shapeVersionExists(stage.subShape) };
    }
    stages.push(resolved);
  }
  return { shapeElementId: shapeElementId(document.key, document.version), stages };
}
