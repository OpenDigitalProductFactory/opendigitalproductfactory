/**
 * Public device-identification catalog projection (spec §7, §8.7).
 *
 * DPF's portfolio-aware Fingerbank: the curated, PII-free
 * fingerprint → identity → DPPM-placement mappings, safe to publish. This
 * module projects active, global fingerprint rules into the public catalog
 * shape and is pure/testable; the API route queries the rules and calls it.
 *
 * Differentiator (spec §7): Fingerbank tells you WHAT a device is; DPF tells you
 * what AND where it belongs in your digital-product estate — the placement layer
 * is the value.
 *
 * PII-safety: entries are derived from rule SHAPES (already PII-free), and each
 * entry is run through redactFingerprintEvidence as a fail-closed net — any
 * blocked_sensitive entry is dropped from the public catalog rather than leaked.
 */

import { redactFingerprintEvidence } from "./discovery-fingerprint-redaction";
import type { FingerprintMatchClause, FingerprintMatchExpression, ResolvedIdentity } from "./discovery-fingerprint-rules";

export type PublicCatalogRuleInput = {
  ruleKey: string;
  status: string;
  scope: string;
  matchExpression: FingerprintMatchExpression;
  requiredEvidenceFamilies: string[];
  resolvedIdentity: ResolvedIdentity;
  /** Semantic taxonomy nodeId string (the placement), or null. */
  taxonomyNodeId: string | null;
  identityConfidence: number;
  taxonomyConfidence: number;
};

export type PublicCatalogSignal = { signal: string; match: string };

export type PublicCatalogEntry = {
  ruleKey: string;
  identity: { name: string; vendor: string | null; deviceClass: string | null };
  placement: {
    taxonomyNodeId: string | null;
    portfolio: string | null;
    path: string[];
  };
  signals: PublicCatalogSignal[];
  evidenceFamilies: string[];
  identityConfidence: number;
  taxonomyConfidence: number;
};

export type PublicDeviceCatalog = {
  catalogKey: string;
  schemaVersion: string;
  version: string;
  count: number;
  entries: PublicCatalogEntry[];
};

function clausesOf(expression: FingerprintMatchExpression): FingerprintMatchClause[] {
  return "all" in expression ? expression.all : expression.any;
}

/** A human-readable, value-bearing summary of one match clause (PII-free for OUI/identity rules). */
function summarizeClause(clause: FingerprintMatchClause): PublicCatalogSignal {
  const value =
    "value" in clause
      ? Array.isArray(clause.value)
        ? clause.value.join(",")
        : String(clause.value)
      : "pattern" in clause
        ? clause.pattern
        : "";
  return { signal: `${clause.path} ${clause.type}`, match: value };
}

function humanizePlacement(nodeId: string | null): { portfolio: string | null; path: string[] } {
  if (!nodeId) {
    return { portfolio: null, path: [] };
  }
  const segments = nodeId.split("/");
  const titleize = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return { portfolio: segments[0] ?? null, path: segments.map(titleize) };
}

/** Project one rule into a public catalog entry, or null if it must not be published. */
export function projectPublicCatalogEntry(rule: PublicCatalogRuleInput): PublicCatalogEntry | null {
  // Only active, global rules are public.
  if (rule.status !== "active" || rule.scope !== "global") {
    return null;
  }

  const signals = clausesOf(rule.matchExpression).map(summarizeClause);
  const identity = {
    name: rule.resolvedIdentity.name,
    vendor: rule.resolvedIdentity.vendor ?? null,
    deviceClass: rule.resolvedIdentity.deviceClass ?? null,
  };

  // Fail-closed PII net: if the projected, value-bearing entry contains
  // anything redaction flags as blocked_sensitive, do not publish it.
  const redaction = redactFingerprintEvidence({ identity, signals });
  if (redaction.status === "blocked_sensitive") {
    return null;
  }

  const placement = humanizePlacement(rule.taxonomyNodeId);
  return {
    ruleKey: rule.ruleKey,
    identity,
    placement: { taxonomyNodeId: rule.taxonomyNodeId, ...placement },
    signals,
    evidenceFamilies: rule.requiredEvidenceFamilies,
    identityConfidence: rule.identityConfidence,
    taxonomyConfidence: rule.taxonomyConfidence,
  };
}

export function buildPublicDeviceCatalog(
  rules: PublicCatalogRuleInput[],
  meta: { catalogKey?: string; schemaVersion?: string; version?: string } = {},
): PublicDeviceCatalog {
  const entries = rules
    .map(projectPublicCatalogEntry)
    .filter((e): e is PublicCatalogEntry => e !== null)
    .sort((a, b) => a.ruleKey.localeCompare(b.ruleKey));

  return {
    catalogKey: meta.catalogKey ?? "dpf-public-device-catalog",
    schemaVersion: meta.schemaVersion ?? "2",
    version: meta.version ?? "0.1.0",
    count: entries.length,
    entries,
  };
}
