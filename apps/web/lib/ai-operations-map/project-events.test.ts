import { describe, expect, it } from "vitest";
import { AUDIT_CLASSES } from "@/lib/audit-classes";
import { TASK_STATES } from "@/lib/tak/task-states";
import {
  SOFTWARE_PLATFORM_MAP_TEMPLATE,
  getMapTemplate,
  validateMapTemplate,
} from "./templates";
import {
  deriveProjectionSeverityFromTaskState,
  projectAgentsToStations,
  projectToolExecution,
} from "./project-events";
import type { OperationsMapAgent, OperationsMapToolExecution } from "./types";

describe("AI operations map projection", () => {
  it("ships a valid software-platform template with stable stations", () => {
    expect(SOFTWARE_PLATFORM_MAP_TEMPLATE.id).toBe("software-platform");
    expect(SOFTWARE_PLATFORM_MAP_TEMPLATE.stations.map((station) => station.id)).toEqual([
      "discover",
      "backlog",
      "design",
      "build",
      "verify",
      "release",
      "support",
      "improve",
    ]);

    expect(validateMapTemplate(SOFTWARE_PLATFORM_MAP_TEMPLATE)).toEqual([]);
    expect(getMapTemplate("software-platform").id).toBe("software-platform");
    expect(getMapTemplate("unknown-archetype").id).toBe("generic-value-chain");
  });

  it("maps every canonical task state to a projection severity", () => {
    const severities = TASK_STATES.map((state) => deriveProjectionSeverityFromTaskState(state));

    expect(severities).toContain("critical");
    expect(severities).toContain("attention");
    expect(severities.every((severity) => ["normal", "attention", "warning", "critical"].includes(severity))).toBe(true);
  });

  it("maps every canonical audit class to a failed tool severity", () => {
    const severities = AUDIT_CLASSES.map((auditClass) =>
      projectToolExecution(makeToolExecution({ auditClass, success: false })).severity,
    );

    expect(severities).toEqual(["critical", "warning", "warning"]);
  });

  it("projects agents to stations using value stream and known roles", () => {
    const agents: OperationsMapAgent[] = [
      makeAgent({ agentId: "hive-scout", name: "Hive Scout", valueStream: "explore" }),
      makeAgent({ agentId: "build-specialist", name: "Build Specialist", valueStream: null }),
      makeAgent({ agentId: "release-manager", name: "Release Manager", valueStream: "release" }),
    ];

    const projected = projectAgentsToStations(agents, SOFTWARE_PLATFORM_MAP_TEMPLATE);

    expect(projected.map((agent) => [agent.agentId, agent.stationId])).toEqual([
      ["hive-scout", "discover"],
      ["build-specialist", "build"],
      ["release-manager", "release"],
    ]);
  });

  it("projects a denied tool execution to a critical build pulse with deep links", () => {
    const projection = projectToolExecution(
      makeToolExecution({
        id: "tool-1",
        agentId: "build-specialist",
        toolName: "write_sandbox_file",
        success: false,
        auditClass: "ledger",
        routeContext: "build",
      }),
    );

    expect(projection.id).toBe("tool:tool-1");
    expect(projection.location.stationId).toBe("build");
    expect(projection.severity).toBe("critical");
    expect(projection.summary).toContain("write_sandbox_file failed");
    expect(projection.links.authorityHref).toBe("/platform/audit/ledger?toolExecutionId=tool-1");
    expect(projection.links.coworkerHref).toBe("/platform/ai/agent/build-specialist");
  });
});

function makeAgent(overrides: Partial<OperationsMapAgent> = {}): OperationsMapAgent {
  return {
    id: "agent-db-1",
    agentId: "agent-1",
    slugId: "agent-1",
    name: "Agent One",
    tier: 2,
    type: "specialist",
    description: null,
    status: "active",
    valueStream: null,
    it4itSections: [],
    sensitivity: "internal",
    lifecycleStage: "production",
    counts: { skills: 0, toolGrants: 0 },
    ...overrides,
  };
}

function makeToolExecution(
  overrides: Partial<OperationsMapToolExecution> = {},
): OperationsMapToolExecution {
  return {
    id: "tool-1",
    threadId: "thread-1",
    agentId: "agent-1",
    userId: "user-1",
    toolName: "search_project_files",
    success: true,
    executionMode: "immediate",
    routeContext: null,
    durationMs: 42,
    createdAt: new Date("2026-05-10T12:00:00.000Z"),
    auditClass: "journal",
    capabilityId: "platform:search_project_files",
    summary: null,
    ...overrides,
  };
}
