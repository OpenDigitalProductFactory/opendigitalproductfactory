import type { DataPolicyDecision } from "./policy-decision";
import type { InferencePayloadMatch } from "@/lib/inference/data-screening/types";
import {
  createRehydrationToken,
  storeRehydrationTokenMap,
  type RehydrationAuthorizationBinding,
  type StoredRehydrationToken,
} from "./rehydration-token-vault";

export type ContextTransform =
  | "omit"
  | "redact"
  | "partial"
  | "tokenize"
  | "aggregate"
  | "pass-through";

export type SensitiveDetailUse = "replaceable" | "material" | "unknown";

export type ContextMaskAuthority = {
  decision: DataPolicyDecision;
  matches: readonly InferencePayloadMatch[];
  detailUse: SensitiveDetailUse;
  rehydrationBindings?: readonly RehydrationAuthorizationBinding[];
};

export type MaskedContext<T> = {
  value: T;
  transformation: "none" | "masked" | "tokenized";
  transformedValueCount: number;
  rehydrationHandle?: string;
};

export class ContextMaskAuthorizationError extends Error {
  constructor() {
    super("A current PDP allow-with-obligations decision with a mask obligation is required.");
    this.name = "ContextMaskAuthorizationError";
  }
}

/**
 * Raised when the caller has not declared the detail replaceable AND the
 * projection would lose something (BI-0064680C).
 *
 * The guard used to rest on the declaration alone, which conflated two very
 * different transforms. `redact`, `partial`, `omit` and `aggregate` are one-way:
 * the answer comes back built on a value the model never saw, so without an
 * explicit "replaceable" it must not run. `tokenize` is not — the value leaves
 * as a token and `rehydrateResponse` restores it for an authorized viewer, so
 * the answer the viewer reads is the answer the detail supports.
 *
 * Applying one bar to both did not make the platform safer; it made the
 * tokenized path unreachable. No caller declares `sensitiveDetailUse`, so every
 * coworker turn carrying so much as an email address fell to `unknown`, refused
 * the mask, and clamped to `local_only` — with the built-and-tested token vault
 * and response PEP sitting unused behind the refusal.
 */
export class ContextMaskMaterialityError extends Error {
  constructor(detailUse: SensitiveDetailUse) {
    super(
      `Sensitive detail use is ${detailUse} and this projection is not fully reversible; masking could make the answer misleading, so an eligible unmasked route is required.`,
    );
    this.name = "ContextMaskMaterialityError";
  }
}

export class ContextMaskCoverageError extends Error {
  constructor(paths: readonly string[]) {
    super(`No safe transform is defined for sensitive classifier path(s): ${paths.join(", ")}`);
    this.name = "ContextMaskCoverageError";
  }
}

const CONTACT_PATTERN =
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/gi;
const SECRET_PATTERN =
  /\b(?:sk-[A-Za-z0-9_-]{10,}|dpfmcp_[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{12,}|AKIA[0-9A-Z]{12,})\b|-----BEGIN\s+(?:RSA\s+)?PRIVATE KEY-----/gi;
const FINANCE_IDENTIFIER_PATTERN = /\b\d[\d\s-]{5,}\d\b/g;

/**
 * Pure transform primitive. `maskForContext` owns authorization and should be
 * used at enforcement seams; this helper exists so every transform has one
 * deterministic implementation.
 */
export function applyContextTransform(
  value: unknown,
  transform: ContextTransform,
): unknown {
  switch (transform) {
    case "omit":
      return undefined;
    case "redact":
      return "[REDACTED]";
    case "partial": {
      const text = String(value ?? "");
      return text.length <= 4 ? "[PARTIAL]" : `[PARTIAL:${text.slice(-4)}]`;
    }
    case "tokenize":
      return createRehydrationToken(String(value ?? ""));
    case "aggregate": {
      const count = Array.isArray(value)
        ? value.length
        : value && typeof value === "object"
          ? Object.keys(value).length
          : typeof value === "number"
            ? value
            : String(value ?? "").length;
      return `[AGGREGATED:${count}]`;
    }
    case "pass-through":
      return value;
  }
}

/** Traversal counters. `tokenizedValueCount` is the reversible subset. */
type MaskState = { transformedValueCount: number; tokenizedValueCount: number };

/**
 * Did this projection lose anything the viewer could not get back?
 *
 * Every transformed value must have been TOKENIZED — redact, partial, omit and
 * aggregate are one-way — and every token must carry a rehydration binding with
 * no unbound occurrence, which is exactly what `rehydrateResponse` requires
 * before it will restore one. A projection that clears both is lossless from
 * the viewer's side: the value leaves as a token and returns as itself.
 */
function isLosslessProjection(
  state: MaskState,
  tokenMap: ReadonlyMap<string, StoredRehydrationToken>,
): boolean {
  if (state.transformedValueCount === 0) return false;
  if (state.tokenizedValueCount !== state.transformedValueCount) return false;
  if (tokenMap.size === 0) return false;
  return [...tokenMap.values()].every(
    (stored) => stored.bindings.length > 0 && !stored.hasUnboundOccurrence,
  );
}

/**
 * Apply the PDP-authorized default context mask profile to classifier-owned
 * paths. Callers cannot supply transform directives: the PDP obligation and
 * classifier reasons are the authority inputs.
 */
export function maskForContext<T>(
  value: T,
  authority: ContextMaskAuthority,
): MaskedContext<T> {
  assertMaskAuthorized(authority);
  if (authority.matches.length === 0) {
    return { value, transformation: "none", transformedValueCount: 0 };
  }

  const matchesByPath = groupMatchesByPath(authority.matches);
  const forcedTransform = transformFromPolicyProfile(authority.decision);
  const unsupported = authority.matches
    .filter((match) =>
      !forcedTransform &&
      !isCoveredBySafeTransform(match, matchesByPath.get(match.path) ?? [])
    )
    .map((match) => match.path);
  if (unsupported.length > 0) {
    throw new ContextMaskCoverageError([...new Set(unsupported)].sort());
  }

  const tokenMap = new Map<string, StoredRehydrationToken>();
  const state = { transformedValueCount: 0, tokenizedValueCount: 0 };
  const transformed = visitContext(
    value,
    "",
    matchesByPath,
    tokenMap,
    state,
    forcedTransform,
    authority.rehydrationBindings,
  ) as T;

  // Materiality is decided on what the transform DID, not on what the caller
  // declared. See the note on ContextMaskMaterialityError.
  if (authority.detailUse !== "replaceable" && !isLosslessProjection(state, tokenMap)) {
    throw new ContextMaskMaterialityError(authority.detailUse);
  }

  const rehydrationHandle = tokenMap.size > 0
    ? storeRehydrationTokenMap(tokenMap)
    : undefined;
  return {
    value: transformed,
    transformation: tokenMap.size > 0 ? "tokenized" : state.transformedValueCount > 0 ? "masked" : "none",
    transformedValueCount: state.transformedValueCount,
    ...(rehydrationHandle ? { rehydrationHandle } : {}),
  };
}

function assertMaskAuthorized(authority: ContextMaskAuthority): void {
  const hasMaskObligation = authority.decision.obligations.some(
    (obligation) => obligation.kind === "mask",
  );
  if (
    authority.decision.effect !== "allow-with-obligations" ||
    !hasMaskObligation
  ) {
    throw new ContextMaskAuthorizationError();
  }
}

function groupMatchesByPath(
  matches: readonly InferencePayloadMatch[],
): ReadonlyMap<string, InferencePayloadMatch[]> {
  const grouped = new Map<string, InferencePayloadMatch[]>();
  for (const match of matches) {
    const existing = grouped.get(match.path) ?? [];
    existing.push(match);
    grouped.set(match.path, existing);
  }
  return grouped;
}

function transformFromPolicyProfile(
  decision: DataPolicyDecision,
): ContextTransform | undefined {
  const profileId = decision.obligations.find(
    (obligation) => obligation.kind === "mask",
  )?.profileId;
  const profiles: Readonly<Record<string, ContextTransform>> = {
    "context-omit": "omit",
    "context-redact": "redact",
    "context-partial": "partial",
    "context-tokenize": "tokenize",
    "context-aggregate": "aggregate",
    "context-pass-through": "pass-through",
  };
  return profileId ? profiles[profileId] : undefined;
}

function isSafelyTransformable(match: InferencePayloadMatch): boolean {
  return match.reason === "contact-detail" ||
    match.reason === "secret-shaped-token" ||
    match.reason === "secret-field-name" ||
    match.reason === "payment-or-finance-text" ||
    (
      match.reason === "customer-record-field" &&
      /(?:email|phone|address|contact)$/i.test(match.path)
    );
}

function isCoveredBySafeTransform(
  match: InferencePayloadMatch,
  pathMatches: readonly InferencePayloadMatch[],
): boolean {
  if (isSafelyTransformable(match)) return true;
  return match.reason === "customer-record-field" &&
    pathMatches.some((candidate) => candidate.reason === "contact-detail");
}

function visitContext(
  value: unknown,
  path: string,
  matchesByPath: ReadonlyMap<string, readonly InferencePayloadMatch[]>,
  tokenMap: Map<string, StoredRehydrationToken>,
  state: MaskState,
  forcedTransform?: ContextTransform,
  rehydrationBindings?: readonly RehydrationAuthorizationBinding[],
): unknown {
  const pathMatches = matchesByPath.get(path) ?? [];
  if (pathMatches.length > 0 && forcedTransform) {
    return applyAuthorizedTransform(
      value,
      forcedTransform,
      tokenMap,
      state,
      bindingsForPath(path, rehydrationBindings),
    );
  }
  if (typeof value === "string" && pathMatches.length > 0) {
    return transformMatchedString(
      value,
      pathMatches,
      tokenMap,
      state,
      bindingsForPath(path, rehydrationBindings),
    );
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      visitContext(
        entry,
        appendIndex(path, index),
        matchesByPath,
        tokenMap,
        state,
        forcedTransform,
        rehydrationBindings,
      ),
    );
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const childPath = appendKey(path, key);
    const childMatches = matchesByPath.get(childPath) ?? [];
    if (
      (forcedTransform === "omit" && childMatches.length > 0) ||
      (!forcedTransform && childMatches.some((match) => match.reason === "secret-field-name"))
    ) {
      state.transformedValueCount += 1;
      continue;
    }
    output[key] = visitContext(
      entry,
      childPath,
      matchesByPath,
      tokenMap,
      state,
      forcedTransform,
      rehydrationBindings,
    );
  }
  return output;
}

function applyAuthorizedTransform(
  value: unknown,
  transform: ContextTransform,
  tokenMap: Map<string, StoredRehydrationToken>,
  state: MaskState,
  rehydrationBindings: readonly RehydrationAuthorizationBinding[],
): unknown {
  if (transform === "pass-through") return value;
  state.transformedValueCount += 1;
  if (transform !== "tokenize") return applyContextTransform(value, transform);
  state.tokenizedValueCount += 1;
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  const token = createRehydrationToken(raw);
  addStoredToken(tokenMap, token, raw, rehydrationBindings);
  return token;
}

function transformMatchedString(
  value: string,
  matches: readonly InferencePayloadMatch[],
  tokenMap: Map<string, StoredRehydrationToken>,
  state: MaskState,
  rehydrationBindings: readonly RehydrationAuthorizationBinding[],
): string {
  let transformed = value;
  if (matches.some((match) => match.reason === "secret-shaped-token")) {
    transformed = transformed.replace(SECRET_PATTERN, () => {
      state.transformedValueCount += 1;
      return "[REDACTED]";
    });
  }
  if (matches.some((match) => match.reason === "contact-detail")) {
    transformed = transformed.replace(CONTACT_PATTERN, (raw) => {
      const token = createRehydrationToken(raw);
      addStoredToken(tokenMap, token, raw, rehydrationBindings);
      state.transformedValueCount += 1;
      state.tokenizedValueCount += 1;
      return token;
    });
  }
  if (matches.some((match) => match.reason === "payment-or-finance-text")) {
    transformed = transformed.replace(FINANCE_IDENTIFIER_PATTERN, (raw) => {
      const token = createRehydrationToken(raw);
      addStoredToken(tokenMap, token, raw, rehydrationBindings);
      state.transformedValueCount += 1;
      state.tokenizedValueCount += 1;
      return token;
    });
  }
  if (
    transformed === value &&
    matches.some((match) =>
      match.reason === "customer-record-field" &&
      /(?:email|phone|address|contact)$/i.test(match.path)
    )
  ) {
    state.transformedValueCount += 1;
    return String(applyContextTransform(value, "partial"));
  }
  if (
    transformed === value &&
    matches.some((match) => match.reason === "payment-or-finance-text")
  ) {
    throw new ContextMaskCoverageError([matches[0]?.path ?? "unknown"]);
  }
  return transformed;
}

function appendKey(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function appendIndex(path: string, index: number): string {
  return `${path}[${index}]`;
}

function addStoredToken(
  tokenMap: Map<string, StoredRehydrationToken>,
  token: string,
  value: string,
  bindings: readonly RehydrationAuthorizationBinding[],
): void {
  const existing = tokenMap.get(token);
  if (!existing) {
    tokenMap.set(token, {
      value,
      bindings: [...bindings],
      ...(bindings.length === 0 ? { hasUnboundOccurrence: true } : {}),
    });
    return;
  }
  // A repeated raw value can occur at multiple governed paths. Every binding is
  // retained, and the response PEP requires their intersection before release.
  if (bindings.length === 0) {
    existing.hasUnboundOccurrence = true;
    return;
  }
  for (const binding of bindings) {
    if (!existing.bindings.some((candidate) => sameBinding(candidate, binding))) {
      existing.bindings.push(binding);
    }
  }
}

function bindingsForPath(
  path: string,
  bindings: readonly RehydrationAuthorizationBinding[] | undefined,
): RehydrationAuthorizationBinding[] {
  return (bindings ?? []).filter((binding) =>
    !binding.pathPrefixes ||
    binding.pathPrefixes.some((prefix) =>
      path === prefix ||
      path.startsWith(`${prefix}.`) ||
      path.startsWith(`${prefix}[`)
    )
  );
}

function sameBinding(
  left: RehydrationAuthorizationBinding,
  right: RehydrationAuthorizationBinding,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
