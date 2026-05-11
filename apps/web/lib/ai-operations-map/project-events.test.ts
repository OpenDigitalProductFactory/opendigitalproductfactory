import { describe, expect, it } from "vitest";
import { AUDIT_CLASSES } from "@/lib/audit-classes";
import { TASK_STATES } from "@/lib/tak/task-states";
import {
  MANAGED_SERVICE_PROVIDER_MAP_TEMPLATE,
  SOFTWARE_PLATFORM_MAP_TEMPLATE,
  getMapTemplate,
  validateMapTemplate,
} from "./templates";
import {
  deriveProjectionSeverityFromTaskState,
  projectBacklogEvidence,
  projectExternalEvidence,
  projectAgentsToStations,
  projectToolExecutionReceipt,
  projectToolExecution,
} from "./project-events";
import type {
  OperationsMapAgent,
  OperationsMapBacklogEvidence,
  OperationsMapExternalEvidence,
  OperationsMapToolExecution,
  OperationsMapToolExecutionReceipt,
} from "./types";

describe("AI operations map projection", () => {
  it("ships a valid software-platform template with stable stations", () => {
    expect(SOFTWARE_PLATFORM_MAP_TEMPLATE.id).toBe("software-platform");
    expect(SOFTWARE_PLATFORM_MAP_TEMPLATE.stations.map((station) => station.id)).toEqual([
      "cross-cutting",
      "explore",
      "evaluate",
      "integrate",
      "build",
      "verify",
      "deploy",
      "release",
      "consume",
      "operate",
      "governance",
      "unplaced",
    ]);

    expect(validateMapTemplate(SOFTWARE_PLATFORM_MAP_TEMPLATE)).toEqual([]);
    expect(getMapTemplate("software-platform").id).toBe("software-platform");
    expect(getMapTemplate("unknown-archetype").id).toBe("generic-value-chain");
  });

  it("selects a managed service provider template from archetype or activation profile", () => {
    expect(MANAGED_SERVICE_PROVIDER_MAP_TEMPLATE.stations.map((station) => station.id)).toEqual([
      "customer-intake",
      "triage",
      "agreements",
      "service-operations",
      "customer-estate",
      "billing-readiness",
      "lifecycle-review",
      "improvement",
    ]);

    expect(validateMapTemplate(MANAGED_SERVICE_PROVIDER_MAP_TEMPLATE)).toEqual([]);
    expect(getMapTemplate("it-managed-services").id).toBe("managed-service-provider");
    expect(getMapTemplate({ archetypeId: "custom-msp", activationProfileType: "managed-service-provider" }).id).toBe(
      "managed-service-provider",
    );
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
      makeAgent({ agentId: "unknown-agent", name: "Unknown Agent", valueStream: "mystery" }),
    ];

    const projected = projectAgentsToStations(agents, SOFTWARE_PLATFORM_MAP_TEMPLATE);

    expect(projected.map((agent) => [agent.agentId, agent.stationId])).toEqual([
      ["hive-scout", "explore"],
      ["build-specialist", "build"],
      ["release-manager", "release"],
      ["unknown-agent", "unplaced"],
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

  it("projects invalid tool receipts as warning evidence linked to the originating execution", () => {
    const projection = projectToolExecutionReceipt(
      makeToolExecutionReceipt({
        id: "receipt-1",
        receiptKind: "sandbox-output",
        receiptStatus: "expired",
        executionStatus: "completed",
        toolExecution: makeToolExecution({
          id: "tool-2",
          agentId: "build-specialist",
          toolName: "write_sandbox_file",
          routeContext: "build",
        }),
      }),
    );

    expect(projection.id).toBe("receipt:receipt-1");
    expect(projection.source).toBe("tool-receipt");
    expect(projection.location.stationId).toBe("build");
    expect(projection.severity).toBe("warning");
    expect(projection.refs.toolReceiptId).toBe("receipt-1");
    expect(projection.refs.toolExecutionId).toBe("tool-2");
    expect(projection.links.authorityHref).toBe("/platform/audit/ledger?toolExecutionId=tool-2");
  });

  it("projects backlog evidence to the verification station with backlog references", () => {
    const projection = projectBacklogEvidence(
      makeBacklogEvidence({
        id: "activity-1",
        backlogItemId: "BI-123",
        summary: "UX verification completed",
        toolExecutionId: "tool-3",
      }),
    );

    expect(projection.id).toBe("backlog-evidence:activity-1");
    expect(projection.source).toBe("evidence-backlog");
    expect(projection.location.stationId).toBe("verify");
    expect(projection.severity).toBe("normal");
    expect(projection.refs.backlogItemId).toBe("BI-123");
    expect(projection.refs.toolExecutionId).toBe("tool-3");
    expect(projection.links.backlogHref).toBe("/platform/backlog?itemId=BI-123");
  });

  it("projects external evidence through route context and history links", () => {
    const projection = projectExternalEvidence(
      makeExternalEvidence({
        id: "external-1",
        provider: "github",
        operationType: "ci-check",
        routeContext: "release",
        resultSummary: "CI checks passed",
      }),
    );

    expect(projection.id).toBe("external-evidence:external-1");
    expect(projection.source).toBe("evidence-external");
    expect(projection.location.stationId).toBe("release");
    expect(projection.label).toBe("github ci-check");
    expect(projection.refs.externalEvidenceRecordId).toBe("external-1");
    expect(projection.links.historyHref).toBe("/platform/ai/history?externalEvidenceRecordId=external-1");
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

function makeToolExecutionReceipt(
  overrides: Partial<OperationsMapToolExecutionReceipt> = {},
): OperationsMapToolExecutionReceipt {
  return {
    id: "receipt-1",
    toolExecutionId: "tool-1",
    buildId: null,
    receiptKind: "tool-output",
    receiptStatus: "valid",
    executionStatus: "completed",
    expiresAt: new Date("2026-05-11T12:00:00.000Z"),
    createdAt: new Date("2026-05-10T12:01:00.000Z"),
    toolExecution: makeToolExecution(),
    ...overrides,
  };
}

function makeBacklogEvidence(overrides: Partial<OperationsMapBacklogEvidence> = {}): OperationsMapBacklogEvidence {
  return {
    id: "activity-1",
    backlogItemId: "BI-1",
    kind: "evidence",
    summary: "Evidence recorded",
    payload: {},
    recordedAt: new Date("2026-05-10T12:02:00.000Z"),
    recordedById: "user-1",
    recordedByAgentId: "agent-1",
    toolExecutionId: null,
    ...overrides,
  };
}

function makeExternalEvidence(overrides: Partial<OperationsMapExternalEvidence> = {}): OperationsMapExternalEvidence {
  return {
    id: "external-1",
    actorUserId: "user-1",
    routeContext: "governance",
    operationType: "audit-sync",
    target: "external-system",
    provider: "external",
    resultSummary: "Evidence synced",
    createdAt: new Date("2026-05-10T12:03:00.000Z"),
    ...overrides,
  };
}
