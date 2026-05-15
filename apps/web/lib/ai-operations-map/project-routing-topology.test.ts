import { describe, expect, it } from "vitest";
import {
  projectRoutingTopology,
  type RoutingDecisionSourceRow,
  type RoutingProviderSourceRow,
  type RoutingRouteOutcomeSourceRow,
  type RoutingScheduledAgentTaskSourceRow,
  type RoutingScheduledJobSourceRow,
  type RoutingTokenUsageSourceRow,
} from "./project-routing-topology";

describe("AI operations routing topology projection", () => {
  it("projects selected provider routes with decision and governance markers", () => {
    const topology = projectRoutingTopology({
      agents: [
        { agentId: "build-specialist", name: "Build Specialist", stationLabel: "Build" },
      ],
      providers: [
        makeProvider({ providerId: "anthropic", name: "Claude", category: "external" }),
        makeProvider({ providerId: "openai", name: "OpenAI / Codex", category: "external" }),
      ],
      endpointProfiles: [],
      routeDecisions: [
        makeDecision({
          id: "decision-1",
          agentMessageId: "build-specialist",
          selectedEndpointId: "anthropic:claude-sonnet",
          selectedModelId: "claude-sonnet",
          sensitivity: "confidential",
          candidateTrace: [
            makeCandidate({ endpointId: "anthropic:claude-sonnet", providerId: "anthropic", modelId: "claude-sonnet" }),
            makeCandidate({ endpointId: "openai:gpt-5.4", providerId: "openai", modelId: "gpt-5.4" }),
          ],
        }),
      ],
      tokenUsage: [],
      routeOutcomes: [],
      scheduledAgentTasks: [],
      scheduledJobs: [],
      now: new Date("2026-05-13T15:00:00.000Z"),
    });

    expect(topology.coworkers.map((coworker) => coworker.agentId)).toEqual(["build-specialist"]);
    expect(topology.providers.map((provider) => [provider.providerId, provider.label, provider.kind])).toEqual([
      ["anthropic", "Claude", "cloud"],
      ["openai", "OpenAI / Codex", "cloud"],
    ]);
    expect(topology.routes).toEqual([
      expect.objectContaining({
        id: "route:decision-1:anthropic",
        coworkerId: "build-specialist",
        providerId: "anthropic",
        state: "active",
        label: "Build Specialist to Claude",
      }),
    ]);
    expect(topology.markers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "decision", label: "Route decision" }),
        expect.objectContaining({ type: "governance", label: "Confidential route" }),
      ]),
    );
  });

  it("projects fallback routes and error markers from fallback history", () => {
    const topology = projectRoutingTopology({
      agents: [{ agentId: "ea-architect", name: "EA Architect", stationLabel: "Integrate" }],
      providers: [
        makeProvider({ providerId: "anthropic", name: "Claude" }),
        makeProvider({ providerId: "local", name: "Local LLM", category: "local", baseUrl: "http://localhost:11434" }),
      ],
      endpointProfiles: [],
      routeDecisions: [
        makeDecision({
          id: "decision-2",
          agentMessageId: "ea-architect",
          selectedEndpointId: "local:llama3",
          fallbackChain: ["anthropic:claude-sonnet", "local:llama3"],
          fallbacksUsed: [
            { endpointId: "anthropic:claude-sonnet", error: "provider 5xx", timestamp: "2026-05-13T14:58:00.000Z" },
          ],
          candidateTrace: [
            makeCandidate({ endpointId: "local:llama3", providerId: "local", modelId: "llama3" }),
            makeCandidate({ endpointId: "anthropic:claude-sonnet", providerId: "anthropic", modelId: "claude-sonnet" }),
          ],
        }),
      ],
      tokenUsage: [],
      routeOutcomes: [],
      scheduledAgentTasks: [],
      scheduledJobs: [],
      now: new Date("2026-05-13T15:00:00.000Z"),
    });

    expect(topology.providers.find((provider) => provider.providerId === "local")?.kind).toBe("local");
    expect(topology.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerId: "local", state: "active" }),
        expect.objectContaining({ providerId: "anthropic", state: "failover" }),
      ]),
    );
    expect(topology.markers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "error", providerId: "anthropic", summary: expect.stringContaining("provider 5xx") }),
      ]),
    );
  });

  it("adds quota markers and provider spend labels from token usage and exclusion reasons", () => {
    const topology = projectRoutingTopology({
      agents: [{ agentId: "ops-coordinator", name: "Ops Coordinator", stationLabel: "Operate" }],
      providers: [
        makeProvider({ providerId: "openai", name: "OpenAI / Codex" }),
        makeProvider({ providerId: "anthropic", name: "Claude" }),
      ],
      endpointProfiles: [],
      routeDecisions: [
        makeDecision({
          id: "decision-3",
          agentMessageId: "ops-coordinator",
          selectedEndpointId: "openai:gpt-5.4",
          excludedTrace: [
            makeCandidate({
              endpointId: "anthropic:claude-sonnet",
              providerId: "anthropic",
              modelId: "claude-sonnet",
              excluded: true,
              excludedReason: "hourly limit reached",
            }),
          ],
        }),
      ],
      tokenUsage: [
        makeTokenUsage({ providerId: "openai", agentId: "ops-coordinator", costUsd: 1.25, inputTokens: 1000, outputTokens: 500 }),
        makeTokenUsage({ providerId: "openai", agentId: "ops-coordinator", costUsd: 0.75, inputTokens: 250, outputTokens: 250 }),
      ],
      routeOutcomes: [],
      scheduledAgentTasks: [],
      scheduledJobs: [],
      now: new Date("2026-05-13T15:00:00.000Z"),
    });

    expect(topology.providers.find((provider) => provider.providerId === "openai")).toEqual(
      expect.objectContaining({
        costUsd: 2,
        tokenTotal: 2000,
      }),
    );
    expect(topology.markers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "quota", label: "Limit / quota", summary: expect.stringContaining("hourly limit") }),
      ]),
    );
  });

  it("adds provider-side symbols for spend watch, local routing, and degraded providers", () => {
    const topology = projectRoutingTopology({
      agents: [{ agentId: "ops-coordinator", name: "Ops Coordinator", stationLabel: "Operate" }],
      providers: [
        makeProvider({ providerId: "openai", name: "OpenAI", status: "active" }),
        makeProvider({ providerId: "local", name: "Docker Model Runner", status: "active", category: "local", baseUrl: "http://model-runner.docker.internal/v1" }),
        makeProvider({ providerId: "chatgpt", name: "ChatGPT Subscription", status: "disabled", cliEngine: "codex" }),
      ],
      endpointProfiles: [],
      routeDecisions: [],
      tokenUsage: [
        makeTokenUsage({ providerId: "openai", agentId: "ops-coordinator", costUsd: 1.5, inputTokens: 1000, outputTokens: 400 }),
        makeTokenUsage({ providerId: "local", agentId: "ops-coordinator", costUsd: 0, inputTokens: 1000, outputTokens: 1000 }),
        makeTokenUsage({ providerId: "chatgpt", agentId: "ops-coordinator", costUsd: 0, inputTokens: 500, outputTokens: 500 }),
      ],
      routeOutcomes: [],
      scheduledAgentTasks: [],
      scheduledJobs: [],
      now: new Date("2026-05-13T15:00:00.000Z"),
    });

    expect(topology.markers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "quota", label: "Spend watch", providerId: "openai", routeId: null }),
        expect.objectContaining({ type: "governance", label: "Local LLM route", providerId: "local", routeId: null }),
        expect.objectContaining({ type: "error", label: "Provider status", providerId: "chatgpt", routeId: null }),
      ]),
    );
  });

  it("keeps configured providers visible even when they have no active route traffic", () => {
    const topology = projectRoutingTopology({
      agents: [{ agentId: "ops-coordinator", name: "Ops Coordinator", stationLabel: "Operate" }],
      providers: [
        makeProvider({ providerId: "openai", name: "OpenAI", status: "active" }),
        makeProvider({ providerId: "chatgpt", name: "ChatGPT Subscription", status: "configured" }),
        makeProvider({ providerId: "anthropic", name: "Claude", status: "paused" }),
        makeProvider({ providerId: "gemini", name: "Google Gemini", status: "unconfigured" }),
      ],
      endpointProfiles: [],
      routeDecisions: [
        makeDecision({
          id: "decision-4",
          agentMessageId: "ops-coordinator",
          selectedEndpointId: "openai:gpt-5.4",
          candidateTrace: [
            makeCandidate({ endpointId: "openai:gpt-5.4", providerId: "openai", modelId: "gpt-5.4" }),
          ],
        }),
      ],
      tokenUsage: [],
      routeOutcomes: [],
      scheduledAgentTasks: [],
      scheduledJobs: [],
      now: new Date("2026-05-13T15:00:00.000Z"),
    });

    expect(topology.providers.map((provider) => provider.providerId)).toEqual(["anthropic", "chatgpt", "openai"]);
    expect(topology.routes.map((route) => route.providerId)).toEqual(["openai"]);
    expect(topology.markers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "error", label: "Provider status", providerId: "anthropic", routeId: null }),
      ]),
    );
    expect(topology.markers).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerId: "gemini" }),
      ]),
    );
  });

  it("uses AI coworker token usage for coworker-to-provider routes instead of task type fallbacks", () => {
    const topology = projectRoutingTopology({
      agents: [{ agentId: "build-specialist", name: "Build Specialist", stationLabel: "Build" }],
      providers: [
        makeProvider({ providerId: "anthropic", name: "Claude" }),
        makeProvider({ providerId: "local", name: "Docker Model Runner", category: "direct", baseUrl: "http://model-runner.docker.internal/v1" }),
      ],
      endpointProfiles: [
        {
          endpointId: "profile-claude-haiku",
          providerId: "anthropic",
          modelId: "claude-haiku",
          friendlyName: "Claude Haiku",
          modelStatus: "active",
        },
      ],
      routeDecisions: [
        makeDecision({
          id: "decision-no-agent",
          agentMessageId: null,
          selectedEndpointId: "profile-claude-haiku",
          taskType: "conversation",
          candidateTrace: [],
        }),
      ],
      tokenUsage: [
        makeTokenUsage({
          id: "usage-build-local",
          agentId: "build-specialist",
          providerId: "local",
          contextKey: "build-thread",
          inputTokens: 50_000,
          outputTokens: 11_000,
        }),
        makeTokenUsage({
          id: "usage-unknown",
          agentId: "unknown",
          providerId: "anthropic",
          inputTokens: 1000,
          outputTokens: 200,
        }),
      ],
      routeOutcomes: [],
      scheduledAgentTasks: [],
      scheduledJobs: [],
      now: new Date("2026-05-13T15:00:00.000Z"),
    });

    expect(topology.coworkers.map((coworker) => coworker.agentId)).toEqual(["build-specialist"]);
    expect(topology.coworkers.map((coworker) => coworker.agentId)).not.toContain("conversation");
    expect(topology.routes).toEqual([
      expect.objectContaining({
        id: "route:usage:usage-build-local",
        coworkerId: "build-specialist",
        providerId: "local",
        state: "secondary",
      }),
    ]);
    expect(topology.markers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "marker:decision-no-agent:decision",
          routeId: null,
          coworkerId: null,
          providerId: "anthropic",
        }),
        expect.objectContaining({
          id: "marker:usage:usage-build-local:spend",
          routeId: "route:usage:usage-build-local",
          coworkerId: "build-specialist",
        }),
      ]),
    );
  });

  it("marks provider route decisions without coworker attribution as router audit events", () => {
    const topology = projectRoutingTopology({
      agents: [{ agentId: "build-specialist", name: "Build Specialist", stationLabel: "Build" }],
      providers: [makeProvider({ providerId: "anthropic", name: "Claude" })],
      endpointProfiles: [
        {
          endpointId: "profile-claude-haiku",
          providerId: "anthropic",
          modelId: "claude-haiku",
          friendlyName: "Claude Haiku",
          modelStatus: "active",
        },
      ],
      routeDecisions: [
        makeDecision({
          id: "decision-without-agent",
          agentMessageId: null,
          agentId: null,
          selectedEndpointId: "profile-claude-haiku",
          taskType: "conversation",
          candidateTrace: [],
        }),
      ],
      tokenUsage: [],
      routeOutcomes: [],
      scheduledAgentTasks: [],
      scheduledJobs: [],
      now: new Date("2026-05-13T15:00:00.000Z"),
    });

    expect(topology.routes).toEqual([]);
    expect(topology.markers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "marker:decision-without-agent:decision",
          type: "decision",
          label: "Unattributed route decision",
          routeId: null,
          coworkerId: null,
          providerId: "anthropic",
          summary: expect.stringContaining("RouteDecisionLog did not record the coworker"),
        }),
      ]),
    );
  });

  it("shows explicit system actors without treating them as missing coworker data", () => {
    const topology = projectRoutingTopology({
      agents: [{ agentId: "build-specialist", name: "Build Specialist", stationLabel: "Build" }],
      providers: [makeProvider({ providerId: "anthropic", name: "Claude" })],
      endpointProfiles: [
        {
          endpointId: "profile-claude-haiku",
          providerId: "anthropic",
          modelId: "claude-haiku",
          friendlyName: "Claude Haiku",
          modelStatus: "active",
        },
      ],
      routeDecisions: [
        makeDecision({
          id: "decision-system-actor",
          agentMessageId: null,
          actorKind: "system",
          actorId: "routed-inference",
          agentId: null,
          selectedEndpointId: "profile-claude-haiku",
          taskType: "evaluation",
          candidateTrace: [],
        }),
      ],
      tokenUsage: [],
      routeOutcomes: [],
      scheduledAgentTasks: [],
      scheduledJobs: [],
      now: new Date("2026-05-13T15:00:00.000Z"),
    });

    expect(topology.routes).toEqual([]);
    expect(topology.markers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "marker:decision-system-actor:decision",
          type: "decision",
          label: "System route decision",
          routeId: null,
          coworkerId: null,
          actorKind: "system",
          actorId: "routed-inference",
          providerId: "anthropic",
          summary: expect.stringContaining("Actor: system/routed-inference"),
        }),
      ]),
    );
    expect(topology.markers.find((marker) => marker.id === "marker:decision-system-actor:decision")?.summary).not.toContain(
      "did not record the coworker",
    );
  });

  it("projects provider outage outcomes as errors and fallback destinations without marking fallback providers down", () => {
    const topology = projectRoutingTopology({
      agents: [{ agentId: "portfolio-analyst", name: "Portfolio Analyst", stationLabel: "Evaluate" }],
      providers: [
        makeProvider({ providerId: "anthropic-sub", name: "Claude / Anthropic (OAuth Subscription)", status: "disabled" }),
        makeProvider({ providerId: "local", name: "Docker Model Runner", category: "local", baseUrl: "http://model-runner.docker.internal/v1" }),
      ],
      endpointProfiles: [],
      routeDecisions: [],
      tokenUsage: [],
      routeOutcomes: [
        makeRouteOutcome({
          id: "outcome-claude-auth",
          providerId: "anthropic-sub",
          modelId: "claude-haiku-4-5-20251001",
          taskType: "conversation",
          providerErrorCode: "auth",
          fallbackOccurred: false,
          createdAt: new Date("2026-05-14T23:40:03.698Z"),
        }),
        makeRouteOutcome({
          id: "outcome-local-fallback",
          providerId: "local",
          modelId: "gemma4:latest",
          taskType: "conversation",
          providerErrorCode: null,
          fallbackOccurred: true,
          createdAt: new Date("2026-05-14T23:40:05.000Z"),
        }),
      ],
      scheduledAgentTasks: [],
      scheduledJobs: [],
      now: new Date("2026-05-15T00:00:00.000Z"),
    });

    expect(topology.markers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "marker:outcome:outcome-claude-auth:error",
          type: "error",
          label: "Provider error",
          routeId: null,
          coworkerId: null,
          providerId: "anthropic-sub",
          summary: expect.stringContaining("auth"),
        }),
        expect.objectContaining({
          id: "marker:outcome:outcome-local-fallback:failover",
          type: "failover",
          label: "Fallback destination",
          routeId: null,
          coworkerId: null,
          providerId: "local",
          summary: expect.stringContaining("fallback"),
        }),
      ]),
    );
    expect(topology.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "timeline:outcome:outcome-claude-auth",
          lane: "history",
          markerType: "error",
        }),
      ]),
    );
  });

  it("draws attributed fallback outcomes as coworker-to-provider failover routes", () => {
    const topology = projectRoutingTopology({
      agents: [{ agentId: "portfolio-analyst", name: "Portfolio Analyst", stationLabel: "Evaluate" }],
      providers: [
        makeProvider({ providerId: "local", name: "Docker Model Runner", category: "local", baseUrl: "http://model-runner.docker.internal/v1" }),
      ],
      endpointProfiles: [],
      routeDecisions: [],
      tokenUsage: [],
      routeOutcomes: [
        makeRouteOutcome({
          id: "outcome-local-fallback",
          agentId: "portfolio-analyst",
          providerId: "local",
          modelId: "gemma4:latest",
          taskType: "conversation",
          providerErrorCode: null,
          fallbackOccurred: true,
          createdAt: new Date("2026-05-14T23:40:05.000Z"),
        } as Partial<RoutingRouteOutcomeSourceRow>),
      ],
      scheduledAgentTasks: [],
      scheduledJobs: [],
      now: new Date("2026-05-15T00:00:00.000Z"),
    });

    expect(topology.routes).toEqual([
      expect.objectContaining({
        id: "route:outcome:outcome-local-fallback:local",
        coworkerId: "portfolio-analyst",
        providerId: "local",
        state: "failover",
      }),
    ]);
    expect(topology.markers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "marker:outcome:outcome-local-fallback:failover",
          type: "failover",
          label: "Fallback destination",
          routeId: "route:outcome:outcome-local-fallback:local",
          coworkerId: "portfolio-analyst",
          providerId: "local",
        }),
      ]),
    );
  });

  it("classifies LLM providers separately from MCP servers for the provider filter", () => {
    const topology = projectRoutingTopology({
      agents: [{ agentId: "ops-coordinator", name: "Ops Coordinator", stationLabel: "Operate" }],
      providers: [
        makeProvider({ providerId: "anthropic", name: "Claude", endpointType: "llm", category: "direct" }),
        makeProvider({
          providerId: "mcp-github",
          name: "GitHub (MCP Official)",
          endpointType: "service",
          category: "mcp-subscribed",
          serviceKind: "mcp",
        }),
      ],
      endpointProfiles: [],
      routeDecisions: [],
      tokenUsage: [],
      routeOutcomes: [],
      scheduledAgentTasks: [],
      scheduledJobs: [],
      now: new Date("2026-05-13T15:00:00.000Z"),
    });

    expect(topology.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerId: "anthropic", providerType: "llm" }),
        expect.objectContaining({ providerId: "mcp-github", providerType: "mcp" }),
      ]),
    );
  });

  it("resolves selected model profile ids back to configured providers", () => {
    const topology = projectRoutingTopology({
      agents: [{ agentId: "build-specialist", name: "Build Specialist", stationLabel: "Build" }],
      providers: [makeProvider({ providerId: "anthropic", name: "Claude" })],
      endpointProfiles: [
        {
          endpointId: "cmogs56zm00058xqa4kpfld31",
          providerId: "anthropic",
          modelId: "claude-haiku-4-5-20251001",
          friendlyName: "Claude Haiku 4.5",
          modelStatus: "active",
        },
      ],
      routeDecisions: [
        makeDecision({
          id: "decision-profile-id",
          agentMessageId: null,
          agentId: "build-specialist",
          selectedEndpointId: "cmogs56zm00058xqa4kpfld31",
          candidateTrace: [],
        }),
      ],
      tokenUsage: [],
      routeOutcomes: [],
      scheduledAgentTasks: [],
      scheduledJobs: [],
      now: new Date("2026-05-13T15:00:00.000Z"),
    });

    expect(topology.routes).toEqual([
      expect.objectContaining({
        id: "route:decision-profile-id:anthropic",
        coworkerId: "build-specialist",
        providerId: "anthropic",
      }),
    ]);
    expect(topology.providers.map((provider) => provider.providerId)).toEqual(["anthropic"]);
  });

  it("projects active future schedules as coworker invocation markers instead of provider routes", () => {
    const topology = projectRoutingTopology({
      agents: [{ agentId: "hive-scout", name: "Hive Scout", stationLabel: "Explore" }],
      providers: [makeProvider({ providerId: "local", name: "Docker Model Runner", category: "local" })],
      endpointProfiles: [],
      routeDecisions: [],
      tokenUsage: [],
      routeOutcomes: [],
      scheduledAgentTasks: [
        makeScheduledTask({
          id: "schedule-1",
          agentId: "hive-scout",
          title: "Discovery gap triage",
          nextRunAt: new Date("2026-05-13T18:00:00.000Z"),
        }),
      ],
      scheduledJobs: [
        makeScheduledJob({
          id: "job-1",
          name: "Provider quota reset",
          nextRunAt: new Date("2026-05-13T20:00:00.000Z"),
        }),
      ],
      now: new Date("2026-05-13T15:00:00.000Z"),
    });

    expect(topology.routes).toEqual([]);
    expect(topology.providers.map((provider) => provider.providerId)).toEqual(["local"]);
    expect(topology.markers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "marker:scheduled:schedule-1",
          type: "scheduled",
          label: "Scheduled invocation",
          routeId: null,
          coworkerId: "hive-scout",
          providerId: null,
          summary: expect.stringContaining("invokes Hive Scout"),
        }),
      ]),
    );
    expect(topology.timeline.map((marker) => [marker.id, marker.lane, marker.label])).toEqual([
      ["timeline:schedule-1", "future", "Discovery gap triage"],
      ["timeline:job-1", "future", "Provider quota reset"],
    ]);
  });
});

function makeProvider(overrides: Partial<RoutingProviderSourceRow> = {}): RoutingProviderSourceRow {
  return {
    providerId: "anthropic",
    name: "Claude",
    status: "active",
    category: "external",
    baseUrl: null,
    endpointType: "llm",
    serviceKind: null,
    mcpTransport: null,
    cliEngine: null,
    recentFailureRate: 0,
    ...overrides,
  };
}

function makeDecision(overrides: Partial<RoutingDecisionSourceRow> = {}): RoutingDecisionSourceRow {
  return {
    id: "decision-1",
    agentMessageId: "agent-1",
    actorKind: "legacy_unattributed",
    actorId: "legacy-route-decision-log",
    agentId: null,
    selectedEndpointId: "anthropic:claude-sonnet",
    taskType: "codegen",
    sensitivity: "internal",
    reason: "Best score for requested task.",
    fitnessScore: 0.91,
    candidateTrace: [makeCandidate()],
    excludedTrace: [],
    policyRulesApplied: [],
    fallbackChain: [],
    fallbacksUsed: null,
    shadowMode: false,
    createdAt: new Date("2026-05-13T14:59:00.000Z"),
    selectedModelId: "claude-sonnet",
    ...overrides,
  };
}

function makeCandidate(overrides: Record<string, unknown> = {}) {
  return {
    endpointId: "anthropic:claude-sonnet",
    providerId: "anthropic",
    modelId: "claude-sonnet",
    endpointName: "Claude Sonnet",
    fitnessScore: 91,
    dimensionScores: { codegen: 90 },
    costPerOutputMToken: 3,
    excluded: false,
    ...overrides,
  };
}

function makeTokenUsage(overrides: Partial<RoutingTokenUsageSourceRow> = {}): RoutingTokenUsageSourceRow {
  return {
    id: "usage-1",
    agentId: "agent-1",
    providerId: "anthropic",
    contextKey: "ctx",
    inputTokens: 0,
    outputTokens: 0,
    inferenceMs: null,
    costUsd: 0,
    createdAt: new Date("2026-05-13T14:45:00.000Z"),
    ...overrides,
  };
}

function makeRouteOutcome(overrides: Partial<RoutingRouteOutcomeSourceRow> = {}): RoutingRouteOutcomeSourceRow {
  return {
    id: "outcome-1",
    providerId: "anthropic",
    modelId: "claude-sonnet",
    taskType: "conversation",
    fallbackOccurred: false,
    providerErrorCode: "rate_limit",
    createdAt: new Date("2026-05-13T14:55:00.000Z"),
    ...overrides,
  };
}

function makeScheduledTask(overrides: Partial<RoutingScheduledAgentTaskSourceRow> = {}): RoutingScheduledAgentTaskSourceRow {
  return {
    id: "schedule-1",
    taskId: "schedule-task",
    agentId: "agent-1",
    title: "Scheduled task",
    routeContext: "operate",
    isActive: true,
    nextRunAt: new Date("2026-05-13T18:00:00.000Z"),
    lastStatus: "ok",
    ...overrides,
  };
}

function makeScheduledJob(overrides: Partial<RoutingScheduledJobSourceRow> = {}): RoutingScheduledJobSourceRow {
  return {
    id: "job-1",
    jobId: "provider-reset",
    name: "Provider reset",
    nextRunAt: new Date("2026-05-13T20:00:00.000Z"),
    lastStatus: "ok",
    ...overrides,
  };
}
