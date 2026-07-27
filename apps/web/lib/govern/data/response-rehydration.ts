import type { PrincipalSensitivity } from "@dpf/db/principal-sensitivity";

import type { EffectiveAuthContext } from "@/lib/identity/effective-auth-context";
import { canAccessAuthoritySubject } from "@/lib/govern/authority/authority-subject";
import {
  isDecisionVersionSnapshotStillFresh,
  type DecisionVersionSnapshot,
} from "./policy-enforcement";
import type { ProcessingPurposeKey } from "./taxonomy";
import {
  readRehydrationTokenMap,
  type RehydrationAuthorizationBinding,
  type RehydrationSubject,
  type ResponseSurface,
} from "./rehydration-token-vault";

export type ResponseRehydrationExplanationCode =
  | "response-rehydration-authorized"
  | "response-rehydration-unavailable"
  | "response-actor-not-authorized"
  | "response-delegation-not-authorized"
  | "response-purpose-not-authorized"
  | "response-surface-not-authorized"
  | "response-subject-not-authorized"
  | "response-clearance-insufficient"
  | "response-policy-version-stale";

export type ResponseRehydrationEvidence = {
  outcome: "rehydrated" | "partially-rehydrated" | "masked";
  authorizedTokenCount: number;
  deniedTokenCount: number;
  explanationCodes: ResponseRehydrationExplanationCode[];
  rawValuesStored: false;
};

export type ResponseRehydrationInput<T> = {
  value: T;
  rehydrationHandle: string;
  authContext: EffectiveAuthContext;
  purpose: ProcessingPurposeKey;
  surface: ResponseSurface;
  currentVersions: DecisionVersionSnapshot;
  now?: number;
};

export function rehydrateResponse<T>(
  input: ResponseRehydrationInput<T>,
): { value: T; evidence: ResponseRehydrationEvidence } {
  const read = readRehydrationTokenMap(input.rehydrationHandle, {
    now: input.now,
  });
  if (read.status === "unavailable") {
    return unavailableResult(input.value);
  }
  if (
    [...read.tokens.values()].every((stored) =>
      stored.bindings.length === 0 || stored.hasUnboundOccurrence
    )
  ) {
    return unavailableResult(input.value);
  }

  const decisions = new Map<
    string,
    { authorized: boolean; value: string; codes: ResponseRehydrationExplanationCode[] }
  >();
  for (const [token, stored] of read.tokens) {
    if (stored.bindings.length === 0 || stored.hasUnboundOccurrence) {
      decisions.set(token, {
        authorized: false,
        value: stored.value,
        codes: ["response-rehydration-unavailable"],
      });
      continue;
    }
    const codes = uniqueCodes(
      stored.bindings.flatMap((binding) => bindingDenials(binding, input)),
    );
    decisions.set(token, {
      authorized: codes.length === 0,
      value: stored.value,
      codes,
    });
  }

  const encountered = new Set<string>();
  const authorized = new Set<string>();
  const denied = new Set<string>();
  const explanationCodes = new Set<ResponseRehydrationExplanationCode>();
  const value = visitValue(input.value, (text) =>
    replaceTokens(text, decisions, {
      encountered,
      authorized,
      denied,
      explanationCodes,
    })
  ) as T;

  if (encountered.size === 0) {
    return unavailableResult(input.value);
  }
  if (authorized.size > 0) {
    explanationCodes.add("response-rehydration-authorized");
  }

  return {
    value,
    evidence: {
      outcome: authorized.size === 0
        ? "masked"
        : denied.size === 0
          ? "rehydrated"
          : "partially-rehydrated",
      authorizedTokenCount: authorized.size,
      deniedTokenCount: denied.size,
      explanationCodes: [...explanationCodes].sort(),
      rawValuesStored: false,
    },
  };
}

function unavailableResult<T>(
  value: T,
): { value: T; evidence: ResponseRehydrationEvidence } {
  return {
    value,
    evidence: {
      outcome: "masked",
      authorizedTokenCount: 0,
      deniedTokenCount: 0,
      explanationCodes: ["response-rehydration-unavailable"],
      rawValuesStored: false,
    },
  };
}

function bindingDenials(
  binding: RehydrationAuthorizationBinding,
  input: Omit<ResponseRehydrationInput<unknown>, "value" | "rehydrationHandle">,
): ResponseRehydrationExplanationCode[] {
  const codes: ResponseRehydrationExplanationCode[] = [];
  if (!actorMatches(binding, input.authContext)) {
    codes.push(
      binding.expectedActor.delegationGrantId ||
          binding.expectedActor.actingAgentId
        ? "response-delegation-not-authorized"
        : "response-actor-not-authorized",
    );
  }
  if (binding.purpose !== input.purpose) {
    codes.push("response-purpose-not-authorized");
  }
  if (
    binding.surface !== input.surface ||
    input.surface === "shared-team" ||
    input.surface === "public"
  ) {
    codes.push("response-surface-not-authorized");
  }
  if (!canAccessSubject(input.authContext, binding.subject)) {
    codes.push("response-subject-not-authorized");
  }
  if (!hasClearance(input.authContext, binding.sensitivity)) {
    codes.push("response-clearance-insufficient");
  }
  if (
    binding.decisionVersions.length === 0 ||
    !binding.decisionVersions.every((version) =>
      isDecisionVersionSnapshotStillFresh(version, input.currentVersions)
    )
  ) {
    codes.push("response-policy-version-stale");
  }
  return codes;
}

function actorMatches(
  binding: RehydrationAuthorizationBinding,
  context: EffectiveAuthContext,
): boolean {
  const expected = binding.expectedActor;
  if (
    context.principalId !== expected.principalId ||
    context.actingHumanUserId !== expected.actingHumanUserId ||
    context.actingAgentId !== expected.actingAgentId
  ) {
    return false;
  }
  if (context.population === "ai-coworker" && !expected.actingAgentId) {
    return false;
  }
  return expected.delegationGrantId === null ||
    context.delegationGrantIds.includes(expected.delegationGrantId);
}

function canAccessSubject(
  context: EffectiveAuthContext,
  subject: RehydrationSubject,
): boolean {
  return canAccessAuthoritySubject(context, subject);
}

function hasClearance(
  context: EffectiveAuthContext,
  sensitivity: PrincipalSensitivity,
): boolean {
  return context.sensitivityClearance.includes(sensitivity);
}

function visitValue(value: unknown, transform: (value: string) => string): unknown {
  if (typeof value === "string") return transform(value);
  if (Array.isArray(value)) {
    return value.map((entry) => visitValue(entry, transform));
  }
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      visitValue(entry, transform),
    ]),
  );
}

function replaceTokens(
  text: string,
  decisions: ReadonlyMap<
    string,
    { authorized: boolean; value: string; codes: ResponseRehydrationExplanationCode[] }
  >,
  state: {
    encountered: Set<string>;
    authorized: Set<string>;
    denied: Set<string>;
    explanationCodes: Set<ResponseRehydrationExplanationCode>;
  },
): string {
  return text.replace(/\[DPF_TOKEN_[A-F0-9]{12}\]/g, (token) => {
    const decision = decisions.get(token);
    if (!decision) return token;
    state.encountered.add(token);
    if (decision.authorized) {
      state.authorized.add(token);
      return decision.value;
    } else {
      state.denied.add(token);
      decision.codes.forEach((code) => state.explanationCodes.add(code));
      return token;
    }
  });
}

function uniqueCodes(
  codes: readonly ResponseRehydrationExplanationCode[],
): ResponseRehydrationExplanationCode[] {
  return [...new Set(codes)].sort();
}
