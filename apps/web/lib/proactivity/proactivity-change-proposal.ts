import {
  PROACTIVITY_ACTIVITY_FAMILIES,
  type ProactivityActivityFamily,
  type ProactivityLevel,
  isProactivityLevel,
} from "./proactivity-types";

export const PROACTIVITY_CHANGE_ACTION = "propose_proactivity_change" as const;

export type ProactivityChangeScope = "agent" | "activity-family" | "route-context" | "organization";

export type ProactivityChangeProposalParameters = {
  kind: "proactivity-change";
  agentId?: string | null;
  activityFamily?: ProactivityActivityFamily | null;
  routeContext?: string | null;
  currentLevel: ProactivityLevel;
  proposedLevel: ProactivityLevel;
  scope: ProactivityChangeScope;
  rationale: string;
  evidenceRefs: Array<{ kind: string; id: string }>;
  spendImpact: string;
  authorityImpact: string;
};

export type BuildProactivityChangeProposalInput = Omit<
  ProactivityChangeProposalParameters,
  "kind" | "spendImpact" | "authorityImpact"
>;

export function buildProactivityChangeProposalParameters(
  input: BuildProactivityChangeProposalInput,
): { actionType: typeof PROACTIVITY_CHANGE_ACTION; parameters: ProactivityChangeProposalParameters } {
  return {
    actionType: PROACTIVITY_CHANGE_ACTION,
    parameters: {
      kind: "proactivity-change",
      ...input,
      spendImpact: "may increase monitoring and notification spend within existing authority",
      authorityImpact: "does not grant new tools, permissions, or approval bypasses",
    },
  };
}

export function parseProactivityChangeProposalParameters(
  value: unknown,
): ProactivityChangeProposalParameters | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.kind !== "proactivity-change") return null;
  if (!isProactivityLevel(record.currentLevel) || !isProactivityLevel(record.proposedLevel)) return null;
  if (!isScope(record.scope)) return null;
  const activityFamily = readOptionalActivityFamily(record.activityFamily);
  if (record.activityFamily != null && activityFamily == null) return null;

  return {
    kind: "proactivity-change",
    agentId: readOptionalString(record.agentId),
    activityFamily,
    routeContext: readOptionalString(record.routeContext),
    currentLevel: record.currentLevel,
    proposedLevel: record.proposedLevel,
    scope: record.scope,
    rationale: readString(record.rationale) ?? "A coworker recommends adjusting how persistently this work is watched.",
    evidenceRefs: readEvidenceRefs(record.evidenceRefs),
    spendImpact: readString(record.spendImpact) ?? "may change monitoring or notification spend within existing authority",
    authorityImpact: readString(record.authorityImpact) ?? "does not grant new tools, permissions, or approval bypasses",
  };
}

function isScope(value: unknown): value is ProactivityChangeScope {
  return value === "agent" || value === "activity-family" || value === "route-context" || value === "organization";
}

function readOptionalActivityFamily(value: unknown): ProactivityActivityFamily | null {
  return typeof value === "string" && (PROACTIVITY_ACTIVITY_FAMILIES as readonly string[]).includes(value)
    ? (value as ProactivityActivityFamily)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readOptionalString(value: unknown): string | null {
  if (value == null) return null;
  return readString(value);
}

function readEvidenceRefs(value: unknown): Array<{ kind: string; id: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const kind = readString(record.kind);
    const id = readString(record.id);
    return kind && id ? [{ kind, id }] : [];
  });
}
