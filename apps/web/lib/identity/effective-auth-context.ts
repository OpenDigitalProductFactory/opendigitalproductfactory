import {
  normalizePrincipalSensitivities,
  type PrincipalSensitivity,
} from "@dpf/db";

import type { DpfSession } from "@/lib/govern/auth";

export const AUTH_POPULATIONS = [
  "workforce",
  "customer",
  "partner",
  "service",
  "ai-coworker",
] as const;

export type AuthPopulation = (typeof AUTH_POPULATIONS)[number];
export type AuthSource = "bearer" | "session" | "service" | "delegation" | "unknown";

export type PrincipalAliasEvidence = {
  type: string;
  value: string;
  issuer: string;
};

type EmployeeScopeInput = {
  id: string;
  directReports?: Array<{ id: string }>;
  directReportIds?: string[];
  indirectReportIds?: string[];
} | null;

export type EffectiveAuthContextInput = {
  user: Pick<
    DpfSession["user"],
    "id" | "type" | "platformRole" | "isSuperuser" | "accountId" | "contactId"
  >;
  grantedCapabilities: string[];
  principal?: {
    principalId: string;
    kind: string;
    aliases?: Array<{ aliasType: string; aliasValue: string; issuer: string }>;
    sensitivityClearance?: string[];
  } | null;
  // Transitional compatibility for existing callers. The shared loader should
  // pass `principal`; this field can be removed after every auth surface moves.
  principalId?: string | null;
  population?: AuthPopulation;
  employeeProfile?: EmployeeScopeInput;
  teamIds?: string[];
  accountScope?: {
    accountIds?: string[];
    contactIds?: string[];
    partnerAccountIds?: string[];
  };
  authentication?: {
    source: AuthSource;
    methods?: string[];
    contextClassReference?: string | null;
  };
  actingHumanUserId?: string | null;
  actingAgentId?: string | null;
  delegationGrantIds?: string[];
};

export type EffectiveAuthContext = {
  principalId: string | null;
  principalAliases: PrincipalAliasEvidence[];
  population: AuthPopulation;
  platformRole: string | null;
  isSuperuser: boolean;
  employeeId: string | null;
  managerScope: {
    directReportIds: string[];
    indirectReportIds: string[];
  } | null;
  teamIds: string[];
  accountScope: {
    accountIds: string[];
    contactIds: string[];
    partnerAccountIds: string[];
  };
  sensitivityClearance: PrincipalSensitivity[];
  authentication: {
    source: AuthSource;
    methods: string[];
    contextClassReference: string | null;
  };
  actingHumanUserId: string | null;
  actingAgentId: string | null;
  delegationGrantIds: string[];
  grantedCapabilities: string[];
};

function normalizeStrings(values: readonly (string | null | undefined)[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value?.trim()).filter(Boolean) as string[])].sort();
}

function normalizeAliases(
  aliases: Array<{ aliasType: string; aliasValue: string; issuer: string }> | undefined,
): PrincipalAliasEvidence[] {
  const keyed = new Map<string, PrincipalAliasEvidence>();
  for (const alias of aliases ?? []) {
    const type = alias.aliasType.trim();
    const value = alias.aliasValue.trim();
    const issuer = alias.issuer.trim();
    if (!type || !value) continue;
    keyed.set(`${type}\u0000${value}\u0000${issuer}`, { type, value, issuer });
  }
  return [...keyed.values()].sort(
    (left, right) =>
      left.type.localeCompare(right.type) ||
      left.value.localeCompare(right.value) ||
      left.issuer.localeCompare(right.issuer),
  );
}

function inferPopulation(
  userType: DpfSession["user"]["type"],
  principalKind: string | null | undefined,
): AuthPopulation {
  if (principalKind === "partner") return "partner";
  if (principalKind === "agent") return "ai-coworker";
  if (principalKind === "service" || principalKind === "edge-agent") return "service";
  return userType === "customer" ? "customer" : "workforce";
}

export function buildEffectiveAuthContext({
  user,
  grantedCapabilities,
  principal,
  principalId,
  population,
  employeeProfile,
  teamIds,
  accountScope,
  authentication,
  actingHumanUserId,
  actingAgentId,
  delegationGrantIds,
}: EffectiveAuthContextInput): EffectiveAuthContext {
  const directReportIds = normalizeStrings([
    ...(employeeProfile?.directReports?.map((report) => report.id) ?? []),
    ...(employeeProfile?.directReportIds ?? []),
  ]);
  const indirectReportIds = normalizeStrings(employeeProfile?.indirectReportIds);
  const resolvedPrincipalId =
    principal?.principalId ??
    principalId ??
    null;

  return {
    principalId: resolvedPrincipalId,
    principalAliases: normalizeAliases(principal?.aliases),
    population: population ?? inferPopulation(user.type, principal?.kind),
    platformRole: user.platformRole,
    isSuperuser: user.isSuperuser,
    employeeId: employeeProfile?.id ?? null,
    managerScope: employeeProfile
      ? {
          directReportIds,
          indirectReportIds,
        }
      : null,
    teamIds: normalizeStrings(teamIds),
    accountScope: {
      accountIds: normalizeStrings([
        ...(accountScope?.accountIds ?? []),
        user.type === "customer" ? user.accountId : null,
      ]),
      contactIds: normalizeStrings([
        ...(accountScope?.contactIds ?? []),
        user.type === "customer" ? user.contactId : null,
      ]),
      partnerAccountIds: normalizeStrings(accountScope?.partnerAccountIds),
    },
    sensitivityClearance: normalizePrincipalSensitivities(principal?.sensitivityClearance),
    authentication: {
      source: authentication?.source ?? "unknown",
      methods: normalizeStrings(authentication?.methods),
      contextClassReference: authentication?.contextClassReference?.trim() || null,
    },
    actingHumanUserId: actingHumanUserId?.trim() || (user.type === "admin" ? user.id : null),
    actingAgentId: actingAgentId?.trim() || null,
    delegationGrantIds: normalizeStrings(delegationGrantIds),
    grantedCapabilities: normalizeStrings(grantedCapabilities),
  };
}
