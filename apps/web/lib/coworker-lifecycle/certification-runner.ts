// Coworker certification runner (EP-COWORKER-LIFECYCLE Phase 2, BI-DE9CC88B).
//
// Sends each roster coworker's golden journeys through the REAL execution
// path — real persona resolution, real grant-filtered tool surface, real
// routing/model floor — judges the outcome with the certification oracles,
// and persists one AssuranceRun per coworker (scopeType="agent",
// adapterKey="coworker-cert") plus AssuranceFindings for each failed oracle.
//
// Non-destructive by construction: the tool surface is post-filtered to
// sideEffect=false tools, journeys instruct read-only behavior, and
// ORACLE-PURITY asserts nothing ran outside the authorization envelope
// (that offered surface, plus any grant-authorized side-effect-free catalog
// tool — native-mcp transports expose the full grant-derived read-only
// toolset, wider than the attachment list; BI-68BBF206). Execution goes
// through runAgenticLoop directly (not executeAutonomousAgenticLoop) with
// interactionMode "chat" and a synthetic threadId, so no AgentThread /
// AgentMessage / TaskRun / reflection-observer rows are created — the only
// writes are the governed ToolExecution audit rows and the assurance records
// this module owns.

import { coworkerBriefSpans } from "@/lib/tak/coworker-prompt-provenance";
import { prisma } from "@dpf/db";
import { COWORKER_AGENT_SEEDS } from "@dpf/db/workforce-seed";
import { runAgenticLoop } from "@/lib/tak/agentic-loop";
import type { RouteSensitivity } from "@/lib/agent-sensitivity";
import {
  resolveAutonomousWorkAgent,
  resolveAutonomousWorkTools,
  type AutonomousWorkUserContext,
} from "@/lib/tak/autonomous-work-run";
import { PLATFORM_TOOLS, toolsToOpenAIFormat } from "@/lib/mcp-tools";
import { getAgentToolGrantsAsync, isToolAllowedByGrants } from "@/lib/tak/agent-grants";
import { applyProviderRouteModelPreference } from "@/lib/ai-provider-route-context";
import { ROUTE_AGENT_MAP_ENTRIES } from "@/lib/tak/agent-routing";
import { journeysForCoworker, type GoldenJourney } from "./golden-journeys";
import {
  evaluateJourneyOracles,
  journeyPassed,
  type OracleVerdict,
  type ToolAuthorizationClass,
} from "./certification-oracles";

import { COWORKER_CERT_ADAPTER_KEY } from "./certification-status";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { isAdmissionTimeout } from "@/lib/inference/inference-admission";
import { classifyInferenceFailure } from "@/lib/build/inference-failure";

export { COWORKER_CERT_ADAPTER_KEY };
export const COWORKER_CERT_ADAPTER_VERSION = "1.0.0";

export type JourneyResult = {
  journeyId: string;
  mode: GoldenJourney["mode"];
  passed: boolean;
  /** The journey could not be assessed because inference never exercised the
   *  coworker — capacity backpressure, provider unavailability, or no eligible
   *  routed endpoint. Retained under its original serialized name for receipt
   *  compatibility. Such a run is never scored as a coworker failure. */
  capacityInconclusive: boolean;
  verdicts: OracleVerdict[];
  executedToolNames: string[];
  downgraded: boolean;
  durationMs: number;
};

export type CoworkerCertificationResult = {
  agentId: string;
  // "inconclusive" = at least one journey hit capacity backpressure and there was
  // no genuine failure; the run is requeued rather than passing or failing.
  status: "passed" | "failed" | "inconclusive";
  runId: string;
  journeys: JourneyResult[];
};

export type CertificationSweepResult = {
  startedAt: Date;
  completedAt: Date;
  results: CoworkerCertificationResult[];
  passed: number;
  failed: number;
  /** Runs left unresolved by inference capacity (not failures) — to be requeued. */
  inconclusive: number;
};

/** First route bound to the agent in ROUTE_AGENT_MAP; workspace as fallback. */
export function certificationRouteFor(agentId: string): string {
  const bound = ROUTE_AGENT_MAP_ENTRIES.find(([, entry]) => entry.agentId === agentId);
  return bound ? bound[0] : "/workspace";
}

type LoopResult = {
  content: string;
  downgraded: boolean;
  executedTools: Array<{ name: string; result: { success: boolean } }>;
};

/** One executed-tool evidence record, transport-agnostic. */
export type ToolEvidence = { name: string; success: boolean };

/** The thread name a journey executes under. Single source for both the loop
 *  dispatch and the governed-audit evidence query — they must never drift
 *  (journeyId is already `<agentId>/<journey>`, matching the live thread
 *  naming `certification:<agentId>/<journeyId>`). */
export function certificationThreadId(journeyId: string): string {
  return `certification:${journeyId}`;
}

export type CertificationDeps = {
  resolveAgent: typeof resolveAutonomousWorkAgent;
  resolveTools: typeof resolveAutonomousWorkTools;
  runLoop: (params: {
    journey: GoldenJourney;
    systemPrompt: string;
    /** Instruction spans within systemPrompt (BI-CE93E314). */
    systemPromptInstructionSpans?: string[];
    sensitivity: RouteSensitivity;
    tools: Parameters<typeof toolsToOpenAIFormat>[0];
    toolsForProvider: Array<Record<string, unknown>>;
    userId: string;
    routeContext: string;
    requireTools: boolean;
    modelRequirements?: Record<string, unknown>;
  }) => Promise<LoopResult>;
  /** Governed audit evidence (BI-68BBF206): the ToolExecution rows written for
   *  this journey's thread within the journey's execution window. The in-loop
   *  executed-tools list only sees calls the in-process loop dispatched itself;
   *  native-mcp transports execute the model's MCP tool calls inside the CLI
   *  subprocess against the governed MCP server, which writes ToolExecution
   *  audit rows the loop counter never observes. Oracles judge the UNION. */
  fetchToolEvidence: (params: {
    threadId: string;
    agentId: string;
    since: Date;
    until: Date;
  }) => Promise<ToolEvidence[]>;
  /** The agent's grant keys, resolved the same way the platform resolves them
   *  for tool gating (DB-first, JSON-registry fallback). Consulted only when
   *  executed evidence contains a tool outside the offered surface, to decide
   *  whether it was still inside the authorization envelope (BI-68BBF206). */
  fetchAgentGrants: (agentId: string) => Promise<string[]>;
  db: typeof prisma;
  now: () => Date;
};

async function defaultRunLoop(
  params: Parameters<CertificationDeps["runLoop"]>[0],
): Promise<LoopResult> {
  const result = await runAgenticLoop({
    chatHistory: [{ role: "user", content: params.journey.prompt }],
    systemPrompt: params.systemPrompt,
    systemPromptInstructionSpans: params.systemPromptInstructionSpans,
    sensitivity: params.sensitivity,
    tools: params.tools,
    toolsForProvider: params.toolsForProvider,
    userId: params.userId,
    routeContext: params.routeContext,
    agentId: params.journey.agentId,
    threadId: certificationThreadId(params.journey.journeyId),
    interactionMode: "chat",
    requireTools: params.requireTools,
    ...(params.modelRequirements && Object.keys(params.modelRequirements).length > 0
      ? { modelRequirements: params.modelRequirements }
      : {}),
  });
  return {
    content: result.content,
    downgraded: result.downgraded,
    executedTools: result.executedTools.map((t) => ({
      name: t.name,
      result: { success: t.result.success },
    })),
  };
}

async function defaultFetchToolEvidence(
  params: Parameters<CertificationDeps["fetchToolEvidence"]>[0],
): Promise<ToolEvidence[]> {
  // Scoped to one journey's thread AND agent AND its execution window: the
  // thread name is deterministic per journey, so the createdAt bounds are what
  // exclude rows from earlier sweeps that reused the same threadId. Bounded
  // take is belt-and-braces — a single journey executes a handful of calls.
  const rows = await prisma.toolExecution.findMany({
    where: {
      threadId: params.threadId,
      agentId: params.agentId,
      createdAt: { gte: params.since, lte: params.until },
    },
    select: { toolName: true, success: true },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  return rows.map((r) => ({ name: r.toolName, success: r.success }));
}

function defaultDeps(): CertificationDeps {
  return {
    resolveAgent: resolveAutonomousWorkAgent,
    resolveTools: resolveAutonomousWorkTools,
    runLoop: defaultRunLoop,
    fetchToolEvidence: defaultFetchToolEvidence,
    fetchAgentGrants: getAgentToolGrantsAsync,
    db: prisma,
    now: () => new Date(),
  };
}

/** Union in-loop and governed-audit tool evidence, deduped by (name, success).
 *  The in-loop list stays authoritative-and-cheap for in-process providers;
 *  the ToolExecution rows are the audited truth for transports (native-mcp
 *  CLI subprocess) whose calls never pass through the in-process counter. */
export function unionToolEvidence(
  inLoop: ToolEvidence[],
  governed: ToolEvidence[],
): ToolEvidence[] {
  const seen = new Set<string>();
  const union: ToolEvidence[] = [];
  for (const t of [...inLoop, ...governed]) {
    const key = `${t.success ? "ok" : "fail"}:${t.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    union.push(t);
  }
  return union;
}

/** Classify one executed tool against the authorization envelope
 *  (BI-68BBF206). The TAK grant registry defines authorization; the catalog's
 *  sideEffect flag defines consequence. A tool is inside the envelope only
 *  when it exists in the platform catalog, is DECLARED sideEffect:false, and
 *  the agent's grants allow it (same grant expansion the platform's tool
 *  gating uses). Everything else is outside: side-effecting, unauthorized, or
 *  unknown. Offered-surface tools never reach this — surface membership is
 *  the fast-path pass. */
export function classifyToolAuthorization(
  toolName: string,
  agentGrants: string[],
): ToolAuthorizationClass {
  const catalogEntry = PLATFORM_TOOLS.find((t) => t.name === toolName);
  if (!catalogEntry) return "unknown";
  if (catalogEntry.sideEffect !== false) return "side-effecting";
  return isToolAllowedByGrants(toolName, agentGrants)
    ? "grant-authorized-read-only"
    : "unauthorized";
}

function inferenceInconclusiveJourney(
  journey: GoldenJourney,
  startedAt: number,
  deps: CertificationDeps,
): JourneyResult {
  return {
    journeyId: journey.journeyId,
    mode: journey.mode,
    passed: false,
    capacityInconclusive: true,
    verdicts: [],
    executedToolNames: [],
    downgraded: false,
    durationMs: deps.now().getTime() - startedAt,
  };
}

async function executeJourney(
  journey: GoldenJourney,
  userContext: AutonomousWorkUserContext & { userId: string },
  deps: CertificationDeps,
): Promise<JourneyResult> {
  const startedAt = deps.now().getTime();
  const routeContext = certificationRouteFor(journey.agentId);

  try {
    const agentInfo = await deps.resolveAgent({
      agentId: journey.agentId,
      routeContext,
      userContext,
      // Bypass the Phase 3 lifecycle gate: certification is how a draft or
      // failed coworker earns activation — gating it would deadlock.
      purpose: "certification",
    });
    const resolved = await deps.resolveTools({
      userContext,
      mode: journey.mode,
      agentId: journey.agentId,
      // The journey MUST resolve its tools under the same route the agent was
      // resolved for. routeContext is what force-attaches a route's declared
      // domain tools (tier 0); without it the journey's central tool is absent
      // from the available list and the loop refuses the call as "not available
      // on this page" — so the journey can never pass, for reasons unrelated to
      // the coworker, its grants, or the tool (BI-8D5BB185).
      routeContext,
    });
    // Non-destructive surface: certification only ever offers read-only tools.
    const readOnlyTools = resolved.tools.filter((t) => !t.sideEffect);
    const toolsForProvider = toolsToOpenAIFormat(readOnlyTools);

    const rawRequirements =
      (agentInfo.modelRequirements as Record<string, unknown> | undefined) ?? undefined;
    const modelRequirements = rawRequirements
      ? applyProviderRouteModelPreference(rawRequirements, routeContext)
      : undefined;

    const loop = await deps.runLoop({
      journey,
      systemPrompt: agentInfo.systemPrompt,
      systemPromptInstructionSpans: coworkerBriefSpans(agentInfo.systemPrompt),
      sensitivity: agentInfo.sensitivity ?? "internal",
      tools: readOnlyTools,
      toolsForProvider,
      userId: userContext.userId,
      routeContext,
      requireTools: true,
      modelRequirements,
    });

    // runAgenticLoop intentionally converts routing/dispatch failures into
    // operator-safe content instead of throwing. Any canonical inference-failure
    // reply means the model never produced a behavioral answer, so certification
    // has no coworker behavior to score. This includes non-transient configuration
    // gaps: bounded scheduling decides whether to retry, while the AssuranceRun
    // remains honestly inconclusive rather than falsely failing the coworker.
    if (classifyInferenceFailure(loop.content) !== null) {
      return inferenceInconclusiveJourney(journey, startedAt, deps);
    }

    // BI-68BBF206: under native-mcp dispatch the model's tool calls execute
    // inside the CLI subprocess against the governed MCP server — ToolExecution
    // audit rows are written, but the in-process executedTools list stays
    // empty, so ORACLE-TOOL read every journey as "attempted: none". The
    // audited rows are the source of truth for governed tool use; union them
    // with the in-loop list (which remains correct — and cheaper — for
    // in-process providers) and judge the union.
    const inLoopEvidence: ToolEvidence[] = loop.executedTools.map((t) => ({
      name: t.name,
      success: t.result.success,
    }));
    let governedEvidence: ToolEvidence[] = [];
    try {
      governedEvidence = await deps.fetchToolEvidence({
        threadId: certificationThreadId(journey.journeyId),
        agentId: journey.agentId,
        since: new Date(startedAt),
        until: deps.now(),
      });
    } catch {
      // An audit-read failure must not fail the coworker: fall back to the
      // in-loop evidence only (the pre-fix behavior), never to a verdict.
    }
    const executedTools = unionToolEvidence(inLoopEvidence, governedEvidence);

    // BI-68BBF206 follow-up: under native-mcp dispatch the CLI subprocess
    // exposes the coworker's FULL grant-derived read-only MCP toolset, while
    // readOnlyTools above is the narrower attachment the runner offered — so
    // governed evidence routinely contains grant-authorized side-effect-free
    // calls the attachment list never named. PURITY guards the authorization
    // envelope, not attachment membership: classify every executed tool that
    // is outside the offered surface (in-loop and DB-derived alike — the rule
    // is uniform, and offered-surface tools always pass) against the catalog's
    // sideEffect declaration and the agent's grants.
    const offeredToolNames = readOnlyTools.map((t) => t.name);
    const offeredSet = new Set(offeredToolNames);
    let judgedTools: Array<ToolEvidence & { authorization?: ToolAuthorizationClass }> =
      executedTools;
    if (executedTools.some((t) => !offeredSet.has(t.name))) {
      let agentGrants: string[] = [];
      try {
        agentGrants = await deps.fetchAgentGrants(journey.agentId);
      } catch {
        // Conservative on failure: with no resolvable grants, a non-offered
        // tool cannot be proven authorized, so it fails PURITY as
        // unauthorized rather than silently passing. (The default resolver
        // already falls back to the JSON registry internally, so this path is
        // a hard infra failure, not a routine miss.)
      }
      judgedTools = executedTools.map((t) =>
        offeredSet.has(t.name)
          ? t
          : { ...t, authorization: classifyToolAuthorization(t.name, agentGrants) },
      );
    }

    const verdicts = evaluateJourneyOracles({
      content: loop.content,
      executedTools: judgedTools,
      offeredToolNames,
      downgraded: loop.downgraded,
    });

    return {
      journeyId: journey.journeyId,
      mode: journey.mode,
      passed: journeyPassed(verdicts),
      capacityInconclusive: false,
      verdicts,
      executedToolNames: [...new Set(executedTools.map((t) => t.name))],
      downgraded: loop.downgraded,
      durationMs: deps.now().getTime() - startedAt,
    };
  } catch (error) {
    // Capacity backpressure, not a coworker failure: the engine was at its
    // ceiling and the (patient, autonomous) admission wait was exhausted. Mark
    // the journey inconclusive with NO failure verdicts, so the run is requeued
    // and the coworker is never wrongly failed for a busy box.
    if (isAdmissionTimeout(error)) {
      return inferenceInconclusiveJourney(journey, startedAt, deps);
    }
    const message = getErrorMessage(error);
    const verdicts = evaluateJourneyOracles({
      content: "",
      executedTools: [],
      offeredToolNames: [],
      downgraded: false,
      executionError: message,
    });
    return {
      journeyId: journey.journeyId,
      mode: journey.mode,
      passed: false,
      capacityInconclusive: false,
      verdicts,
      executedToolNames: [],
      downgraded: false,
      durationMs: deps.now().getTime() - startedAt,
    };
  }
}

function certFindingKey(agentId: string, oracleId: string, journeyId: string): string {
  return `coworker-cert:${agentId}:${journeyId}:${oracleId}`;
}

async function persistCoworkerRun(
  agentId: string,
  journeys: JourneyResult[],
  deps: CertificationDeps,
): Promise<CoworkerCertificationResult> {
  const at = deps.now();
  // A GENUINE failure (a journey that ran and failed an oracle) trumps capacity
  // backpressure — a broken coworker must not hide behind a busy box. Only a run
  // with no genuine failures but some capacity-inconclusive journeys is
  // "inconclusive" (requeued); an all-passed run is "passed".
  const genuineFailure = journeys.some((j) => !j.passed && !j.capacityInconclusive);
  const anyInconclusive = journeys.some((j) => j.capacityInconclusive);
  const status: "passed" | "failed" | "inconclusive" = genuineFailure
    ? "failed"
    : anyInconclusive
      ? "inconclusive"
      : "passed";
  const runId = `assurance_coworker_cert_${agentId}_${at.toISOString().replace(/[^a-zA-Z0-9]/g, "_")}`;

  await deps.db.assuranceRun.create({
    data: {
      runId,
      scopeType: "agent",
      scopeId: agentId,
      adapterKey: COWORKER_CERT_ADAPTER_KEY,
      adapterVersion: COWORKER_CERT_ADAPTER_VERSION,
      status,
      startedAt: at,
      completedAt: deps.now(),
      summary: {
        agentId,
        journeys: journeys.map((j) => ({
          journeyId: j.journeyId,
          passed: j.passed,
          capacityInconclusive: j.capacityInconclusive,
          executedToolNames: j.executedToolNames,
          downgraded: j.downgraded,
          durationMs: j.durationMs,
          verdicts: j.verdicts,
        })),
      },
    },
  });

  const failedVerdicts = journeys.flatMap((j) =>
    j.verdicts.filter((v) => !v.passed).map((v) => ({ journey: j, verdict: v })),
  );
  const activeKeys: string[] = [];
  for (const { journey, verdict } of failedVerdicts) {
    const findingKey = certFindingKey(agentId, verdict.oracleId, journey.journeyId);
    activeKeys.push(findingKey);
    const base = {
      findingKind: "coworker-certification",
      title: `${agentId}: ${verdict.oracleId} failed on ${journey.journeyId}`,
      description: verdict.detail,
      affectedType: "agent",
      affectedId: agentId,
      adapterKey: COWORKER_CERT_ADAPTER_KEY,
      vendorIdentifier: verdict.oracleId,
      policySeverity: verdict.oracleId === "ORACLE-SURFACE" ? "medium" : "high",
      releaseImpact: "track",
      lastSeenAt: at,
      source: { adapterKey: COWORKER_CERT_ADAPTER_KEY, journeyId: journey.journeyId },
      evidence: { verdicts: journey.verdicts, executedToolNames: journey.executedToolNames },
    };
    const existing = await deps.db.assuranceFinding.findUnique({ where: { findingKey } });
    if (existing) {
      await deps.db.assuranceFinding.update({
        where: { findingKey },
        data: {
          ...base,
          ...(existing.status === "resolved"
            ? { status: "open", resolvedAt: null, reopenCount: { increment: 1 } }
            : {}),
        },
      });
    } else {
      await deps.db.assuranceFinding.create({
        data: { ...base, findingKey, status: "open", firstSeenAt: at },
      });
    }
  }

  // Absent-clean: oracle findings for this agent that did not reproduce are resolved.
  await deps.db.assuranceFinding.updateMany({
    where: {
      findingKey: { startsWith: `coworker-cert:${agentId}:`, notIn: activeKeys },
      status: { in: ["open", "planned", "blocked"] },
    },
    data: { status: "resolved", resolvedAt: at },
  });

  return { agentId, status, runId, journeys };
}

/** Resolve the operator identity certification runs execute as. */
export async function resolveCertificationUserContext(
  db: typeof prisma = prisma,
): Promise<(AutonomousWorkUserContext & { userId: string }) | null> {
  const owner = await db.user.findFirst({
    where: { isSuperuser: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!owner) return null;
  return { userId: owner.id, platformRole: null, isSuperuser: true };
}

export async function runCoworkerCertificationSweep(options?: {
  agentIds?: string[];
  deps?: Partial<CertificationDeps>;
}): Promise<CertificationSweepResult> {
  const deps: CertificationDeps = { ...defaultDeps(), ...options?.deps };
  const startedAt = deps.now();

  const roster = COWORKER_AGENT_SEEDS.map((seed) => seed.agentId).filter(
    (agentId) => !options?.agentIds || options.agentIds.includes(agentId),
  );

  const userContext = await resolveCertificationUserContext(deps.db);
  if (!userContext) {
    return { startedAt, completedAt: deps.now(), results: [], passed: 0, failed: 0, inconclusive: 0 };
  }

  const results: CoworkerCertificationResult[] = [];
  for (const agentId of roster) {
    const journeyResults: JourneyResult[] = [];
    for (const journey of journeysForCoworker(agentId)) {
      journeyResults.push(await executeJourney(journey, userContext, deps));
    }
    results.push(await persistCoworkerRun(agentId, journeyResults, deps));
  }

  return {
    startedAt,
    completedAt: deps.now(),
    results,
    passed: results.filter((r) => r.status === "passed").length,
    failed: results.filter((r) => r.status === "failed").length,
    inconclusive: results.filter((r) => r.status === "inconclusive").length,
  };
}
