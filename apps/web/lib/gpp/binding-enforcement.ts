// Per-binding permit enforcement: which bindings are enforced, and the rules a
// binding must meet before it may be.
//
// GPP Phase 2, PR-E (docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md).
// Scope baseline: OBJ-CRITICAL, OBJ-NODISRUPT; acceptance AC-ENFORCE.
// Decision: DI-6D5D686464DC (shadow first, earn enforce).
//
// THE ENFORCED SET IS THIS FILE. A binding is enforced only when it has an
// entry in GPP_BINDING_ENFORCEMENT, which is checked-in source: promotion is a
// reviewed PR that cites a WWMD decision, and binding-enforcement.test.ts
// refuses an entry that does not meet promotionRefusals() below. Nothing in
// the database and no environment variable can add an entry. The one runtime
// override, DPF_GPP_ENFORCEMENT=shadow-all, can only LOWER every binding to
// shadow; it is not the global "enforce" switch §5.0 item 3 forbids, because
// there is no value that raises anything.
//
// At merge the table is EMPTY, so no call's outcome changes.
//
// Pure apart from reading the one env variable: no gate, store or registry
// imports, so the runtime path and the critical-interaction map can both read it.

import { assertGppTestSeam, bindingRef, type GppBinding } from "./bindings";
import type { CallSite } from "./unmediated-execute-sites";

/**
 * How an enforced binding treats `lineage_unsealed` (plan R1, promotion criterion 4).
 * - `sealed-required`: the binding's gate is expected to write sealed decisions.
 *   An unsealed one downgrades THAT call to shadow (recorded), never a refusal,
 *   so an unsealed ledger cannot become a refusal storm.
 * - `unsealed-accepted`: the ratifying decision explicitly accepts unsealed
 *   lineage for this binding; the call stays enforced on the other checks.
 */
export type BindingLineagePolicy = "sealed-required" | "unsealed-accepted";
export const BINDING_LINEAGE_POLICIES: readonly BindingLineagePolicy[] = ["sealed-required", "unsealed-accepted"];

export type BindingEnforcementEntry = {
  mode: "enforced";
  /** The WWMD decision that ratified the promotion (principle_decide, recorded with dpf-record-decision-outcome). */
  decisionId: string;
  /** ISO date the decision was ratified. */
  ratifiedAt: string;
  /** Where the shadow evidence lives (at least 14 days of GppPermitObservation for the binding). */
  evidenceRef: string;
  lineage: BindingLineagePolicy;
};

/** DI ids as the decision ledger mints them. */
export const DECISION_ID_PATTERN = /^DI-[0-9A-F]{12}$/;

/**
 * THE ENFORCED SET. Empty at merge: this PR promotes no binding. Each
 * promotion is its own small, revertable PR under the procedure in GPP Annex A.
 */
export const GPP_BINDING_ENFORCEMENT: Readonly<Record<string, BindingEnforcementEntry>> = {};

/**
 * SHRINK-ONLY. Every declared binding not in GPP_BINDING_ENFORCEMENT is here,
 * and a new binding starts here. An id leaves only by moving into the
 * enforcement table, which binding-enforcement.test.ts gates.
 */
export const KNOWN_SHADOW_BINDINGS: readonly string[] = ["tak-alignment-admit", "human-checkpoint-admit"];

export const GPP_ENFORCEMENT_ENV = "DPF_GPP_ENFORCEMENT";
/** The only recognised value of DPF_GPP_ENFORCEMENT. Any other value is ignored. */
export const GPP_ENFORCEMENT_SHADOW_ALL = "shadow-all";

let enforcementOverride: Readonly<Record<string, BindingEnforcementEntry>> | null = null;

/** Test seam: promote fixture bindings in a test only. Refuses outside the test runner. */
export function setBindingEnforcementOverrideForTests(
  table: Readonly<Record<string, BindingEnforcementEntry>> | null,
): void {
  if (table) assertGppTestSeam("setBindingEnforcementOverrideForTests");
  enforcementOverride = table;
}

function enforcementTable(): Readonly<Record<string, BindingEnforcementEntry>> {
  return enforcementOverride ?? GPP_BINDING_ENFORCEMENT;
}

/** The checked-in entry for a binding, or null. Ignores the runtime override (that only lowers). */
export function bindingEnforcementEntry(bindingId: string): BindingEnforcementEntry | null {
  const table = enforcementTable();
  return Object.hasOwn(table, bindingId) ? table[bindingId]! : null;
}

export type BindingModeResolution =
  | { mode: "enforced"; entry: BindingEnforcementEntry }
  | { mode: "shadow"; reason: "not-promoted" | "operator-shadow-all" };

/**
 * `enforced` only when a checked-in entry exists and the operator has not set
 * DPF_GPP_ENFORCEMENT=shadow-all. Every other env value is ignored, so the
 * override can never raise a binding.
 */
export function resolveBindingMode(
  bindingId: string,
  env: Record<string, string | undefined> = process.env,
): BindingModeResolution {
  const entry = bindingEnforcementEntry(bindingId);
  if (!entry || entry.mode !== "enforced") return { mode: "shadow", reason: "not-promoted" };
  if (env[GPP_ENFORCEMENT_ENV]?.trim() === GPP_ENFORCEMENT_SHADOW_ALL) {
    return { mode: "shadow", reason: "operator-shadow-all" };
  }
  return { mode: "enforced", entry };
}

/** What the promotion ratchet needs to know about the live tree. */
export type PromotionContext = {
  bindings: readonly GppBinding[];
  shadowList: readonly string[];
  /** Every registered tool, classified by the runtime's classifyConsequentialTool. */
  tools: ReadonlyArray<{ name: string; consequential: boolean; alignmentRequired: boolean }>;
  /** Every direct executeTool site outside the monitor (findUnmediatedExecuteSites). */
  directSites: readonly CallSite[];
};

/**
 * Why `bindingId` may not be enforced with `entry`. Empty means promotable.
 * Pure; binding-enforcement.test.ts runs it against the live tree for every
 * entry in GPP_BINDING_ENFORCEMENT.
 */
export function promotionRefusals(bindingId: string, entry: BindingEnforcementEntry, ctx: PromotionContext): string[] {
  const refusals: string[] = [];
  if (entry.mode !== "enforced") refusals.push(`${bindingId}: mode must be "enforced"`);
  if (!DECISION_ID_PATTERN.test(entry.decisionId ?? "")) {
    refusals.push(`${bindingId}: decision id must be a WWMD decision id matching ${DECISION_ID_PATTERN.source}`);
  }
  if (!entry.ratifiedAt || Number.isNaN(Date.parse(entry.ratifiedAt))) {
    refusals.push(`${bindingId}: ratifiedAt must be an ISO date`);
  }
  if (!entry.evidenceRef?.trim()) refusals.push(`${bindingId}: evidenceRef must cite the shadow evidence`);
  if (!BINDING_LINEAGE_POLICIES.includes(entry.lineage)) {
    refusals.push(`${bindingId}: lineage must be one of ${BINDING_LINEAGE_POLICIES.join(", ")}`);
  }
  if (ctx.shadowList.includes(bindingId)) {
    refusals.push(`${bindingId}: still on KNOWN_SHADOW_BINDINGS; remove it there in the same change`);
  }

  const binding = ctx.bindings.find((candidate) => candidate.bindingId === bindingId);
  if (!binding) {
    refusals.push(`${bindingId}: not a declared binding in GPP_BINDINGS`);
    return refusals;
  }
  const ref = bindingRef(binding);
  if (binding.reason !== "oai") refusals.push(`${ref}: only an "oai" binding may be enforced (reason is ${binding.reason}; no c5 detector exists)`);
  if (!binding.tools || binding.tools.length === 0) {
    refusals.push(`${ref}: covers tools by predicate only; promotion needs an explicit, reviewable \`tools\` list`);
    return refusals;
  }

  const registry = new Map(ctx.tools.map((tool) => [tool.name, tool]));
  for (const name of binding.tools) {
    const tool = registry.get(name);
    if (!tool) {
      refusals.push(`${ref}: ${name} is not a registered platform tool`);
      continue;
    }
    if (!tool.consequential || !binding.toolPredicate({ consequential: tool.consequential, name })) {
      refusals.push(`${ref}: ${name} is not outward, authority or irreversible by classifyConsequentialTool`);
    }
    // Constraint 1: never demand a gate that does not run. Outside a Workroom
    // the alignment gate runs only for tools whose classification requires it.
    if (binding.admission === "alignment-approve" && !tool.alignmentRequired) {
      refusals.push(`${ref}: the alignment gate does not run for ${name} outside a Workroom, so no call could carry its permit`);
    }
  }

  // §5.3: promotable only once every path to the binding's tools passes the monitor.
  const named = new Set(binding.tools);
  for (const site of ctx.directSites) {
    if (site.toolName === "dynamic") {
      refusals.push(`${ref}: dynamic direct site at ${site.path}:${site.line} could reach any tool; route it through governedExecuteTool first`);
    } else if (named.has(site.toolName)) {
      refusals.push(`${ref}: ${site.toolName} still has a direct executeTool site at ${site.path}:${site.line}`);
    }
  }
  return refusals;
}
