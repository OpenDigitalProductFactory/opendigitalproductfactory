// Who may coordinate a Workroom — the producer the conformance gate was waiting
// for (BI-E0728215).
//
// `workroom-shape-conformance` reads `coordinatorEligibility` and falls back to
// `{ jsi: "unknown", authorityBinding: "unknown" }` when it is absent. NOTHING
// populated it. The field was undefined on every tick of every room, so every AI
// Process Overseer was refused permanently — not for want of configuration, but
// because the check had no producer. This is that producer.
//
// Two governed decisions shape it, both scored by the kernel rather than assumed:
//
//   DI-F8C8042FBB5D — authority comes from an EXPLICIT binding (margin 9.318,
//   high confidence). Reusing an agent's route binding, or treating the work
//   shape's own declaration as authority, both scored ~2.3-2.9; `Least privilege,
//   deny by default` contributed NEGATIVELY to each. A binding is a row an
//   operator can see, suspend and revoke — not an inference.
//
//   DI-FF4A015CF917 — an ABSENT qualification scheme is not a failed one (margin
//   5.420, high confidence). Removing the JSI check outright scored 0.713.
//
// Pure resolution over supplied state; the caller owns the queries.

/** Mirrors WORKROOM_COORDINATOR_ELIGIBILITY_STATES, plus `not-applicable`. */
export type CoordinatorEligibilityState =
  | "eligible"
  | "absent"
  | "stale"
  | "narrowed"
  | "suspended"
  | "incompatible"
  | "not-applicable"
  | "unknown";

export type CoordinatorEligibility = {
  jsi: CoordinatorEligibilityState;
  authorityBinding: CoordinatorEligibilityState;
};

/** The scope an AuthorityBinding must carry to grant room coordination. A route
 *  binding (`platform-engineer on /platform`) is page access and deliberately
 *  does NOT qualify — that conflation is the option the kernel rejected. */
export const COORDINATION_SCOPE_TYPE = "workroom";
export const COORDINATION_RESOURCE_TYPE = "work-shape";

/** Just the binding facts this resolution needs. */
export type CoordinationBindingRow = {
  status: string;
  scopeType: string;
  resourceType: string;
  /** The work shape this binding grants coordination over. */
  resourceRef: string;
};

/**
 * Authority-binding eligibility for one agent coordinating one shape.
 *
 * `absent` — we looked and there is no binding. Honest and actionable: the room
 * names what is missing, and creating the binding resolves it. This is the state
 * that replaces the permanent, uninformative `unknown`.
 *
 * `suspended` — a binding exists but is not active. Distinguished from absent
 * because the remedy differs: reinstate rather than grant.
 */
export function resolveAuthorityBindingEligibility(
  shapeKey: string | null,
  bindings: readonly CoordinationBindingRow[],
): CoordinatorEligibilityState {
  if (!shapeKey) return "unknown";
  const forShape = bindings.filter(
    (binding) =>
      binding.scopeType === COORDINATION_SCOPE_TYPE &&
      binding.resourceType === COORDINATION_RESOURCE_TYPE &&
      binding.resourceRef === shapeKey,
  );
  if (forShape.length === 0) return "absent";
  if (forShape.some((binding) => binding.status === "active")) return "eligible";
  if (forShape.some((binding) => binding.status === "suspended")) return "suspended";
  return "absent";
}

/**
 * JSI qualification eligibility.
 *
 * There is no TAK-JSI qualification substrate in the schema — no qualification
 * model exists, so no coworker on any install can be qualified. A precondition
 * that can never be met is not a safeguard; it is a permanent denial wearing a
 * safeguard's clothes, and it offers no graduated control at all.
 *
 * So an absent SCHEME resolves `not-applicable` (recorded on the room, does not
 * block), while a scheme that exists and is not satisfied blocks exactly as
 * before. `schemePresent` is detected from the substrate rather than hardcoded,
 * so the control becomes real the day the qualification model lands — nobody has
 * to remember to switch it on.
 */
export function resolveJsiEligibility(input: {
  schemePresent: boolean;
  qualified?: boolean;
  stale?: boolean;
}): CoordinatorEligibilityState {
  if (!input.schemePresent) return "not-applicable";
  if (input.stale) return "stale";
  if (input.qualified === true) return "eligible";
  if (input.qualified === false) return "absent";
  return "unknown";
}

/** Candidate names for the qualification substrate, checked against the live
 *  Prisma client. Presence of the model IS the scheme's presence — see
 *  resolveJsiEligibility. Extend this list if the model lands under another name;
 *  the accompanying test fails loudly if none is found AND the doc claims one. */
export const JSI_QUALIFICATION_MODELS = [
  "jsiQualification",
  "jobQualification",
  "agentQualification",
] as const;

/** True when the platform has a qualification substrate to evaluate against. */
export function jsiSchemePresent(client: Record<string, unknown>): boolean {
  return JSI_QUALIFICATION_MODELS.some((model) => model in client);
}

export function resolveCoordinatorEligibility(input: {
  shapeKey: string | null;
  bindings: readonly CoordinationBindingRow[];
  schemePresent: boolean;
  qualified?: boolean;
  stale?: boolean;
}): CoordinatorEligibility {
  return {
    authorityBinding: resolveAuthorityBindingEligibility(input.shapeKey, input.bindings),
    jsi: resolveJsiEligibility(input),
  };
}
