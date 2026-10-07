// apps/web/lib/gpp/shape-language/drc.ts
//
// Pipeline step 4: design-rule checks. Design: docs/superpowers/specs/
// 2026-10-02-gpp-shape-notation-and-compiler-design.md §7.2 (the rule table),
// §5 (construct catalog and its DRC column), §5.4 (E-NOT-EXECUTABLE), §6.2
// (gate modes), §6.4 (binding records), §4.3 (W-ORPHAN-LAYOUT); the GPP
// standard docs/architecture/gated-permissions-process.md §10 (C-1…C-9);
// plan: docs/superpowers/plans/2026-10-02-gpp-shape-notation-compiler-phase-3.md
// (PR-3b-3, BI-6DA17863; "Spec refinements" item 2).
//
// `runDesignRules(document, resolved, options)` reads a schema-valid document
// and the facts resolve.ts found for it, and returns every finding as data
// (diagnostics.ts). Errors stop emission; warnings, info and not-evaluated do
// not. Nothing here throws, reads the database or the network: every input
// that is not the document is a resolve fact or an injected option.
//
// Each rule reuses the runtime's own rule, never a restatement of it:
// - C-1 clause 1: KNOWN_STAGE_TOOL_GAPS / stageToolGapKey, the
//   stage-tool-parity.test.ts rule (agent stage of a cadence shape).
// - C-4: isToolAllowedByGrants over the agent's resolved grants plus
//   COWORKER_AUTHORIZED_SURFACE_BASELINE_GRANTS — the effective set
//   stage-tool-parity.test.ts checks.
// - C-7: bindingEnforcementEntry (GPP_BINDING_ENFORCEMENT).
// - C-9: the critical-interaction map's `directSites` input
//   (resolve-sources.ts liveDirectExecuteSites builds it).
// - D-4: governedDecisionStage on the lowered definition.
// - D-7: the resolver facts resolve.ts found by the bindings.test.ts import.
// - D-8: ratifiedGateFor over the ratification table.
// - D-9 (GPP Phase 3c PR-3c-5): roomGrantsFromWorkShape and
//   isToolAllowedByGrants, the runtime's own reading of a shape's ceiling.
// - D-10 (PR-3c-5): the sub-shape facts resolve.ts found (existence, and the
//   first cycle in the sub-shape call graph).
// - S-1…S-6: checkSoundness.
//
// Each violation is reported ONCE, under the rule that names it, so a seeded
// violation yields exactly its rule. Where two rules of §7.2 describe the same
// fact, the split is:
// - Entry into a stage holding an O / A / I tool (a consequential tool, by
//   classifyConsequentialTool). The entering transition is the advance of
//   each predecessor in the flow graph (the implied sequence or the explicit
//   flow). No advance at all (the start stage, entered by its trigger, or a
//   stage entered from a split or join) is C-1 clause 2. A status-change
//   advance is D-1. A governed advance is a gate: in `shadow` mode its
//   verdict is only recorded, like an advisory consult, so the transition is
//   guarded only by advice — D-2; `enforced` but not blocking is D-6; and when
//   the stage holds an O or I tool (or a consequential tool that declares no
//   consequence, which fails closed) the gate needs a checkpoint with
//   `exactAction: true` — D-3.
// - A missing or dangling tool is C-2 (unregistered, or no TOOL_TO_GRANTS
//   entry, which the runtime denies by default). C-4 checks only tools C-2
//   accepted, and an unknown accountable agent is one C-4 on the stage.
// - C-7 resolver clause, as the plan resolves it (refinement 2): an enforced
//   gate whose `resolution` involves doctrine (`doctrine`,
//   `doctrine-then-human`) and names no resolver. An `accountable-human`
//   gate needs none; D-4 checks that a person can decide it. A resolver that
//   is NAMED but is not an exported function is D-7, not C-7.
// - C-3 scope ownership (GPP §10: "a binding names no owning scope, or more
//   than one"): the schema already gives a gate exactly one authority and a
//   stage exactly one advance, so neither half of the plan's wording can fail
//   on a schema-valid document. The case that can is a stage `binding` whose
//   stage has no typed gate: the binding record takes its gate key and
//   authority from that gate (§6.4), so it has no owning scope.
// - D-8 compares a typed gate, field for field, with the ratified entry for
//   its decision scope; an unratified scope is a mismatch. A governed advance
//   with no typed gate is not compared: it emits exactly today's advance, and
//   a shape with such a stage is not migrated (decompile's
//   awaitingRatification, §10).
//
// Standing reports, on every compile, on the shape element:
// - C-5 is `not-evaluated`: capability tags do not exist on main, so
//   co-occurrence cannot be computed. It is never reported as a pass.
// - C-7's build-sandbox containment clause is `not-evaluated`: it applies only
//   to Build Studio stages (Phase 5).
// - C-8 is `info`: the drive is the only transition path for work shapes.
// - C-9 is `not-evaluated` when no direct-site facts are supplied.
//
// E-NOT-EXECUTABLE is checked for every construct whose flag in
// executable-constructs.ts is off: `stage.deadline`, a flow split or join,
// `flow.edges[].rework`, `gate.onRefuse` and `stage.subShape`. The
// parallel-split-join flag is on since Phase 3c PR-3c-2 (BI-8875C9DF), so a
// split or join compiles, the rework-edge flag since PR-3c-3, so a rework
// edge or a refuse route compiles, and the stage-deadline flag since PR-3c-4,
// so a stage deadline compiles; sub-shape is still refused. The walk is
// constructsUsedBy (constructs-used-by.ts), run over the lowered definition,
// the same walk the drive runs over its definition contract (Phase 3c).
// `options.executable` replaces the table for tests only; production callers
// omit it.
//
// W-ORPHAN-LAYOUT: a layout sidecar node or edge key that matches no derived
// element id (nor an edge of the implied flow, which the canvas draws), or a
// sidecar for another shape version. The sidecar is not the document, so the
// finding sits on the shape element and its message names the sidecar key.
//
// OFFLINE TOOLING in Phase 3b: nothing in the running app imports this module.

import { canonicalJson } from "@dpf/integration-shared/canonical-json";

import { COWORKER_AUTHORIZED_SURFACE_BASELINE_GRANTS } from "@/lib/coworker/authorized-surface-coworker-contract";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";
import { roomGrantsFromWorkShape } from "@/lib/work-management/room-turn-authority";
import { KNOWN_STAGE_TOOL_GAPS, stageToolGapKey } from "@/lib/work-management/stage-tool-gaps";
import { governedDecisionStage } from "@/lib/work-management/workroom-stage-decision";

import { bindingEnforcementEntry } from "../binding-enforcement";
import {
  escapeJsonPointerToken,
  sortDiagnostics,
  toJsonPointer,
  type GppDiagnostic,
  type GppDiagnosticCode,
  type GppDiagnosticSeverity,
  type GppRuleId,
} from "./diagnostics";
import { constructsUsedBy } from "./constructs-used-by";
import { elementIdsOf, gateElementId, shapeElementId } from "./element-ids";
import { copyGate, lowerToDefinition } from "./emit";
import { CONSTRUCT_EXECUTABLE, type GppConstruct } from "./executable-constructs";
import { GATE_RATIFICATION, ratifiedGateFor, type GateRatificationEntry } from "./gate-ratification";
import type { GppLayoutSidecar } from "./gpp-layout-schema";
import type { GppGate, GppShapeDocument } from "./gpp-shape-schema";
import { buildShapeFlowGraph } from "./interpreter";
import type { GppResolution, GppResolvedStage, GppResolvedTool } from "./resolve";
import { checkSoundness } from "./soundness";

export type DesignRuleOptions = {
  /** The layout sidecar, when the document has one (W-ORPHAN-LAYOUT). */
  layout?: GppLayoutSidecar;
  /** The gate ratification table (D-8). Defaults to GATE_RATIFICATION; tests inject one. */
  ratification?: Readonly<Record<string, GateRatificationEntry>>;
  /**
   * C-9 facts: direct executeTool sites outside the reference monitor, keyed by
   * literal tool name, as "<path>:<line>" (liveDirectExecuteSites). Absent:
   * C-9 is reported `not-evaluated`.
   */
  directSites?: ReadonlyMap<string, readonly string[]>;
  /** TEST-ONLY replacement for CONSTRUCT_EXECUTABLE. Production callers omit it. */
  executable?: Readonly<Record<GppConstruct, boolean>>;
};

type Segment = string | number;
type Stage = GppShapeDocument["stages"][number];

const DOCTRINE_RESOLUTIONS: ReadonlySet<GppGate["resolution"]> = new Set(["doctrine", "doctrine-then-human"]);
const GAP_KEYS: ReadonlySet<string> = new Set(KNOWN_STAGE_TOOL_GAPS.map((gap) => stageToolGapKey(gap.shapeKey, gap.stageKey)));

function finding(
  rule: GppRuleId,
  severity: GppDiagnosticSeverity,
  elementId: string,
  path: readonly Segment[],
  message: string,
  code: GppDiagnosticCode = rule as GppDiagnosticCode,
): GppDiagnostic {
  return { rule, code, severity, elementId, path: toJsonPointer(path), message };
}

/** A consequential (O / A / I) tool, by classifyConsequentialTool. */
const isOai = (tool: GppResolvedTool) => tool.consequential === true;

/** An O or I tool for D-3. A consequential tool that declares no consequence cannot be shown not to be one, so it counts. */
const isOutwardOrIrreversible = (tool: GppResolvedTool) =>
  tool.consequential === true && tool.consequence !== "authority";

function typedGate(stage: Stage): GppGate | undefined {
  return stage.advance.kind === "governed-decision" ? stage.advance.gate : undefined;
}

/** The gate's pointer: the typed block when present, else the governed advance it belongs to. */
function gatePath(index: number, stage: Stage, ...rest: Segment[]): Segment[] {
  return typedGate(stage) ? ["stages", index, "advance", "gate", ...rest] : ["stages", index, "advance"];
}

/**
 * D-9 sub-shape widening and D-10 sub-shape resolution for one stage that
 * calls a sub-shape (GPP Phase 3c PR-3c-5, BI-8875C9DF; Phase 3c design §9.4).
 *
 * - D-10: the `key@version` must name a registered shape version, and the
 *   sub-shape call graph must have no cycle (the parent catalog's "Child
 *   key@version resolves; no cycles", §5 row 14). One finding per stage, for
 *   whichever fails first.
 * - D-9: a child may not hold more than its parent. Its declared `grants` must
 *   be a subset of the parent's, and every child stage tool must be allowed by
 *   the parent's grants. Both are compared as the runtime reads a shape's
 *   ceiling (roomGrantsFromWorkShape: `tool:read` is the coworker read
 *   baseline, a capability class expands to its grants), and a tool is
 *   checked with isToolAllowedByGrants, which denies a tool with no grant
 *   mapping. Evaluated only when the source could read the child; one finding
 *   per stage naming every excess.
 */
function subShapeFindings(document: GppShapeDocument, stage: Stage, index: number, facts: GppResolvedStage | undefined): GppDiagnostic[] {
  const stageId = `stage:${stage.key}`;
  const path: Segment[] = ["stages", index, "subShape"];
  const fact = facts?.subShape;
  if (!fact || !fact.exists) {
    return [finding("D-10", "error", stageId, path, `Stage "${stage.key}" calls sub-shape "${stage.subShape}", which is not a registered shape version.`)];
  }
  if (fact.cycle) {
    return [finding("D-10", "error", stageId, path, `Stage "${stage.key}" calls sub-shape "${fact.ref}", and the sub-shape calls form a cycle: ${fact.cycle.join(" -> ")}.`)];
  }
  if (!fact.grants) return [];
  const ceiling = roomGrantsFromWorkShape(document.grants);
  const allowed = new Set(ceiling);
  const extraGrants = roomGrantsFromWorkShape(fact.grants).filter((grant) => !allowed.has(grant));
  const extraTools = (fact.tools ?? []).filter((tool) => !isToolAllowedByGrants(tool.toolName, ceiling));
  if (extraGrants.length === 0 && extraTools.length === 0) return [];
  const parts = [
    ...(extraGrants.length > 0 ? [`grants the parent does not hold (${extraGrants.join(", ")})`] : []),
    ...(extraTools.length > 0 ? [`stage tools outside the parent's grants (${extraTools.map((tool) => `${tool.stageKey}:${tool.toolName}`).join(", ")})`] : []),
  ];
  return [finding("D-9", "error", stageId, path, `Sub-shape "${fact.ref}" of stage "${stage.key}" would widen the parent's authority: it declares ${parts.join(" and ")}.`)];
}

/** Every design-rule finding for a schema-valid document and its resolve facts, in diagnostic order. */
export function runDesignRules(
  document: GppShapeDocument,
  resolved: GppResolution,
  options: DesignRuleOptions = {},
): GppDiagnostic[] {
  const out: GppDiagnostic[] = [];
  const shapeId = shapeElementId(document.key, document.version);
  const executable = options.executable ?? CONSTRUCT_EXECUTABLE;
  const ratification = options.ratification ?? GATE_RATIFICATION;
  const resolvedByKey = new Map<string, GppResolvedStage>(resolved.stages.map((stage) => [stage.stageKey, stage]));

  const notExecutable = (construct: GppConstruct, elementId: string, path: readonly Segment[], what: string) => {
    if (executable[construct]) return;
    out.push(
      finding(
        "E-NOT-EXECUTABLE",
        "error",
        elementId,
        path,
        `E-NOT-EXECUTABLE ${construct} at ${elementId}: ${what} The runtime does not execute this construct yet (Phase 3c, BI-8875C9DF), so the document stays a draft.`,
        `E-NOT-EXECUTABLE/${construct}`,
      ),
    );
  };

  // ── standing reports ──────────────────────────────────────────────────────
  out.push(
    finding(
      "C-5",
      "not-evaluated",
      shapeId,
      [],
      "C-5 co-occurrence was not evaluated: capability tags do not exist on main, so untrusted input, sensitive access and state change cannot be detected together. This is not a pass.",
    ),
    finding(
      "C-7",
      "not-evaluated",
      shapeId,
      [],
      "C-7 build-sandbox containment was not evaluated: it applies only to stages the Build Studio sandbox runs, which are modelled in Phase 5. This is not a pass.",
      "C-7/SANDBOX-CONTAINMENT",
    ),
    finding(
      "C-8",
      "info",
      shapeId,
      [],
      "C-8: the drive is the only transition path for work shapes; every stage transition of this shape goes through it.",
    ),
  );
  if (!options.directSites) {
    out.push(
      finding("C-9", "not-evaluated", shapeId, [], "C-9 unmediated reach was not evaluated: no direct-execute-site facts were supplied. This is not a pass."),
    );
  }

  // ── per stage ─────────────────────────────────────────────────────────────
  const lowered = lowerToDefinition(document);
  document.stages.forEach((stage, index) => {
    const facts = resolvedByKey.get(stage.key);
    const stageId = `stage:${stage.key}`;
    const base: Segment[] = ["stages", index];
    const tools = facts?.tools ?? [];
    const principal = facts?.principal;

    // C-1 clause 1.
    if (
      document.triggers.includes("cadence") &&
      principal?.kind === "agent" &&
      (stage.tools === undefined || stage.tools.length === 0) &&
      !GAP_KEYS.has(stageToolGapKey(document.key, stage.key))
    ) {
      out.push(
        finding(
          "C-1",
          "error",
          stageId,
          [...base, ...(stage.tools === undefined ? [] : ["tools"])],
          `Agent stage "${stage.key}" of a cadence shape declares no tools and is not on KNOWN_STAGE_TOOL_GAPS.`,
        ),
      );
    }

    // C-2, C-4, C-9 per tool.
    const agentKnown = principal?.kind === "agent" && principal.known;
    const effectiveGrants =
      principal?.kind === "agent" ? [...new Set([...principal.grants, ...COWORKER_AUTHORIZED_SURFACE_BASELINE_GRANTS])] : [];
    if (principal?.kind === "agent" && !principal.known) {
      out.push(
        finding("C-4", "error", stageId, [...base, "accountablePrincipalRef"], `Accountable agent "${principal.agentId}" is not a known agent, so no grant can be shown to be held.`),
      );
    }
    tools.forEach((tool, toolIndex) => {
      const path = [...base, "tools", toolIndex];
      if (!tool.registered) {
        out.push(finding("C-2", "error", tool.elementId, path, `"${tool.toolName}" is not a registered platform tool.`));
        return;
      }
      if (tool.grantRequirement === null) {
        out.push(
          finding("C-2", "error", tool.elementId, path, `"${tool.toolName}" has no TOOL_TO_GRANTS entry, so it resolves to no enforceable grant and the runtime denies it.`),
        );
        return;
      }
      if (agentKnown && principal?.kind === "agent" && !isToolAllowedByGrants(tool.toolName, effectiveGrants)) {
        out.push(
          finding(
            "C-4",
            "error",
            tool.elementId,
            path,
            `Accountable agent "${principal.agentId}" holds no grant "${tool.toolName}" requires (${tool.grantRequirement.join(" or ")}).`,
          ),
        );
      }
      const sites = options.directSites?.get(tool.toolName) ?? [];
      if (sites.length > 0) {
        out.push(
          finding(
            "C-9",
            "warning",
            tool.elementId,
            path,
            `"${tool.toolName}" has ${sites.length} direct executeTool site(s) outside the reference monitor (KNOWN_UNMEDIATED_EXECUTE_SITES): ${sites.join(", ")}.`,
          ),
        );
      }
    });

    // Bindings: C-3, C-7, D-5, D-7.
    const gate = typedGate(stage);
    if (stage.binding) {
      const bindingId = facts?.binding?.elementId ?? `binding:${stage.binding.id}@${stage.binding.version}`;
      const bindingPath = [...base, "binding"];
      if (!gate) {
        out.push(
          finding(
            "C-3",
            "error",
            bindingId,
            bindingPath,
            `Binding "${stage.binding.id}" names no owning scope: stage "${stage.key}" has no typed gate to give it an authority and gate key.`,
          ),
        );
      }
      if (stage.binding.enforcement === "enforced" && !bindingEnforcementEntry(stage.binding.id)) {
        out.push(
          finding(
            "C-7",
            "error",
            bindingId,
            [...bindingPath, "enforcement"],
            `Binding "${stage.binding.id}" is declared enforced but has no entry in GPP_BINDING_ENFORCEMENT; it runs in shadow.`,
            "C-7/ENFORCEMENT-ENTRY",
          ),
        );
      }
      if (stage.binding.enforcement === "enforced" && gate && !gate.resolver) {
        out.push(
          finding("D-7", "error", bindingId, bindingPath, `Enforced binding "${stage.binding.id}" needs its gate's resolver, and gate:${stage.key} names none.`),
        );
      }
      (facts?.binding?.egress ?? []).forEach((egress, egressIndex) => {
        if (egress.registered) return;
        out.push(
          finding("D-5", "error", bindingId, [...bindingPath, "egress", egressIndex], `Egress tool "${egress.toolName}" is not a registered platform tool.`),
        );
      });
    }

    // Sub-shape: D-9 widening, D-10 resolution (GPP Phase 3c PR-3c-5).
    if (stage.subShape !== undefined) out.push(...subShapeFindings(document, stage, index, facts));

    // Gates: C-7, D-4, D-7, D-8, onRefuse.
    if (stage.advance.kind === "governed-decision") {
      const gateId = gateElementId(stage.key);
      if (!governedDecisionStage(lowered, stage.key)) {
        out.push(
          finding(
            "D-4",
            "error",
            stageId,
            [...base, "evidence"],
            `Governed stage "${stage.key}" does not declare decision-record evidence, so governedDecisionStage returns null and no person can decide it.`,
          ),
        );
      }
      if (gate) {
        if (gate.mode === "enforced" && DOCTRINE_RESOLUTIONS.has(gate.resolution) && !gate.resolver) {
          out.push(
            finding(
              "C-7",
              "error",
              gateId,
              gatePath(index, stage, "resolution"),
              `gate:${stage.key} is enforced with resolution "${gate.resolution}" but names no resolver, so nothing can resolve it as enforced.`,
              "C-7/RESOLVER",
            ),
          );
        }
        if (gate.resolver && facts?.gate?.resolver?.exists === false && (gate.mode === "enforced" || stage.binding)) {
          out.push(
            finding(
              "D-7",
              "error",
              gateId,
              gatePath(index, stage, "resolver"),
              `Resolver ${gate.resolver.module}#${gate.resolver.exportName} is not an exported function.`,
            ),
          );
        }
        const ratified = ratifiedGateFor(stage.advance.decisionScope, ratification);
        if (!ratified) {
          out.push(
            finding("D-8", "error", gateId, gatePath(index, stage), `Decision scope "${stage.advance.decisionScope}" has no ratified gate, so a typed gate cannot be emitted for it.`),
          );
        } else if (canonicalJson(copyGate(gate)) !== canonicalJson(copyGate(ratified))) {
          out.push(
            finding("D-8", "error", gateId, gatePath(index, stage), `gate:${stage.key} differs from the ratified gate for "${stage.advance.decisionScope}".`),
          );
        }
      }
    }
  });

  // ── entry into O / A / I stages: C-1 clause 2, D-1, D-2, D-3, D-6 ─────────
  const graph = buildShapeFlowGraph(document);
  document.stages.forEach((stage) => {
    const tools = resolvedByKey.get(stage.key)?.tools ?? [];
    const oai = tools.filter(isOai);
    if (oai.length === 0) return;
    const stageId = `stage:${stage.key}`;
    const node = graph.nodes.get(stageId);
    if (!node || node.stageKey !== stage.key) return;
    const names = oai.map((tool) => tool.toolName).join(", ");
    const predecessors = graph.predecessors.get(stageId) ?? [];
    if (predecessors.length === 0) {
      if (graph.start === stageId) {
        out.push(
          finding("C-1", "error", stageId, ["stages", node.index, "tools"], `Stage "${stage.key}" holds O/A/I tools (${names}) and is entered by its trigger, so no gate guards entry to it.`),
        );
      }
      return;
    }
    for (const predecessor of predecessors) {
      const from = graph.nodes.get(predecessor);
      if (!from || from.kind !== "stage") {
        out.push(
          finding("C-1", "error", stageId, ["stages", node.index, "tools"], `Stage "${stage.key}" holds O/A/I tools (${names}) and is entered from ${predecessor}, so no gate guards entry to it.`),
        );
        continue;
      }
      const source = document.stages[from.index] as Stage;
      if (source.advance.kind === "status-change") {
        out.push(
          finding(
            "D-1",
            "error",
            `stage:${source.key}`,
            ["stages", from.index, "advance"],
            `Stage "${source.key}" advances by status change into "${stage.key}", which holds O/A/I tools (${names}).`,
          ),
        );
        continue;
      }
      const gate = source.advance.gate;
      const gateId = gateElementId(source.key);
      if (gate?.mode === "shadow") {
        out.push(
          finding(
            "D-2",
            "error",
            gateId,
            gatePath(from.index, source, "mode"),
            `gate:${source.key} runs in shadow, so its verdict is only recorded, like an advisory consult; the transition into "${stage.key}" (O/A/I: ${names}) is guarded only by advice.`,
          ),
        );
      }
      if (gate?.mode === "enforced" && !gate.blocking) {
        out.push(
          finding("D-6", "error", gateId, gatePath(from.index, source, "blocking"), `gate:${source.key} is enforced but not blocking on the transition into "${stage.key}" (O/A/I: ${names}).`),
        );
      }
      const oi = tools.filter(isOutwardOrIrreversible);
      if (oi.length > 0 && gate?.checkpoint?.exactAction !== true) {
        out.push(
          finding(
            "D-3",
            "error",
            gateId,
            gatePath(from.index, source, ...(gate?.checkpoint ? ["checkpoint", "exactAction"] : [])),
            `"${stage.key}" holds O or I tools (${oi.map((tool) => tool.toolName).join(", ")}), and gate:${source.key} has no checkpoint with exactAction: true.`,
          ),
        );
      }
    }
  });

  // ── gated constructs: E-NOT-EXECUTABLE ────────────────────────────────────
  // One walk over the lowered definition, shared with the drive (Phase 3c,
  // PR-3c-1): gate.onRefuse, stage.deadline, stage.subShape, flow splits and
  // joins, and rework edges.
  for (const use of constructsUsedBy(lowered)) notExecutable(use.construct, use.elementId, use.path, use.detail);

  // ── S-1…S-6 ───────────────────────────────────────────────────────────────
  out.push(...checkSoundness(document));

  // ── W-ORPHAN-LAYOUT ───────────────────────────────────────────────────────
  if (options.layout) {
    const layout = options.layout;
    const ref = `${document.key}@${document.version}`;
    if (layout.shape !== ref) {
      out.push(finding("W-ORPHAN-LAYOUT", "warning", shapeId, [], `The layout sidecar is for "${layout.shape}", not "${ref}".`));
    }
    const known = new Set<string>([...elementIdsOf(document), ...graph.edges.map((edge) => edge.elementId)]);
    for (const [section, entries] of [["nodes", layout.nodes], ["edges", layout.edges]] as const) {
      for (const key of Object.keys(entries)) {
        if (known.has(key)) continue;
        out.push(
          finding(
            "W-ORPHAN-LAYOUT",
            "warning",
            shapeId,
            [],
            `Layout sidecar ${section} key "${key}" (/${section}/${escapeJsonPointerToken(key)}) matches no element of ${ref}.`,
          ),
        );
      }
    }
  }

  return sortDiagnostics(out);
}
