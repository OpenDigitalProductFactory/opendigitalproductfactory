import { INITIATIVE_CORRECTABLE_ERRORS, INITIATIVE_DISPOSITION_GUIDANCE, INITIATIVE_WRITER_CORRECTION_LIMIT } from "../backlog/initiative-readiness/disposition-contract";
import { sourcePageEndLine, sourcePageNextLine } from "../source-page-lines";

export type TerminalToolPolicy = {
  writerToolName: string;
  readerToolNames: readonly string[];
  minimumSuccessfulReaderCalls: number;
  maximumReaderCalls: number;
  immutableReaderArguments?: ImmutableReaderArguments;
  terminalPhase?: "writer-only";
  persistedEvidenceAvailable?: boolean;
};

type TerminalProviderRoute = {
  deniedProviders?: string[];
  preferredProviderId?: string;
};

/** Route a bounded required-writer retry away from the provider that returned prose. */
export function rotateTerminalWriterProvider(
  options: TerminalProviderRoute,
  providerId: string,
): void {
  const noncompliantProvider = providerId.trim();
  if (!noncompliantProvider || noncompliantProvider === "unknown") return;
  options.deniedProviders = [
    ...new Set([...(options.deniedProviders ?? []), noncompliantProvider]),
  ];
  if (options.preferredProviderId === noncompliantProvider) {
    delete options.preferredProviderId;
  }
}

export type ImmutableReaderArguments = {
  repositoryFullName: string;
  path: string;
  version: string;
  expectedBlobId: string;
};

type ImmutableReaderArtifactRef = {
  repositoryFullName: string;
  path: string;
  commitSha: string;
  providerBlobId: string;
};

export type TerminalToolRecord = {
  name: string;
  args?: Record<string, unknown>;
  result: { success: boolean; error?: string; message?: string; data?: Record<string, unknown> };
};

const INITIATIVE_REVIEW_READER_NAMES = [
  "read_source_at_version",
  "search_source_at_version",
] as const;

export function createInitiativeReviewTerminalToolPolicy(
  writerToolName: string,
  requiredToolNames: readonly string[],
  artifactRef: ImmutableReaderArtifactRef,
): TerminalToolPolicy | null {
  const required = new Set(requiredToolNames);
  const readerToolNames = INITIATIVE_REVIEW_READER_NAMES.filter((name) => required.has(name));
  return readerToolNames.length > 0 && required.has(writerToolName)
    ? {
        writerToolName,
        readerToolNames,
        minimumSuccessfulReaderCalls: 1,
        maximumReaderCalls: 6,
        immutableReaderArguments: {
          repositoryFullName: artifactRef.repositoryFullName,
          path: artifactRef.path,
          version: artifactRef.commitSha,
          expectedBlobId: artifactRef.providerBlobId,
        },
      }
    : null;
}

/**
 * Resume a review that already persisted successful immutable evidence without
 * reopening the reader surface. The resumed turn is a bounded writer phase:
 * the model may propose only the independently selected governed assessment.
 */
export function enterTerminalWriterPhase(policy: TerminalToolPolicy): TerminalToolPolicy {
  return {
    ...policy,
    terminalPhase: "writer-only",
    persistedEvidenceAvailable: true,
  };
}

export type TerminalToolArgumentDisposition =
  | { kind: "allow"; arguments: Record<string, unknown> }
  | {
      kind: "refuse";
      result: { success: false; error: string; message: string };
    };

const IMMUTABLE_READER_IDENTITY_KEYS = ["repositoryFullName", "path", "version", "expectedBlobId"] as const;

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum;
}

/**
 * Treat the server-issued initiative-review binding as authority for immutable
 * source identity. Provider arguments may select only a bounded page within
 * that artifact; they cannot replace or broaden the bound artifact itself.
 */
export function normalizeTerminalToolArguments(
  policy: TerminalToolPolicy,
  toolName: string,
  providerArguments: Record<string, unknown>,
): TerminalToolArgumentDisposition {
  if (toolName !== "read_source_at_version" || !policy.readerToolNames.includes(toolName)) {
    return { kind: "allow", arguments: providerArguments };
  }

  const binding = policy.immutableReaderArguments;
  if (!binding) {
    return {
      kind: "refuse",
      result: {
        success: false,
        error: "terminal_reader_binding_missing",
        message: "The immutable evidence reader has no server-issued artifact binding.",
      },
    };
  }

  for (const key of IMMUTABLE_READER_IDENTITY_KEYS) {
    if (Object.hasOwn(providerArguments, key) && providerArguments[key] !== binding[key]) {
      return {
        kind: "refuse",
        result: {
          success: false,
          error: "terminal_reader_identity_conflict",
          message: `The provider-supplied ${key} conflicts with the server-issued artifact binding.`,
        },
      };
    }
  }

  const normalized: Record<string, unknown> = { ...binding };
  const cursor = providerArguments["cursor"];
  if (cursor !== undefined) {
    if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > 2_048) {
      return {
        kind: "refuse",
        result: {
          success: false,
          error: "terminal_reader_pagination_invalid",
          message: "The immutable evidence cursor must be a non-empty bounded string.",
        },
      };
    }
    normalized["cursor"] = cursor;
  }

  const boundedControls = [
    ["startLine", 1, Number.MAX_SAFE_INTEGER],
    ["maxLines", 1, 200],
    ["maxChars", 1, 3_200],
  ] as const;
  for (const [name, minimum, maximum] of boundedControls) {
    const value = providerArguments[name];
    if (value === undefined) continue;
    if (!boundedInteger(value, minimum, maximum)) {
      return {
        kind: "refuse",
        result: {
          success: false,
          error: "terminal_reader_pagination_invalid",
          message: `${name} is outside the immutable evidence pagination bounds.`,
        },
      };
    }
    normalized[name] = value;
  }

  return { kind: "allow", arguments: normalized };
}

export type TerminalToolProgress = {
  readerAttempts: number;
  successfulReaderCalls: number;
  evidenceAvailable: boolean;
  partialEvidence: boolean;
  continuationCursor: string | null;
  paginationInvalid: boolean;
  writerAttempted: boolean;
  readerBudgetExhausted: boolean;
};

export type TerminalToolCallDisposition =
  | { kind: "allow" }
  | {
      kind: "refuse";
      result: { success: false; error: string; message: string };
    };

export type TerminalTextExitDisposition =
  | { kind: "complete" }
  | { kind: "nudge"; message: string; allowedToolNames: string[] }
  | {
      kind: "input-required";
      reason: "missing-terminal-writer";
      writerToolName: string;
      message: string;
    };

export function summarizeTerminalToolProgress(
  policy: TerminalToolPolicy,
  records: readonly TerminalToolRecord[],
): TerminalToolProgress {
  const readers = new Set(policy.readerToolNames);
  const readerRecords = records.filter((record) => readers.has(record.name));
  if (policy.persistedEvidenceAvailable) {
    return {
      readerAttempts: readerRecords.length,
      successfulReaderCalls: Math.max(
        policy.minimumSuccessfulReaderCalls,
        readerRecords.filter((record) => record.result.success).length,
      ),
      evidenceAvailable: true,
      partialEvidence: false,
      continuationCursor: null,
      paginationInvalid: false,
      writerAttempted: records.some((record) => record.name === policy.writerToolName),
      readerBudgetExhausted: readerRecords.length >= policy.maximumReaderCalls,
    };
  }
  const successfulReaderCalls = readerRecords.filter((record) => record.result.success).length;
  const binding = policy.immutableReaderArguments;
  let attemptActive = false;
  let expectedCursor: string | null = null;
  let expectedStartLine: number | null = null;
  let expectedTotalLines: number | null = null;
  let evidenceComplete = false;
  let paginationInvalid = false;
  const seenCursors = new Set<string>();

  for (const record of readerRecords) {
    if (record.name !== "read_source_at_version" || !record.result.success) continue;
    const data = record.result.data;
    const validIdentity = binding && data
      && data["repositoryFullName"] === binding.repositoryFullName
      && data["path"] === binding.path
      && data["version"] === binding.version
      && data["blobId"] === binding.expectedBlobId;
    const startLine = data?.["startLine"];
    const endLine = data?.["endLine"];
    const totalLines = data?.["totalLines"];
    const hasMore = data?.["hasMore"];
    const nextCursor = data?.["nextCursor"];
    const content = data?.["content"];
    const hasContent = typeof content === "string";
    const validPage = validIdentity
      && boundedInteger(startLine, 1, Number.MAX_SAFE_INTEGER)
      && boundedInteger(endLine, 1, Number.MAX_SAFE_INTEGER)
      && boundedInteger(totalLines, 1, Number.MAX_SAFE_INTEGER)
      && endLine >= startLine
      && endLine <= totalLines
      && typeof hasMore === "boolean"
      && (hasMore ? (endLine < totalLines || (hasContent && !content.endsWith("\n"))) : endLine === totalLines)
      && (!hasContent || (content.length > 0
        && sourcePageEndLine(startLine, content) === endLine))
      && (hasMore ? typeof nextCursor === "string" && nextCursor.length > 0 : nextCursor === null);
    if (!validPage) {
      attemptActive = false;
      expectedCursor = null;
      expectedStartLine = null;
      expectedTotalLines = null;
      evidenceComplete = false;
      paginationInvalid = true;
      continue;
    }

    const suppliedCursor = record.args?.["cursor"];
    const suppliedStartLine = record.args?.["startLine"];
    const startsAtBeginning = startLine === 1
      && suppliedCursor === undefined
      && (suppliedStartLine === undefined || suppliedStartLine === 1);
    if (startsAtBeginning) {
      attemptActive = true;
      expectedTotalLines = totalLines;
      paginationInvalid = false;
      seenCursors.clear();
    } else if (!attemptActive
      || typeof suppliedCursor !== "string"
      || suppliedCursor !== expectedCursor
      || startLine !== expectedStartLine
      || totalLines !== expectedTotalLines) {
      attemptActive = false;
      expectedCursor = null;
      expectedStartLine = null;
      expectedTotalLines = null;
      evidenceComplete = false;
      paginationInvalid = true;
      continue;
    }

    if (hasMore) {
      if (seenCursors.has(nextCursor as string)) {
        attemptActive = false;
        expectedCursor = null;
        evidenceComplete = false;
        paginationInvalid = true;
        continue;
      }
      seenCursors.add(nextCursor as string);
      expectedCursor = nextCursor as string;
      expectedStartLine = hasContent ? sourcePageNextLine(endLine, content) : endLine + 1;
      evidenceComplete = false;
    } else {
      expectedCursor = null;
      expectedStartLine = null;
      evidenceComplete = attemptActive;
      attemptActive = false;
    }
  }
  return {
    readerAttempts: readerRecords.length,
    successfulReaderCalls,
    evidenceAvailable: evidenceComplete,
    partialEvidence: attemptActive && expectedCursor !== null,
    continuationCursor: attemptActive ? expectedCursor : null,
    paginationInvalid,
    writerAttempted: records.some((record) => record.name === policy.writerToolName),
    readerBudgetExhausted: readerRecords.length >= policy.maximumReaderCalls,
  };
}

export function resolveTerminalToolCall(
  policy: TerminalToolPolicy,
  records: readonly TerminalToolRecord[],
  toolName: string,
): TerminalToolCallDisposition {
  const progress = summarizeTerminalToolProgress(policy, records);
  if (toolName === policy.writerToolName && progress.writerAttempted && !canCorrectTerminalWriter(policy, records)) {
    return {
      kind: "refuse",
      result: {
        success: false,
        error: "terminal_writer_already_attempted",
        message: "The sole governed writer has already been attempted in this turn. No second writer call is allowed.",
      },
    };
  }
  if (policy.terminalPhase === "writer-only" && policy.readerToolNames.includes(toolName)) {
    // BI-69BBC446 follow-up. This refusal used to read "Immutable evidence is
    // already persisted. Call <writer> now." A reviewer took six refusals in a
    // row and reported to a human: "BLOCKED - immutable evidence unavailable;
    // all six evidence-reader attempts failed" - the exact inverse of what the
    // refusal said. It then wrote prose instead of its verdict, and the run
    // ended with no receipt. A success condition phrased as an error is read as
    // an error, so this states the state first, the consequence second, and
    // never uses a word the model can hear as "missing".
    return {
      kind: "refuse",
      result: {
        success: false,
        error: "terminal_writer_phase_reader_refused",
        message:
          `SUCCESS, NOT A FAILURE: you already read the bound artifact in full and it is persisted for this `
          + `turn. Nothing is missing and there is nothing left to retrieve. Re-reading is declined only `
          + `because it would be redundant. You have everything you need to judge. `
          + `Call ${policy.writerToolName} now with your assessment - a pass and a fail are equally valid. `
          + `If you answer with prose instead, this run ends with NO receipt recorded and your review is lost.`,
      },
    };
  }
  if (toolName === policy.writerToolName && !progress.evidenceAvailable) {
    return {
      kind: "refuse",
      result: {
        success: false,
        error: progress.partialEvidence
          ? "terminal_writer_requires_complete_evidence"
          : "terminal_writer_requires_evidence",
        message: progress.partialEvidence
          ? `Continue the bound immutable read with cursor ${progress.continuationCursor} before recording the governed assessment.`
          : "Read the bound immutable evidence from the beginning before recording the governed assessment.",
      },
    };
  }
  if (policy.readerToolNames.includes(toolName) && progress.evidenceAvailable) {
    return {
      kind: "refuse",
      result: {
        success: false,
        error: "terminal_evidence_complete",
        message: `The complete bound artifact has been read. Call ${policy.writerToolName} now.`,
      },
    };
  }
  if (policy.readerToolNames.includes(toolName) && progress.readerBudgetExhausted) {
    return {
      kind: "refuse",
      result: {
        success: false,
        error: "terminal_reader_budget_exhausted",
        message: "The bounded evidence budget ended before complete traversal. No governed disposition can be recorded.",
      },
    };
  }
  return { kind: "allow" };
}

function providerToolName(tool: Record<string, unknown>): string | null {
  const fn = tool["function"];
  return fn && typeof fn === "object" && !Array.isArray(fn)
    ? String((fn as Record<string, unknown>)["name"] ?? "") || null
    : null;
}

function writerReachedTerminalBoundary(
  policy: TerminalToolPolicy,
  records: readonly TerminalToolRecord[],
): boolean {
  return records.some((record) => record.name === policy.writerToolName && (
    record.result.success
    || (
      record.result.error === "approval_required"
      && typeof record.result.data?.["envelopeId"] === "string"
      && record.result.data["envelopeId"].trim().length > 0
    )
  ));
}

function canCorrectTerminalWriter(policy: TerminalToolPolicy, records: readonly TerminalToolRecord[]): boolean {
  const attempts = records.filter((record) => record.name === policy.writerToolName);
  const last = attempts.at(-1);
  return attempts.length > 0 && attempts.length <= INITIATIVE_WRITER_CORRECTION_LIMIT
    && !writerReachedTerminalBoundary(policy, records)
    && last?.result.success === false
    && INITIATIVE_CORRECTABLE_ERRORS.has(last.result.error ?? "");
}

function correctionReminder(policy: TerminalToolPolicy, records: readonly TerminalToolRecord[]): string {
  const last = records.filter((record) => record.name === policy.writerToolName).at(-1)!;
  return `The canonical writer rejected the assessment: ${last.result.error}: ${last.result.message ?? "Receipt validation failed."} `
    + `Use the already-read immutable evidence to independently correct the proposal and call ${policy.writerToolName}. `
    + INITIATIVE_DISPOSITION_GUIDANCE;
}

export function terminalWriterFailureMessage(policy: TerminalToolPolicy, records: readonly TerminalToolRecord[]): string {
  const last = records.filter((record) => record.name === policy.writerToolName).at(-1);
  return last
    ? `${policy.writerToolName} did not persist a valid receipt. Last result: ${last.result.error ?? "unverified-writer-result"}: ${last.result.message ?? "No verifiable receipt returned."} Automatic correction for this attempt has stopped. Resolve this error before resuming the same TaskRun; do not advance its gate.`
    : `The provider did not invoke required writer ${policy.writerToolName}. Resume the same TaskRun with a provider that supports the required tool call; no receipt was created.`;
}

export function selectTerminalToolSurface(
  providerTools: readonly Record<string, unknown>[],
  allowedToolNames: readonly string[],
): Array<Record<string, unknown>> {
  const allowed = new Set(allowedToolNames);
  return providerTools.filter((tool) => {
    const name = providerToolName(tool);
    return name !== null && allowed.has(name);
  });
}

export function applyTerminalToolSurface(
  policy: TerminalToolPolicy,
  records: readonly TerminalToolRecord[],
  providerTools: readonly Record<string, unknown>[],
): Array<Record<string, unknown>> {
  const progress = summarizeTerminalToolProgress(policy, records);
  if (progress.writerAttempted) return canCorrectTerminalWriter(policy, records)
    ? selectTerminalToolSurface(providerTools, [policy.writerToolName]) : [];
  if (policy.terminalPhase === "writer-only") {
    return selectTerminalToolSurface(providerTools, [policy.writerToolName]);
  }
  if (progress.evidenceAvailable) return selectTerminalToolSurface(providerTools, [policy.writerToolName]);
  if (progress.readerBudgetExhausted) return [];
  if (progress.partialEvidence) return selectTerminalToolSurface(providerTools, ["read_source_at_version"]);
  return [...providerTools];
}

export function buildTerminalToolReminder(
  policy: TerminalToolPolicy,
  records: readonly TerminalToolRecord[],
): string {
  const progress = summarizeTerminalToolProgress(policy, records);
  if (progress.writerAttempted) {
    if (canCorrectTerminalWriter(policy, records)) return correctionReminder(policy, records);
    return terminalWriterFailureMessage(policy, records);
  }
  if (policy.terminalPhase === "writer-only") {
    return `Immutable evidence is already persisted. Call ${policy.writerToolName} now; do not read again or respond with prose first.`;
  }
  if (progress.evidenceAvailable) return `Call ${policy.writerToolName} now; complete immutable evidence is available.`;
  if (progress.readerBudgetExhausted) return "Immutable traversal is incomplete and the bounded reader budget is exhausted; do not record a disposition.";
  if (progress.partialEvidence) return `Continue read_source_at_version with cursor ${progress.continuationCursor}; the writer remains unavailable until traversal completes.`;
  const remaining = policy.maximumReaderCalls - progress.readerAttempts;
  return `Use the immutable evidence readers before ${policy.writerToolName}. ${remaining} bounded evidence calls remain; reserve the terminal step for the governed writer.`;
}

export function resolveTerminalTextExit(
  policy: TerminalToolPolicy,
  records: readonly TerminalToolRecord[],
  nudgesUsed: number,
): TerminalTextExitDisposition {
  const progress = summarizeTerminalToolProgress(policy, records);
  if (writerReachedTerminalBoundary(policy, records)) return { kind: "complete" };
  if (progress.writerAttempted) {
    if (canCorrectTerminalWriter(policy, records) && nudgesUsed < INITIATIVE_WRITER_CORRECTION_LIMIT) return {
      kind: "nudge", allowedToolNames: [policy.writerToolName], message: correctionReminder(policy, records),
    };
    return {
      kind: "input-required",
      reason: "missing-terminal-writer",
      writerToolName: policy.writerToolName,
      message: terminalWriterFailureMessage(policy, records),
    };
  }
  if (progress.readerBudgetExhausted && !progress.evidenceAvailable) {
    return {
      kind: "input-required",
      reason: "missing-terminal-writer",
      writerToolName: policy.writerToolName,
      message: "Immutable evidence traversal is incomplete and its bounded read budget is exhausted. No receipt was created.",
    };
  }
  if (nudgesUsed > 0) {
    return {
      kind: "input-required",
      reason: "missing-terminal-writer",
      writerToolName: policy.writerToolName,
      message: `The provider did not honor the required writer tool-call contract for ${policy.writerToolName}. The same TaskRun remains resumable. No receipt was created.`,
    };
  }
  if (!progress.evidenceAvailable) {
    const partial = progress.partialEvidence;
    return {
      kind: "nudge",
      allowedToolNames: partial ? ["read_source_at_version"] : [...policy.readerToolNames],
      message: partial
        ? `Continue read_source_at_version with cursor ${progress.continuationCursor}. Do not assess the artifact before the terminal page returns hasMore=false.`
        : "Read the bound immutable evidence from the beginning now. Do not finish from prompt context alone.",
    };
  }
  return {
    kind: "nudge",
    allowedToolNames: [policy.writerToolName],
    message:
      `Evidence retrieval is complete and succeeded - nothing is missing and you have everything you need to `
      + `judge. Call ${policy.writerToolName} now with your independent assessment; a pass and a fail are `
      + `equally valid outcomes. Answering with prose instead of the tool call ends this run with NO receipt `
      + `recorded.`,
  };
}
