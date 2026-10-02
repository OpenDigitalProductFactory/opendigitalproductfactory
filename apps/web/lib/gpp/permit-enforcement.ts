// What the reference monitor does with a permit verdict when an enforced
// binding covers the call.
//
// GPP Phase 2, PR-E (docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md).
// Scope baseline: OBJ-CRITICAL, OBJ-NODISRUPT; acceptance AC-ENFORCE.
//
// Pure. decidePermitEnforcement returns one of:
// - `not-applicable`: no binding in GPP_BINDING_ENFORCEMENT covers the tool.
//   The monitor takes exactly its shadow path. With the shipped (empty) table
//   this is the answer for every call.
// - `refuse`: the call carries no valid permit from an enforced binding. The
//   monitor returns `permit_required` with a gate descriptor shaped as the MCP
//   extension draft's remediation hint (condition handle_required /
//   handle_invalid / handle_mismatch), and records the observation enforced.
// - `allow`: enforced, and the permit verified.
// - `downgraded`: the binding is enforced but this call cannot be judged on
//   its permit for a reason that is NOT the caller's, so the call runs as in
//   shadow and the observation records `enforcement_downgraded` and why.
//
// Order of checks: first what the INSTALL can do (operator override, signing
// key), then what the PRESENTER controls (permit present, MAC, binding, exact
// arguments, expiry/revocation/uses/tool, lineage present), and only last the
// ledger property (unsealed lineage) and infrastructure faults. A forged,
// replayed or mismatched permit is therefore refused before any downgrade is
// considered, on every install that can sign.
//
// Why a missing key downgrades rather than refuses. With no
// DPF_GPP_PERMIT_SECRET the install cannot tell a real permit from a forged
// one (`unsigned`). Enforcing there would be theatre: accepting every unsigned
// permit lets a forged row through, and refusing every one turns a missing
// secret into a refusal of every call under the binding. Neither is honest, so
// the binding does not enforce on that install, and says so on every call.

import type { GppPermitEnforcement } from "@dpf/db";

import { resolveBindingMode, type BindingEnforcementEntry } from "./binding-enforcement";
import { bindingRef, gppBindings, bindingCoversTool, type GppBinding, type GppBindingToolFacts } from "./bindings";
import { PERMIT_HANDLE_META_KEY } from "./permit-carriage";
import { canSignPermits } from "./permit-handle";
import type { MonitorPermitOutcome, PermitChecks } from "./permit-verdict";

/** The MCP extension draft's conditions (BI-899C3844, §5 Denial and remediation). */
export type PermitRequiredCondition = "handle_required" | "handle_invalid" | "handle_mismatch";

export type EnforcementDowngradeReason =
  /** The operator set DPF_GPP_ENFORCEMENT=shadow-all. */
  | "operator-shadow-all"
  /** No DPF_GPP_PERMIT_SECRET: the install cannot verify any permit. */
  | "permit-key-unconfigured"
  /** The binding requires sealed lineage and the admitting decision is unsealed (R1). */
  | "lineage-unsealed-not-accepted"
  /** Infrastructure: the decision ledger could not be read. */
  | "lineage-lookup-failed"
  /** Infrastructure: the enforced binding's gate admitted, but its permit could not be written. */
  | "permit-mint-failed"
  /** Infrastructure: the presented handle could not be looked up. */
  | "presented-lookup-failed"
  /** Infrastructure: permit resolution failed as a whole. */
  | "permit-resolution-failed";

/** The draft's `gate` descriptor, plus the DPF binding facts behind it. */
export type PermitGateDescriptor = {
  gateRef: string;
  title: string;
  /** No MCP tool issues a DPF permit on request: the gate admits in-call, or a person approves. */
  obtain: "out_of_band";
  bindingId: string;
  gateKey: string;
  authority: GppBinding["authority"];
  admission: GppBinding["admission"];
};

export type PermitEnforcementDecision =
  | { kind: "not-applicable" }
  | { kind: "downgraded"; reason: EnforcementDowngradeReason; bindingIds: string[] }
  | { kind: "allow"; bindingId: string; decisionId: string }
  | {
      kind: "refuse";
      condition: PermitRequiredCondition;
      reason: string;
      gates: PermitGateDescriptor[];
      bindingIds: string[];
      decisionIds: string[];
    };

function gateTitle(binding: GppBinding): string {
  return binding.admission === "alignment-approve"
    ? "WWWD x WSID alignment approval for this call"
    : "An approved human checkpoint for this call";
}

export function gateDescriptor(binding: GppBinding): PermitGateDescriptor {
  return {
    gateRef: bindingRef(binding),
    title: gateTitle(binding),
    obtain: "out_of_band",
    bindingId: binding.bindingId,
    gateKey: binding.gateKey,
    authority: binding.authority,
    admission: binding.admission,
  };
}

function checksOf(outcome: MonitorPermitOutcome): PermitChecks | null {
  const checks = outcome.detail.checks;
  return checks && typeof checks === "object" ? (checks as PermitChecks) : null;
}

export type DecidePermitEnforcementInput = {
  tool: GppBindingToolFacts;
  outcome: MonitorPermitOutcome;
  /** Defaults to canSignPermits(). */
  canSign?: boolean;
  env?: Record<string, string | undefined>;
};

export function decidePermitEnforcement(input: DecidePermitEnforcementInput): PermitEnforcementDecision {
  const declared = gppBindings()
    .filter((binding) => bindingCoversTool(binding, input.tool))
    .map((binding) => ({ binding, resolution: resolveBindingMode(binding.bindingId, input.env) }))
    .filter(({ resolution }) => resolution.mode === "enforced" || resolution.reason === "operator-shadow-all");
  if (declared.length === 0) return { kind: "not-applicable" };

  const enforced = declared.flatMap(({ binding, resolution }) =>
    resolution.mode === "enforced" ? [{ binding, entry: resolution.entry }] : [],
  );
  const bindingIds = declared.map(({ binding }) => binding.bindingId);
  const downgrade = (reason: EnforcementDowngradeReason): PermitEnforcementDecision => ({ kind: "downgraded", reason, bindingIds });
  if (enforced.length === 0) return downgrade("operator-shadow-all");
  if (!(input.canSign ?? canSignPermits())) return downgrade("permit-key-unconfigured");

  const { outcome } = input;
  const detail = outcome.detail;
  const handlePresented = detail.handlePresented === true;
  const refuse = (condition: PermitRequiredCondition, reason: string): PermitEnforcementDecision => ({
    kind: "refuse",
    condition,
    reason,
    gates: enforced.map(({ binding }) => gateDescriptor(binding)),
    bindingIds: enforced.map(({ binding }) => binding.bindingId),
    decisionIds: enforced.map(({ entry }) => entry.decisionId),
  });
  if (detail.resolutionFailed === true) return downgrade("permit-resolution-failed");
  if (detail.presentedLookupFailed === true) return downgrade("presented-lookup-failed");

  const match: { binding: GppBinding; entry: BindingEnforcementEntry } | undefined = enforced.find(
    ({ binding }) => binding.bindingId === outcome.bindingId,
  );
  const checks = checksOf(outcome);
  if (!outcome.permitRowId || !checks) {
    // The enforced gate admitted this call but its permit could not be
    // written: infrastructure, and the gate did admit.
    if (!handlePresented && detail.mintFailed === true && match) return downgrade("permit-mint-failed");
    return handlePresented ? refuse("handle_invalid", "unknown-permit") : refuse("handle_required", "no-permit");
  }
  // On a keyed install `unsigned` cannot occur (verifyPermitMac returns it only
  // with no key); fail closed if it ever does.
  if (checks.mac !== "ok") return refuse("handle_invalid", checks.mac === "invalid" ? "mac-invalid" : "unsigned-on-keyed-install");
  if (!match) return refuse(handlePresented ? "handle_mismatch" : "handle_required", "permit-from-other-binding");
  if (checks.paramHash === "mismatch") return refuse("handle_mismatch", "param-mismatch");
  if (checks.paramHash !== "match") return refuse("handle_mismatch", "permit-not-bound-to-call");
  if (checks.state === "tool_not_in_capabilities") return refuse("handle_mismatch", checks.state);
  if (checks.state !== "valid") return refuse("handle_invalid", checks.state);
  if (checks.lineage === "missing") return refuse("handle_invalid", "lineage-missing");
  if (checks.lineage === "lookup_failed") return downgrade("lineage-lookup-failed");
  if (checks.lineage === "unsealed" && match.entry.lineage !== "unsealed-accepted") {
    return downgrade("lineage-unsealed-not-accepted");
  }
  return { kind: "allow", bindingId: match.binding.bindingId, decisionId: match.entry.decisionId };
}

/** The observation fields for a decision. Empty for `not-applicable`, so the shadow observation is unchanged. */
export function enforcementObservation(
  decision: PermitEnforcementDecision,
): { enforcement?: GppPermitEnforcement; detail: Record<string, unknown> } {
  switch (decision.kind) {
    case "not-applicable":
      return { detail: {} };
    case "allow":
      return {
        enforcement: "enforced",
        detail: { enforcement: { outcome: "allowed", bindingId: decision.bindingId, decisionId: decision.decisionId } },
      };
    case "downgraded":
      return {
        enforcement: "shadow",
        detail: { enforcement: { outcome: "enforcement_downgraded", reason: decision.reason, bindings: decision.bindingIds } },
      };
    case "refuse":
      return {
        enforcement: "enforced",
        detail: {
          enforcement: {
            outcome: "refused",
            condition: decision.condition,
            reason: decision.reason,
            bindings: decision.bindingIds,
            decisionIds: decision.decisionIds,
          },
        },
      };
  }
}

/** The refusal's human-readable detail: which gate to pursue, never the permit's contents. */
export function permitRequiredMessage(decision: Extract<PermitEnforcementDecision, { kind: "refuse" }>): string {
  const gates = decision.gates.map((gate) => `${gate.title} (${gate.gateRef})`).join(" or ");
  return `a valid permit is required (${decision.condition}). Obtain it by passing: ${gates}. Do not retry the same call unchanged.`;
}

/**
 * The refusal's structured data. `authorization` mirrors the MCP extension
 * draft's denial envelope and `transaction_authorization` remediation hint, so
 * an external client can act on it; `permit` carries the DPF verdict.
 */
export function permitRequiredData(
  decision: Extract<PermitEnforcementDecision, { kind: "refuse" }>,
  verdict: MonitorPermitOutcome["verdict"],
): Record<string, unknown> {
  return {
    authorization: {
      reason: "insufficient_authorization",
      remediation: "available",
      remediationHints: decision.gates.map((gate) => ({
        type: "transaction_authorization",
        condition: decision.condition,
        gate,
      })),
    },
    permit: {
      condition: decision.condition,
      verdict,
      reason: decision.reason,
      carriage: PERMIT_HANDLE_META_KEY,
    },
  };
}
