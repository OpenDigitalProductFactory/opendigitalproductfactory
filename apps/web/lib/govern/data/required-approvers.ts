// Condition → required human approver (BI-0B4B16CA).
//
// THE FINDING this closes the mechanism half of: the correct substrate was
// designed TWICE and wired ZERO times. The PDP (evaluateDataPolicy,
// policy-decision.ts) could return obligations but the shipped policy bundle
// never emitted `human-approval`, and evaluateDataPolicy had ZERO production
// call sites (only its own test). So a change touching regulated data got the
// same single CODEOWNERS approver as any other file — process was on the wrong
// axis (more AI review, never a named human).
//
// THIS MODULE is the first production caller of evaluateDataPolicy. It composes:
//   changed fields  ──▶ field-classification.ts (BI-81ABBDA2: categories +
//                        regulatedScope, a COMPUTABLE data class, not a regex)
//                   ──▶ evaluateDataPolicy (the PDP: policy match → obligations)
//                   ──▶ the human-approval obligations (named authority roles)
// so "which human role must sign off on this change?" is a sound, tested query
// keyed off the data actually touched — the basis the operator asked for
// ("processes and workflows must include these steps when needed").
//
// SCOPE: this is the DECISION mechanism. It computes the required approver; it
// does not yet BLOCK a workflow on it. Wiring it into a live enforcement point
// (a phase gate / the build process matrix / a ValueStreamHitlGate evaluator)
// is the remaining half of BI-0B4B16CA, deliberately separated so the decision
// logic ships and is verifiable on its own rather than entangled with a critical
// gate. Until that lands, callers get a correct answer to act on; nothing is
// silently enforced or silently skipped.

import {
  evaluateDataPolicy,
  type PolicyEvaluationContext,
} from "./policy-decision";
import { classifyField } from "./field-classification";
import type { DataAction, ProcessingPurposeKey } from "./taxonomy";

/** A required human approver derived from a data policy's human-approval obligation. */
export interface RequiredApprover {
  /** PlatformRole roleId that must approve (e.g. "HR-000"). */
  authorityRole: string;
  /** The approver must differ from the actor. */
  separationOfDuties: boolean;
  /** The "Model.field" that triggered the requirement, for explanation. */
  triggeredByField: string;
  /** The policy explanation code, for audit. */
  explanationCode: string;
}

export interface ResolveRequiredApproversOptions {
  organizationId: string;
  /** The data action the change performs. Defaults to "write". */
  action?: DataAction;
  purpose?: ProcessingPurposeKey;
}

/** A minimal, deterministic context envelope for a single-field policy probe. */
function contextForField(
  field: ReturnType<typeof classifyField>,
  opts: ResolveRequiredApproversOptions,
): PolicyEvaluationContext {
  return {
    organizationId: opts.organizationId,
    action: opts.action ?? "write",
    asset: "data:unknown",
    purpose: opts.purpose ?? "platform-operations",
    classification: {
      known: true,
      categories: field?.categories ?? [],
      regulatedScope: field?.regulatedScope,
    },
    environmentKnown: true,
    assetVersion: "n/a",
    classificationVersion: "field-classification@1",
    authorityVersion: "n/a",
    policyBundleVersion: "default",
  };
}

/**
 * Resolve the human approvers a change must obtain, given the set of
 * "Model.field" keys it touches. Deduplicated by authorityRole. Empty when no
 * touched field carries a policy that emits a human-approval obligation.
 *
 * This is the sound replacement for "regex the BI text for 'pci'": the answer is
 * derived from the COMPUTABLE classification of the fields actually changed.
 */
export function resolveRequiredApprovers(
  changedFields: readonly string[],
  opts: ResolveRequiredApproversOptions,
): RequiredApprover[] {
  const byRole = new Map<string, RequiredApprover>();
  for (const key of changedFields) {
    const dot = key.indexOf(".");
    if (dot <= 0) continue;
    const classification = classifyField(key.slice(0, dot), key.slice(dot + 1));
    if (!classification) continue;
    // Only fields under a regulated scope can trigger the human-approval policy;
    // skip the PDP call otherwise (cheap short-circuit, same result).
    if (classification.regulatedScope === "none") continue;

    const decision = evaluateDataPolicy(contextForField(classification, opts));
    for (const ob of decision.obligations) {
      if (ob.kind !== "human-approval") continue;
      if (!byRole.has(ob.authorityRole)) {
        byRole.set(ob.authorityRole, {
          authorityRole: ob.authorityRole,
          separationOfDuties: ob.separationOfDuties,
          triggeredByField: key,
          explanationCode: decision.explanationCode,
        });
      }
    }
  }
  return [...byRole.values()];
}

/** True when the change touches data that requires a named human approver. */
export function changeNeedsHumanApproval(
  changedFields: readonly string[],
  opts: ResolveRequiredApproversOptions,
): boolean {
  return resolveRequiredApprovers(changedFields, opts).length > 0;
}
