// Pure helpers for BI-PIR-6de01e8d — detect + recover when the model claims a
// delivered tool is unavailable. Kept out of agentic-loop.ts so the baselined
// module does not grow (module-size ratchet).

import type { ChatMessage } from "@/lib/ai-inference";
import { ISSUE_REPORT_STATUS, type IssueReportStatus } from "@/lib/quality/issue-report-status";

/**
 * Clause 2.6 platform path: detect when the agent's text asserts a tool
 * is unavailable AND that tool name appears in its delivered tool list.
 * Returns the offending tool name (or `(unspecified — generic refusal)`
 * for blanket "currently empty / pending" claims), or null.
 */
export function detectToolRefusedDespiteAvailability(
  responseText: string,
  deliveredTools: Array<{ name: string }>,
): string | null {
  if (!responseText) return null;
  const refusalPattern = /(?:not (?:available|enabled|granted|callable|in (?:my )?tool list|exposed)|isn['’]t (?:available|enabled|granted|callable|in (?:my )?tool list|exposed)|is missing|currently `?\[\]`?|pending (?:follow-on |grant)|don['’]t have (?:access|the ability))(?:\s+(?:in|for|to|yet|now|here))?/i;
  if (!refusalPattern.test(responseText)) return null;
  for (const tool of deliveredTools) {
    if (responseText.includes(tool.name)) return tool.name;
  }
  if (/currently `?\[\]`?|pending (?:follow-on |grant)/i.test(responseText)) {
    return "(unspecified — generic refusal)";
  }
  return null;
}

/**
 * Corrective nudge text when the model claims a delivered tool is unavailable
 * (BI-PIR-6de01e8d). Pure + unit-tested; used by the agentic-loop recovery path.
 */
export function buildToolRefusedDespiteAvailableNudge(args: {
  refusedToolName: string;
  deliveredToolNames: string[];
}): string {
  const toolHint =
    args.refusedToolName.startsWith("(unspecified")
      ? args.deliveredToolNames.slice(0, 12).join(", ")
      : args.refusedToolName;
  return (
    `CORRECTION: that tool IS available in this session (delivered tool list includes: ${toolHint}). ` +
    `Do not claim it is unavailable, missing, or ungranted. Call it now via a tool call and continue the task.`
  );
}

/**
 * When the model closed with zero tool calls after a false unavailability claim,
 * append the assistant text + a corrective user nudge so the loop can continue.
 * Returns null when recovery should not run (tools already executed, or stripped).
 */
export function appendToolRefusedRecoveryMessages(args: {
  messages: ChatMessage[];
  assistantContent: string;
  refusedToolName: string;
  deliveredTools: Array<{ name: string }>;
  executedToolCount: number;
  toolsStripped: boolean;
}): ChatMessage[] | null {
  if (args.executedToolCount > 0 || args.toolsStripped) return null;
  return [
    ...args.messages,
    { role: "assistant" as const, content: args.assistantContent },
    {
      role: "user" as const,
      content: buildToolRefusedDespiteAvailableNudge({
        refusedToolName: args.refusedToolName,
        deliveredToolNames: args.deliveredTools.map((t) => t.name),
      }),
    },
  ];
}

/**
 * Severity + status for the PlatformIssueReport a tool-refused-despite-
 * availability detection files (BI-09C2480B).
 *
 * The root-cause cluster already shipped (skip local fallback above the tool
 * threshold, cap the local tool surface, and issue an in-loop corrective
 * nudge). What remained was noise: the detector filed a high-severity OPEN
 * report on EVERY self-refusal, so a refusal the loop immediately self-corrected
 * still became one of the ~24 duplicate BI-PIR-* backlog items — the
 * issue-report-triage cron only projects OPEN reports into the backlog.
 *
 * When recovery ran, downgrade to a low-severity `resolved_locally` record: a
 * terminal status the triage runner and the dedupe-key path both skip, so it
 * survives for trend analysis without escalating to an operator-facing BI. An
 * unrecovered refusal (tools already executed, or tools stripped) still stands
 * as a high-severity OPEN contract issue.
 */
export function classifyToolRefusedIssue(args: { recovered: boolean }): {
  severity: "high" | "low";
  status: IssueReportStatus;
} {
  return args.recovered
    ? { severity: "low", status: ISSUE_REPORT_STATUS.RESOLVED_LOCALLY }
    : { severity: "high", status: ISSUE_REPORT_STATUS.OPEN };
}
