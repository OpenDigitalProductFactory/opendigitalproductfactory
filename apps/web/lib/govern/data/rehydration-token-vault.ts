import { createHmac, randomBytes } from "node:crypto";

import type { PrincipalSensitivity } from "@dpf/db/principal-sensitivity";

import type { ProcessingPurposeKey } from "./taxonomy";
import type {
  InferenceDataClass,
  InferencePolicyDecisionVersion,
} from "@/lib/inference/data-screening/types";

export const RESPONSE_SURFACES = [
  "private-user",
  "private-employee",
  "private-customer",
  "private-partner",
  "shared-team",
  "public",
] as const;

export type ResponseSurface = (typeof RESPONSE_SURFACES)[number];

export type RehydrationSubject =
  | { kind: "employee"; id: string }
  | { kind: "account"; id: string }
  | { kind: "contact"; id: string }
  | { kind: "partner-account"; id: string }
  | { kind: "principal"; id: string }
  | { kind: "team"; id: string };

export type RehydrationExpectedActor = {
  principalId: string;
  actingHumanUserId: string | null;
  actingAgentId: string | null;
  delegationGrantId: string | null;
};

export type RehydrationAuthorizationBinding = {
  expectedActor: RehydrationExpectedActor;
  purpose: ProcessingPurposeKey;
  surface: ResponseSurface;
  subject: RehydrationSubject;
  sensitivity: PrincipalSensitivity;
  decisionVersions: InferencePolicyDecisionVersion[];
  dataClasses: InferenceDataClass[];
  pathPrefixes?: string[];
};

/** Caller-owned identity/surface intent. Sensitivity and policy evidence are
 * deliberately absent: the screening seam derives those from the PDP receipt. */
export type RehydrationRouteBinding = Pick<
  RehydrationAuthorizationBinding,
  "expectedActor" | "purpose" | "surface" | "subject"
> & {
  pathPrefixes?: string[];
};

export type StoredRehydrationToken = {
  value: string;
  bindings: RehydrationAuthorizationBinding[];
  hasUnboundOccurrence?: true;
};

type TokenVaultEntry = {
  expiresAt: number;
  tokens: ReadonlyMap<string, StoredRehydrationToken>;
};

export type RehydrationTokenMapRead =
  | {
      status: "available";
      tokens: ReadonlyMap<string, StoredRehydrationToken>;
    }
  | { status: "unavailable" };

const TOKEN_KEY = randomBytes(32);
const DEFAULT_TOKEN_TTL_MS = 5 * 60_000;
const MAX_TOKEN_MAPS = 1_000;
const tokenVault = new Map<string, TokenVaultEntry>();

export function createRehydrationToken(value: string): string {
  const digest = createHmac("sha256", TOKEN_KEY)
    .update(value)
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();
  return `[DPF_TOKEN_${digest}]`;
}

export function storeRehydrationTokenMap(
  tokens: ReadonlyMap<string, StoredRehydrationToken>,
  options: { now?: number; ttlMs?: number } = {},
): string {
  const now = options.now ?? Date.now();
  removeExpiredEntries(now);
  while (tokenVault.size >= MAX_TOKEN_MAPS) {
    const oldest = tokenVault.keys().next().value as string | undefined;
    if (!oldest) break;
    tokenVault.delete(oldest);
  }

  const handle = `rehydration_${randomBytes(12).toString("hex")}`;
  tokenVault.set(handle, {
    expiresAt: now + (options.ttlMs ?? DEFAULT_TOKEN_TTL_MS),
    tokens: cloneTokenMap(tokens),
  });
  return handle;
}

export function readRehydrationTokenMap(
  handle: string,
  options: { now?: number } = {},
): RehydrationTokenMapRead {
  const now = options.now ?? Date.now();
  const entry = tokenVault.get(handle);
  if (!entry || entry.expiresAt <= now) {
    if (entry) tokenVault.delete(handle);
    return { status: "unavailable" };
  }
  return {
    status: "available",
    tokens: cloneTokenMap(entry.tokens),
  };
}

function removeExpiredEntries(now: number): void {
  for (const [handle, entry] of tokenVault) {
    if (entry.expiresAt <= now) tokenVault.delete(handle);
  }
}

function cloneTokenMap(
  tokens: ReadonlyMap<string, StoredRehydrationToken>,
): ReadonlyMap<string, StoredRehydrationToken> {
  return new Map(
    [...tokens].map(([token, stored]) => [
      token,
      {
        value: stored.value,
        bindings: stored.bindings.map((binding) => ({
          expectedActor: { ...binding.expectedActor },
          purpose: binding.purpose,
          surface: binding.surface,
          subject: { ...binding.subject },
          sensitivity: binding.sensitivity,
          decisionVersions: binding.decisionVersions.map((version) => ({
            ...version,
          })),
          dataClasses: [...binding.dataClasses],
          ...(binding.pathPrefixes
            ? { pathPrefixes: [...binding.pathPrefixes] }
            : {}),
        })),
        ...(stored.hasUnboundOccurrence
          ? { hasUnboundOccurrence: true as const }
          : {}),
      },
    ]),
  );
}
