export type TerminalToolPolicy = {
  writerToolName: string;
  readerToolNames: readonly string[];
  minimumSuccessfulReaderCalls: number;
  maximumReaderCalls: number;
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
): TerminalToolPolicy | null {
  const required = new Set(requiredToolNames);
  const readerToolNames = INITIATIVE_REVIEW_READER_NAMES.filter((name) => required.has(name));
  return readerToolNames.length > 0 && required.has(writerToolName)
    ? {
        writerToolName,
        readerToolNames,
        minimumSuccessfulReaderCalls: 1,
        maximumReaderCalls: 6,
      }
    : null;
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
  | { kind: "fail-closed"; message: string };

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
      kind: "fail-closed",
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
