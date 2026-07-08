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
// ORACLE-PURITY asserts nothing ran outside that surface. Execution goes
// through runAgenticLoop directly (not executeAutonomousAgenticLoop) with
// interactionMode "chat" and a synthetic threadId, so no AgentThread /
// AgentMessage / TaskRun / reflection-observer rows are created — the only
// writes are the governed ToolExecution audit rows and the assurance records
// this module owns.

import { prisma } from "@dpf/db";
import { COWORKER_AGENT_SEEDS } from "@dpf/db/workforce-seed";
import { runAgenticLoop } from "@/lib/tak/agentic-loop";
import {
  resolveAutonomousWorkAgent,
  resolveAutonomousWorkTools,
  type AutonomousWorkUserContext,
} from "@/lib/tak/autonomous-work-run";
import { toolsToOpenAIFormat } from "@/lib/mcp-tools";
import { applyProviderRouteModelPreference } from "@/lib/ai-provider-route-context";
import { ROUTE_AGENT_MAP_ENTRIES } from "@/lib/tak/agent-routing";
import { journeysForCoworker, type GoldenJourney } from "./golden-journeys";
import {
  evaluateJourneyOracles,
  journeyPassed,
  type OracleVerdict,
} from "./certification-oracles";

import { COWORKER_CERT_ADAPTER_KEY } from "./certification-status";

export { COWORKER_CERT_ADAPTER_KEY };
export const COWORKER_CERT_ADAPTER_VERSION = "1.0.0";

export type JourneyResult = {
  journeyId: string;
  mode: GoldenJourney["mode"];
  passed: boolean;
  verdicts: OracleVerdict[];
  executedToolNames: string[];
  downgraded: boolean;
  durationMs: number;
};

export type CoworkerCertificationResult = {
  agentId: string;
  status: "passed" | "failed";
  runId: string;
  journeys: JourneyResult[];
};

export type CertificationSweepResult = {
  startedAt: Date;
  completedAt: Date;
  results: CoworkerCertificationResult[];
  passed: number;
  failed: number;
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

export type CertificationDeps = {
  resolveAgent: typeof resolveAutonomousWorkAgent;
  resolveTools: typeof resolveAutonomousWorkTools;
  runLoop: (params: {
    journey: GoldenJourney;
    systemPrompt: string;
    sensitivity: "public" | "internal" | "confidential" | "restricted";
    tools: Parameters<typeof toolsToOpenAIFormat>[0];
    toolsForProvider: Array<Record<string, unknown>>;
    userId: string;
    routeContext: string;
    modelRequirements?: Record<string, unknown>;
  }) => Promise<LoopResult>;
  db: typeof prisma;
  now: () => Date;
};

async function defaultRunLoop(
  params: Parameters<CertificationDeps["runLoop"]>[0],
): Promise<LoopResult> {
  const result = await runAgenticLoop({
    chatHistory: [{ role: "user", content: params.journey.prompt }],
    systemPrompt: params.systemPrompt,
    sensitivity: params.sensitivity,
    tools: params.tools,
    toolsForProvider: params.toolsForProvider,
    userId: params.userId,
    routeContext: params.routeContext,
    agentId: params.journey.agentId,
    threadId: `certification:${params.journey.journeyId}`,
    interactionMode: "chat",
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

function defaultDeps(): CertificationDeps {
  return {
    resolveAgent: resolveAutonomousWorkAgent,
    resolveTools: resolveAutonomousWorkTools,
    runLoop: defaultRunLoop,
    db: prisma,
    now: () => new Date(),
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
    });
    const resolved = await deps.resolveTools({
      userContext,
      mode: journey.mode,
      agentId: journey.agentId,
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
      sensitivity: agentInfo.sensitivity ?? "internal",
      tools: readOnlyTools,
      toolsForProvider,
      userId: userContext.userId,
      routeContext,
      modelRequirements,
    });

    const verdicts = evaluateJourneyOracles({
      content: loop.content,
      executedTools: loop.executedTools.map((t) => ({
        name: t.name,
        success: t.result.success,
      })),
      offeredToolNames: readOnlyTools.map((t) => t.name),
      downgraded: loop.downgraded,
    });

    return {
      journeyId: journey.journeyId,
      mode: journey.mode,
      passed: journeyPassed(verdicts),
      verdicts,
      executedToolNames: [...new Set(loop.executedTools.map((t) => t.name))],
      downgraded: loop.downgraded,
      durationMs: deps.now().getTime() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
  const status: "passed" | "failed" = journeys.every((j) => j.passed) ? "passed" : "failed";
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
    return { startedAt, completedAt: deps.now(), results: [], passed: 0, failed: 0 };
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
  };
}

