// apps/web/lib/govern/data/policy-enforcement.ts
// BI-DG-002 (spec §6.5): Policy Enforcement Point support. One pure PDP feeds many
// PEPs. Each PEP declares a capability matrix of obligation kinds it can enforce; a
// policy/PEP combination whose obligations exceed that matrix is rejected (a build-time
// gate can call assertBundleEnforceable). A side-effecting decision is single-use and
// bound to the exact input + versions; immediately before mutation the PEP revalidates
// versions/state to close time-of-check/time-of-use gaps.

import type { DataPepKind } from "./taxonomy";
import type { DataObligation, DataObligationKind, DataExecutablePolicy } from "./executable-policies";
import type { DataPolicyDecision } from "./policy-decision";

/** Obligation kinds each PEP kind can actually enforce (spec §6.5 capability matrix). */
export const DATA_PEP_CAPABILITY_MATRIX: Readonly<
  Record<DataPepKind, ReadonlySet<DataObligationKind>>
> = Object.freeze({
  "api-write": new Set<DataObligationKind>([
    "mask",
    "encrypt",
    "log-use",
    "human-approval",
    "disposition-evidence",
  ]),
  "high-risk-read": new Set<DataObligationKind>(["mask", "log-use"]),
  "mdm-action": new Set<DataObligationKind>([
    "human-approval",
    "log-use",
    "disposition-evidence",
  ]),
  "coworker-context": new Set<DataObligationKind>(["mask", "log-use"]),
  "inference-dispatch": new Set<DataObligationKind>([
    "mask",
    "destination",
    "log-use",
    "human-approval",
  ]),
  projection: new Set<DataObligationKind>([
    "mask",
    "encrypt",
    "destination",
    "delete-derived-copy",
    "log-use",
  ]),
  lifecycle: new Set<DataObligationKind>([
    "delete-derived-copy",
    "disposition-evidence",
    "log-use",
    "human-approval",
  ]),
});

export class PepCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PepCapabilityError";
  }
}

export function canPepEnforce(pepKind: DataPepKind, kind: DataObligationKind): boolean {
  return DATA_PEP_CAPABILITY_MATRIX[pepKind].has(kind);
}

/** Throw if any obligation exceeds what this PEP can enforce (spec §6.5). */
export function assertObligationsEnforceable(
  pepKind: DataPepKind,
  obligations: readonly DataObligation[],
): void {
  for (const o of obligations) {
    if (!canPepEnforce(pepKind, o.kind)) {
      throw new PepCapabilityError(
        `PEP "${pepKind}" cannot enforce obligation "${o.kind}"`,
      );
    }
  }
}

/**
 * Build-time gate: every obligation any policy in the bundle can attach must be
 * enforceable by at least one PEP. A never-enforceable obligation is dead policy.
 */
export function assertBundleEnforceable(policies: readonly DataExecutablePolicy[]): void {
  const enforceable = new Set<DataObligationKind>();
  for (const set of Object.values(DATA_PEP_CAPABILITY_MATRIX)) {
    for (const k of set) enforceable.add(k);
  }
  for (const p of policies) {
    for (const o of p.obligations ?? []) {
      if (!enforceable.has(o.kind)) {
        throw new PepCapabilityError(
          `policy ${p.id} attaches obligation "${o.kind}" no PEP can enforce`,
        );
      }
    }
  }
}

/** Versions the PEP re-reads immediately before mutating, to detect drift. */
export type DecisionVersionSnapshot = {
  assetVersion: string;
  classificationVersion: string;
  authorityVersion: string;
};

/**
 * TOCTOU guard: a single-use decision is only safe to act on if the asset,
 * classification, and authority versions still match what was decided against. Returns
 * false when any drifted (the caller must re-evaluate rather than mutate).
 */
export function isDecisionStillFresh(
  decision: DataPolicyDecision,
  current: DecisionVersionSnapshot,
): boolean {
  return (
    decision.assetVersion === current.assetVersion &&
    decision.classificationVersion === current.classificationVersion &&
    decision.authorityVersion === current.authorityVersion
  );
}
