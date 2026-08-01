// apps/web/lib/govern/data/policy-decision.ts
// BI-DG-002 (spec §6.5): the Policy Decision Point. A PURE, in-process evaluator —
// MCP tools like get_data_policy/check_data_action explain and simulate it but are not
// the security boundary. Given a resolved evaluation context + policy bundle it returns
// a typed decision. Unknown/invalid context FAILS CLOSED for restricted data, external
// destinations, destructive actions, prohibited storage, and identity/regulated MDM
// (deny); lower-risk ambiguity routes to review. Ambiguity never silently becomes allow.

import {
  EFFECT_RANK,
  PRECEDENCE_ORDER,
  precedenceRank,
  type DataAction,
  type DataAssetId,
  type DataCategory,
  type DataEffect,
  type DataFieldId,
  type DataProtectionTransformation,
  type DataSensitivity,
  type DestinationClass,
  type MasterDataDomainKey,
  type ProcessingPurposeKey,
  type SubjectRole,
} from "./taxonomy";
import {
  DATA_EXECUTABLE_POLICIES,
  type DataExecutablePolicy,
  type DataObligation,
  type PolicyMatch,
} from "./executable-policies";
import type { RegulatedScope } from "./field-classification";

/** Resolved facts the PDP evaluates. The caller (PEP) resolves classification from the
 *  registry; `known: false` marks context that could not be resolved. */
export type PolicyEvaluationContext = {
  organizationId: string;
  action: DataAction;
  asset: DataAssetId;
  fields?: readonly DataFieldId[];
  purpose: ProcessingPurposeKey;
  destination?: DestinationClass;
  transformation?: DataProtectionTransformation;
  classification: {
    known: boolean;
    sensitivity?: DataSensitivity;
    categories?: readonly DataCategory[];
    masterDataDomain?: MasterDataDomainKey;
    subjectRoles?: readonly SubjectRole[];
    collectionRule?: "allowed" | "minimize" | "prohibited";
    /** Regulated legal scope (PCI/PHI) of the data, from field-classification.ts
     *  (BI-0B4B16CA). Lets a policy require a named human approver for cardholder
     *  or health data specifically. */
    regulatedScope?: RegulatedScope;
  };
  environmentKnown: boolean;
  assetVersion: string;
  classificationVersion: string;
  authorityVersion: string;
  policyBundleVersion: string;
};

export type DataPolicyDecision = {
  decisionId: string;
  organizationId: string;
  inputHash: string;
  effect: DataEffect;
  obligations: DataObligation[];
  matchedPolicyVersions: string[];
  assetVersion: string;
  classificationVersion: string;
  authorityVersion: string;
  explanationCode: string;
  replay: "single-use" | "read-cacheable";
  cacheKey?: string;
};

const SIDE_EFFECTING: ReadonlySet<DataAction> = new Set<DataAction>([
  "collect",
  "write",
  "project",
  "export",
  "delete",
  "anonymize",
  "publish",
]);

const DESTRUCTIVE: ReadonlySet<DataAction> = new Set<DataAction>(["delete", "anonymize"]);

/** Deterministic, dependency-free string hash (djb2/xor) for the canonical input. */
function stableHash(value: unknown): string {
  const json = JSON.stringify(value);
  let h = 5381;
  for (let i = 0; i < json.length; i++) h = ((h << 5) + h) ^ json.charCodeAt(i);
  return (h >>> 0).toString(16).padStart(8, "0");
}

function canonicalInput(ctx: PolicyEvaluationContext): unknown {
  const c = ctx.classification;
  return {
    o: ctx.organizationId,
    a: ctx.action,
    as: ctx.asset,
    f: ctx.fields ? [...ctx.fields].sort() : [],
    p: ctx.purpose,
    d: ctx.destination ?? null,
    k: c.known,
    s: c.sensitivity ?? null,
    cat: c.categories ? [...c.categories].sort() : [],
    md: c.masterDataDomain ?? null,
    cr: c.collectionRule ?? null,
    av: ctx.assetVersion,
    cv: ctx.classificationVersion,
    auth: ctx.authorityVersion,
    pb: ctx.policyBundleVersion,
  };
}

function isHighRisk(ctx: PolicyEvaluationContext): boolean {
  return (
    DESTRUCTIVE.has(ctx.action) ||
    ctx.action === "export" ||
    ctx.action === "publish" ||
    ctx.classification.sensitivity === "restricted" ||
    ctx.destination === "external-service" ||
    ctx.classification.collectionRule === "prohibited" ||
    ctx.classification.masterDataDomain !== undefined
  );
}

function inList<T>(list: readonly T[] | undefined, value: T | undefined): boolean {
  if (!list) return true; // omitted axis = "any"
  if (value === undefined) return false;
  return list.includes(value);
}

function anyIn<T>(list: readonly T[] | undefined, values: readonly T[] | undefined): boolean {
  if (!list) return true;
  if (!values || values.length === 0) return false;
  return values.some((v) => list.includes(v));
}

function policyMatches(m: PolicyMatch, ctx: PolicyEvaluationContext): boolean {
  return (
    inList(m.actions, ctx.action) &&
    inList(m.assets, ctx.asset) &&
    inList(m.purposes, ctx.purpose) &&
    inList(m.destinations, ctx.destination) &&
    inList(m.transformations, ctx.transformation ?? "none") &&
    inList(m.sensitivities, ctx.classification.sensitivity) &&
    inList(m.domains, ctx.classification.masterDataDomain) &&
    inList(m.regulatedScopes, ctx.classification.regulatedScope) &&
    anyIn(m.categories, ctx.classification.categories) &&
    anyIn(m.subjectRoles, ctx.classification.subjectRoles)
  );
}

function decision(
  ctx: PolicyEvaluationContext,
  effect: DataEffect,
  explanationCode: string,
  obligations: DataObligation[],
  matched: string[],
): DataPolicyDecision {
  const inputHash = stableHash(canonicalInput(ctx));
  const replay: DataPolicyDecision["replay"] = SIDE_EFFECTING.has(ctx.action)
    ? "single-use"
    : "read-cacheable";
  const base: DataPolicyDecision = {
    decisionId: `ddp_${inputHash}`,
    organizationId: ctx.organizationId,
    inputHash,
    effect,
    obligations,
    matchedPolicyVersions: matched,
    assetVersion: ctx.assetVersion,
    classificationVersion: ctx.classificationVersion,
    authorityVersion: ctx.authorityVersion,
    explanationCode,
    replay,
  };
  // Reusable cache only for non-side-effecting, non-MDM reads (spec §6.5).
  if (replay === "read-cacheable" && ctx.classification.masterDataDomain === undefined) {
    base.cacheKey = [
      ctx.organizationId,
      ctx.action,
      ctx.asset,
      ctx.purpose,
      ctx.destination ?? "-",
      ctx.transformation ?? "none",
      ctx.assetVersion,
      ctx.classificationVersion,
      ctx.authorityVersion,
      ctx.policyBundleVersion,
    ].join("|");
  }
  return base;
}

/**
 * Evaluate a data action against the policy bundle. Deterministic and pure.
 * Precedence lattice (spec §6.5): the STRONGEST precedence level with any matching
 * policy decides; within a level the strongest effect wins (deny > review >
 * allow-with-obligations > allow); array order never decides. Obligations from every
 * matching allow-with-obligations policy accumulate onto an allow decision.
 */
export function evaluateDataPolicy(
  ctx: PolicyEvaluationContext,
  policies: readonly DataExecutablePolicy[] = DATA_EXECUTABLE_POLICIES,
): DataPolicyDecision {
  const highRisk = isHighRisk(ctx);

  // Fail-closed on unknown/invalid context.
  if (!ctx.classification.known || !ctx.environmentKnown) {
    return highRisk
      ? decision(ctx, "deny", "unknown-context-high-risk", [], [])
      : decision(ctx, "review", "unknown-context-review", [], []);
  }

  // Hard backstop: prohibited storage cannot be collected/written/projected.
  if (
    ctx.classification.collectionRule === "prohibited" &&
    (ctx.action === "collect" || ctx.action === "write" || ctx.action === "project")
  ) {
    return decision(ctx, "deny", "prohibited-storage", [], ["prohibited-storage-collection@1"]);
  }

  const matched = policies.filter((p) => policyMatches(p.match, ctx));

  if (matched.length === 0) {
    // No explicit authorization → never allow.
    return highRisk
      ? decision(ctx, "deny", "no-policy-high-risk", [], [])
      : decision(ctx, "review", "no-policy-review", [], []);
  }

  // Strongest precedence level with any match decides.
  const decidingLevel = [...matched]
    .sort((a, b) => precedenceRank(a.precedenceLevel) - precedenceRank(b.precedenceLevel))[0]
    .precedenceLevel;
  const atLevel = matched.filter((p) => p.precedenceLevel === decidingLevel);

  // Strongest effect within the deciding level.
  const strongest = atLevel.reduce((acc, p) =>
    EFFECT_RANK[p.effect] > EFFECT_RANK[acc.effect] ? p : acc,
  );

  const matchedIds = matched.map((p) => `${p.id}@${p.version}`);

  if (strongest.effect === "deny" || strongest.effect === "review") {
    return decision(ctx, strongest.effect, strongest.explanationCode, [], matchedIds);
  }

  // Allow: accumulate obligations from every matching allow-with-obligations policy.
  const obligations: DataObligation[] = [];
  for (const p of matched) {
    if (p.effect === "allow-with-obligations") obligations.push(...(p.obligations ?? []));
  }
  const effect: DataEffect = obligations.length > 0 ? "allow-with-obligations" : "allow";
  return decision(ctx, effect, strongest.explanationCode, obligations, matchedIds);
}

export { PRECEDENCE_ORDER };
