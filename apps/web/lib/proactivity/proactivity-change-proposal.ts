import {
  PROACTIVITY_ACTIVITY_FAMILIES,
  type ProactivityActivityFamily,
  type ProactivityLevel,
  isProactivityLevel,
} from "./proactivity-types";

export const PROACTIVITY_CHANGE_ACTION = "propose_proactivity_change" as const;

export type ProactivityChangeScope = "agent" | "activity-family" | "route-context" | "organization";
export type ProactivityHardFloor = "money-out" | "public";

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
  /** Optional business boundary proposed by the coworker, such as recurring
   * bills below a stated amount. */
  operatingBoundary?: string;
  /** Evidence count used for an explainable self-tune proposal. */
  approvedUnchangedCount?: number;
  /** These approval floors survive every proactivity level. */
  hardFloors?: ProactivityHardFloor[];
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
      hardFloors: input.hardFloors ?? ["money-out", "public"],
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
    operatingBoundary: readOptionalString(record.operatingBoundary) ?? undefined,
    approvedUnchangedCount: readOptionalCount(record.approvedUnchangedCount),
    hardFloors: readHardFloors(record.hardFloors),
  };
}

export type ProactivitySelfTuneInput = {
  agentId: string;
  activityFamily: ProactivityActivityFamily;
  currentLevel: ProactivityLevel;
  approvedUnchangedCount: number;
  operatingBoundary: string;
  evidenceRefs: Array<{ kind: string; id: string }>;
  minimumCount?: number;
};

/** Turn repeated, unchanged approvals into a bounded proposal. The coworker can
 * suggest one step more initiative, but cannot change its own level or remove
 * the money/public approval floors. */
export function buildProactivitySelfTuneCandidate(
  input: ProactivitySelfTuneInput,
): ReturnType<typeof buildProactivityChangeProposalParameters> | null {
  const minimumCount = input.minimumCount ?? 5;
  if (input.approvedUnchangedCount < minimumCount || input.currentLevel === "assertive") {
    return null;
  }
  const proposedLevel: ProactivityLevel =
    input.currentLevel === "quiet" ? "balanced" : "assertive";
  return buildProactivityChangeProposalParameters({
    agentId: input.agentId,
    activityFamily: input.activityFamily,
    routeContext: null,
    currentLevel: input.currentLevel,
    proposedLevel,
    scope: "activity-family",
    rationale: `You approved my last ${input.approvedUnchangedCount} matching decisions unchanged. I can take more initiative for ${input.operatingBoundary}, while money leaving the business and anything public still come to you.`,
    evidenceRefs: input.evidenceRefs,
    operatingBoundary: input.operatingBoundary,
    approvedUnchangedCount: input.approvedUnchangedCount,
    hardFloors: ["money-out", "public"],
  });
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

function readOptionalCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function readHardFloors(value: unknown): ProactivityHardFloor[] {
  if (!Array.isArray(value)) return ["money-out", "public"];
  const floors = value.filter(
    (entry): entry is ProactivityHardFloor => entry === "money-out" || entry === "public",
  );
  return floors.length > 0 ? [...new Set(floors)] : ["money-out", "public"];
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
