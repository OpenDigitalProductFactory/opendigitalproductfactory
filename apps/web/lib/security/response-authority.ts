// EP-SOVEREIGN-SOC P3 — governed security response authority.
//
// Spec: docs/superpowers/specs/2026-06-24-sovereign-soc-siem-design.md §4.5, §6.
//
// Composes the merged EP-MSP-FEDERATION remediation rail (no second engine):
//   • evaluateRemediationAuthority / buildRemediationProposal (the BAND gate —
//     read-only auto-approves, mutating needs a human, destructive refused) from
//     lib/service-desk/remediation-authority.ts.
// and layers the KERNEL gate on top: the security-response decision is also
// scored by principle_decide over the registered security dimensions
// (reversibility / blast_radius / evidence_confidence / customer_consent_state /
// business_disruption) carried by the security principle pages. The kernel can
// only make a response MORE conservative than the band — a safety ratchet — never
// auto-approve something the band withholds. The verdict is the action decision;
// the analytical verdict (is it malicious?) lives on the SecurityCase and is NOT
// scored here (spec §6, §7.3). Modeled on lib/decision/ui-surface-features.ts.

import {
  CONSERVATIVE_AUTHORITY_BAND,
  type AuthorityBand,
  type AuthorityDecision,
  type RemediationActionDraft,
  type RemediationRiskClass,
  buildRemediationProposal,
} from "@/lib/service-desk/remediation-authority";

export const SECURITY_RESPONSE_SELECT_SURFACE = "soc-response-authority";

export type SecurityBlastRadius = "single-host" | "account" | "estate";

/** Catalog of security response action types → conservative defaults. The
 *  per-action riskClass feeds the band gate; reversible / blastRadius feed the
 *  kernel gate (and can be overridden per call by the coworker's assessment). */
export interface SecurityResponseSpec {
  riskClass: RemediationRiskClass;
  reversible: boolean;
  blastRadius: SecurityBlastRadius;
}

export const SECURITY_RESPONSE_CATALOG: Record<string, SecurityResponseSpec> = {
  collect_diagnostics: { riskClass: "read-only", reversible: true, blastRadius: "single-host" },
  quarantine_host: { riskClass: "medium", reversible: true, blastRadius: "single-host" },
  block_ip: { riskClass: "medium", reversible: true, blastRadius: "estate" },
  block_domain: { riskClass: "medium", reversible: true, blastRadius: "estate" },
  revoke_token: { riskClass: "medium", reversible: true, blastRadius: "account" },
  disable_account: { riskClass: "high", reversible: true, blastRadius: "account" },
  isolate_host: { riskClass: "high", reversible: true, blastRadius: "single-host" },
  kill_process: { riskClass: "high", reversible: false, blastRadius: "single-host" },
  wipe_host: { riskClass: "destructive", reversible: false, blastRadius: "single-host" },
};

export type SecurityResponseConsent = "standing" | "per-action" | "none";

export interface SecurityResponseInput {
  actionType: string;
  target: string;
  rationale: string;
  /** Investigation confidence in the verdict that justifies this action (0..1). */
  evidenceConfidence: number;
  /** Standing customer approval breadth for this action class. */
  consent: SecurityResponseConsent;
  /** Overrides the catalog defaults when the coworker assesses differently. */
  reversible?: boolean;
  blastRadius?: SecurityBlastRadius;
  /** Does executing this break production for the target? */
  businessDisruption?: number; // 0..1
}

const clamp = (n: number): number => Math.max(0, Math.min(1, n));

const BLAST_SCORE: Record<SecurityBlastRadius, number> = {
  "single-host": 0.2,
  account: 0.5,
  estate: 0.9,
};

const CONSENT_SCORE: Record<SecurityResponseConsent, number> = {
  standing: 1,
  "per-action": 0.5,
  none: 0,
};

/** Resolve the effective spec (catalog defaults overridden by the call). */
export function resolveResponseSpec(input: SecurityResponseInput): SecurityResponseSpec {
  const base = SECURITY_RESPONSE_CATALOG[input.actionType] ?? {
    riskClass: "high" as RemediationRiskClass,
    reversible: false,
    blastRadius: "estate" as SecurityBlastRadius,
  };
  return {
    riskClass: base.riskClass,
    reversible: input.reversible ?? base.reversible,
    blastRadius: input.blastRadius ?? base.blastRadius,
  };
}

/** Map a security response to the federation rail's RemediationActionDraft. */
export function securityResponseToDraft(
  input: SecurityResponseInput,
): RemediationActionDraft {
  const spec = resolveResponseSpec(input);
  return {
    actionType: input.actionType,
    parameters: { target: input.target, reversible: spec.reversible, blastRadius: spec.blastRadius },
    riskClass: spec.riskClass,
    rationale: input.rationale,
  };
}

/**
 * Derive principle_decide feature vectors (keyed by PRINCIPLE_DIMENSIONS) for the
 * two options the kernel weighs: auto-execute vs propose-to-human. Cost axes
 * (blast_radius, business_disruption) carry the actual cost; the security
 * principles weight them negatively, so a high-blast / disruptive / low-evidence
 * / unconsented action makes "propose" win. Pure.
 */
export function securityResponseFeatures(input: SecurityResponseInput): {
  autoExecute: Record<string, number>;
  propose: Record<string, number>;
} {
  const spec = resolveResponseSpec(input);
  const blast = BLAST_SCORE[spec.blastRadius];
  const disruption = clamp(input.businessDisruption ?? (spec.reversible ? 0.2 : 0.6));
  const evidence = clamp(input.evidenceConfidence);
  const consent = CONSENT_SCORE[input.consent];
  const reversibility = spec.reversible ? 0.9 : 0.1;
  return {
    autoExecute: {
      reversibility,
      blast_radius: blast,
      evidence_confidence: evidence,
      customer_consent_state: consent,
      business_disruption: disruption,
    },
    // The propose baseline: a human reviews, so blast/disruption are not borne
    // autonomously (near-zero), and consent/evidence are not load-bearing.
    propose: {
      reversibility: 0.9,
      blast_radius: 0.05,
      evidence_confidence: 0.5,
      customer_consent_state: 0.5,
      business_disruption: 0.05,
    },
  };
}

export type SecurityResponseGate = "auto-approve" | "needs-human-approval" | "refuse";

export interface SecurityResponseVerdict {
  /** The combined (band ∧ kernel, most conservative) decision. */
  decision: SecurityResponseGate;
  /** The band-only decision (from the federation remediation authority). */
  bandDecision: AuthorityDecision;
  /** Whether the kernel ratcheted the band decision down. */
  kernelRatcheted: boolean;
  reason: string;
  ledger?: unknown;
}

type ToolExecutor = (
  toolName: string,
  args: Record<string, unknown>,
  userId: string,
  context: Record<string, unknown>,
) => Promise<{ success?: boolean; data?: Record<string, unknown>; error?: string }>;

const STRICTNESS: Record<SecurityResponseGate, number> = {
  "auto-approve": 0,
  "needs-human-approval": 1,
  refuse: 2,
};

function moreConservative(
  a: SecurityResponseGate,
  b: SecurityResponseGate,
): SecurityResponseGate {
  return STRICTNESS[a] >= STRICTNESS[b] ? a : b;
}

/**
 * Decide how a security response action is authorized: the band gate sets the
 * baseline; the kernel gate (principle_decide over the registered security
 * dimensions) can only ratchet it MORE conservative. Refused-by-band actions
 * never reach the kernel. The executor is injectable for tests; the default
 * routes through the governed principle_decide path.
 */
export async function decideSecurityResponse(
  input: SecurityResponseInput,
  opts: {
    userId: string;
    band?: AuthorityBand;
    routeContext?: string;
    toolExecutor?: ToolExecutor;
  },
): Promise<SecurityResponseVerdict> {
  const band = opts.band ?? CONSERVATIVE_AUTHORITY_BAND;
  const draft = securityResponseToDraft(input);
  const proposal = buildRemediationProposal(
    { incidentKey: input.target, edgeNodeId: input.target },
    [draft],
    band,
  );
  const bandDecision = proposal.overallDecision;

  // Band refused or already requires a human → the kernel cannot widen it; done.
  if (bandDecision !== "auto-approve") {
    return {
      decision: bandDecision,
      bandDecision,
      kernelRatcheted: false,
      reason:
        bandDecision === "refuse"
          ? `Band refuses ${input.actionType} (${draft.riskClass}).`
          : `Band requires human approval for ${input.actionType} (${draft.riskClass}).`,
    };
  }

  // Band would auto-approve (read-only). The kernel scores whether autonomous
  // execution beats proposing to a human, over the security dimensions.
  const { autoExecute, propose } = securityResponseFeatures(input);
  const exec = opts.toolExecutor ?? (await import("@/lib/mcp-tools")).executeTool;
  const response = await exec(
    "principle_decide",
    {
      context:
        "An AI SOC coworker is deciding whether to AUTO-EXECUTE a security response action " +
        "on an estate, or PROPOSE it for human approval. Governed by the security principles: " +
        "never auto-execute an irreversible or estate-wide action without explicit human approval; " +
        "prefer reversible containment; honour standing customer consent only for low-blast actions.",
      callingPopulation: "in_platform_coworker",
      callingSurface: SECURITY_RESPONSE_SELECT_SURFACE,
      options: [
        { id: "auto-execute", description: `Auto-execute ${input.actionType} on ${input.target}.`, features: autoExecute },
        { id: "propose", description: "Propose the action for human approval instead.", features: propose },
      ],
    },
    opts.userId,
    { routeContext: opts.routeContext ?? SECURITY_RESPONSE_SELECT_SURFACE },
  );

  const data = response.success ? response.data : undefined;
  const rec = data?.["recommendation"] as { optionId?: string; confidence?: string } | undefined;
  const kernelAutoOk = rec?.optionId === "auto-execute" && rec?.confidence === "high";
  const kernelDecision: SecurityResponseGate = kernelAutoOk ? "auto-approve" : "needs-human-approval";
  const decision = moreConservative(bandDecision, kernelDecision);
  return {
    decision,
    bandDecision,
    kernelRatcheted: decision !== bandDecision,
    reason: kernelAutoOk
      ? "Band + kernel both clear autonomous execution."
      : "Band allows auto, but the kernel ratchets to human approval (blast / reversibility / evidence / consent).",
    ledger: data?.["scores"] ?? data ?? null,
  };
}
