import { createHmac, randomBytes } from "node:crypto";

import type { DataPolicyDecision } from "./policy-decision";
import type { InferencePayloadMatch } from "@/lib/inference/data-screening/types";

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

export class ContextMaskMaterialityError extends Error {
  constructor(detailUse: SensitiveDetailUse) {
    super(
      `Sensitive detail use is ${detailUse}; masking could make the answer misleading, so an eligible unmasked route is required.`,
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

const TOKEN_KEY = randomBytes(32);
const TOKEN_TTL_MS = 5 * 60_000;
const MAX_TOKEN_MAPS = 1_000;
const CONTACT_PATTERN =
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/gi;
const SECRET_PATTERN =
  /\b(?:sk-[A-Za-z0-9_-]{10,}|dpfmcp_[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{12,}|AKIA[0-9A-Z]{12,})\b|-----BEGIN\s+(?:RSA\s+)?PRIVATE KEY-----/gi;
const FINANCE_IDENTIFIER_PATTERN = /\b\d[\d\s-]{5,}\d\b/g;

type TokenVaultEntry = {
  expiresAt: number;
  tokens: ReadonlyMap<string, string>;
};

const tokenVault = new Map<string, TokenVaultEntry>();

function stableToken(value: string): string {
  const digest = createHmac("sha256", TOKEN_KEY)
    .update(value)
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();
  return `[DPF_TOKEN_${digest}]`;
}

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
      return stableToken(String(value ?? ""));
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
  if (authority.detailUse !== "replaceable") {
    throw new ContextMaskMaterialityError(authority.detailUse);
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

  const tokenMap = new Map<string, string>();
  const state = { transformedValueCount: 0 };
  const transformed = visitContext(
    value,
    "",
    matchesByPath,
    tokenMap,
    state,
    forcedTransform,
  ) as T;

  const rehydrationHandle = tokenMap.size > 0
    ? storeTokenMap(tokenMap)
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
  tokenMap: Map<string, string>,
  state: { transformedValueCount: number },
  forcedTransform?: ContextTransform,
): unknown {
  const pathMatches = matchesByPath.get(path) ?? [];
  if (pathMatches.length > 0 && forcedTransform) {
    return applyAuthorizedTransform(value, forcedTransform, tokenMap, state);
  }
  if (typeof value === "string" && pathMatches.length > 0) {
    return transformMatchedString(value, pathMatches, tokenMap, state);
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
    );
  }
  return output;
}

function applyAuthorizedTransform(
  value: unknown,
  transform: ContextTransform,
  tokenMap: Map<string, string>,
  state: { transformedValueCount: number },
): unknown {
  if (transform === "pass-through") return value;
  state.transformedValueCount += 1;
  if (transform !== "tokenize") return applyContextTransform(value, transform);
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  const token = stableToken(raw);
  tokenMap.set(token, raw);
  return token;
}

function transformMatchedString(
  value: string,
  matches: readonly InferencePayloadMatch[],
  tokenMap: Map<string, string>,
  state: { transformedValueCount: number },
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
      const token = stableToken(raw);
      tokenMap.set(token, raw);
      state.transformedValueCount += 1;
      return token;
    });
  }
  if (matches.some((match) => match.reason === "payment-or-finance-text")) {
    transformed = transformed.replace(FINANCE_IDENTIFIER_PATTERN, (raw) => {
      const token = stableToken(raw);
      tokenMap.set(token, raw);
      state.transformedValueCount += 1;
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

function storeTokenMap(tokens: ReadonlyMap<string, string>): string {
  const now = Date.now();
  for (const [handle, entry] of tokenVault) {
    if (entry.expiresAt <= now) tokenVault.delete(handle);
  }
  while (tokenVault.size >= MAX_TOKEN_MAPS) {
    const oldest = tokenVault.keys().next().value as string | undefined;
    if (!oldest) break;
    tokenVault.delete(oldest);
  }
  const handle = `rehydration_${randomBytes(12).toString("hex")}`;
  tokenVault.set(handle, {
    expiresAt: now + TOKEN_TTL_MS,
    tokens: new Map(tokens),
  });
  return handle;
}
