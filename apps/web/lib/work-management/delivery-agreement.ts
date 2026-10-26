import { canonicalJson } from "@dpf/integration-shared/canonical-json";

/** Finite delivery identity. Existing readiness/terminal policy still owns success. */
export type DeliveryContext = {
  state: "checked" | "not-required" | "unavailable";
  checkedAt: string;
  peerRef: string | null;
  guidanceState: "checked" | "not-required" | "unavailable";
  reason: string;
  sourceRefs: string[];
};
export type DeliveryAgreement = {
  schemaVersion: 1;
  objective: string;
  backlogItemId: string | null;
  capturedAt: string;
  basis: "created" | "first-observation";
  acceptance: { digest: string; criteria: string[] } | null;
  context: DeliveryContext;
};
export type DeliveryHandoff = {
  schemaVersion: 1;
  completedAt: string;
  baselineId: string | null;
  evidenceRefs: string[];
  summary: string;
  followOnRefs: string[];
};
export type DeliveryAgreementView = {
  originalObjective: string;
  capturedAt: string;
  basis: DeliveryAgreement["basis"];
  acceptance: DeliveryAgreement["acceptance"];
  objectiveChanged: boolean;
  disposition: "in-progress" | "delivered" | "closed-without-handoff";
  context: DeliveryContext;
  handoff: DeliveryHandoff | null;
  followOnRefs: string[];
};
export function deliveryObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const instant = (value: unknown): value is string => text(value) && Number.isFinite(Date.parse(value));
const strings = (value: unknown, limit = 200): value is string[] => Array.isArray(value)
  && value.length <= limit && value.every(text);

export function readDeliveryAgreement(workspaceState: unknown): DeliveryAgreement | null {
  const value = deliveryObject(deliveryObject(workspaceState).deliveryAgreement);
  const context = deliveryObject(value.context);
  const acceptance = value.acceptance === null ? null : deliveryObject(value.acceptance);
  if (value.schemaVersion !== 1 || !text(value.objective) || !instant(value.capturedAt)
    || !["created", "first-observation"].includes(String(value.basis))
    || !(value.backlogItemId === null || text(value.backlogItemId))
    || !["checked", "not-required", "unavailable"].includes(String(context.state))
    || !["checked", "not-required", "unavailable"].includes(String(context.guidanceState))
    || !instant(context.checkedAt) || !text(context.reason)
    || !(context.peerRef === null || text(context.peerRef)) || !strings(context.sourceRefs, 20)
    || (acceptance !== null && (!text(acceptance.digest) || !strings(acceptance.criteria) || !acceptance.criteria.length))) return null;
  return value as unknown as DeliveryAgreement;
}

export function retainDeliveryAgreement(workspaceState: unknown, input: Omit<DeliveryAgreement, "schemaVersion">): Record<string, unknown> {
  const state = deliveryObject(workspaceState);
  if (Object.hasOwn(state, "deliveryAgreement")) {
    if (!readDeliveryAgreement(state)) throw new Error("The stored delivery agreement requires repair; it cannot be replaced.");
    return { ...state };
  }
  const next = { ...state, deliveryAgreement: { ...input, schemaVersion: 1 } };
  if (!readDeliveryAgreement(next)) throw new Error("A valid delivery agreement is required.");
  return next;
}

export function readDeliveryHandoff(workspaceState: unknown): DeliveryHandoff | null {
  const value = deliveryObject(deliveryObject(workspaceState).deliveryHandoff);
  if (value.schemaVersion !== 1 || !instant(value.completedAt) || !text(value.summary)
    || !(value.baselineId === null || text(value.baselineId))
    || !strings(value.evidenceRefs) || value.evidenceRefs.length === 0
    || !strings(value.followOnRefs, 50)) return null;
  return value as unknown as DeliveryHandoff;
}

/** Called only inside a successful governed terminal transaction. Never grants completion. */
export function finishDeliveryAgreement(workspaceState: unknown, input: Omit<DeliveryHandoff, "schemaVersion">): Record<string, unknown> {
  const state = deliveryObject(workspaceState);
  if (!readDeliveryAgreement(state)) {
    if (Object.hasOwn(state, "deliveryAgreement")) throw new Error("The stored delivery agreement requires repair.");
    return { ...state }; // Historical rooms have no invented agreement.
  }
  const next = { ...state, deliveryHandoff: { ...input, schemaVersion: 1 } };
  if (!readDeliveryHandoff(next)) throw new Error("A delivery handoff requires outcome evidence and a valid completion time.");
  const prior = readDeliveryHandoff(state);
  if (Object.hasOwn(state, "deliveryHandoff")) {
    if (!prior || canonicalJson(prior) !== canonicalJson(next.deliveryHandoff)) {
      throw new Error("The recorded delivery handoff cannot be replaced.");
    }
    return { ...state };
  }
  return next;
}

export function projectDeliveryAgreement(input: {
  workspaceState: unknown; currentObjective: string | null | undefined; terminal: boolean;
}): DeliveryAgreementView | null {
  const agreement = readDeliveryAgreement(input.workspaceState);
  if (!agreement) return null;
  const handoff = readDeliveryHandoff(input.workspaceState);
  return {
    originalObjective: agreement.objective, capturedAt: agreement.capturedAt, basis: agreement.basis,
    acceptance: agreement.acceptance, context: agreement.context,
    objectiveChanged: agreement.objective.trim() !== (input.currentObjective ?? "").trim(),
    disposition: input.terminal ? handoff ? "delivered" : "closed-without-handoff" : "in-progress",
    handoff, followOnRefs: handoff?.followOnRefs ?? [],
  };
}
