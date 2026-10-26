// Portable GPP binding-record drafts (BI-721C467A).
//
// Binding-record drafts from compiled shape documents. Design:
// docs/superpowers/specs/2026-10-02-gpp-shape-notation-and-compiler-design.md
// §6.4 ("Binding records"); plan: docs/superpowers/plans/
// 2026-10-02-gpp-shape-notation-compiler-phase-3.md (PR-3b-4, BI-6DA17863;
// "Out of scope for 3b").
//
// For each stage with a `binding` whose declared tools include an outward,
// authority or irreversible (O / A / I) tool — classifyConsequentialTool's
// `consequential`, read from the resolve facts — one draft in the GppBinding
// shape: the binding id and version, the gate key (`gate.gateKey ??
// decisionScope`) and authority of the stage's typed entry gate, its resolver when
// one is named, `admission: "stage-gate-admit"`, `attach: { shapeRef,
// stageKey }`, and the stage's O / A / I tools as a list, never a predicate.
//
// The draft type is LOCAL to this module on purpose. It does not import or
// widen GppBinding (apps/web/lib/gpp/bindings.ts): the `stage-gate-admit`
// admission and the `attach` field are interface changes in BI-69415B68's code
// and ship in a slice coordinated with that item. `toolPredicate` is a
// function in GppBinding; a draft is data, so it carries `reason: "oai"`,
// which names the predicate (`tool.consequential`) instead.
//
// Pure and fixture-tested only. In Phase 3b nothing writes a draft to disk or
// reads one at runtime, and the compiler never writes GPP_BINDING_ENFORCEMENT
// or adds to GPP_BINDINGS.

import type { DecisionScope as PermitAuthority } from "../decision-scopes.ts";
import { enteringGate } from "./entering-gate.ts";
import type { GppShapeDocument } from "./gpp-shape-schema.ts";
import type { GppResolution } from "./resolve.ts";

export type GppBindingRecordDraft = {
  bindingId: string;
  version: number;
  gateKey: string;
  authority: PermitAuthority;
  /** Present only when the entry gate names one (D-7 refuses an enforced binding without one). */
  resolver?: { module: string; exportName: string };
  admission: "stage-gate-admit";
  attach: { shapeRef: string; stageKey: string };
  /** The stage's O / A / I tools, in declared order. Always a list. */
  tools: string[];
  reason: "oai";
};

export type CompiledShapeForBindings = {
  document: GppShapeDocument;
  resolution: GppResolution;
};

/** One draft per bound stage that reaches an O / A / I tool, in document then stage order. */
export function emitBindingRecords(compiled: readonly CompiledShapeForBindings[]): GppBindingRecordDraft[] {
  const drafts: GppBindingRecordDraft[] = [];
  for (const { document, resolution } of compiled) {
    const resolvedByKey = new Map(resolution.stages.map((stage) => [stage.stageKey, stage]));
    for (const stage of document.stages) {
      const { binding } = stage;
      const entry = enteringGate(document, stage.key);
      // No typed gate: the binding has no owning scope (DRC C-3 refuses it), so there is no record.
      if (!binding || !entry) continue;
      const tools = (resolvedByKey.get(stage.key)?.tools ?? [])
        .filter((tool) => tool.consequential === true)
        .map((tool) => tool.toolName);
      if (tools.length === 0) continue;
      const { gate } = entry;
      drafts.push({
        bindingId: binding.id,
        version: binding.version,
        gateKey: gate.gateKey ?? entry.decisionScope,
        authority: gate.authority,
        ...(gate.resolver ? { resolver: { module: gate.resolver.module, exportName: gate.resolver.exportName } } : {}),
        admission: "stage-gate-admit",
        attach: { shapeRef: `${document.key}@${document.version}`, stageKey: stage.key },
        tools,
        reason: "oai",
      });
    }
  }
  return drafts;
}
