// GPP Phase 2 bindings: which existing gate's admit mints a permit, for which
// calls.
//
// GPP Phase 2, PR-C (docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md).
// Scope baseline: OBJ-PERMIT, OBJ-CRITICAL.
//
// Hand-declared and small until the Phase 3 compiler emits binding records.
// Rules, each pinned by bindings.test.ts:
// - a binding names only a gate that exists: its resolver is an exported,
//   implemented function (§5.4 ordering — never demand an unimplemented gate);
// - a binding covers only outward/authority/irreversible (O/A/I) calls, as
//   classified by the runtime's own classifyConsequentialTool, unless its
//   reason is `c5`;
// - no binding covers a routine read or an ordinary write.
//
// There is no Build Studio binding (plan Risk R4) and no C-5 binding: C-5
// combinations are not computed on main. The `c5` reason exists in the type and
// has no entries.
//
// Pure: no imports from the gates themselves, so the critical-interaction map
// can read this table without loading the runtime.

import type { PermitAuthority } from "./permit-claims";

/** Which gate's admit, inside the reference monitor, mints under the binding. */
export type GppBindingAdmission =
  /** The WWWD x WSID alignment gate returned `approve` (DecisionInteraction). */
  | "alignment-approve"
  /** The coworker authority gate admitted on an approved human checkpoint (CoworkerActionEnvelope). */
  | "approved-envelope";

/** What the binding knows about a tool: the runtime classification, nothing more. */
export type GppBindingToolFacts = {
  /** classifyConsequentialTool(...).consequential — the O/A/I set. */
  consequential: boolean;
};

export type GppBinding = {
  bindingId: string;
  version: number;
  gateKey: string;
  authority: PermitAuthority;
  /** The implemented gate function, as a module path under apps/web and its export. */
  resolver: { module: string; exportName: string };
  admission: GppBindingAdmission;
  toolPredicate: (tool: GppBindingToolFacts) => boolean;
  reason: "oai" | "c5";
};

export const GPP_BINDINGS: readonly GppBinding[] = [
  {
    bindingId: "tak-alignment-admit",
    version: 1,
    gateKey: "tak-alignment",
    authority: "wwwd",
    resolver: { module: "lib/tak/alignment-tool-gate", exportName: "runTakAlignmentGate" },
    admission: "alignment-approve",
    // Every O/A/I tool for which the monitor runs the alignment gate. Inside a
    // Workroom that is every consequential tool, so the predicate is the O/A/I
    // set; a permit is minted only when the gate actually ran and approved.
    toolPredicate: (tool) => tool.consequential,
    reason: "oai",
  },
  {
    bindingId: "human-checkpoint-admit",
    version: 1,
    gateKey: "coworker-authority-escalation",
    authority: "wwwd",
    resolver: {
      module: "lib/govern/authority/coworker-tool-authority-gate",
      exportName: "enforceCoworkerToolAuthority",
    },
    admission: "approved-envelope",
    toolPredicate: (tool) => tool.consequential,
    reason: "oai",
  },
] as const;

/** `id@version`, the form the plan, the map and observations cite. */
export function bindingRef(binding: Pick<GppBinding, "bindingId" | "version">): string {
  return `${binding.bindingId}@${binding.version}`;
}

/** Bindings that could cover this tool at all (used by the map). */
export function bindingsForTool(tool: GppBindingToolFacts): GppBinding[] {
  return GPP_BINDINGS.filter((binding) => binding.toolPredicate(tool));
}

/**
 * The binding that covers THIS call: the first declared binding whose gate
 * admitted it. Alignment is declared first because it is the last gate to
 * admit before execution. Null means no gate admitted the call, which is the
 * `ungoverned` verdict.
 */
export function bindingForAdmittedCall(input: {
  tool: GppBindingToolFacts;
  alignmentApproved: boolean;
  approvedEnvelopeId: string | null;
}): GppBinding | null {
  for (const binding of GPP_BINDINGS) {
    if (!binding.toolPredicate(input.tool)) continue;
    if (binding.admission === "alignment-approve" && input.alignmentApproved) return binding;
    if (binding.admission === "approved-envelope" && input.approvedEnvelopeId) return binding;
  }
  return null;
}
