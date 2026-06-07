/**
 * Hive fingerprint contribution + inbound activation (spec §6, §8.6; BI-08A4D549).
 *
 * OUTBOUND (fail-closed): when an install resolves a device, it may contribute
 * the fingerprint *shape* → identity → DPPM placement to the hive — NEVER the
 * operator's MAC / IP / hostname / SSID. redactFingerprintEvidence (the merged
 * Phase-1 gate) runs over the whole payload first; ANY `blocked_sensitive`
 * status ABORTS the contribution (fail-closed, not best-effort). The payload
 * carries the contributor pseudonym ("obfuscated, not anonymous") + the
 * redaction report for audit. Gated on the §6.1 device-fingerprint opt-in,
 * passed in as a boolean so this core is decoupled from the consent UI.
 *
 * INBOUND (supply-chain safe): a curated inbound rule is executable placement
 * logic authored by another install. It therefore ships `status: "draft"` /
 * non-global `scope`, carries provenance, and activates locally ONLY after the
 * install's own positive/negative fixtures pass against it. No inbound rule
 * auto-activates sight-unseen.
 *
 * Pure, offline, testable. Reuses redactFingerprintEvidence + evaluateFingerprintRule.
 */

import { redactFingerprintEvidence } from "./discovery-fingerprint-redaction";
import {
  evaluateFingerprintRule,
  type FingerprintMatchExpression,
  type FingerprintRuleObservation,
  type ResolvedIdentity,
} from "./discovery-fingerprint-rules";

export type ContributableRule = {
  ruleKey: string;
  requiredEvidenceFamilies: string[];
  matchExpression: FingerprintMatchExpression;
  resolvedIdentity: ResolvedIdentity;
  /** Semantic taxonomy nodeId string (the placement), or null. */
  taxonomyNodeId: string | null;
  identityConfidence: number;
  taxonomyConfidence: number;
};

export type FingerprintContributionPayload = {
  ruleKey: string;
  requiredEvidenceFamilies: string[];
  matchExpression: FingerprintMatchExpression;
  resolvedIdentity: ResolvedIdentity;
  taxonomyNodeId: string | null;
  identityConfidence: number;
  taxonomyConfidence: number;
  /** Stable obfuscated contributor identity (per "obfuscated, not anonymous"). */
  contributor: string;
};

export type FingerprintContributionResult =
  | { status: "skipped_opt_out" }
  | { status: "aborted_blocked_sensitive"; blockedReasons: string[] }
  | { status: "ready"; payload: FingerprintContributionPayload; redactedFields: string[] };

export type BuildContributionOptions = {
  /** The §6.1 device-fingerprint contribution opt-in (default-on in the UI; injected here). */
  optIn: boolean;
  /** Stable pseudonym used across all contribution types. */
  contributor: string;
};

/**
 * Build a PII-free fingerprint contribution, fail-closed. Returns a discriminated
 * result: skipped (opt-out), aborted (PII that can't be safely shared), or ready
 * (the redacted, contributable payload).
 */
export function buildFingerprintContribution(
  rule: ContributableRule,
  options: BuildContributionOptions,
): FingerprintContributionResult {
  if (!options.optIn) {
    return { status: "skipped_opt_out" };
  }

  // Redact the full would-be payload. An OUI/identity/placement rule is
  // inherently PII-free, but a carelessly-authored rule could embed a MAC in a
  // match value — the gate catches it. blocked_sensitive (secret-like) aborts.
  const candidate = {
    matchExpression: rule.matchExpression,
    resolvedIdentity: rule.resolvedIdentity,
  };
  const redaction = redactFingerprintEvidence(candidate);
  if (redaction.status === "blocked_sensitive") {
    return { status: "aborted_blocked_sensitive", blockedReasons: redaction.blockedReasons };
  }

  const redacted = redaction.normalizedEvidence as typeof candidate;
  return {
    status: "ready",
    redactedFields: redaction.redactedFields,
    payload: {
      ruleKey: rule.ruleKey,
      requiredEvidenceFamilies: rule.requiredEvidenceFamilies,
      matchExpression: redacted.matchExpression,
      resolvedIdentity: redacted.resolvedIdentity,
      taxonomyNodeId: rule.taxonomyNodeId,
      identityConfidence: rule.identityConfidence,
      taxonomyConfidence: rule.taxonomyConfidence,
      contributor: options.contributor,
    },
  };
}

// ── Inbound activation (supply-chain safe) ───────────────────────────────────

export type InboundFingerprintRule = ContributableRule & {
  /** Provenance: the contributing install's pseudonym + curation record id. */
  provenance: { contributor: string; curationRecordId: string };
};

export type InboundFixture = FingerprintRuleObservation & { name?: string };

export type InboundActivationDecision = {
  activate: boolean;
  /** Always starts as draft/local; only flips to active when fixtures pass. */
  status: "draft" | "active";
  scope: "local" | "global";
  reasons: string[];
};

/**
 * Decide whether to activate an inbound (hive-curated) rule locally. The rule
 * starts draft/local and only activates after its own positive fixtures all
 * match AND its negative fixtures all fail to match against THIS engine.
 * Provenance is required — an inbound rule with no provenance never activates.
 */
export function decideInboundActivation(
  rule: InboundFingerprintRule,
  fixtures: { positive: InboundFixture[]; negative: InboundFixture[] },
): InboundActivationDecision {
  const reasons: string[] = [];

  if (!rule.provenance?.contributor || !rule.provenance?.curationRecordId) {
    return { activate: false, status: "draft", scope: "local", reasons: ["missing_provenance"] };
  }
  if (fixtures.positive.length === 0) {
    return { activate: false, status: "draft", scope: "local", reasons: ["no_positive_fixtures"] };
  }

  for (const fixture of fixtures.positive) {
    if (!evaluateFingerprintRule(rule, fixture).matched) {
      reasons.push(`positive_fixture_failed:${fixture.name ?? "unnamed"}`);
    }
  }
  for (const fixture of fixtures.negative) {
    if (evaluateFingerprintRule(rule, fixture).matched) {
      reasons.push(`negative_fixture_matched:${fixture.name ?? "unnamed"}`);
    }
  }

  if (reasons.length > 0) {
    // Failed local validation — keep as draft, do NOT activate.
    return { activate: false, status: "draft", scope: "local", reasons };
  }

  // Fixtures pass locally — safe to activate, but scoped local (not global)
  // until the operator/governance widens it.
  return { activate: true, status: "active", scope: "local", reasons: ["fixtures_passed"] };
}
