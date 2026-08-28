export type TerminalToolPolicy = {
  writerToolName: string;
  readerToolNames: readonly string[];
  minimumSuccessfulReaderCalls: number;
  maximumReaderCalls: number;
  immutableReaderArguments?: ImmutableReaderArguments;
};

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
  result: { success: boolean };
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
  const successfulReaderCalls = readerRecords.filter((record) => record.result.success).length;
  return {
    readerAttempts: readerRecords.length,
    successfulReaderCalls,
    evidenceAvailable: successfulReaderCalls >= policy.minimumSuccessfulReaderCalls,
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
  if (toolName === policy.writerToolName && !progress.evidenceAvailable) {
    return {
      kind: "refuse",
      result: {
        success: false,
        error: "terminal_writer_requires_evidence",
        message: "Read the bound immutable evidence before recording the governed assessment.",
      },
    };
  }
  if (policy.readerToolNames.includes(toolName) && progress.readerBudgetExhausted) {
    return {
      kind: "refuse",
      result: {
        success: false,
        error: "terminal_reader_budget_exhausted",
        message: `The bounded evidence budget is complete. Call ${policy.writerToolName} now.`,
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
  return progress.readerBudgetExhausted && !progress.writerAttempted
    ? selectTerminalToolSurface(providerTools, [policy.writerToolName])
    : [...providerTools];
}

export function buildTerminalToolReminder(
  policy: TerminalToolPolicy,
  records: readonly TerminalToolRecord[],
): string {
  const progress = summarizeTerminalToolProgress(policy, records);
  if (progress.readerBudgetExhausted) return `Call ${policy.writerToolName} now; the bounded evidence budget is complete.`;
  const remaining = policy.maximumReaderCalls - progress.readerAttempts;
  return `Use the immutable evidence readers before ${policy.writerToolName}. ${remaining} bounded evidence calls remain; reserve the terminal step for the governed writer.`;
}

export function resolveTerminalTextExit(
  policy: TerminalToolPolicy,
  records: readonly TerminalToolRecord[],
  nudgesUsed: number,
): TerminalTextExitDisposition {
  const progress = summarizeTerminalToolProgress(policy, records);
  if (progress.writerAttempted) return { kind: "complete" };
  if (nudgesUsed > 0) {
    return {
      kind: "input-required",
      reason: "missing-terminal-writer",
      writerToolName: policy.writerToolName,
      message: "The independent review stopped without recording a governed assessment. No receipt was created.",
    };
  }
  if (!progress.evidenceAvailable) {
    return {
      kind: "nudge",
      allowedToolNames: [...policy.readerToolNames],
      message: "Read the bound immutable evidence now. Do not finish from prompt context alone.",
    };
  }
  return {
    kind: "nudge",
    allowedToolNames: [policy.writerToolName],
    message: `Evidence retrieval is complete. Call ${policy.writerToolName} now with your independent assessment; do not respond with prose first.`,
  };
}
