import type {
  CoworkerCapabilityNeedKind,
  CoworkerCapabilityNeedSeverity,
} from "@/lib/coworker-self-assessment/types";
import { LOCAL_TOOL_SELECTION_CLIFF } from "./context-economy-metrics";
import {
  evaluatePatternReadiness,
  normalizePatternText,
  patternDecisionScope,
  type WorkCasePatternBinding,
  type WorkPatternEvidenceRef,
  type WorkPatternMetadata,
  type WorkPatternScope,
  workPatternFingerprint,
} from "./work-pattern-types";

export type PatternObserverToolExecution = {
  id?: string;
  toolName: string;
  success: boolean;
  summary?: string | null;
  result?: unknown;
  taskRunId?: string | null;
  createdAt?: Date;
};

export type PatternObserverTurnMetric = {
  threadId?: string | null;
  agentMessageId?: string | null;
  ctxPeakTokens?: number | null;
  ctxWindowTokens?: number | null;
  toolSurfaceCount?: number | null;
  toolDefinitionTokens?: number | null;
  toolSurfaceExceedsLocalCliff?: boolean | null;
  toolSurfaceWindowShare?: number | null;
  toolSelectionAccuracy?: number | null;
  executedTools?: number | null;
  createdAt?: Date;
};

export type PatternObserverTaskRun = {
  taskRunId?: string | null;
  repeatedPatternKey?: string | null;
  a2aMetadata?: unknown;
  createdAt?: Date;
};

export type PatternObserverEnvelope = {
  id?: string;
  proposedActionKey?: string | null;
  approved?: boolean | null;
  status?: string | null;
  decision?: string | null;
  taskRunId?: string | null;
  workCaseRef?: string | null;
  caseType?: string | null;
  transitionKey?: string | null;
  governedActionKey?: string | null;
  authorityMode?: WorkCasePatternBinding["authorityMode"] | null;
  sponsorPrincipalId?: string | null;
  receiptPolicy?: WorkCasePatternBinding["receiptPolicy"] | null;
  createdAt?: Date;
};

export type ClassifiedPatternNeed = {
  kind: CoworkerCapabilityNeedKind;
  severity: CoworkerCapabilityNeedSeverity;
  need: string;
  blocks: string;
  evidenceJson: Record<string, unknown>;
  readinessJson: Record<string, unknown>;
  fingerprint: string;
};

export type ClassifiedPattern = {
  metadata: WorkPatternMetadata;
  need: ClassifiedPatternNeed;
};

export type PatternObserverInput = {
  agentId: string;
  routeContext?: string | null;
  since: Date;
  toolExecutions: PatternObserverToolExecution[];
  turnMetrics: PatternObserverTurnMetric[];
  taskRuns: PatternObserverTaskRun[];
  envelopes: PatternObserverEnvelope[];
  priorNeedFingerprints: Set<string>;
};

export type PatternObserverOutput = {
  needs: ClassifiedPatternNeed[];
  patterns: ClassifiedPattern[];
};

type CandidateSpec = {
  signal: string;
  kind: CoworkerCapabilityNeedKind;
  severity: CoworkerCapabilityNeedSeverity;
  scope: WorkPatternScope;
  need: string;
  blocks: string;
  evidenceJson: Record<string, unknown>;
  evidence: WorkPatternEvidenceRef[];
  workCaseBinding?: WorkCasePatternBinding;
  readinessJson?: Record<string, unknown>;
};

const GRANT_DENIAL_PATTERNS = [
  "forbidden_grant",
  "forbidden grant",
  "insufficient_token_scope",
];
const LOW_TOOL_ACCURACY_THRESHOLD = 0.7;

function resultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result === null || result === undefined) return "";
  try {
    return JSON.stringify(result);
  } catch {
    return "";
  }
}

function executionErrorText(execution: PatternObserverToolExecution): string {
  return [execution.summary ?? "", resultText(execution.result)].join(" ").trim();
}

function hasGrantDenial(text: string): boolean {
  const normalized = normalizePatternText(text).replace(/_/g, "_");
  return GRANT_DENIAL_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function pushCandidate(
  input: PatternObserverInput,
  spec: CandidateSpec,
  out: PatternObserverOutput,
): void {
  const fingerprint = workPatternFingerprint({
    agentId: input.agentId,
    routeContext: input.routeContext ?? null,
    kind: spec.kind,
    normalizedNeed: spec.need,
  });
  if (input.priorNeedFingerprints.has(fingerprint)) {
    return;
  }

  const decisionScope = patternDecisionScope(spec.scope);
  const metadata: WorkPatternMetadata = {
    patternKey: `${spec.signal}:${fingerprint}`,
    status: "observed",
    scope: spec.scope,
    version: 1,
    source: "observer",
    decisionScope,
    evidence: spec.evidence,
    candidate: {
      kind: spec.kind,
      need: spec.need,
      blocks: spec.blocks,
      fingerprint,
      evaluationMethod: "deterministic-pattern-observer",
    },
    workCaseBinding: spec.workCaseBinding,
    observedAt: input.since.toISOString(),
  };
  const readiness = evaluatePatternReadiness(metadata);

  const need: ClassifiedPatternNeed = {
    kind: spec.kind,
    severity: spec.severity,
    need: spec.need,
    blocks: spec.blocks,
    fingerprint,
    evidenceJson: {
      ...spec.evidenceJson,
      fingerprint,
      patternKey: metadata.patternKey,
      decisionScope,
    },
    readinessJson: {
      ...(spec.readinessJson ?? {}),
      ...readiness,
      activationProposed: false,
    },
  };

  out.needs.push(need);
  out.patterns.push({ metadata, need });
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = grouped.get(key) ?? [];
    list.push(item);
    grouped.set(key, list);
  }
  return grouped;
}

function evidenceFromExecution(execution: PatternObserverToolExecution): WorkPatternEvidenceRef {
  return {
    taskRunId: execution.taskRunId ?? undefined,
    toolExecutionId: execution.id,
  };
}

function evidenceFromMetric(metric: PatternObserverTurnMetric): WorkPatternEvidenceRef {
  return {
    threadId: metric.threadId ?? undefined,
    agentMessageId: metric.agentMessageId ?? undefined,
  };
}

function classifyRepeatedToolFailures(input: PatternObserverInput, out: PatternObserverOutput): void {
  const failures = input.toolExecutions.filter((execution) => execution.success === false);
  const grantGroups = groupBy(
    failures.filter((execution) => hasGrantDenial(executionErrorText(execution))),
    (execution) => execution.toolName,
  );

  for (const [toolName, executions] of grantGroups) {
    if (executions.length < 2) continue;
    const need = `Missing ${toolName} authority`;
    pushCandidate(
      input,
      {
        signal: "grant-denial",
        kind: "grant",
        severity: "important",
        scope: "route",
        need,
        blocks: `Repeated grant denials prevented ${input.agentId} from using ${toolName}.`,
        evidenceJson: {
          signal: "grant-denial",
          toolName,
          occurrences: executions.length,
          summaries: executions.map((execution) => execution.summary ?? null).filter(Boolean),
        },
        evidence: executions.slice(0, 3).map(evidenceFromExecution),
      },
      out,
    );
  }

  const nonGrantGroups = groupBy(
    failures.filter((execution) => !hasGrantDenial(executionErrorText(execution))),
    (execution) => `${execution.toolName}|${normalizePatternText(executionErrorText(execution))}`,
  );
  for (const [key, executions] of nonGrantGroups) {
    if (executions.length < 2) continue;
    const [toolName, normalizedError] = key.split("|");
    const need = `Stabilize repeated ${toolName} tool failure`;
    pushCandidate(
      input,
      {
        signal: "tool-failure",
        kind: "tool",
        severity: "important",
        scope: "route",
        need,
        blocks: `The same ${toolName} failure recurred and blocked reliable completion.`,
        evidenceJson: {
          signal: "tool-failure",
          toolName,
          normalizedError,
          occurrences: executions.length,
        },
        evidence: executions.slice(0, 3).map(evidenceFromExecution),
      },
      out,
    );
  }
}

function classifyTurnMetrics(input: PatternObserverInput, out: PatternObserverOutput): void {
  const overloads = input.turnMetrics.filter((metric) => {
    const count = metric.toolSurfaceCount ?? 0;
    return metric.toolSurfaceExceedsLocalCliff === true || count > LOCAL_TOOL_SELECTION_CLIFF;
  });
  if (overloads.length >= 2) {
    const maxToolSurfaceCount = Math.max(
      ...overloads.map((metric) => metric.toolSurfaceCount ?? 0),
    );
    const maxToolDefinitionTokens = Math.max(
      ...overloads.map((metric) => metric.toolDefinitionTokens ?? 0),
    );
    pushCandidate(
      input,
      {
        signal: "tool-surface-overload",
        kind: "tool",
        severity: "important",
        scope: "route",
        need: "Reduce repeated tool surface overload",
        blocks:
          "Repeated turns exceeded the local tool-selection cliff, which makes tool choice less reliable.",
        evidenceJson: {
          signal: "tool-surface-overload",
          occurrences: overloads.length,
          maxToolSurfaceCount,
          maxToolDefinitionTokens,
          localToolSelectionCliff: LOCAL_TOOL_SELECTION_CLIFF,
        },
        evidence: overloads.slice(0, 3).map(evidenceFromMetric),
      },
      out,
    );
  }

  const lowAccuracy = input.turnMetrics.filter((metric) => {
    const accuracy = metric.toolSelectionAccuracy;
    return (
      typeof accuracy === "number" &&
      accuracy < LOW_TOOL_ACCURACY_THRESHOLD &&
      (metric.executedTools ?? 0) > 0
    );
  });
  if (lowAccuracy.length >= 2) {
    const minToolSelectionAccuracy = Math.min(
      ...lowAccuracy.map((metric) => metric.toolSelectionAccuracy ?? 1),
    );
    pushCandidate(
      input,
      {
        signal: "low-tool-selection-accuracy",
        kind: "tool",
        severity: "important",
        scope: "route",
        need: "Improve repeated low tool-selection accuracy",
        blocks:
          "Repeated turns attempted tools but produced low tool-call success, making the route unreliable.",
        evidenceJson: {
          signal: "low-tool-selection-accuracy",
          occurrences: lowAccuracy.length,
          minToolSelectionAccuracy,
          threshold: LOW_TOOL_ACCURACY_THRESHOLD,
        },
        evidence: lowAccuracy.slice(0, 3).map(evidenceFromMetric),
      },
      out,
    );
  }
}

function isApprovedEnvelope(envelope: PatternObserverEnvelope): boolean {
  if (envelope.approved === true) return true;
  const status = normalizePatternText(envelope.status ?? "");
  const decision = normalizePatternText(envelope.decision ?? "");
  return status === "approved" || decision === "approved";
}

function workCaseBindingFromEnvelopes(envelopes: PatternObserverEnvelope[]): WorkCasePatternBinding | undefined {
  const envelope = envelopes.find((item) =>
    Boolean(
      item.workCaseRef ||
        item.caseType ||
        item.transitionKey ||
        item.governedActionKey ||
        item.authorityMode ||
        item.sponsorPrincipalId ||
        item.receiptPolicy,
    ),
  );
  if (!envelope) {
    return undefined;
  }

  return {
    caseType: envelope.caseType ?? undefined,
    transitionKey: envelope.transitionKey ?? undefined,
    governedActionKey: envelope.governedActionKey ?? undefined,
    authorityMode: envelope.authorityMode ?? undefined,
    sponsorPrincipalId: envelope.sponsorPrincipalId ?? undefined,
    receiptPolicy: envelope.receiptPolicy ?? undefined,
  };
}

function envelopeScope(binding: WorkCasePatternBinding | undefined): WorkPatternScope {
  if (!binding) {
    return "activity";
  }
  return binding.transitionKey ? "case-transition" : "case-type";
}

function classifyEnvelopes(input: PatternObserverInput, out: PatternObserverOutput): void {
  const approved = input.envelopes.filter(
    (envelope) => isApprovedEnvelope(envelope) && Boolean(envelope.proposedActionKey),
  );
  const grouped = groupBy(approved, (envelope) => envelope.proposedActionKey ?? "");

  for (const [actionKey, envelopes] of grouped) {
    if (!actionKey || envelopes.length < 2) continue;
    const workCaseBinding = workCaseBindingFromEnvelopes(envelopes);
    pushCandidate(
      input,
      {
        signal: "repeated-approved-envelope",
        kind: "convention",
        severity: "minor",
        scope: envelopeScope(workCaseBinding),
        need: `Review repeated approved action ${actionKey} for proceduralization`,
        blocks:
          "The same approved action keeps recurring and may deserve a governed procedure, not an automatic mutation.",
        evidenceJson: {
          signal: "repeated-approved-envelope",
          proposedActionKey: actionKey,
          occurrences: envelopes.length,
          envelopeIds: envelopes.map((envelope) => envelope.id).filter(Boolean),
        },
        evidence: envelopes.slice(0, 3).map((envelope) => ({
          taskRunId: envelope.taskRunId ?? undefined,
          receiptId: envelope.id,
          workCaseRef: envelope.workCaseRef ?? undefined,
        })),
        workCaseBinding,
        readinessJson: {
          activationProposed: false,
        },
      },
      out,
    );
  }
}

export function classifyPatternSignals(input: PatternObserverInput): PatternObserverOutput {
  const out: PatternObserverOutput = { needs: [], patterns: [] };
  classifyRepeatedToolFailures(input, out);
  classifyTurnMetrics(input, out);
  classifyEnvelopes(input, out);
  return out;
}
