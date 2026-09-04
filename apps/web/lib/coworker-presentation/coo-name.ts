export const COO_NAME_MAX_LENGTH = 40;

export const COO_NAME_SUGGESTION_GROUPS = [
  { label: "Role-like", names: ["First Officer", "Number Two"] },
  { label: "Mission-inspired", names: ["General", "Navigator"] },
  { label: "Relaxed", names: ["Alex", "Sam"] },
] as const;

type ValidationOptions = {
  employeeDisplayNames?: readonly string[];
};

export type CooNameValidation =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

const RESERVED_NAMES = new Map<string, string>([
  ["system", "That name is reserved for an internal system identity."],
  ["onboarding coo", "That name belongs to the distinct setup coworker."],
  ["ceo", "That name implies an accountable owner role. Choose a conversational name instead."],
  ["chief executive officer", "That name implies an accountable owner role. Choose a conversational name instead."],
  ["owner", "That name implies an accountable owner role. Choose a conversational name instead."],
  ["founder", "That name implies an accountable owner role. Choose a conversational name instead."],
  ["accountable officer", "That name implies an accountable owner role. Choose a conversational name instead."],
]);

function normalizeForComparison(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase();
}

export function normalizeCooConversationalName(value: string | null | undefined): string | null {
  const normalized = value?.normalize("NFKC").trim().replace(/\s+/gu, " ") ?? "";
  if (!normalized || normalizeForComparison(normalized) === "coo") return null;
  return normalized;
}

export function validateCooConversationalName(
  value: string | null | undefined,
  options: ValidationOptions = {},
): CooNameValidation {
  const normalized = normalizeCooConversationalName(value);
  if (normalized === null) return { ok: true, value: null };

  if (/[\u0000-\u001f\u007f-\u009f]/u.test(normalized)) {
    return { ok: false, error: "The conversational name cannot contain control characters." };
  }
  if (Array.from(normalized).length > COO_NAME_MAX_LENGTH) {
    return { ok: false, error: `Keep the conversational name to ${COO_NAME_MAX_LENGTH} characters or fewer.` };
  }
  if (!/[\p{L}\p{N}]/u.test(normalized)) {
    return { ok: false, error: "Enter a name containing at least one letter or number." };
  }

  const comparison = normalizeForComparison(normalized);
  if (/^agt(?:-|_)/u.test(comparison)) {
    return { ok: false, error: "That looks like an internal coworker identifier." };
  }
  const reservedError = RESERVED_NAMES.get(comparison);
  if (reservedError) return { ok: false, error: reservedError };

  const employeeNames = options.employeeDisplayNames ?? [];
  if (employeeNames.some((employeeName) => normalizeForComparison(employeeName.trim()) === comparison)) {
    return {
      ok: false,
      error: "Choose a name that is not already used by a person in your organization.",
    };
  }

  return { ok: true, value: normalized };
}

export function isStandingCooAgentId(agentId: string | null | undefined): boolean {
  return agentId === "AGT-ORCH-000" || agentId === "coo";
}

export type CoworkerPresentationIdentity = {
  primaryName: string;
  roleName: string | null;
};

export function resolveCooPresentationIdentity({
  agentId,
  canonicalName,
  conversationalName,
}: {
  agentId: string | null | undefined;
  canonicalName: string;
  conversationalName: string | null | undefined;
}): CoworkerPresentationIdentity {
  if (!isStandingCooAgentId(agentId)) return { primaryName: canonicalName, roleName: null };
  const primaryName = normalizeCooConversationalName(conversationalName);
  return primaryName
    ? { primaryName, roleName: "AI COO" }
    : { primaryName: canonicalName, roleName: null };
}

export function resolveCooPresentationName({
  agentId,
  canonicalName,
  conversationalName,
}: {
  agentId: string | null | undefined;
  canonicalName: string;
  conversationalName: string | null | undefined;
}): string {
  const identity = resolveCooPresentationIdentity({ agentId, canonicalName, conversationalName });
  return identity.roleName ? `${identity.primaryName} · ${identity.roleName}` : identity.primaryName;
}

export function presentStandingCoo<T extends { agentId: string; agentName: string }>(
  agent: T,
  conversationalName: string | null | undefined,
): T {
  const agentName = resolveCooPresentationName({
    agentId: agent.agentId,
    canonicalName: agent.agentName,
    conversationalName,
  });
  return agentName === agent.agentName ? agent : { ...agent, agentName };
}
