// apps/web/lib/build/build-orchestrator.ts
// Build Process Orchestrator: plan parsing, dependency-aware parallel dispatch,
// result synthesis, and process-defined communication.
// EP-BUILD-ORCHESTRATOR — "Do what Claude Code does"

import { prisma } from "@dpf/db";
import { isUsageLimitDispatchOutput } from "@/lib/build/dispatch-attempts";
import {
  runVerificationRepairLoop,
  verificationNeedsRepair,
  VERIFICATION_REPAIR_MAX_ROUNDS,
} from "@/lib/build/verification-repair";
import { runAgenticLoop, type AgenticResult } from "@/lib/agentic-loop";
import { agentEventBus, type AgentEvent } from "@/lib/agent-event-bus";
import { getAvailableTools, toolsToOpenAIFormat } from "@/lib/mcp-tools";
import { getBuildContextSection } from "@/lib/build/build-agent-prompts";
import { appendGovernedSpecialistCorpus } from "@/lib/build/build-specialist-corpus";
import {
  buildDependencyGraph,
  type AssignedTask,
} from "./task-dependency-graph";
import { normalizeBuildPlanPaths } from "./build-plan-paths";
import {
  buildSpecialistPromptWithProvenance,
  SPECIALIST_AGENT_IDS,
  SPECIALIST_MODEL_REQS,
  SPECIALIST_TOOLS,
} from "./specialist-prompts";
import { isMissingSandboxToolSurfaceOutput } from "./sandbox-tool-surface-detector";
import { classifyBlockedCause } from "./blocked-cause";
import type { SpecialistRole } from "./task-dependency-graph";
import type {
  BuildPlanDoc,
  BuildDeliberationPhase,
  BuildDeliberationSummary,
  BuildDeliberationSummaryEntry,
} from "@/lib/explore/feature-build-types";
import { mergeHappyPathStateIntoPlan } from "@/lib/explore/feature-build-types";
import type { CodexResult } from "./codex-dispatch";
import type { ClaudeResult } from "./claude-dispatch";
import { getBuildStudioConfig, type BuildStudioDispatchConfig } from "./build-studio-config";
import { formatBuildEngineSelectionEvidence } from "./build-engine-selection-runtime";
import { classifyRetrySafePreDispatchFailure, type BuildEngineCandidate } from "./build-engine-selection";
import { assertAgentProviderCompatibility, type BuildAgentId } from "./sandbox/agent-runner-types";
import { getBuildAgentRunner } from "./sandbox/agents";
import { getBuildExecutionProvider } from "./sandbox/providers";
import type { BuildExecutionProviderId } from "./sandbox/provider-types";
import type { ReviewResult } from "@/lib/feature-build-types";
import { queueBuildReviewVerification } from "@/lib/build-review-verification-trigger";
import {
  buildReviewBranchArtifacts,
  mapCompactSummaryToBuildEntry,
  deriveReviewRiskLevel,
  artifactTypeForPhase,
  type ReviewBranchInput,
} from "./build-reviewers";
import { formatCoworkerOperationalCloseout } from "@/lib/tak/coworker-interaction-contract";

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_DURATION_ORCHESTRATOR_MS = 2_400_000; // 40 minutes — tasks average 2 min, 14-task builds need ~30 min
const MAX_SPECIALIST_RETRIES = 2;
export const MAX_SCOPED_TASK_CONTEXT_CHARS = 8_000;
const MAX_TASK_ARTIFACT_SUMMARY_CHARS = 3_200;
const MAX_TASK_ARTIFACT_ENTRY_CHARS = 320;

export function resolveBuildProviderRunner(input: {
  agentId?: BuildAgentId;
  providerId?: BuildExecutionProviderId;
}) {
  const provider = getBuildExecutionProvider(input.providerId ?? "local-docker");
  const runner = getBuildAgentRunner(input.agentId ?? "codex");
  assertAgentProviderCompatibility(runner.capabilities(), provider.capabilities());
  return { provider, runner };
}

const ROLE_LABELS: Record<SpecialistRole, string> = {
  "data-architect": "Data Architect",
  "software-engineer": "Software Engineer",
  "frontend-engineer": "Frontend Engineer",
  "documentation-specialist": "Documentation Specialist",
  "qa-engineer": "QA",
};

export function formatPhaseMessage(role: SpecialistRole, outcome: string): string {
  return `${ROLE_LABELS[role]} complete: ${outcome}`;
}

export type BuildSummary = {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  specialistSummaries: Array<{ role: SpecialistRole; taskTitle: string; outcome: string; status: SpecialistOutcome }>;
};

/**
 * Sanitize raw Codex CLI / agentic loop output for user display.
 * Strips leaked system prompt fragments, internal instructions, and
 * token usage lines — extracts only the meaningful result summary.
 */
function sanitizeSpecialistOutput(raw: string): string {
  // Common system prompt fragments that leak through Codex CLI output
  const NOISE_PATTERNS = [
    // Codex CLI stderr banner (captured when 2>&1 was used; safety net)
    /Reading (?:additional )?(?:input|prompt) from stdin\.{0,3}\s*/gi,
    /OpenAI Codex v[\d.]+[^]*?(?=\n\n|codex\n|user\n)/gi,
    /^-{4,}$/gm,
    /^workdir:.*$/gm,
    /^model:.*$/gm,
    /^provider:.*$/gm,
    /^approval:.*$/gm,
    /^sandbox:.*$/gm,
    /^reasoning (?:effort|summaries):.*$/gm,
    /^session id:.*$/gm,
    /^user$/gm,
    /^codex$/gm,
    /^warning:.*bubblewrap.*$/gmi,
    // System prompt fragments that leak through
    /You are a (?:data architect|software engineer|frontend engineer|QA engineer)[^]*?(?=\n\n|\n[A-Z])/gi,
    /HEURISTICS:[\s\S]*?(?=\n\n[A-Z]|\n---|\n\n$)/gi,
    /--- Running Spec[\s\S]*/gi,
    /Decomposition:.*$/gm,
    /Test-driven thinking:.*$/gm,
    /Pattern reuse:.*$/gm,
    /Key (?:files|patterns):[\s\S]*?(?=\n\n|\n[A-Z])/gi,
    /Validate with:.*$/gm,
    /After changes:.*$/gm,
    /Then:?\s*pnpm.*$/gm,
    /pnpm --filter.*$/gm,
    /MAX \d+ SHORT SENTENCES.*$/gm,
    /Never mention internal IDs.*$/gm,
    /Lead the user through the phases.*$/gm,
    /→ Review → Ship.*$/gm,
    /tokens used[\s\S]*$/gi,
  ];

  let cleaned = raw;
  for (const pat of NOISE_PATTERNS) {
    cleaned = cleaned.replace(pat, "");
  }
  // Collapse multiple blank lines and trim
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  // If cleaning left almost nothing, fall back to last meaningful line
  if (cleaned.length < 10 && raw.length > 10) {
    const lines = raw.split("\n").filter(l => l.trim().length > 5);
    cleaned = lines[lines.length - 1] ?? "Completed";
  }

  return cleaned;
}

function clipText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= 24) return value.slice(0, maxChars);
  return `${value.slice(0, maxChars - 24).trimEnd()}\n[truncated to fit budget]`;
}

function conciseArtifactText(content: string): string {
  const cleaned = sanitizeSpecialistOutput(content)
    .replace(/RAW_HISTORY_SENTINEL[^\r\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "completed in prior run";
  return clipText(cleaned, MAX_TASK_ARTIFACT_ENTRY_CHARS);
}

function extractVerificationHint(content: string): string | undefined {
  const lower = content.toLowerCase();
  const hints: string[] = [];
  if (/typecheck[\s:]*pass/i.test(content) || lower.includes("no type errors")) {
    hints.push("typecheck pass");
  } else if (/typecheck[\s:]*fail/i.test(content) || /type\s*error/i.test(content)) {
    hints.push("typecheck needs review");
  }
  const passMatch = content.match(/(\d+)\s*(?:tests?\s+)?pass(?:ing|ed)?/i);
  const failMatch = content.match(/(\d+)\s*(?:tests?\s+)?fail(?:ing|ed|ures?)?/i);
  if (passMatch || failMatch) {
    hints.push(`${passMatch?.[1] ?? "0"} pass/${failMatch?.[1] ?? "0"} fail`);
  }
  return hints.length > 0 ? hints.join("; ") : undefined;
}

export type TaskArtifactEntry = {
  taskIndex: number;
  title: string;
  specialist: SpecialistRole | string;
  outcome: SpecialistOutcome | string;
  files: string[];
  summary: string;
  verification?: string;
  durationMs?: number;
};

export function buildTaskArtifactEntry(params: {
  task: AssignedTask;
  outcome: SpecialistOutcome;
  content: string;
  durationMs?: number;
}): TaskArtifactEntry {
  return {
    taskIndex: params.task.taskIndex,
    title: params.task.title,
    specialist: params.task.specialist,
    outcome: params.outcome,
    files: (params.task.files ?? []).map((file) => file.path),
    summary: conciseArtifactText(params.content),
    verification: extractVerificationHint(params.content),
    durationMs: params.durationMs,
  };
}

function taskArtifactEntryFromStored(task: StoredTaskResult): TaskArtifactEntry {
  return {
    taskIndex: task.taskIndex ?? -1,
    title: task.title,
    specialist: task.specialist,
    outcome: task.outcome,
    files: task.files ?? [],
    summary: task.artifactSummary ?? "completed in prior run",
    verification: task.verification,
    durationMs: task.durationMs,
  };
}

export function buildTaskArtifactSummary(
  entries: TaskArtifactEntry[],
  maxChars = MAX_TASK_ARTIFACT_SUMMARY_CHARS,
): string {
  const completed = entries.filter((entry) => entry.outcome === "DONE" || entry.outcome === "DONE_WITH_CONCERNS");
  if (completed.length === 0) return "";

  const lines = completed.map((entry) => {
    const files = entry.files.length > 0 ? ` files=${entry.files.slice(0, 4).join(", ")}` : "";
    const verification = entry.verification ? ` verification=${entry.verification}` : "";
    return `- ${entry.specialist} [${entry.outcome}] (${entry.title}): ${entry.summary}${files}${verification}`;
  });

  const selected: string[] = [];
  let used = "Completed task artifacts:\n".length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    const nextUsed = used + line.length + 1;
    if (nextUsed > maxChars && selected.length > 0) break;
    selected.unshift(line);
    used = nextUsed;
    if (used >= maxChars) break;
  }

  const omitted = lines.length - selected.length;
  const prefix = omitted > 0 ? `Completed task artifacts (${omitted} older omitted to preserve context budget):` : "Completed task artifacts:";
  return clipText([prefix, ...selected].join("\n"), maxChars);
}

export function buildScopedTaskContext(params: {
  buildId: string;
  task: AssignedTask;
  plan: BuildPlanDoc;
  artifactSummary?: string;
  rawBuildContext?: string;
  maxChars?: number;
}): string {
  void params.rawBuildContext; // Intentionally discarded: task dispatches must not inherit raw lifecycle history.

  const maxChars = params.maxChars ?? MAX_SCOPED_TASK_CONTEXT_CHARS;
  const relevantFiles = (params.task.files ?? []).length > 0
    ? (params.task.files ?? [])
    : (params.plan.fileStructure ?? []).filter((file) => {
      const purpose = file.purpose.toLowerCase();
      const path = file.path.toLowerCase();
      return params.task.title.toLowerCase().split(/\s+/).some((word) => word.length > 3 && (purpose.includes(word) || path.includes(word)));
    });
  const priorTaskTitles = params.plan.tasks
    .slice(0, Math.max(params.task.taskIndex, 0))
    .map((task) => task.title)
    .slice(-6);
  const artifactSummary = clipText(params.artifactSummary?.trim() || "No completed task artifacts yet.", 2_800);

  const lines = [
    "--- Scoped Build Task Context ---",
    `Build ID: ${params.buildId}`,
    "Context policy: raw Build Studio conversation history is intentionally omitted. Use only this task spec, relevant plan subset, and completed artifact summary.",
    "",
    "Current Task:",
    `- Index: ${params.task.taskIndex}`,
    `- Specialist: ${params.task.specialist}`,
    `- Title: ${params.task.title}`,
    params.task.task.testFirst ? `- Test first: ${clipText(params.task.task.testFirst, 900)}` : null,
    params.task.task.implement ? `- Implement: ${clipText(params.task.task.implement, 1_200)}` : null,
    params.task.task.verify ? `- Verify: ${clipText(params.task.task.verify, 900)}` : null,
    "",
    "Relevant Plan Files:",
    ...(relevantFiles.length > 0
      ? relevantFiles.slice(0, 12).map((file) => `- ${file.path} (${file.action}): ${clipText(file.purpose, 240)}`)
      : ["- No explicit file targets recorded for this task."]),
    "",
    "Dependency Context:",
    ...(priorTaskTitles.length > 0
      ? priorTaskTitles.map((title) => `- Prior planned task: ${title}`)
      : ["- This task has no prior planned dependency in the task graph."]),
    "",
    "Artifact Summary:",
    artifactSummary,
  ].filter((line): line is string => line != null);

  return clipText(lines.join("\n"), maxChars);
}

export function formatBuildCompleteMessage(summary: BuildSummary): string {
  const { completedTasks, totalTasks, failedTasks } = summary;
  const hasBlocked = summary.specialistSummaries.some(s => s.status === "BLOCKED" || s.status === "NEEDS_CONTEXT");

  // Group tasks by status
  const done = summary.specialistSummaries.filter(s => s.status === "DONE");
  const concerns = summary.specialistSummaries.filter(s => s.status === "DONE_WITH_CONCERNS");
  const blocked = summary.specialistSummaries.filter(s => s.status === "BLOCKED" || s.status === "NEEDS_CONTEXT");

  const parts: string[] = [];

  // Header
  if (hasBlocked || failedTasks > 0) {
    parts.push(`Build needs attention — ${completedTasks} of ${totalTasks} tasks completed, ${failedTasks} need review.`);
  } else if (concerns.length > 0) {
    parts.push(`Build completed with ${concerns.length} item${concerns.length > 1 ? "s" : ""} to review (${completedTasks}/${totalTasks} tasks done).`);
  } else {
    parts.push(`Build completed successfully — all ${totalTasks} tasks done.`);
  }

  // Completed tasks (concise list)
  if (done.length > 0) {
    parts.push("\nCompleted:");
    for (const s of done) {
      parts.push(`  - ${s.taskTitle}`);
    }
  }

  // Concerns (show task title + sanitized detail)
  if (concerns.length > 0) {
    parts.push("\nNeeds review:");
    for (const s of concerns) {
      const detail = sanitizeSpecialistOutput(s.outcome);
      parts.push(`  - ${s.taskTitle}${detail && detail !== s.taskTitle ? ` — ${detail.slice(0, 120)}` : ""}`);
    }
  }

  // Blocked
  if (blocked.length > 0) {
    parts.push("\nBlocked:");
    for (const s of blocked) {
      const detail = sanitizeSpecialistOutput(s.outcome);
      parts.push(`  - ${s.taskTitle}${detail ? ` — ${detail.slice(0, 120)}` : ""}`);
    }
  }

  // Call to action
  if (hasBlocked || failedTasks > 0) {
    parts.push("\n" + formatCoworkerOperationalCloseout({
      status: "not ready for review",
      evidence: `${completedTasks}/${totalTasks} tasks completed; ${failedTasks} task${failedTasks === 1 ? "" : "s"} need review or repair.`,
      nextAction: "resolve the blocked task output, then rerun Build Studio implementation or verification for the affected task.",
      owner: "Build Studio build agent",
    }));
  } else if (concerns.length > 0) {
    parts.push("\n" + formatCoworkerOperationalCloseout({
      status: "needs review",
      evidence: `${completedTasks}/${totalTasks} tasks completed with ${concerns.length} concern${concerns.length === 1 ? "" : "s"} flagged.`,
      nextAction: "run the review phase so acceptance, UX, and release-readiness evidence are checked.",
      owner: "Build Studio review agent",
    }));
  } else {
    parts.push("\n" + formatCoworkerOperationalCloseout({
      status: "ready for review",
      evidence: `${completedTasks}/${totalTasks} tasks completed with no blocked task output.`,
      nextAction: "run the review phase so tests, UX verification, and acceptance evidence are recorded.",
      owner: "Build Studio review agent",
    }));
  }

  return parts.join("\n");
}

// ─── Deliberation integration (Task 8) ─────────────────────────────────────
// Build Studio's review entry points (ideate → plan gate, plan → build gate,
// and the post-build review phase) now wrap their dual-reviewer runs as a
// DeliberationRun + DeliberationOutcome + compact FeatureBuild.deliberationSummary
// entry.
//
// Pattern selection (spec §7.4):
//   - "review"  is the default for ideate and plan — peer review at medium
//                assurance. Risk can escalate to add a skeptic branch.
//   - "debate"  is opt-in; callers set `explicitPattern: "debate"` when they
//                want author/reviewer/adjudicator + rebuttals. Typically used
//                for contested design decisions.
//
// The existing reviewer LLM calls still run — their ReviewResult stays the
// source of truth for pass/fail gating. The deliberation layer is an honest
// retrospective of what the reviewers found, so ClaimRecord rows, an outcome
// row, and the FeatureBuild.deliberationSummary trail all exist for UI +
// audit. Synthesis failures fail loud (memory: silent seed skips).

type DeliberationPatternChoice = "review" | "debate";

/**
 * Default deliberation pattern per build phase. Ideate and plan are the two
 * phases where deliberation is the default per the plan's Step 8.5.
 * Callers that want to upgrade to "debate" for a single invocation pass
 * `explicitPattern` to runBuildReviewDeliberation.
 */
export function defaultDeliberationPatternForPhase(
  phase: BuildDeliberationPhase,
): DeliberationPatternChoice {
  // review pattern is the default at every build-phase review point.
  // The activation resolver is what decides whether to actually activate,
  // but for the Build Studio surfaces, "review" is the selected default.
  void phase;
  return "review";
}

export type BuildReviewDeliberationInput = {
  userId: string;
  buildId: string;
  phase: BuildDeliberationPhase;
  reviewerBranches: ReviewBranchInput[];
  /** Optional TaskRun to tie the deliberation into an existing work unit. */
  taskRunId?: string;
  /** Optional thread id — progress events from the deliberation layer fan
   *  out through the agent event bus for this thread. */
  threadId?: string;
  /** Opt-in to the debate pattern for this invocation. Omit for default
   *  peer review. */
  explicitPattern?: DeliberationPatternChoice;
  /** Passed to the activation resolver to narrow strategy selection. */
  strategyProfile?: "economy" | "balanced" | "high-assurance" | "document-authority";
};

export type BuildReviewDeliberationResult = {
  entry: BuildDeliberationSummaryEntry;
  deliberationRunId: string;
  reason: string;
};

/**
 * Wrap a completed dual-reviewer run as a deliberation. Persists the
 * ClaimRecord + DeliberationOutcome trail and patches FeatureBuild
 * .deliberationSummary[phase] with a compact UI entry.
 *
 * Fails loud — callers should not assume silent success. The reviewer path
 * (build-reviewers.ts / mcp-tools.ts) retains authority over pass/fail
 * gating; this function only records the deliberation trail.
 */
export async function runBuildReviewDeliberation(
  input: BuildReviewDeliberationInput,
): Promise<BuildReviewDeliberationResult> {
  const { userId, buildId, phase, reviewerBranches, taskRunId, threadId, strategyProfile } = input;

  const patternSlug: DeliberationPatternChoice =
    input.explicitPattern ?? defaultDeliberationPatternForPhase(phase);

  // Derive a risk level from the reviewer findings so the activation
  // resolver can optionally escalate (spec §7.4 — skeptic branch on
  // medium+ risk).
  const parsedReviews: Array<ReviewResult | null> = reviewerBranches.map((b) => b.review);
  const riskLevel = deriveReviewRiskLevel(parsedReviews);
  const artifactType = artifactTypeForPhase(phase);

  const { startDeliberation } = await import("@/lib/actions/deliberation");
  const { synthesizeDeliberation } = await import("@/lib/deliberation/synthesizer");

  // Stage/risk triggers are pre-authorized by the auto-approve predicate
  // (see startDeliberationAutoApprove). Explicit debate invocations still
  // go through normal proposal review — that matches spec §7.1.
  const stageForResolver: "ideate" | "plan" | "review" = phase;

  const started = await startDeliberation({
    userId,
    patternSlug,
    taskRunId,
    threadId,
    buildId,
    artifactType,
    strategyProfile: strategyProfile ?? "balanced",
    stage: stageForResolver,
    riskLevel,
    routeContext: "/build",
  });

  const branchArtifacts = buildReviewBranchArtifacts(reviewerBranches);

  // Map branchNodeIds onto actual persisted TaskNode ids so the synthesizer
  // can write ClaimRecord rows with valid foreign keys. The orchestrator
  // already materialized branch nodes; we look them up in order.
  const persistedBranches = await prisma.taskNode.findMany({
    where: { taskRun: { id: undefined, taskRunId: undefined }, deliberationRun: { id: started.deliberationRunId } },
    select: { id: true, workerRole: true },
    orderBy: { createdAt: "asc" },
  });
  // The above where clause is intentionally over-restrictive to avoid false
  // matches — fallback to TaskNode lookup by DeliberationRun id directly.
  const nodesByRole = await prisma.taskNode.findMany({
    where: { deliberationRunId: started.deliberationRunId },
    select: { id: true, workerRole: true },
    orderBy: { createdAt: "asc" },
  });
  void persistedBranches;

  // Best-effort alignment: pair review branches with the persisted worker
  // roles the orchestrator materialized. If counts don't match (pattern
  // expanded extra branches we don't have content for), we let the
  // synthesizer count them as incomplete — that's truthful.
  // IMPORTANT: fall back to null (not art.branchNodeId) when no persisted
  // node exists. art.branchNodeId may be a placeholder string like
  // "reviewer-1" that doesn't exist in TaskNode, which causes a FK
  // violation on ClaimRecord.branchNodeId -> TaskNode(id).
  // branchNodeId is nullable (ON DELETE SET NULL) so null is safe.
  const alignedArtifacts = branchArtifacts.map((art, idx) => ({
    ...art,
    branchNodeId: nodesByRole[idx]?.id ?? null,
  }));

  const synth = await synthesizeDeliberation({
    deliberationRunId: started.deliberationRunId,
    artifactType,
    branches: alignedArtifacts,
    diversityLabel: patternSlug === "debate" ? "debate-roles" : "peer-review",
  });

  const entry = mapCompactSummaryToBuildEntry({
    patternSlug,
    compactSummary: synth.compactSummary,
    rationaleSummary: synth.outcome.rationaleSummary,
    unresolvedRisks: synth.outcome.unresolvedRisks,
    diversityLabel: patternSlug === "debate" ? "debate-roles" : "peer-review",
  });

  // Patch FeatureBuild.deliberationSummary[phase]. Read-modify-write, because
  // deliberationSummary is a JSON blob keyed by phase.
  const existing = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { deliberationSummary: true },
  });
  const current = (existing?.deliberationSummary as BuildDeliberationSummary | null) ?? {};
  const nextSummary: BuildDeliberationSummary = {
    ...current,
    [phase]: entry,
  };

  await prisma.featureBuild.update({
    where: { buildId },
    data: {
      deliberationSummary: nextSummary as unknown as import("@dpf/db").Prisma.InputJsonValue,
    },
  });

  return {
    entry,
    deliberationRunId: started.deliberationRunId,
    reason: started.reason,
  };
}

export type SpecialistOutcome =
  | "DONE"                // Task completed successfully
  | "DONE_WITH_CONCERNS"  // Task completed but flagged issues for review
  | "BLOCKED"             // Task cannot proceed — needs human or dependency resolution
  | "NEEDS_CONTEXT";      // Task needs additional information from orchestrator

/** Error patterns that indicate infrastructure issues vs. task-level failures. */
export const INFRA_ERROR_PATTERNS = [
  "sandbox not running", "sandbox initialization failed", "all sandbox slots",
  "sandbox container not found", "no sandbox", "could not initialize sandbox",
];
export const MISSING_PREREQUISITE_PATTERNS = [
  "not found in schema", "file not found", "no model named",
];

/** Classify a specialist's result into a structured outcome. Works with AgenticResult, CodexResult, and ClaudeResult. */
export function classifyOutcome(result: AgenticResult | CodexResult | ClaudeResult, role: SpecialistRole): SpecialistOutcome {
  const content = result.content.toLowerCase();

  if ("durationMs" in result && !("providerId" in result)) {
    if (isMissingSandboxToolSurfaceOutput(result.content)) return "BLOCKED";
    if (!result.success) {
      if (content.includes("timed out")) return "BLOCKED";
      return "BLOCKED";
    }
    const CLI_CONCERN_PATTERNS = [
      /\berrors?[:]\s/i,
      /\bwarnings?[:]\s/i,
      /\d+\s+errors?\b/i,
      /\d+\s+warnings?\b/i,
      /typecheck.*fail/i,
      /build.*fail/i,
      /\d+\s+tests?\s+failed\b/i,
      /\b\d+\s+failed\b/i,
      /test\s+suite.*fail/i,
    ];
    if (CLI_CONCERN_PATTERNS.some(pat => pat.test(content))) {
      return "DONE_WITH_CONCERNS";
    }
    return "DONE";
  }

  // AgenticResult path (original logic)
  const agenticResult = result as AgenticResult;
  const calledBuildTools = agenticResult.executedTools.some(t =>
    t.name !== "read_sandbox_file" && t.name !== "search_sandbox" && t.name !== "list_sandbox_files" && t.name !== "describe_model"
  );
  const hasErrors = agenticResult.executedTools.some(t => !t.result.success);
  const isQA = role === "qa-engineer";

  const toolErrors = agenticResult.executedTools
    .filter(t => !t.result.success)
    .map(t => (t.result.error ?? "").toLowerCase());
  const hasInfraError = toolErrors.some(err =>
    INFRA_ERROR_PATTERNS.some(pat => err.includes(pat))
  );
  if (hasInfraError) return "BLOCKED";

  const hasMissingPrereq = toolErrors.some(err =>
    MISSING_PREREQUISITE_PATTERNS.some(pat => err.includes(pat))
  );
  if (hasMissingPrereq && !calledBuildTools) return "BLOCKED";

  if (content.includes("blocked") || content.includes("cannot proceed") || content.includes("missing prerequisite")) {
    return "BLOCKED";
  }
  if (content.includes("need more information") || content.includes("please clarify") || content.includes("which ")) {
    return "NEEDS_CONTEXT";
  }
  if (isQA && calledBuildTools) {
    return hasErrors ? "DONE_WITH_CONCERNS" : "DONE";
  }
  if (calledBuildTools && !hasErrors) return "DONE";
  if (calledBuildTools && hasErrors) return "DONE_WITH_CONCERNS";
  // No build tools called — normally BLOCKED, but a substantial text response
  // without blocking language indicates the agent answered via reasoning alone.
  if (content.length > 50) return "DONE";
  return "BLOCKED";
}

// ─── QA Verification Parsing ──────────────────────────────────────────────

export type QAVerification = {
  typecheckPassed: boolean;
  testsPassed: number;
  testsFailed: number;
  /** "high" = regexes matched expected format; "low" = couldn't parse, safe defaults applied */
  parseConfidence: "high" | "low";
};

/**
 * Parse QA specialist output into structured verification data.
 * Uses broadened regexes to handle common test runner output formats.
 * Returns safe defaults (typecheckPassed: false, confidence: low) when output
 * is empty or unparseable — preventing false auto-advance on broken QA runs.
 */
export function parseQAVerification(qaContent: string): QAVerification {
  if (!qaContent || !qaContent.trim()) {
    return { typecheckPassed: false, testsPassed: 0, testsFailed: 0, parseConfidence: "low" };
  }

  // Strip ANSI color codes. A real `pnpm -r test` run is colorized, and the
  // escape sequences otherwise wedge between digits and keywords and corrupt
  // the count regexes below.
  // eslint-disable-next-line no-control-regex -- ANSI color strip
  const clean = qaContent.replace(/\x1b\[[0-9;]*m/g, "");
  const lower = clean.toLowerCase();

  // Typecheck: explicit fail indicators mean failure; absence alone is not a pass
  const hasTypecheckFail = /typecheck[\s:]*fail/i.test(clean)
    || /type\s*error/i.test(clean)
    || /tsc.*error/i.test(clean);
  const hasTypecheckPass = /typecheck[\s:]*pass/i.test(clean)
    || /typecheck[\s:]*(?:ok|success)/i.test(clean)
    || lower.includes("no type errors");

  // Test counts. A monorepo `pnpm -r test` run prints one vitest summary PER
  // package, so a single .match() captures only the FIRST package's numbers and
  // silently drops failures in later packages (e.g. apps/web). That let builds
  // whose own feature tests fail slip past the build→review gate with
  // testsFailed:0 — the model wrote broken tests, but the pipeline reported
  // green. Aggregate every count across the whole output instead: for gate
  // purposes an over-count of failures is safe (it errs toward blocking the
  // advance), an under-count is not. Legacy single-summary inputs sum to the
  // same single value, so existing behavior is preserved.
  let testsPassed = 0;
  let testsFailed = 0;
  let sawCount = false;
  for (const m of clean.matchAll(/(\d+)\s*(?:tests?\s+)?pass(?:ing|ed)?/gi)) {
    testsPassed += parseInt(m[1]!);
    sawCount = true;
  }
  for (const m of clean.matchAll(/(\d+)\s*(?:tests?\s+)?fail(?:ing|ed|ures?)?/gi)) {
    testsFailed += parseInt(m[1]!);
    sawCount = true;
  }

  const hasTestResults = sawCount;
  const hasTypecheckSignal = hasTypecheckFail || hasTypecheckPass;

  if (!hasTestResults && !hasTypecheckSignal) {
    return { typecheckPassed: false, testsPassed: 0, testsFailed: 0, parseConfidence: "low" };
  }

  return {
    typecheckPassed: hasTypecheckPass || (!hasTypecheckFail && hasTestResults),
    testsPassed,
    testsFailed,
    parseConfidence: "high",
  };
}

// ─── Task Resume Logic ─────────────────────────────────────────────────────

/** Stored task result shape from saveBuildEvidence("taskResults", ...) */
export type StoredTaskResult = {
  taskIndex?: number;
  title: string;
  specialist: string;
  outcome: string;
  durationMs?: number;
  files?: string[];
  artifactSummary?: string;
  verification?: string;
};

/**
 * Determine which tasks can be skipped based on prior stored results.
 * Returns a Set of task titles that completed successfully (DONE or DONE_WITH_CONCERNS).
 */
export function getCompletedTaskTitles(
  storedTasks: StoredTaskResult[] | undefined | null,
): Set<string> {
  const completed = new Set<string>();
  if (!storedTasks?.length) return completed;
  for (const t of storedTasks) {
    if (t.outcome === "DONE" || t.outcome === "DONE_WITH_CONCERNS") {
      completed.add(t.title);
    }
  }
  return completed;
}

/**
 * Build a prior results summary string from stored task results,
 * providing downstream context for tasks that depend on completed work.
 */
export function buildStoredResultsSummary(
  storedTasks: StoredTaskResult[] | undefined | null,
): string {
  if (!storedTasks?.length) return "";
  return buildTaskArtifactSummary(storedTasks.map(taskArtifactEntryFromStored));
}

// ─── Specialist Dispatch ────────────────────────────────────────────────────

type SpecialistResult = {
  task: AssignedTask;
  result: AgenticResult | CodexResult | ClaudeResult;
  outcome: SpecialistOutcome;
  success: boolean;
  retries: number;
};

async function dispatchSpecialist(params: {
  task: AssignedTask;
  userId: string;
  platformRole: string | null;
  isSuperuser: boolean;
  buildId: string;
  buildContext: string;
  parentThreadId: string;
  priorResults?: string;
  sessionId?: string;
  dispatchConfig: BuildStudioDispatchConfig;
}): Promise<SpecialistResult> {
  const { task, userId, platformRole, isSuperuser, buildId, buildContext, parentThreadId, priorResults, sessionId, dispatchConfig: config } = params;
  const role = task.specialist;
  let agenticFallbackProviderId: string | null = null;

  // Emit dispatch event
  agentEventBus.emit(parentThreadId, {
    type: "orchestrator:task_dispatched",
    buildId,
    taskTitle: task.title,
    specialist: ROLE_LABELS[role],
  });

  // ─── CLI dispatch path: Codex or Claude Code running inside the sandbox ──
  if (config.provider === "codex" || config.provider === "claude" || config.provider === "grok" || config.provider === "opencode") {
    const onProgress = (message: string) => {
      agentEventBus.emit(parentThreadId, {
        type: "orchestrator:task_progress",
        buildId,
        taskTitle: task.title,
        message,
      });
    };
    const containerId = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
    const selectedCandidate = config.selection?.selected;
    const cliAttempts: BuildEngineCandidate[] = selectedCandidate
      ? [selectedCandidate, ...config.selection!.fallbackChain.slice(0, 1)]
      : [];
    let cliResult: CodexResult | ClaudeResult | null = null;
    // One bounded same-engine re-dispatch per task when the CLI dies on
    // infrastructure (BI-2B9E16CC). The agentic path has always retried failures
    // MAX_SPECIALIST_RETRIES times; the CLI path retried nothing after dispatch,
    // so a timeout or a 503 stranded the whole build in `build` phase forever.
    let infraRedispatchUsed = false;
    const dispatchOnce = async (
      candidate: BuildEngineCandidate | undefined,
    ): Promise<(CodexResult | ClaudeResult) & { exitCode: number }> => {
      const engine = candidate?.engine ?? config.provider;
      // The loop diverts "agentic" to the legacy path before ever calling this;
      // the guard is here to narrow the union for resolveBuildProviderRunner.
      if (engine === "agentic") throw new Error("dispatchOnce received the agentic engine");
      const { provider, runner } = resolveBuildProviderRunner({ agentId: engine });
      const runResult = await runner.run(
        provider,
        { id: containerId, buildId, providerId: provider.id, containerId },
        {
          task,
          buildId,
          buildContext,
          priorResults,
          providerId: candidate?.providerId
            ?? (engine === "claude" ? config.claudeProviderId : engine === "grok" ? config.grokProviderId : engine === "opencode" ? config.opencodeProviderId : config.codexProviderId),
          model: candidate?.modelId
            ?? (engine === "claude" ? config.claudeModel : engine === "grok" ? config.grokModel : engine === "opencode" ? config.opencodeModel : config.codexModel),
          sessionId,
          onProgress,
        },
      );
      return {
        content: runResult.stdout || runResult.stderr,
        success: runResult.exitCode === 0,
        executedTools: [],
        durationMs: runResult.durationMs,
        exitCode: runResult.exitCode,
      };
    };
    for (let attemptIndex = 0; attemptIndex < Math.max(1, cliAttempts.length); attemptIndex += 1) {
      const candidate = cliAttempts[attemptIndex];
      if (candidate?.engine === "agentic") {
        agenticFallbackProviderId = candidate.providerId;
        break;
      }
      const engine = candidate?.engine ?? config.provider;
      let dispatched = await dispatchOnce(candidate);
      cliResult = dispatched;

      // Infrastructure death → retry the SAME engine once. A substantive block
      // ("I need a decision on X") matches nothing and is not retried, because
      // re-running will not answer it.
      if (
        !dispatched.success
        && !infraRedispatchUsed
        && classifyBlockedCause({ content: dispatched.content, exitCode: dispatched.exitCode }) === "infrastructure"
      ) {
        infraRedispatchUsed = true;
        agentEventBus.emit(parentThreadId, {
          type: "orchestrator:specialist_retry",
          buildId,
          specialist: ROLE_LABELS[role],
          reason: `The ${engine} session died on infrastructure (not a decision it needed from you); retrying the same task once.`,
          attempt: 1,
        });
        await prisma.buildActivity.create({
          data: {
            buildId,
            tool: "engine_selection",
            summary: `Build dispatch ${engine} failed on infrastructure after ${dispatched.durationMs}ms; re-dispatching the same engine once for task "${task.title}".`,
          },
        }).catch(() => {});
        dispatched = await dispatchOnce(candidate);
        cliResult = dispatched;
      }

      if (cliResult.success) break;
      const retryClass = classifyRetrySafePreDispatchFailure({
        message: cliResult.content,
        durationMs: cliResult.durationMs,
      });
      const next = cliAttempts[attemptIndex + 1];
      if (!retryClass || !next || config.selection?.fallbackDisabled) break;
      await prisma.buildActivity.create({
        data: {
          buildId,
          tool: "engine_selection",
          summary: `Build dispatch ${engine} ${retryClass} failure occurred before phase side effects; falling back once to ${next.engine} (provider=${next.providerId}).`,
        },
      }).catch(() => {});
    }

    if (!cliResult && !agenticFallbackProviderId) {
      throw new Error("Build engine selection returned no specialist dispatch attempt.");
    }

    const outcome = cliResult ? classifyOutcome(cliResult, role) : "BLOCKED";

    if (cliResult && isMissingSandboxToolSurfaceOutput(cliResult.content)) {
      agentEventBus.emit(parentThreadId, {
        type: "orchestrator:specialist_retry",
        buildId,
        specialist: ROLE_LABELS[role],
        reason:
          "CLI session reported that the Build Studio sandbox tool set is not exposed; retrying through the platform agentic tool path.",
        attempt: 1,
      });
    } else if (cliResult && !agenticFallbackProviderId) {
      agentEventBus.emit(parentThreadId, {
        type: "orchestrator:task_complete",
        buildId,
        taskTitle: task.title,
        specialist: ROLE_LABELS[role],
        outcome: cliResult.success ? "DONE" : "BLOCKED",
      });

      return {
        task,
        result: cliResult,
        outcome,
        success: outcome === "DONE" || outcome === "DONE_WITH_CONCERNS",
        retries: 0,
      };
    }
  }

  // ─── Agentic loop path (legacy fallback) ─────────────────────────────────
  const agentId = SPECIALIST_AGENT_IDS[role];
  const modelReqs = SPECIALIST_MODEL_REQS[role];
  const allowedToolNames = new Set(SPECIALIST_TOOLS[role]);

  const thread = await prisma.agentThread.upsert({
    where: { userId_contextKey: { userId, contextKey: `build:${buildId}:${role}:${task.taskIndex}` } },
    update: {},
    create: { userId, contextKey: `build:${buildId}:${role}:${task.taskIndex}` },
  });

  const userContext = { userId, platformRole, isSuperuser };
  const allTools = await getAvailableTools(userContext, { mode: "act", agentId });
  const scopedTools = allTools.filter(t => allowedToolNames.has(t.name));
  const toolsForProvider = toolsToOpenAIFormat(scopedTools);

  const base = await buildSpecialistPromptWithProvenance({
    role,
    taskDescription: `Task: ${task.title}\n\nFiles to work on:\n${(task.files ?? []).map(f => `- ${f.path} (${f.action}): ${f.purpose}`).join("\n") || "See task description for details."}`,
    buildContext,
    priorResults,
  });
  // A1 (BI-C654F960) Phase 2a: govern the inline path — append the real
  // specialist Agent's corpus (BI-B31072B8). Flag-gated default-off (no-op).
  // BI-CE93E314: the appended corpus is retrieved DATA, so the declared spans
  // stay exactly the role prompt from buildSpecialistPromptWithProvenance.
  const { prompt: systemPrompt } = await appendGovernedSpecialistCorpus(base.text, { role, agentId, query: task.title });

  let lastResult: AgenticResult | null = null;
  let retries = 0;

  for (let attempt = 0; attempt <= MAX_SPECIALIST_RETRIES; attempt++) {
    const taskPrompt = attempt === 0
      ? task.task.implement || task.title
      : `RETRY (attempt ${attempt + 1}): The previous attempt had issues:\n${lastResult?.content?.slice(0, 500) ?? "Unknown error"}\n\nTry a different approach. Original task: ${task.task.implement || task.title}`;

    lastResult = await runAgenticLoop({
      chatHistory: [{ role: "user", content: taskPrompt }],
      systemPrompt,
      systemPromptInstructionSpans: base.instructionSpans,
      sensitivity: "development", // code clearance; payload screening still applies
      tools: scopedTools,
      toolsForProvider,
      userId,
      routeContext: "/build",
      agentId,
      threadId: thread.id,
      modelRequirements: agenticFallbackProviderId || config.selection?.selected?.engine === "agentic"
        ? { ...modelReqs, allowedProviders: [agenticFallbackProviderId ?? config.selection!.selected!.providerId] }
        : modelReqs,
      requireTools: true,
      onProgress: (event: AgentEvent) => agentEventBus.emit(parentThreadId, event),
    });

    const outcome = classifyOutcome(lastResult, role);

    if (outcome === "DONE" || outcome === "DONE_WITH_CONCERNS") {
      return { task, result: lastResult, outcome, success: true, retries: attempt };
    }

    retries = attempt + 1;
    if (attempt < MAX_SPECIALIST_RETRIES) {
      agentEventBus.emit(parentThreadId, {
        type: "orchestrator:specialist_retry",
        buildId,
        specialist: ROLE_LABELS[role],
        reason: lastResult.content.slice(0, 200),
        attempt: attempt + 1,
      });
    }
  }

  const finalOutcome = classifyOutcome(lastResult!, role);
  return { task, result: lastResult!, outcome: finalOutcome, success: false, retries };
}

async function saveTaskPhaseHandoff(params: {
  buildId: string;
  userId: string;
  parentThreadId: string;
  entry: TaskArtifactEntry;
}): Promise<void> {
  try {
    const { executeTool } = await import("@/lib/mcp-tools");
    const openIssues =
      params.entry.outcome === "BLOCKED" || params.entry.outcome === "NEEDS_CONTEXT"
        ? [`${params.entry.title}: ${params.entry.summary}`]
        : [];

    await executeTool("save_phase_handoff", {
      buildId: params.buildId,
      summary: `${params.entry.specialist} finished ${params.entry.title}: ${params.entry.summary}`,
      decisionsMade: [
        `Task outcome: ${params.entry.outcome}`,
        params.entry.files.length > 0
          ? `Files touched: ${params.entry.files.slice(0, 6).join(", ")}`
          : "Files touched: none recorded",
      ],
      openIssues,
      userPreferences: [],
      toPhase: "build",
      autoAdvance: false,
    }, params.userId, {
      routeContext: "/build",
      agentId: "AGT-ORCH-300",
      threadId: params.parentThreadId,
    });
  } catch (err) {
    console.warn("[orchestrator] task phase handoff skipped:", (err as Error)?.message ?? err);
  }
}

// ─── Orchestrator Main ──────────────────────────────────────────────────────

export type OrchestratorResult = {
  content: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  specialistResults: SpecialistResult[];
  totalInputTokens: number;
  totalOutputTokens: number;
};

/**
 * Run the Build Process Orchestrator.
 * Parses the approved plan, builds dependency graph, dispatches specialists
 * in parallel phases, synthesizes results.
 *
 * This is a DIRECT DISPATCH FUNCTION — not an agentic loop.
 * It calls runAgenticLoop for each specialist, not for itself.
 */
export async function runBuildOrchestrator(params: {
  buildId: string;
  plan: BuildPlanDoc;
  userId: string;
  platformRole: string | null;
  isSuperuser: boolean;
  parentThreadId: string;
  buildContext: string;
}): Promise<OrchestratorResult> {
  const { buildId, plan, userId, platformRole, isSuperuser, parentThreadId, buildContext } = params;
  const startTime = Date.now();
  const normalizedPlan = normalizeBuildPlanPaths(plan);

  if (normalizedPlan.rewrites.length > 0) {
    try {
      await prisma.featureBuild.update({
        where: { buildId },
        data: {
          buildPlan: normalizedPlan.plan as unknown as import("@dpf/db").Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      console.warn("[orchestrator] Could not persist normalized build plan:", (err as Error).message);
    }
  }

  if (normalizedPlan.unresolvedModifyPaths.length > 0) {
    const missingTargets = normalizedPlan.unresolvedModifyPaths.join(", ");
    agentEventBus.emit(parentThreadId, {
      type: "orchestrator:warning",
      buildId,
      message: `Build plan refers to files that no longer exist: ${missingTargets}`,
    });
    return {
      content: formatCoworkerOperationalCloseout({
        status: "blocked before implementation",
        evidence: `the implementation plan targets files that no longer exist: ${missingTargets}.`,
        nextAction: "refresh the plan against the current Build Studio file layout, then retry implementation.",
        owner: "Build Studio plan agent",
      }),
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      specialistResults: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
    };
  }

  // ─── Ensure sandbox metadata is on the build record ─────────────────────
  // The preview iframe needs sandboxPort to render. Set it if missing.
  const sandboxContainer = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
  const sandboxPort = Number(process.env.SANDBOX_PORT ?? "3035");
  try {
    await prisma.featureBuild.update({
      where: { buildId },
      data: { sandboxId: sandboxContainer, sandboxPort },
    });
  } catch (err) {
    console.warn("[orchestrator] sandbox metadata update skipped:", (err as Error).message);
  }

  // ─── Layer 2: Task checkpointing — resume from prior results ─────────────
  // Read previously completed task results from the FeatureBuild record.
  // Tasks with outcome DONE or DONE_WITH_CONCERNS are skipped on re-run.
  let completedTaskTitles = new Set<string>();
  let taskArtifactEntries: TaskArtifactEntry[] = [];
  let taskResultsVersion = 0;

  try {
    const build = await prisma.featureBuild.findUnique({
      where: { buildId },
      select: { taskResults: true, taskResultsVersion: true },
    });
    taskResultsVersion = build?.taskResultsVersion ?? 0;
    const stored = build?.taskResults as {
      tasks?: StoredTaskResult[];
    } | null;

    completedTaskTitles = getCompletedTaskTitles(stored?.tasks);
    taskArtifactEntries = (stored?.tasks ?? []).map(taskArtifactEntryFromStored);

    if (completedTaskTitles.size > 0) {
      console.log(`[orchestrator] Resuming build ${buildId}: ${completedTaskTitles.size} tasks already completed, will skip`);
    }
  } catch (err) {
    console.warn("[orchestrator] Could not read prior task results, starting fresh:", err);
  }

  // ─── Pre-flight check: select one policy-qualified healthy engine ─────────
  // The shared selector owns auth, health, capacity, residency, sensitivity,
  // capability, and hard-pin gates before any specialist side effect begins.
  const { deriveDeliverableSensitivity, mapBuildDeliverableToRoutingSensitivity } = await import("@/lib/explore/build-process-matrix");
  const buildSensitivity = deriveDeliverableSensitivity({ text: buildContext });
  const preflightConfig = await getBuildStudioConfig({
    // low→development; elevated→internal; high→confidential (founder ruling).
    sensitivity: mapBuildDeliverableToRoutingSensitivity(buildSensitivity),
  });

  if (preflightConfig.selection) {
    await prisma.buildActivity.create({
      data: {
        buildId,
        tool: "engine_selection",
        summary: formatBuildEngineSelectionEvidence(preflightConfig.selection),
      },
    }).catch((err) => console.warn("[orchestrator] Could not persist engine selection evidence:", err));
  }
  if (!preflightConfig.selection || preflightConfig.selection.status === "blocked" || !preflightConfig.selection.selected) {
    return {
      content: formatCoworkerOperationalCloseout({
        status: "blocked before implementation",
        evidence: preflightConfig.selection?.reason ?? "Build Studio could not resolve an allowed healthy execution engine.",
        nextAction: preflightConfig.selection?.action ?? "Review AI Readiness, restore one allowed engine, and retry implementation.",
        owner: "operator/admin",
      }),
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      specialistResults: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
    };
  }

  try {
    const buildRecord = await prisma.featureBuild.findUnique({
      where: { buildId },
      select: { plan: true },
    });
    if (buildRecord) {
      await prisma.featureBuild.update({
        where: { buildId },
        data: {
          codingProvider: preflightConfig.provider,
          plan: mergeHappyPathStateIntoPlan(
            (buildRecord.plan as Record<string, unknown> | null) ?? null,
            {
              execution: {
                engine: preflightConfig.provider,
                source: null,
                status: "running",
                failureStage: null,
              },
            },
          ) as import("@dpf/db").Prisma.InputJsonValue,
        },
      });
    }
  } catch (err) {
    console.warn("[orchestrator] Could not persist execution engine metadata:", err);
  }

  // ─── Pre-flight check: sandbox test toolchain is loadable ────────────────
  // The shared sandbox (dpf-sandbox-1) reuses node_modules across builds. A
  // stale/partial install makes vitest fail to LOAD (rolldown native-binding
  // error, vitest-not-found) and surfaces later as a confusing parse error on a
  // valid file — the FB-69231490 stall. Heal it BEFORE dispatching tasks so the
  // QA specialist's verification runs against a sound toolchain; if it cannot be
  // healed, block LOUD with the structured diagnosis instead of letting a
  // specialist hang on an opaque failure.
  try {
    const { ensureSandboxToolchainHealthy } = await import("./sandbox/sandbox-toolchain-health");
    const health = await ensureSandboxToolchainHealthy(sandboxContainer);
    if (health.restored) {
      await prisma.buildActivity.create({
        data: {
          buildId,
          tool: "sandbox:toolchain-restored",
          summary: `Sandbox toolchain was unloadable (${health.signature ?? "unknown"}); auto-restored node_modules before dispatch.`,
        },
      }).catch(() => {});
    }
    if (!health.healthy) {
      return {
        content: formatCoworkerOperationalCloseout({
          status: "blocked before implementation",
          evidence:
            `the build sandbox test toolchain is not loadable` +
            `${health.signature ? ` (${health.signature})` : ""}: ${health.diagnosis ?? "vitest could not load after a clean reinstall."} ` +
            `This is sandbox state, not a code defect.`,
          nextAction: "recover the sandbox (diagnose_sandbox / recover_sandbox) or rebuild its node_modules, then retry implementation.",
          owner: "operator/admin",
        }),
        totalTasks: 0, completedTasks: 0, failedTasks: 0,
        specialistResults: [], totalInputTokens: 0, totalOutputTokens: 0,
      };
    }
  } catch (err) {
    // A probe failure must not hard-stop the build — log and proceed; the QA
    // gate still guards the advance.
    console.warn("[orchestrator] toolchain preflight skipped:", (err as Error)?.message);
  }

  // Build dependency graph from plan
  const phases = buildDependencyGraph(
    normalizedPlan.plan.fileStructure ?? [],
    normalizedPlan.plan.tasks ?? [],
  );

  const totalTasks = phases.reduce((sum, p) => sum + p.tasks.length, 0);

  // Emit build started (report resume status if applicable)
  const specialists = [...new Set(phases.flatMap(p => p.tasks.map(t => ROLE_LABELS[t.specialist])))];
  const pendingTaskCount = totalTasks - completedTaskTitles.size;
  agentEventBus.emit(parentThreadId, {
    type: "orchestrator:build_started",
    buildId,
    taskCount: totalTasks,
    specialists,
    ...(completedTaskTitles.size > 0 && {
      resuming: true,
      skippedTasks: completedTaskTitles.size,
      pendingTasks: pendingTaskCount,
    }),
  });

  // Execute phases sequentially; tasks within a phase run in parallel
  const allResults: SpecialistResult[] = [];

  // Layer 1: CLI session continuity — DISABLED for now.
  // Claude Code --session-id is single-use: one session per invocation.
  // Parallel tasks in the same phase all try to claim the same session → "already in use" error.
  // Proper session chaining (sequential between phases) is a future enhancement.
  // For now, each task gets its own fresh session. Context is passed via priorResults text.

  // BI-F72C1044: usage-limit fast-abort. The whole build runs on ONE configured
  // provider, so once a dispatch reports a usage-limit (subscription cap that
  // won't clear within the build) every remaining dispatch will fail the same
  // way. Set once, then stop dispatching for the rest of the build instead of
  // firing the entire queue into an exhausted cap (the live "~17 dead dispatches
  // in one build" pattern). Remaining tasks stay pending so a retry after the
  // cap resets re-dispatches them.
  let usageLimitAborted = false;
  // BI-0F291741: a LOCAL build engine (opencode) runs the model on ONE GPU. The
  // in-process withLocalInferenceLock (chat-adapter.ts) does NOT cover the
  // sandbox-CLI path, so two parallel specialists would each spawn a local model
  // inside the container and collide on the GPU — the "both reviewers timed out"
  // failure, now in the build phase. Serialize specialist dispatch for a local
  // engine; cloud subscription CLIs keep concurrency 2 for throughput within
  // their per-minute caps.
  const localBuildEngine = preflightConfig.selection.selected.local;
  for (const phase of phases) {
    // Timeout check
    if (Date.now() - startTime > MAX_DURATION_ORCHESTRATOR_MS) {
      console.warn(`[orchestrator] hit MAX_DURATION (${MAX_DURATION_ORCHESTRATOR_MS}ms). Reporting partial results.`);
      break;
    }

    // Filter out already-completed tasks (Layer 2: resume)
    const pendingTasks = phase.tasks.filter(task => {
      if (completedTaskTitles.has(task.title)) {
        console.log(`[orchestrator] Skipping completed task: "${task.title}"`);
        agentEventBus.emit(parentThreadId, {
          type: "orchestrator:task_complete",
          buildId,
          taskTitle: task.title,
          specialist: ROLE_LABELS[task.specialist],
          outcome: "Skipped (completed in prior run)",
          status: "DONE",
        });
        return false;
      }
      return true;
    });

    // Skip phase entirely if all tasks are already done
    if (pendingTasks.length === 0) {
      continue;
    }

    // Dispatch pending tasks with a concurrency limit. Cloud subscription CLIs
    // allow 2 (per-minute caps); a local engine is serialized to 1 so parallel
    // specialists don't collide on the single GPU (BI-0F291741).
    const MAX_CONCURRENT_TASKS = localBuildEngine ? 1 : 2;
    const phaseResults: SpecialistResult[] = [];
    const taskQueue = [...pendingTasks];

    // Process tasks in batches of MAX_CONCURRENT_TASKS
    while (taskQueue.length > 0) {
      const batch = taskQueue.splice(0, MAX_CONCURRENT_TASKS);
      const artifactSummaryForBatch = buildTaskArtifactSummary(taskArtifactEntries);
      const batchResults = await Promise.all(
        batch.map(async (task) => {
          const scopedTaskContext = buildScopedTaskContext({
            buildId,
            task,
            plan: normalizedPlan.plan,
            artifactSummary: artifactSummaryForBatch,
            rawBuildContext: buildContext,
          });
          const specialistResult = await dispatchSpecialist({
            task,
            userId,
            platformRole,
            isSuperuser,
            buildId,
            buildContext: scopedTaskContext,
            parentThreadId,
            priorResults: artifactSummaryForBatch || undefined,
            dispatchConfig: preflightConfig,
            // sessionId omitted — see Layer 1 comment above
          });
          const artifactEntry = buildTaskArtifactEntry({
            task: specialistResult.task,
            outcome: specialistResult.outcome,
            content: specialistResult.result.content,
            durationMs: "durationMs" in specialistResult.result ? specialistResult.result.durationMs : undefined,
          });
          await saveTaskPhaseHandoff({
            buildId,
            userId,
            parentThreadId,
            entry: artifactEntry,
          });
          return specialistResult;
        }),
      );
      phaseResults.push(...batchResults);
      taskArtifactEntries.push(...batchResults.map((sr) => buildTaskArtifactEntry({
        task: sr.task,
        outcome: sr.outcome,
        content: sr.result.content,
        durationMs: "durationMs" in sr.result ? sr.result.durationMs : undefined,
      })));

      // BI-F72C1044: stop the dispatch storm the moment the provider reports a
      // usage-limit. Drop the rest of THIS phase's queue and signal the outer
      // loop to skip remaining phases — the cap applies to the whole build.
      if (batchResults.some((sr) => isUsageLimitDispatchOutput(sr.result.content))) {
        usageLimitAborted = true;
        const dropped = taskQueue.length;
        taskQueue.length = 0;
        console.warn(
          `[orchestrator] usage-limit fast-abort (BI-F72C1044): provider capped — ` +
            `stopped dispatching ${dropped} remaining task(s) in this phase and skipping ` +
            `remaining phases for build ${buildId}. They stay pending for a retry once the cap resets.`,
        );
        agentEventBus.emit(parentThreadId, {
          type: "orchestrator:phase_summary",
          buildId,
          completed: allResults.filter((r) => r.success).length,
          total: totalTasks,
          summary:
            `Paused: the build provider hit its usage limit. Remaining tasks were not ` +
            `dispatched (no point firing into an exhausted cap). Retry once the cap resets ` +
            `or switch the Build Studio provider.`,
        });
        break;
      }
    }

    // Collect results and build prior context for next phase
    for (const sr of phaseResults) {
      allResults.push(sr);

      const roleLabel = ROLE_LABELS[sr.task.specialist];
      // Clean outcome for user-facing events; downstream specialists receive
      // the compact artifact ledger instead of raw specialist stdout.
      const cleanOutcome = sanitizeSpecialistOutput(sr.result.content.slice(0, 300));

      // Emit completion event with structured outcome
      agentEventBus.emit(parentThreadId, {
        type: "orchestrator:task_complete",
        buildId,
        taskTitle: sr.task.title,
        specialist: roleLabel,
        outcome: cleanOutcome,
        status: sr.outcome,
      });

      // Downstream specialists receive the compact artifact summary created
      // after task completion, not raw specialist stdout or full thread history.
    }

    // Emit phase summary
    const completed = allResults.filter(r => r.success).length;
    agentEventBus.emit(parentThreadId, {
      type: "orchestrator:phase_summary",
      buildId,
      completed,
      total: totalTasks,
      summary: `Phase ${phase.phaseIndex + 1} complete.`,
    });

    // BI-F72C1044: the provider is capped for the whole build — don't start the
    // next phase's dispatches into the same exhausted cap.
    if (usageLimitAborted) break;
  }

  // Save verification evidence and trigger phase advance (build → review)
  // The QA specialist's result contains test/typecheck output — persist it
  // so the phase gate can evaluate and auto-advance.
  const qaResult = allResults.find(r => r.task.specialist === "qa-engineer");
  if (qaResult) {
    try {
      const { executeTool } = await import("@/lib/mcp-tools");
      const qaContent = qaResult.result.content;
      const verification = parseQAVerification(qaContent);

      // Scope the gate verdict to the build's changed files. A QA specialist may
      // run a wider pass than the feature's own surface (a stray "run full test
      // suite" task, or `tsc` over all of apps/web), so a pre-existing failure
      // ELSEWHERE in the repo would otherwise flip typecheckPassed=false and
      // block a build whose own files are clean (the FB-69231490 stall).
      // Neutralize out-of-scope noise here while preserving the full-repo signal.
      let changedFiles: string[] = [];
      try {
        const { getSandboxStateForBuild } = await import("@/lib/build/sandbox-state");
        const sandboxState = await getSandboxStateForBuild(buildId);
        changedFiles = sandboxState?.sourceDiffstat.map((entry) => entry.path) ?? [];
      } catch (err) {
        console.warn("[orchestrator] could not resolve changed files for gate scoping:", (err as Error)?.message);
      }
      const { scopeVerificationOutputForGate } = await import("@/lib/build/scoped-verification");
      const { normalizeVerificationOutput } = await import("@/lib/build/verification-output");
      const scoped = scopeVerificationOutputForGate({
        verification: normalizeVerificationOutput({ ...verification, fullOutput: qaContent }),
        changedFiles,
      });

      await executeTool("saveBuildEvidence", {
        field: "verificationOut",
        value: {
          ...verification,
          // Gate-facing fields reflect the changed surface, not the whole repo.
          typecheckPassed: scoped.typecheckPassed ?? verification.typecheckPassed,
          testsFailed: scoped.testsFailed ?? verification.testsFailed,
          testsPassed: scoped.testsPassed ?? verification.testsPassed,
          outOfScopeNoise: scoped.outOfScopeNoise,
          globalTestsFailed: scoped.globalTestsFailed,
          failureAxis: scoped.failureAxis,
          scopedToChangedFiles: changedFiles,
          fullOutput: qaContent.slice(0, 2000),
          timestamp: new Date().toISOString(),
        },
      }, userId, { routeContext: "/build", agentId: "AGT-ORCH-300", threadId: parentThreadId });

      // BI-99B06AD1 — build/codegen verification → bounded fix loop. If THIS
      // build's own changed surface failed typecheck/tests, don't just stall at
      // the build→review gate: dispatch a scoped repair coding turn (failing
      // files + the real error), re-verify directly via runSandboxTests, repeat
      // up to N rounds, then fall through to the gate (which stalls/escalates as
      // before). Additive + bounded; the outer catch makes it regression-safe.
      if (
        changedFiles.length > 0 &&
        verificationNeedsRepair({ typecheckPassed: scoped.typecheckPassed, testsFailed: scoped.testsFailed })
      ) {
        const repairRole =
          allResults.find((r) => r.task.specialist !== "qa-engineer")?.task.specialist ??
          allResults[0]?.task.specialist ??
          "software-engineer";
        const containerId = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
        const loop = await runVerificationRepairLoop({
          initial: {
            typecheckPassed: scoped.typecheckPassed,
            testsFailed: scoped.testsFailed,
            failureAxis: scoped.failureAxis,
            output: qaContent,
          },
          changedFiles,
          maxRounds: VERIFICATION_REPAIR_MAX_ROUNDS,
          log: (m) =>
            agentEventBus.emit(parentThreadId, {
              type: "orchestrator:task_progress",
              buildId,
              taskTitle: "verification-repair",
              message: m,
            }),
          dispatchRepair: async (spec) => {
            const repairTask: AssignedTask = {
              taskIndex: allResults.length,
              title: spec.title,
              specialist: repairRole,
              files: spec.failingFiles.map((path) => ({ path, action: "modify" as const, purpose: "fix verification failure" })),
              task: { title: spec.title, testFirst: "", implement: spec.implement, verify: spec.verify },
            };
            const res = await dispatchSpecialist({
              task: repairTask, userId, platformRole, isSuperuser, buildId, buildContext, parentThreadId,
              dispatchConfig: preflightConfig,
            });
            allResults.push(res);
            return res.success;
          },
          reverify: async () => {
            const { runSandboxTests } = await import("./coding-agent");
            const r = await runSandboxTests(containerId, { changedFiles });
            const fullOutput = `${r.typeCheckOutput}\n${r.testOutput}`;
            const reNorm = normalizeVerificationOutput({
              typecheckPassed: r.typeCheckPassed,
              testsFailed: r.passed ? 0 : 1,
              testsPassed: r.passed ? 1 : 0,
              fullOutput,
            });
            const reScoped = scopeVerificationOutputForGate({ verification: reNorm, changedFiles });
            return {
              typecheckPassed: reScoped.typecheckPassed,
              testsFailed: reScoped.testsFailed,
              failureAxis: reScoped.failureAxis,
              output: fullOutput,
            };
          },
        });

        if (loop.rounds > 0) {
          // Persist the post-repair verdict so the phase gate evaluates the
          // repaired state rather than the pre-repair failure.
          await executeTool("saveBuildEvidence", {
            field: "verificationOut",
            value: {
              ...verification,
              typecheckPassed: loop.final.typecheckPassed ?? scoped.typecheckPassed,
              testsFailed: loop.final.testsFailed ?? scoped.testsFailed,
              testsPassed: loop.repaired ? 1 : (scoped.testsPassed ?? verification.testsPassed),
              outOfScopeNoise: scoped.outOfScopeNoise,
              globalTestsFailed: scoped.globalTestsFailed,
              failureAxis: loop.final.failureAxis,
              scopedToChangedFiles: changedFiles,
              fullOutput: (loop.final.output ?? qaContent).slice(0, 2000),
              timestamp: new Date().toISOString(),
              verificationRepairRounds: loop.rounds,
              verificationRepaired: loop.repaired,
            },
          }, userId, { routeContext: "/build", agentId: "AGT-ORCH-300", threadId: parentThreadId });
          await prisma.buildActivity.create({
            data: {
              buildId,
              tool: "build:verification-repair",
              summary: `Ran ${loop.rounds} scoped verification-repair round(s); repaired=${loop.repaired}. (BI-99B06AD1)`,
            },
          }).catch(() => { /* audit best-effort */ });
        }
      }
    } catch (err) {
      console.error("[orchestrator] Failed to save verification evidence:", err);
    }
  }

  // Persist task results with optimistic locking to prevent concurrent overwrites.
  // Uses taskResultsVersion to detect if another process modified results since we
  // read them at the start. On version mismatch, re-reads and retries once.
  try {
    const newTaskResults = allResults.map(r => {
      const artifact = buildTaskArtifactEntry({
        task: r.task,
        outcome: r.outcome,
        content: r.result.content,
        durationMs: "durationMs" in r.result ? r.result.durationMs : undefined,
      });
      return {
        taskIndex: artifact.taskIndex,
        title: r.task.title,
        specialist: r.task.specialist,
        outcome: r.outcome,
        durationMs: artifact.durationMs ?? 0,
        files: artifact.files,
        artifactSummary: artifact.summary,
        verification: artifact.verification,
      };
    });

    const MAX_MERGE_RETRIES = 1;
    for (let attempt = 0; attempt <= MAX_MERGE_RETRIES; attempt++) {
      // Re-read current state for merge (on retry, this picks up the other writer's data)
      let currentVersion = taskResultsVersion;
      let priorTasks: StoredTaskResult[] = [];
      try {
        const build = await prisma.featureBuild.findUnique({
          where: { buildId },
          select: { taskResults: true, taskResultsVersion: true },
        });
        currentVersion = build?.taskResultsVersion ?? 0;
        const stored = build?.taskResults as { tasks?: StoredTaskResult[] } | null;
        const newTaskTitles = new Set(newTaskResults.map(t => t.title));
        priorTasks = (stored?.tasks ?? []).filter(t => !newTaskTitles.has(t.title));
      } catch (err) {
        console.error("[orchestrator] Failed to re-read stored results for merge:", err);
      }

      const mergedTasks = [...priorTasks, ...newTaskResults];
      const completedCount = mergedTasks.filter(t => t.outcome === "DONE" || t.outcome === "DONE_WITH_CONCERNS").length;
      const taskResultsValue = {
        completedTasks: completedCount,
        totalTasks,
        timedOut: Date.now() - startTime > MAX_DURATION_ORCHESTRATOR_MS,
        tasks: mergedTasks,
        timestamp: new Date().toISOString(),
      };

      // Optimistic lock: only update if version hasn't changed since our read
      const updated = await prisma.featureBuild.updateMany({
        where: { buildId, taskResultsVersion: currentVersion },
        data: {
          taskResults: taskResultsValue as unknown as import("@dpf/db").Prisma.InputJsonValue,
          taskResultsVersion: currentVersion + 1,
        },
      });

      if (updated.count > 0) {
        // Success — emit evidence event for SSE subscribers
        if (parentThreadId) {
          agentEventBus.emit(parentThreadId, { type: "evidence:update", buildId, field: "taskResults" });
        }
        break;
      }

      // Version mismatch — another writer updated since our read
      if (attempt < MAX_MERGE_RETRIES) {
        console.warn(`[orchestrator] taskResults version conflict (expected ${currentVersion}), retrying merge`);
      } else {
        console.error(`[orchestrator] taskResults merge failed after ${MAX_MERGE_RETRIES + 1} attempts — version conflict persists`);
      }
    }
  } catch (err) {
    console.error("[orchestrator] Failed to save task results:", err);
  }

  // Auto-advance build → review if the phase gate is satisfied.
  // NOTE: Cannot call advanceBuildPhase (server action) here because auth()
  // has no HTTP request context inside the agentic loop. Direct DB update instead.
  try {
    const { checkPhaseGate, canTransitionPhase } = await import("@/lib/feature-build-types");
    const updatedBuild = await prisma.featureBuild.findUnique({ where: { buildId } });
    // The synthetic QA task (taskIndex === -1, "Full verification: tests +
    // typecheck") is dispatched to the model, which runs the full suite via
    // opencode — flaky and slow on a local model (observed: 61s pass for one
    // build, then a 301s rate-limit FAILURE for the next) and REDUNDANT: the
    // authoritative verification is the scoped checkPhaseGate below, which reads
    // the saved verificationOut. A failed model-run QA task must NOT block the
    // build→review advance, or ~half of all builds strand at `build` forever.
    const hasBlockingTasks = allResults.some(
      (r) =>
        (r.outcome === "BLOCKED" || r.outcome === "NEEDS_CONTEXT") &&
        r.task.taskIndex !== -1,
    );
    if (!hasBlockingTasks && updatedBuild && updatedBuild.phase === "build" && canTransitionPhase("build", "review")) {
      // Scope the verification to THIS build's changed files before gating.
      // A pre-existing typecheck/test failure ELSEWHERE in the repo (e.g. an
      // unrelated broken test, a stale sandbox) otherwise sets
      // verificationOut.typecheckPassed=false and stalls EVERY build at
      // build->review even though the build's OWN files are clean — observed
      // live: a build's full-suite verification hit an unrelated rolldown parse
      // error and never advanced. getScopedVerificationForBuild nulls
      // out-of-scope failures; treat null (out-of-scope only) as a pass, keep an
      // in-scope failure (false) blocking.
      let verificationForGate: Record<string, unknown> | unknown = updatedBuild.verificationOut;
      try {
        const { getScopedVerificationForBuild } = await import("@/lib/build/scoped-verification");
        const scoped = await getScopedVerificationForBuild(buildId);
        if (scoped) {
          verificationForGate = {
            ...((updatedBuild.verificationOut ?? {}) as Record<string, unknown>),
            typecheckPassed: scoped.buildScoped.typecheckPassed ?? true,
            testsFailed: scoped.buildScoped.testsFailed ?? 0,
          };
        }
      } catch (scopeErr) {
        console.warn("[orchestrator] scoped verification for gate failed; using raw verificationOut:", (scopeErr as Error)?.message);
      }
      const gate = checkPhaseGate("build", "review", {
        verificationOut: verificationForGate as typeof updatedBuild.verificationOut,
      });
      if (gate.allowed) {
        await prisma.featureBuild.update({ where: { buildId }, data: { phase: "review" } });
        await queueBuildReviewVerification(buildId);
        agentEventBus.emit(parentThreadId, { type: "phase:change", buildId, phase: "review" });
        prisma.buildActivity.create({ data: { buildId, tool: "phase:advance", summary: "Phase advanced: build → review" } }).catch((err: unknown) => console.warn("[orchestrator] buildActivity create failed:", (err as Error)?.message));
      }
    }
  } catch (err) {
    console.error("[orchestrator] Failed to auto-advance to review:", err);
    agentEventBus.emit(parentThreadId, {
      type: "orchestrator:warning",
      buildId,
      message: "Build completed but could not auto-advance to review phase. You can advance manually.",
    });
  }

  // Synthesize final result (include skipped tasks in completed count)
  // The synthetic QA task (taskIndex === -1) is advisory — its model-run failure
  // is not a build failure (the authoritative verification is the phase gate).
  // Count it as completed, never failed, so the summary + "needs attention"
  // messaging stay accurate when only the redundant QA task fails.
  const completedTasks = allResults.filter(r => r.success || r.task.taskIndex === -1).length + completedTaskTitles.size;
  const failedTasks = allResults.filter(r => !r.success && r.task.taskIndex !== -1).length;
  const totalInputTokens = allResults.reduce((sum, r) => sum + ("totalInputTokens" in r.result ? r.result.totalInputTokens : 0), 0);
  const totalOutputTokens = allResults.reduce((sum, r) => sum + ("totalOutputTokens" in r.result ? r.result.totalOutputTokens : 0), 0);

  const summary: BuildSummary = {
    totalTasks,
    completedTasks,
    failedTasks,
    specialistSummaries: allResults.map(r => ({
      role: r.task.specialist,
      taskTitle: r.task.title,
      status: r.outcome,
      outcome: sanitizeSpecialistOutput(r.result.content.slice(0, 300)),
    })),
  };

  // BI-9EA09823 — best-effort, additive: a build that failed (a failed task or a
  // BLOCKED/NEEDS_CONTEXT task that never advanced to review) lands a
  // fingerprinted corrective BI. Keyed on the sorted role:title of the failing
  // tasks — NOT buildId — so the same feature failing the same way increments
  // occurrenceCount instead of spamming a new item on every rebuild.
  const blockingTasks = allResults.filter(
    r => !r.success || r.outcome === "BLOCKED" || r.outcome === "NEEDS_CONTEXT",
  );
  if (blockingTasks.length > 0) {
    try {
      const { captureCorrectiveFailureBI } = await import("@/lib/backlog/capture-corrective-bi");
      const signature = blockingTasks
        .map(r => `${r.task.specialist}:${r.task.title}`)
        .sort()
        .join("|");
      await captureCorrectiveFailureBI({
        source: "build-failure",
        signature,
        title: `[build-failure] ${blockingTasks.length} task(s) failed: ${blockingTasks[0]!.task.title}`.slice(0, 200),
        body: [
          `buildId: ${buildId}`,
          `failedTasks: ${failedTasks}`,
          ``,
          ...blockingTasks.map(
            r => `- [${r.outcome}] ${r.task.specialist} / ${r.task.title}: ${sanitizeSpecialistOutput(r.result.content.slice(0, 200))}`,
          ),
        ].join("\n"),
      });
    } catch (err) {
      console.error("[orchestrator] corrective-BI capture failed:", err);
    }
  }

  return {
    content: formatBuildCompleteMessage(summary),
    totalTasks,
    completedTasks,
    failedTasks,
    specialistResults: allResults,
    totalInputTokens,
    totalOutputTokens,
  };
}
