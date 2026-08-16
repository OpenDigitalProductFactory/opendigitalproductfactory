// External web access for scheduled (unattended) coworker turns — BI-0A59F936.
//
// The interactive path resolves external access from a per-session toggle the
// owner flips in the chat panel. A scheduled turn has no human attached, so the
// toggle's job falls to the coworker's standing grant: an agent granted
// `web_search` gets its external tools on scheduled turns too. Before this
// module existed the scheduler passed nothing, and getAvailableTools stripped
// every `requiresExternalAccess` tool (search_public_web AND the keyless
// fetch_public_website) from EVERY scheduled turn regardless of grants —
// recurring "research" tasks ran blind and reported ok.
//
// Deliberately independent of USE_UNIFIED_COWORKER: unified mode short-circuits
// the external-access gate for interactive turns, and behaviour here must be
// identical whichever way that flag points.

export type ScheduledTurnExternalAccess = {
  enabled: boolean;
  reason: "web-search-grant" | "no-web-search-grant";
};

/**
 * Resolve the external-access posture for a scheduled turn from the agent's
 * standing grants (DB-first via AgentToolGrant, JSON registry fallback).
 */
export async function resolveScheduledTurnExternalAccess(
  agentId: string,
): Promise<ScheduledTurnExternalAccess> {
  const { getAgentToolGrantsAsync } = await import("@/lib/tak/agent-grants");
  const grants = await getAgentToolGrantsAsync(agentId);
  const enabled = grants.includes("web_search");
  return { enabled, reason: enabled ? "web-search-grant" : "no-web-search-grant" };
}

// Task kinds whose whole purpose is watching external signals. A run of these
// without web tools is not a degraded run — it is no run at all.
const RESEARCH_TASK_KINDS = new Set([
  "product-intelligence-watch",
  "business-analysis-watch",
]);

// Prompt shapes that unambiguously ask for outside-world material. Deliberately
// conservative: a false negative degrades to today's behaviour (the run
// proceeds), while a false positive would fail a task that never needed the web.
const RESEARCH_PROMPT_PATTERNS: RegExp[] = [
  /\bresearch\b/i,
  /\bcompetitors?\b|\bcompetitive\s+(landscape|analysis|intelligence)\b/i,
  /\bmarket\s+(scan|watch|trends?|intelligence|research)\b/i,
  /\bindustry\s+(news|trends?|reports?)\b/i,
  /\b(search|browse|scan|monitor|watch|check)\b[^.\n]{0,40}\b(web|internet|online|news)\b/i,
  /\bweb\s+(search|research)\b/i,
  /https?:\/\//i,
  /\bfetch\b[^.\n]{0,40}\b(url|website|page|site)\b/i,
];

/** Whether a scheduled task's declared kind or prompt requires web research. */
export function scheduledTaskNeedsExternalResearch(input: {
  taskKind?: string | null;
  prompt: string;
}): boolean {
  if (input.taskKind && RESEARCH_TASK_KINDS.has(input.taskKind)) return true;
  return RESEARCH_PROMPT_PATTERNS.some((pattern) => pattern.test(input.prompt));
}

export class ScheduledResearchUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduledResearchUnavailableError";
  }
}

/**
 * Fail loudly BEFORE the turn runs when a task needs research the turn cannot
 * perform. Completing "ok" with confident, unresearched output is the failure
 * mode this guards against; a recorded error the owner can act on is strictly
 * better than a green run that did not do the job.
 */
export function assertScheduledResearchCapability(input: {
  taskKind?: string | null;
  prompt: string;
  agentId: string;
  /** Full authorized surface for the turn — attached AND deferred tools. */
  tools: Array<{ requiresExternalAccess?: boolean }>;
  externalAccess: ScheduledTurnExternalAccess;
}): void {
  if (!scheduledTaskNeedsExternalResearch(input)) return;
  const hasExternalTool = input.tools.some((tool) => tool.requiresExternalAccess === true);
  if (hasExternalTool) return;
  const cause =
    input.externalAccess.reason === "no-web-search-grant"
      ? `the coworker "${input.agentId}" does not hold the web_search grant`
      : `no web tools survived tool resolution for "${input.agentId}"`;
  throw new ScheduledResearchUnavailableError(
    `This task requires web research, but ${cause}. ` +
      `Grant web access to this coworker (Platform → AI Coworkers), or reword the task so it does not depend on outside information. ` +
      `Refusing to run blind: a confident answer produced without research would be worse than this error.`,
  );
}
