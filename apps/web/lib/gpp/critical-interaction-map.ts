// Critical-interaction map: every platform tool, how it can be reached, and
// which gates guard it.
//
// GPP Phase 1, T1 (docs/superpowers/plans/2026-10-01-gpp-phase-1-see-and-ratchet.md).
// Scope baseline: OBJ-VISIBLE; acceptance AC-MAP.
//
// Pure: callers pass the registry, the grant map, holders and call sites in;
// the map invents no rule of its own. Classification comes from the runtime's
// own classifyConsequentialTool, so the map cannot disagree with enforcement.

import type { ConsequentialToolClassification } from "@/lib/tak/consequential-tool-policy";

import { bindingsForTool } from "./bindings";

export type GuardMode = "enforced" | "shadow" | "none";

export type MapToolInput = {
  name: string;
  sideEffect?: boolean;
  consequence?: string | null;
  consequenceScope?: string | null;
  buildPhases?: readonly string[] | null;
};

export type CriticalInteractionDeps = {
  classify: (tool: MapToolInput) => Pick<
    ConsequentialToolClassification,
    "consequential" | "alignmentRequired" | "collaborationShape"
  >;
  grantsFor: (toolName: string) => readonly string[];
  holdersOf: (grantKey: string) => readonly string[];
  projectableTools: ReadonlySet<string>;
  shapeGateMode: GuardMode;
  directSites: ReadonlyMap<string, readonly string[]>;
};

export type CriticalInteractionEntry = {
  name: string;
  sideEffect: boolean;
  consequence: string | null;
  consequenceScope: string | null;
  grants: string[];
  holders: string[];
  buildPhases: string[];
  collaborationShape: string | null;
  guards: {
    /** WWWD × WSID alignment gate for tools that require it outside a Workroom. */
    alignment: GuardMode;
    /** Inside a Workroom the alignment gate runs for every consequential tool. */
    alignmentInWorkroom: boolean;
    escalation: GuardMode;
    projector: GuardMode;
    shapeGate: GuardMode;
    /** GPP Phase 2 permit (PR-C): `shadow` when a declared binding covers the tool, else `none`. */
    permit: GuardMode;
  };
  directSites: string[];
  /** Outward, authority or irreversible: the calls GPP gates. C-5 combinations are not computed in Phase 1. */
  critical: boolean;
  /** Side-effecting with no declared consequence class. */
  unclassifiedSideEffect: boolean;
};

export type CriticalInteractionMap = {
  generatedAt: string;
  gitSha: string | null;
  totals: { tools: number; sideEffect: number; critical: number; unclassifiedSideEffect: number; directSites: number };
  tools: CriticalInteractionEntry[];
  /** Direct sites whose tool name is a variable (approved proposals, dispatch proxies). */
  dynamicDirectSites: string[];
};

export function buildCriticalInteractionMap(
  tools: readonly MapToolInput[],
  deps: CriticalInteractionDeps,
  meta: { generatedAt: string; gitSha: string | null },
): CriticalInteractionMap {
  const entries = tools.map((tool): CriticalInteractionEntry => {
    const sideEffect = tool.sideEffect === true;
    const classification = deps.classify(tool);
    const grants = [...deps.grantsFor(tool.name)];
    const holders = [...new Set(grants.flatMap((grant) => deps.holdersOf(grant)))].sort();
    const shape = classification.collaborationShape ?? null;
    return {
      name: tool.name,
      sideEffect,
      consequence: tool.consequence ?? null,
      consequenceScope: tool.consequenceScope ?? null,
      grants,
      holders,
      buildPhases: [...(tool.buildPhases ?? [])],
      collaborationShape: shape,
      guards: {
        alignment: classification.alignmentRequired ? "enforced" : "none",
        alignmentInWorkroom: classification.consequential,
        escalation: sideEffect ? "enforced" : "none",
        projector: deps.projectableTools.has(tool.name) ? "enforced" : "none",
        shapeGate: shape ? deps.shapeGateMode : "none",
        permit: bindingsForTool({ consequential: classification.consequential }).length ? "shadow" : "none",
      },
      directSites: [...(deps.directSites.get(tool.name) ?? [])],
      critical: classification.consequential,
      unclassifiedSideEffect: sideEffect && !tool.consequence,
    };
  });
  entries.sort((a, b) => Number(b.critical) - Number(a.critical) || a.name.localeCompare(b.name));
  return {
    generatedAt: meta.generatedAt,
    gitSha: meta.gitSha,
    totals: {
      tools: entries.length,
      sideEffect: entries.filter((e) => e.sideEffect).length,
      critical: entries.filter((e) => e.critical).length,
      unclassifiedSideEffect: entries.filter((e) => e.unclassifiedSideEffect).length,
      directSites: entries.reduce((sum, e) => sum + e.directSites.length, 0) + (deps.directSites.get("dynamic")?.length ?? 0),
    },
    tools: entries,
    dynamicDirectSites: [...(deps.directSites.get("dynamic") ?? [])],
  };
}

/** Markdown summary: critical tools first, then unclassified side-effecting tools. */
export function renderCriticalInteractionMarkdown(map: CriticalInteractionMap): string {
  const row = (e: CriticalInteractionEntry) =>
    `| \`${e.name}\` | ${e.consequence ?? "—"} | ${e.guards.alignment}${e.guards.alignmentInWorkroom ? " (+ in Workroom)" : ""} | ${e.guards.escalation} | ${e.guards.projector} | ${e.guards.shapeGate} | ${e.guards.permit} | ${e.holders.length} | ${e.directSites.join(", ") || "—"} |`;
  const head = "| Tool | Consequence | Alignment | Escalation | Projector | Shape gate | Permit | Holders | Direct sites |\n|---|---|---|---|---|---|---|---|---|";
  const t = map.totals;
  return [
    `# Critical-interaction map`,
    ``,
    `Generated ${map.generatedAt}${map.gitSha ? ` at ${map.gitSha}` : ""}.`,
    `${t.tools} tools · ${t.sideEffect} side-effecting · ${t.critical} critical · ${t.unclassifiedSideEffect} unclassified side-effecting · ${t.directSites} direct call sites.`,
    ``,
    `## Critical tools`,
    ``,
    head,
    ...map.tools.filter((e) => e.critical).map(row),
    ``,
    `## Unclassified side-effecting tools`,
    ``,
    head,
    ...map.tools.filter((e) => e.unclassifiedSideEffect).map(row),
    ``,
    `## Direct sites with a dynamic tool name`,
    ``,
    ...(map.dynamicDirectSites.length ? map.dynamicDirectSites.map((site) => `- ${site}`) : ["- none"]),
    ``,
  ].join("\n");
}
