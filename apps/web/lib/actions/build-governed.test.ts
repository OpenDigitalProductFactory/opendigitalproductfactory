import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockPrisma } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockPrisma: {
    featureBuild: {
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    buildPhaseRun: {
      upsert: vi.fn(),
    },
    businessBuildBrief: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    organization: {
      findFirst: vi.fn(),
    },
    platformDevConfig: {
      findUnique: vi.fn(),
    },
    platformConfig: {
      findUnique: vi.fn(),
    },
    buildActivity: {
      create: vi.fn(),
    },
    phaseHandoff: {
      create: vi.fn(),
    },
    employeeProfile: {
      findFirst: vi.fn(),
    },
    calendarEvent: {
      upsert: vi.fn(),
    },
    backlogItemActivity: {
      create: vi.fn(),
    },
    workroom: {
      create: vi.fn(),
      findUnique: vi.fn(),
      // BI-937128F6: unified WIP query reads active capsules across surfaces.
      findMany: vi.fn(),
    },
    workroomActivity: {
      create: vi.fn(),
    },
    // BI-937128F6: unified WIP query reads the active shared nonprod leases.
    nonProductionEnvironmentLease: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

const { mockIsSandboxAvailable, mockStartBuildBranch, mockGetClientIdentity } = vi.hoisted(() => ({
  mockIsSandboxAvailable: vi.fn(),
  mockStartBuildBranch: vi.fn(),
  mockGetClientIdentity: vi.fn(),
}));

const { mockQueueBuildReviewVerification } = vi.hoisted(() => ({
  mockQueueBuildReviewVerification: vi.fn(),
}));

const { mockSaveBuildArtifactRevision } = vi.hoisted(() => ({
  mockSaveBuildArtifactRevision: vi.fn(),
}));

const { mockListReleasableSandboxFiles } = vi.hoisted(() => ({
  mockListReleasableSandboxFiles: vi.fn(),
}));

const { mockEvaluateBuildStudioPlanAdvancementGate } = vi.hoisted(() => ({
  mockEvaluateBuildStudioPlanAdvancementGate: vi.fn(),
}));

const { mockEvaluateBuildStudioDecision } = vi.hoisted(() => ({
  mockEvaluateBuildStudioDecision: vi.fn(),
}));

const { mockRunBuildPipeline } = vi.hoisted(() => ({
  mockRunBuildPipeline: vi.fn(),
}));

const { mockGetQuiescenceLevel } = vi.hoisted(() => ({
  mockGetQuiescenceLevel: vi.fn(),
}));

const { mockEnforceBuildInitiativeReadiness } = vi.hoisted(() => ({
  mockEnforceBuildInitiativeReadiness: vi.fn(),
}));
const mockAssertFeatureBuildCompletion = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
}));
vi.mock("@/lib/platform-runtime/work-admission", () => ({ admitRuntimeGuardedWork: vi.fn() }));

vi.mock("@/lib/build/sandbox/build-branch", () => ({
  isSandboxAvailable: mockIsSandboxAvailable,
  startBuildBranch: mockStartBuildBranch,
  getClientIdentity: mockGetClientIdentity,
}));
vi.mock("@/lib/build/sandbox/sandbox-build-gc", () => ({ releaseSandboxForTerminalBuild: vi.fn(async () => {}) }));
vi.mock("@/lib/build-review-verification-trigger", () => ({
  queueBuildReviewVerification: mockQueueBuildReviewVerification,
}));

vi.mock("@/lib/build/build-artifact-provenance", () => ({
  saveBuildArtifactRevision: mockSaveBuildArtifactRevision,
}));

vi.mock("@/lib/build/sandbox/sandbox", () => ({
  listReleasableSandboxFiles: mockListReleasableSandboxFiles,
}));

vi.mock("@/lib/decision-perspective/build-studio-gate", () => ({
  evaluateBuildStudioPlanAdvancementGate: mockEvaluateBuildStudioPlanAdvancementGate,
}));

vi.mock("@/lib/build/decision-service", () => ({
  evaluateBuildStudioDecision: mockEvaluateBuildStudioDecision,
}));

const mockGetBuildStudioConfig = vi.fn(async () => ({
  selection: { status: "selected", selected: { engine: "opencode" }, reason: "ok", action: null },
}));
vi.mock("@/lib/build/build-studio-config", () => ({
  getBuildStudioConfig: (...args: unknown[]) => mockGetBuildStudioConfig(...(args as [])),
}));

vi.mock("@/lib/build/build-entry-gate", () => ({
  enforceBuildInitiativeReadiness: mockEnforceBuildInitiativeReadiness,
  assertBuildPhaseInitiativeReadiness: mockEnforceBuildInitiativeReadiness,
}));
vi.mock("@/lib/backlog/initiative-readiness/build-terminal-transition", () => ({ assertFeatureBuildCompletion: mockAssertFeatureBuildCompletion }));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/build-pipeline", () => ({
  runBuildPipeline: mockRunBuildPipeline,
}));

vi.mock("@/lib/agent-event-bus", () => ({
  agentEventBus: {
    emit: vi.fn(),
    subscribe: vi.fn(),
    subscribeSystem: vi.fn(),
    broadcastSystem: vi.fn(),
    requestCancel: vi.fn(),
    isCancelled: vi.fn(),
    clearCancel: vi.fn(),
    markActive: vi.fn(),
    markIdle: vi.fn(),
    isActive: vi.fn(),
  },
}));

vi.mock("@/lib/self-upgrade/quiescence", () => ({
  getQuiescenceLevel: mockGetQuiescenceLevel,
  QuiescingError: class QuiescingError extends Error {
    readonly code = "PORTAL_QUIESCING";
    readonly retryAfterSeconds: number;
    readonly level: string;
    constructor(level: string, retryAfterSeconds = 30) {
      super(`Portal is ${level} for upgrade — new work refused`);
      this.name = "QuiescingError";
      this.level = level;
      this.retryAfterSeconds = retryAfterSeconds;
    }
  },
}));

import { revalidatePath } from "next/cache";
import { approveBuildStart, advanceBuildPhase, completeBuild, createFeatureBuild, recordBuildAcceptance, resumeBuildImplementation, runBuildReviewVerification, updateBusinessBuildBrief, updateFeatureBrief } from "./build";

describe("governed build start approvals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      user: {
        id: "user-1",
        platformRole: "HR-000",
        isSuperuser: true,
      },
    });
    mockPrisma.buildActivity.create.mockResolvedValue({});
    mockPrisma.featureBuild.count.mockResolvedValue(0);
    mockPrisma.phaseHandoff.create.mockResolvedValue({});
    mockPrisma.employeeProfile.findFirst.mockResolvedValue(null);
    mockPrisma.calendarEvent.upsert.mockResolvedValue({});
    mockPrisma.backlogItemActivity.create.mockResolvedValue({});
    mockPrisma.workroom.findUnique.mockResolvedValue(null);
    mockPrisma.workroom.findMany.mockResolvedValue([]);
    mockPrisma.nonProductionEnvironmentLease.findMany.mockResolvedValue([]);
    mockPrisma.workroom.create.mockResolvedValue({
      id: "capsule-row-direct",
      capsuleId: "WC-DIRECT1",
    });
    mockPrisma.workroomActivity.create.mockResolvedValue({});
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));
    mockPrisma.businessBuildBrief.findUnique.mockResolvedValue({ status: "accepted" });
    mockPrisma.businessBuildBrief.upsert.mockResolvedValue({});
    mockPrisma.businessBuildBrief.update.mockResolvedValue({});
    mockPrisma.organization.findFirst.mockResolvedValue({ id: "org-1" });
    mockPrisma.platformConfig.findUnique.mockResolvedValue(null);
    mockPrisma.buildPhaseRun.upsert.mockResolvedValue({});
    mockGetQuiescenceLevel.mockResolvedValue("normal");
    mockIsSandboxAvailable.mockResolvedValue(false);
    mockStartBuildBranch.mockResolvedValue(undefined);
    mockRunBuildPipeline.mockResolvedValue({ step: "complete" });
    mockQueueBuildReviewVerification.mockResolvedValue(undefined);
    mockEvaluateBuildStudioPlanAdvancementGate.mockResolvedValue({
      allowed: true,
      interactionId: "DI-ALLOW",
      operatorMessage: "WWMD recommends starting implementation.",
      evaluation: {
        outcomeType: "recommend",
        confidenceScore: 0.9,
      },
    });
    mockEnforceBuildInitiativeReadiness.mockResolvedValue({ allowed: true, message: "allowed" });
    mockEvaluateBuildStudioDecision.mockResolvedValue({
      status: "recommended",
      recommendation: { optionId: "start-implementation", confidence: "high", margin: 0.8 },
      reasonSummary: "Recommended next action: start implementation.",
      operatorActionLabel: "Start implementation",
      auditSummary: "Governed pre-gate recommendation selected start-implementation.",
    });
    mockSaveBuildArtifactRevision.mockResolvedValue({
      revisionId: "rev-1",
      revisionNumber: 1,
      status: "accepted",
      receiptIds: [],
      warnings: [],
      errors: [],
    });
    mockListReleasableSandboxFiles.mockResolvedValue(["apps/web/components/build/BuildStudio.tsx"]);
    mockGetClientIdentity.mockResolvedValue({
      clientId: "test-client-id",
      gitAgentEmail: "agent-test@hive.dpf",
      gitAuthorName: "dpf-agent-test",
      clientBranch: "client/test-client-id",
      upstreamRemoteUrl: null,
    });
  });

  it("createFeatureBuild attaches a Work Capsule to direct Build Studio work", async () => {
    mockPrisma.featureBuild.create.mockImplementation(async (args) => ({
      id: "build-row-direct",
      buildId: args.data.buildId,
      title: "Harden portal work capsule routing",
      description: "Keep portal-started development inside governed work.",
      phase: "ideate",
    }));

    const result = await createFeatureBuild({
      title: "Harden portal work capsule routing",
      description: "Keep portal-started development inside governed work.",
    });

    if (!result.ok) throw new Error(`expected success, got: ${result.error}`);
    expect(result.buildId).toMatch(/^FB-[A-F0-9]{8}$/);
    expect(mockPrisma.workroom.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: "build-studio",
          executorKind: "build-studio",
          executorRef: result.buildId,
          status: "working",
          featureBuildId: "build-row-direct",
          backlogItemId: null,
          epicId: null,
          idempotencyKey: `build-studio:${result.buildId}`,
          workspaceState: expect.objectContaining({
            buildStudio: expect.objectContaining({
              buildId: result.buildId,
              phase: "ideate",
            }),
          }),
        }),
      }),
    );
    expect(mockPrisma.backlogItemActivity.create).not.toHaveBeenCalled();
  });

  it("createFeatureBuild swallows the fire-and-forget QuiescingError during a self-upgrade drain", async () => {
    // BI-QUIESCE-005: startBuildPhaseRun throws QuiescingError when the portal
    // is draining for a self-upgrade. createFeatureBuild fires it as `void …`
    // cost tracking, so that throw must be swallowed by a `.catch` — otherwise
    // it escapes as an unhandled promise rejection in the production server
    // process (not just under test). This locks in the `.catch(() => {})` fix.
    mockGetQuiescenceLevel.mockResolvedValue("draining");
    mockPrisma.featureBuild.create.mockImplementation(async (args) => ({
      id: "build-row-drain",
      buildId: args.data.buildId,
      title: "Drain-safe build",
      description: null,
      phase: "ideate",
    }));

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const result = await createFeatureBuild({ title: "Drain-safe build" });
      if (!result.ok) throw new Error(`expected success, got: ${result.error}`);
      expect(result.buildId).toMatch(/^FB-[A-F0-9]{8}$/);
      // Flush microtasks + one macrotask so that, were the `.catch` missing, the
      // QuiescingError would surface as an unhandledRejection here before we
      // assert that none was raised.
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(unhandled).toEqual([]);
    // The drain gate refuses the start before any DB write — the cost-tracking
    // upsert never runs.
    expect(mockPrisma.buildPhaseRun.upsert).not.toHaveBeenCalled();
  });

  it("createFeatureBuild RETURNS (not throws) the WIP-cap error so its message reaches the client", async () => {
    // In production, a thrown Server-Action error has its message stripped to a
    // generic digest, so the operator would never see "you already have 3 builds
    // in progress" — they'd see a scary render error. Locking in the returned-value
    // contract keeps the plain-English message intact across the RSC boundary.
    mockPrisma.featureBuild.count.mockResolvedValue(3); // at the cap (BUILD_WIP_CAP)

    const result = await createFeatureBuild({ title: "One build too many" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected the WIP cap to reject the build");
    expect(result.code).toBe("BUILD_WIP_CAP_REACHED");
    expect(result.error).toContain("3 builds in progress");
    // Rejected before any DB write — no build row, no work capsule.
    expect(mockPrisma.featureBuild.create).not.toHaveBeenCalled();
    expect(mockPrisma.workroom.create).not.toHaveBeenCalled();
  });

  it("updateFeatureBrief writes the legacy brief and backfills the BusinessBuildBrief contract", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      id: "feature-build-row-1",
      buildId: "FB-123",
      title: "Improve Build Studio intake",
      createdById: "user-1",
      phase: "ideate",
    });
    mockPrisma.featureBuild.update.mockResolvedValue({});

    const brief = {
      title: "Improve Build Studio intake",
      description: "Build Studio should turn business-language requests into a brief.",
      portfolioContext: "Build Studio",
      targetRoles: ["Operations lead"],
      inputs: ["Reviewed plan"],
      dataNeeds: "Business outcome, evidence, success signals",
      acceptanceCriteria: ["A non-developer can review the generated brief."],
    };

    await updateFeatureBrief("FB-123", brief);

    expect(mockPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function));
    expect(mockPrisma.featureBuild.update).toHaveBeenCalledWith({
      where: { buildId: "FB-123" },
      data: { brief },
    });
    expect(mockPrisma.businessBuildBrief.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { featureBuildId: "feature-build-row-1" },
        create: expect.objectContaining({
          briefId: "BBB-FB-123",
          orgId: "org-1",
          featureBuildId: "feature-build-row-1",
          capabilityPackId: "build_studio_self_development",
          status: "accepted",
          acceptedByUserId: "user-1",
          acceptedAt: expect.any(Date),
        }),
        update: expect.objectContaining({
          businessOutcome: brief.description,
          confidence: "high",
          acceptedByUserId: "user-1",
          acceptedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("updateBusinessBuildBrief persists business edits and accepts a complete brief", async () => {
    mockPrisma.businessBuildBrief.findUnique.mockResolvedValue({
      id: "business-brief-row-1",
      briefId: "BBB-FB-123",
      featureBuildId: "feature-build-row-1",
      submittedByUserId: "user-1",
      status: "awaiting_clarification",
    });

    await updateBusinessBuildBrief({
      briefId: "BBB-FB-123",
      intakeSource: "artifact_reference",
      evidenceKind: "document",
      businessOutcome: "Reduce missed support escalations before the morning standup.",
      affectedPeopleText: "Support manager\nCustomer success lead",
      affectedWorkflow: "Customer escalation review",
      sourceEvidenceText: "Existing Zendesk escalation report\nMorning standup SOP",
      copyAdaptAvoidText: "",
      successSignalsText: "Managers see unresolved escalations by site\nEvery escalation has an owner",
      constraintsText: "Do not expose customer data across accounts",
      openQuestionsText: "",
      accept: true,
    });

    expect(mockPrisma.businessBuildBrief.update).toHaveBeenCalledWith({
      where: { briefId: "BBB-FB-123" },
      data: expect.objectContaining({
        status: "accepted",
        acceptedByUserId: "user-1",
        acceptedAt: expect.any(Date),
        businessOutcome: "Reduce missed support escalations before the morning standup.",
        affectedWorkflow: "Customer escalation review",
        affectedPeople: [
          { kind: "persona", label: "Support manager" },
          { kind: "persona", label: "Customer success lead" },
        ],
        sourceEvidence: [
          expect.objectContaining({
            kind: "document",
            label: "Existing Zendesk escalation report",
            summary: "Existing Zendesk escalation report",
          }),
          expect.objectContaining({
            kind: "document",
            label: "Morning standup SOP",
            summary: "Morning standup SOP",
          }),
        ],
        successSignals: [
          "Managers see unresolved escalations by site",
          "Every escalation has an owner",
        ],
        constraints: ["Do not expose customer data across accounts"],
        openQuestions: [],
        confidence: "high",
      }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/build");
  });

  it("advanceBuildPhase blocks ideate to plan until the business brief is accepted", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      id: "build-row-1",
      phase: "ideate",
      createdById: "user-1",
      originatingBacklogItemId: null,
      draftApprovedAt: null,
      designDoc: null,
      designReview: null,
      plan: null,
      brief: {
        acceptanceCriteria: ["A non-developer can approve the business brief."],
      },
      buildPlan: null,
      planReview: null,
      taskResults: null,
      verificationOut: null,
      acceptanceMet: null,
      uxTestResults: null,
      uxVerificationStatus: null,
    });
    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({
      governedBacklogEnabled: true,
    });
    mockPrisma.businessBuildBrief.findUnique.mockResolvedValue({
      status: "awaiting_clarification",
    });

    await expect(advanceBuildPhase("FB-123", "plan")).rejects.toThrow(
      "Accept the business build brief before moving into planning.",
    );
    expect(mockPrisma.featureBuild.update).not.toHaveBeenCalled();
  });

  it("approveBuildStart stamps draftApprovedAt for governed backlog drafts", async () => {
    const buildRow = {
      createdById: "user-1",
      phase: "ideate",
      originatingBacklogItemId: "backlog-row-1",
      draftApprovedAt: null,
    };

    mockPrisma.featureBuild.findUnique.mockResolvedValue(buildRow);
    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({
      governedBacklogEnabled: true,
    });
    mockPrisma.featureBuild.update.mockResolvedValue({});

    const result = await approveBuildStart("FB-123");

    expect(result.ok).toBe(true);
    expect(result.ok && result.data.approvedAt).toBeInstanceOf(Date);
    expect(mockPrisma.featureBuild.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buildId: "FB-123" },
        data: expect.objectContaining({
          draftApprovedAt: expect.any(Date),
        }),
      }),
    );
  });

  // BI-CE1AB982 — approval used to succeed unconditionally, so an owner
  // approved a start that silently never dispatched and the panel then reported
  // "working" indefinitely.
  it("approveBuildStart refuses and does not stamp approval when no engine can run the build", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      createdById: "user-1",
      phase: "ideate",
      originatingBacklogItemId: "backlog-row-1",
      draftApprovedAt: null,
    });
    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({ governedBacklogEnabled: true });
    mockGetBuildStudioConfig.mockResolvedValueOnce({
      selection: {
        status: "blocked",
        selected: null,
        reason: "No eligible endpoints for task type 'code-gen'.",
        action: "Connect, provision, or wait for one allowed Build Studio engine, then retry.",
      },
    } as never);

    const result = await approveBuildStart("FB-123");

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("Connect, provision, or wait for one allowed Build Studio engine");
    // The owner's approval must not be recorded for work that cannot start.
    expect(mockPrisma.featureBuild.update).not.toHaveBeenCalled();
    expect(mockPrisma.buildActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tool: "dispatch_blocked" }),
      }),
    );
  });

  it("advanceBuildPhase blocks ideate to plan when governed drafts are not approved", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      id: "build-row-1",
      phase: "ideate",
      createdById: "user-1",
      originatingBacklogItemId: "backlog-row-1",
      draftApprovedAt: null,
      designDoc: null,
      designReview: null,
      plan: null,
      brief: null,
      buildPlan: null,
      planReview: null,
      taskResults: null,
      verificationOut: null,
      acceptanceMet: null,
      uxTestResults: null,
      uxVerificationStatus: null,
    });
    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({
      governedBacklogEnabled: true,
    });

    await expect(advanceBuildPhase("FB-123", "plan")).rejects.toThrow(
      "Approve Start before moving this governed backlog draft into planning.",
    );
    expect(mockPrisma.featureBuild.update).not.toHaveBeenCalled();
  });

  it("resumeBuildImplementation reopens review builds with flagged task results", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      createdById: "user-1",
      phase: "review",
      taskResultsVersion: 2,
      threadId: null,
      taskResults: {
        completedTasks: 2,
        totalTasks: 2,
        tasks: [
          { title: "Layout fix", specialist: "frontend-engineer", outcome: "DONE_WITH_CONCERNS" },
          { title: "Verification", specialist: "qa-engineer", outcome: "DONE_WITH_CONCERNS" },
        ],
      },
      verificationOut: {
        typecheckPassed: false,
        testsPassed: 0,
        testsFailed: 1,
      },
    });
    mockPrisma.featureBuild.update.mockResolvedValue({});

    const outcome = await resumeBuildImplementation("FB-123");

    expect(mockPrisma.featureBuild.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buildId: "FB-123" },
        data: expect.objectContaining({
          phase: "build",
          verificationOut: null,
          taskResultsVersion: { increment: 1 },
          taskResults: expect.objectContaining({
            completedTasks: 0,
            tasks: [
              expect.objectContaining({ title: "Layout fix", outcome: "BLOCKED" }),
              expect.objectContaining({ title: "Verification", outcome: "BLOCKED" }),
            ],
          }),
        }),
      }),
    );
    expect(outcome).toEqual({
      mode: "reset-blocked",
      resetTasks: 2,
      dispatchQueued: true,
      message: "Reset 2 tasks to BLOCKED; queued implementation resume.",
    });
  });

  it("resumeBuildImplementation reports replan-and-dispatch when no task rows exist", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      createdById: "user-1",
      phase: "build",
      sandboxId: null,
      diffPatch: null,
      diffSummary: null,
      taskResultsVersion: 1,
      threadId: null,
      taskResults: {
        completedTasks: 0,
        totalTasks: 16,
        tasks: [],
      },
      verificationOut: {
        typecheckPassed: false,
        testsPassed: 0,
        testsFailed: 0,
      },
    });
    mockPrisma.featureBuild.update.mockResolvedValue({});

    const outcome = await resumeBuildImplementation("FB-EMPTY");

    expect(outcome.mode).toBe("replan-and-dispatch");
    expect(outcome.resetTasks).toBe(0);
    expect(outcome.dispatchQueued).toBe(true);
    expect(outcome.message).toContain("No persisted task rows were reset");
  });

  it("resumeBuildImplementation prepares a clean sandbox branch when the sandbox is available", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      createdById: "user-1",
      phase: "build",
      taskResultsVersion: 4,
      threadId: null,
      taskResults: {
        completedTasks: 3,
        totalTasks: 6,
        tasks: [
          { title: "Layout fix", specialist: "frontend-engineer", outcome: "DONE" },
          { title: "Panel normalization", specialist: "frontend-engineer", outcome: "BLOCKED" },
        ],
      },
      verificationOut: null,
    });
    mockPrisma.featureBuild.update.mockResolvedValue({});
    mockIsSandboxAvailable.mockResolvedValue(true);

    await resumeBuildImplementation("FB-456");

    expect(mockIsSandboxAvailable).toHaveBeenCalledTimes(1);
    expect(mockStartBuildBranch).toHaveBeenCalledWith("FB-456");
  });

  it("resumeBuildImplementation reopens ship builds when release preparation found no releasable source diff", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      createdById: "user-1",
      phase: "ship",
      sandboxId: "dpf-sandbox-1",
      diffPatch: null,
      diffSummary: null,
      taskResultsVersion: 5,
      threadId: null,
      taskResults: {
        completedTasks: 2,
        totalTasks: 2,
        tasks: [
          { title: "Stabilize workflow shell", specialist: "frontend-engineer", outcome: "DONE" },
          { title: "Run verification", specialist: "qa-engineer", outcome: "DONE" },
        ],
      },
      verificationOut: {
        typecheckPassed: true,
        testsPassed: 2,
        testsFailed: 0,
      },
    });
    mockPrisma.featureBuild.update.mockResolvedValue({});
    mockIsSandboxAvailable.mockResolvedValue(true);
    mockListReleasableSandboxFiles.mockResolvedValue([]);

    await resumeBuildImplementation("FB-789");

    expect(mockListReleasableSandboxFiles).toHaveBeenCalledWith(
      "dpf-sandbox-1",
      { baseRef: "client/test-client-id" },
    );
    expect(mockStartBuildBranch).toHaveBeenCalledWith("FB-789");
    expect(mockPrisma.featureBuild.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buildId: "FB-789" },
        data: expect.objectContaining({
          phase: "build",
          diffPatch: null,
          diffSummary: null,
          verificationOut: null,
          taskResultsVersion: { increment: 1 },
          taskResults: expect.objectContaining({
            completedTasks: 0,
            tasks: [
              expect.objectContaining({ title: "Stabilize workflow shell", outcome: "BLOCKED" }),
              expect.objectContaining({ title: "Run verification", outcome: "BLOCKED" }),
            ],
          }),
        }),
      }),
    );
  });

  it("advanceBuildPhase enqueues UX verification when moving into review", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      id: "build-row-1",
      phase: "build",
      createdById: "user-1",
      originatingBacklogItemId: "backlog-row-1",
      draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
      designDoc: { problemStatement: "Fix overlap" },
      designReview: { decision: "pass", summary: "ok", issues: [] },
      plan: null,
      brief: { acceptanceCriteria: ["Header does not overlap content."] },
      buildPlan: {
        fileStructure: [{ path: "apps/web/components/build/BuildStudio.tsx", action: "modify", purpose: "Fix overlap" }],
        tasks: [{ title: "Fix overlap", testFirst: "Reproduce", implement: "Patch layout", verify: "Run checks" }],
      },
      planReview: { decision: "pass", summary: "ok", issues: [] },
      taskResults: { completedTasks: 1, totalTasks: 1, tasks: [{ title: "Fix overlap", outcome: "DONE" }] },
      verificationOut: { typecheckPassed: true, testsFailed: 0, testsPassed: 0 },
      acceptanceMet: null,
      uxTestResults: null,
      uxVerificationStatus: null,
      sandboxId: "dpf-sandbox-1",
      threadId: null,
    });
    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({
      governedBacklogEnabled: true,
    });
    mockPrisma.featureBuild.update.mockResolvedValue({});
    mockListReleasableSandboxFiles.mockResolvedValue(["apps/web/components/build/BuildStudio.tsx"]);

    await advanceBuildPhase("FB-123", "review");

    expect(mockPrisma.featureBuild.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buildId: "FB-123" },
        data: expect.objectContaining({ phase: "review" }),
      }),
    );
    expect(mockQueueBuildReviewVerification).toHaveBeenCalledWith("FB-123");
    expect(mockEvaluateBuildStudioPlanAdvancementGate).not.toHaveBeenCalled();
  });

  it("advanceBuildPhase invokes WWMD only for plan to build after deterministic gates pass", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      id: "build-row-1",
      phase: "plan",
      createdById: "user-1",
      originatingBacklogItemId: "backlog-row-1",
      draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
      designDoc: { problemStatement: "Add WWMD gate" },
      designReview: { decision: "pass", summary: "ok", issues: [] },
      plan: {
        happyPathState: {
          intake: {
            status: "ready",
            taxonomyNodeId: "taxonomy-1",
            backlogItemId: "BI-WWMD",
            epicId: "EP-WWMD",
            constrainedGoal: "Add WWMD gate",
            failureReason: null,
          },
        },
      },
      brief: { acceptanceCriteria: ["Decision ledger row is written."] },
      buildPlan: {
        fileStructure: [{ path: "apps/web/lib/decision-perspective/build-studio-gate.ts", action: "create", purpose: "Gate service" }],
        tasks: [{ title: "Gate service", testFirst: "Add tests", implement: "Write service", verify: "Run checks" }],
      },
      planReview: { decision: "pass", summary: "ready", issues: [] },
      taskResults: null,
      verificationOut: null,
      acceptanceMet: null,
      uxTestResults: null,
      uxVerificationStatus: null,
      sandboxId: null,
      deliberationSummary: null,
    });
    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({ governedBacklogEnabled: true });
    mockPrisma.featureBuild.update.mockResolvedValue({});

    await advanceBuildPhase("FB-123", "build");

    expect(mockEvaluateBuildStudioDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        request: expect.objectContaining({
          source: "build-studio",
          routeContext: "/build",
          buildId: "FB-123",
          phase: "plan",
          question: expect.stringContaining("Start implementation"),
          options: expect.arrayContaining([
            expect.objectContaining({ id: "start-implementation", operatorLabel: "Start implementation" }),
          ]),
        }),
      }),
    );
    expect(mockEvaluateBuildStudioPlanAdvancementGate).toHaveBeenCalledWith(
      expect.objectContaining({
        build: expect.objectContaining({ buildId: "FB-123", phase: "plan" }),
      }),
    );
    expect(mockPrisma.featureBuild.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buildId: "FB-123" },
        data: expect.objectContaining({ phase: "build" }),
      }),
    );
  });

  it("advanceBuildPhase blocks child implementation while an upstream sibling is unfinished", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      id: "build-row-usage",
      buildId: "FB-USAGE",
      title: "Record usage",
      phase: "plan",
      parentEpicId: "epic-row-1",
      dependenciesOut: [
        {
          dependsOn: {
            id: "build-row-read",
            buildId: "FB-READ",
            title: "Truck and parts read",
            phase: "build",
          },
        },
      ],
      createdById: "user-1",
      originatingBacklogItemId: "backlog-row-1",
      draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
      designDoc: { problemStatement: "Record parts usage" },
      designReview: { decision: "pass", summary: "ok", issues: [] },
      plan: {
        happyPathState: {
          intake: {
            status: "ready",
            taxonomyNodeId: "taxonomy-1",
            backlogItemId: "BI-USAGE",
            epicId: "EP-TRUCK",
            constrainedGoal: "Record usage",
            failureReason: null,
          },
        },
      },
      brief: { acceptanceCriteria: ["A technician can mark a part used."] },
      buildPlan: {
        fileStructure: [{ path: "apps/web/components/build/BuildStudio.tsx", action: "modify", purpose: "Record usage" }],
        tasks: [{ title: "Usage", testFirst: "Add test", implement: "Patch UI", verify: "Run checks" }],
      },
      planReview: { decision: "pass", summary: "ready", issues: [] },
      taskResults: null,
      verificationOut: null,
      acceptanceMet: null,
      uxTestResults: null,
      uxVerificationStatus: null,
      sandboxId: null,
      deliberationSummary: null,
    });
    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({ governedBacklogEnabled: true });

    await expect(advanceBuildPhase("FB-USAGE", "build")).rejects.toThrow(
      "Waiting on: Truck and parts read",
    );

    expect(mockEvaluateBuildStudioPlanAdvancementGate).not.toHaveBeenCalled();
    expect(mockPrisma.featureBuild.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buildId: "FB-USAGE" },
        data: expect.objectContaining({ phase: "build" }),
      }),
    );
  });

  it("advanceBuildPhase blocks plan to build when WWMD escalates or defers", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      id: "build-row-1",
      phase: "plan",
      createdById: "user-1",
      originatingBacklogItemId: "backlog-row-1",
      draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
      designDoc: { problemStatement: "Add WWMD gate" },
      designReview: { decision: "pass", summary: "ok", issues: [] },
      plan: {
        happyPathState: {
          intake: {
            status: "ready",
            taxonomyNodeId: "taxonomy-1",
            backlogItemId: "BI-WWMD",
            epicId: "EP-WWMD",
            constrainedGoal: "Add WWMD gate",
            failureReason: null,
          },
        },
      },
      brief: { acceptanceCriteria: ["Decision ledger row is written."] },
      buildPlan: {
        fileStructure: [{ path: "apps/web/lib/decision-perspective/build-studio-gate.ts", action: "create", purpose: "Gate service" }],
        tasks: [{ title: "Gate service", testFirst: "Add tests", implement: "Write service", verify: "Run checks" }],
      },
      planReview: { decision: "pass", summary: "ready", issues: [] },
      taskResults: null,
      verificationOut: null,
      acceptanceMet: null,
      uxTestResults: null,
      uxVerificationStatus: null,
      sandboxId: null,
      deliberationSummary: null,
    });
    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({ governedBacklogEnabled: true });
    mockEvaluateBuildStudioPlanAdvancementGate.mockResolvedValue({
      allowed: false,
      interactionId: "DI-BLOCK",
      operatorMessage: "WWMD requires escalation before implementation starts.",
      evaluation: {
        outcomeType: "escalate",
        confidenceScore: 0.42,
      },
    });

    await expect(advanceBuildPhase("FB-123", "build")).rejects.toThrow(
      "WWMD requires escalation before implementation starts.",
    );
    expect(mockPrisma.featureBuild.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buildId: "FB-123" },
        data: expect.objectContaining({ phase: "build" }),
      }),
    );
  });

  it("runBuildReviewVerification resets UX evidence and enqueues a fresh review pass", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      createdById: "user-1",
      phase: "review",
    });
    mockPrisma.featureBuild.update.mockResolvedValue({});

    await runBuildReviewVerification("FB-789");

    expect(mockPrisma.featureBuild.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buildId: "FB-789" },
        data: expect.objectContaining({
          uxVerificationStatus: null,
          uxTestResults: null,
        }),
      }),
    );
    expect(mockQueueBuildReviewVerification).toHaveBeenCalledWith("FB-789");
  });

  it("completeBuild records ready dependent children after their upstream blockers clear", async () => {
    mockPrisma.featureBuild.findUnique.mockImplementation(async (args) => {
      if ((args as { select?: { dependenciesIn?: unknown } }).select?.dependenciesIn) {
        return {
          id: "build-row-read",
          buildId: "FB-READ",
          title: "Truck and parts read",
          parentEpicId: "epic-row-1",
          phase: "complete",
          dependenciesIn: [
            {
              dependent: {
                id: "build-row-usage",
                buildId: "FB-USAGE",
                title: "Record usage",
                parentEpicId: "epic-row-1",
                phase: "plan",
                dependenciesOut: [
                  {
                    dependsOn: {
                      id: "build-row-read",
                      buildId: "FB-READ",
                      title: "Truck and parts read",
                      phase: "complete",
                    },
                  },
                ],
              },
            },
          ],
        };
      }

      return {
        createdById: "user-1",
      };
    });
    mockPrisma.featureBuild.update.mockResolvedValue({});

    await completeBuild("FB-READ");

    expect(mockAssertFeatureBuildCompletion).toHaveBeenCalledWith({
      buildId: "FB-READ",
      expectedPhase: undefined,
    });
    expect(mockPrisma.buildActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          buildId: "FB-USAGE",
          tool: "dependency:ready",
          summary: expect.stringContaining("Ready to plan"),
        }),
      }),
    );
  });

  it("recordBuildAcceptance persists met acceptance evidence once review checks are complete", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      createdById: "user-1",
      phase: "review",
      brief: {
        acceptanceCriteria: [
          "The workflow header no longer overlaps content.",
          "The operator can continue from review into release.",
        ],
      },
      designDoc: null,
      verificationOut: {
        typecheckPassed: true,
        testsPassed: 1,
        testsFailed: 7,
      },
      uxVerificationStatus: "complete",
      uxTestResults: [
        { step: "Header remains visible", passed: true },
        { step: "Continue action stays in view", passed: true },
      ],
    });
    await recordBuildAcceptance("FB-321");

    expect(mockSaveBuildArtifactRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        buildId: "FB-321",
        field: "acceptanceMet",
        savedByUserId: "user-1",
        value: [
          expect.objectContaining({
            criterion: "The workflow header no longer overlaps content.",
            met: true,
          }),
          expect.objectContaining({
            criterion: "The operator can continue from review into release.",
            met: true,
          }),
        ],
      }),
    );
    expect(mockPrisma.buildActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          buildId: "FB-321",
          tool: "record_acceptance",
        }),
      }),
    );
  });

  it("advanceBuildPhase blocks build to review when the sandbox has no releasable source diff (fake-task-complete guard)", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      id: "build-row-fake-1",
      phase: "build",
      createdById: "user-1",
      originatingBacklogItemId: "backlog-row-1",
      draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
      designDoc: { problemStatement: "Fix overlap" },
      designReview: { decision: "pass", summary: "ok", issues: [] },
      plan: null,
      brief: { acceptanceCriteria: ["Header does not overlap content."] },
      buildPlan: {
        fileStructure: [{ path: "apps/web/components/build/BuildStudio.tsx", action: "modify", purpose: "Fix overlap" }],
        tasks: [{ title: "Fix overlap", testFirst: "Reproduce", implement: "Patch layout", verify: "Run checks" }],
      },
      planReview: { decision: "pass", summary: "ok", issues: [] },
      taskResults: { completedTasks: 1, totalTasks: 1, tasks: [{ title: "Fix overlap", outcome: "DONE" }] },
      verificationOut: { typecheckPassed: true, testsFailed: 0, testsPassed: 4 },
      acceptanceMet: [{ criterion: "Header does not overlap content.", met: true }],
      uxTestResults: [{ step: "Header remains visible", passed: true }],
      uxVerificationStatus: "complete",
      sandboxId: "dpf-sandbox-1",
      threadId: null,
    });
    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({
      governedBacklogEnabled: true,
    });
    mockListReleasableSandboxFiles.mockResolvedValue([]);

    // BI-8C6AA60E: RETURNED as a value, not thrown — a thrown Server Action
    // message is stripped to a digest in production and the operator sees nothing.
    expect(await advanceBuildPhase("FB-123", "review")).toEqual({
      ok: false,
      message:
        "No releasable source changes are present in the sandbox. Tasks are marked complete but no code was written. Resume implementation and make real code changes before advancing to review.",
    });

    expect(mockPrisma.featureBuild.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buildId: "FB-123" },
        data: expect.objectContaining({ phase: "review" }),
      }),
    );
  });

  it("advanceBuildPhase blocks review to ship when the sandbox has no releasable source diff", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      id: "build-row-ship-1",
      phase: "review",
      createdById: "user-1",
      originatingBacklogItemId: "backlog-row-1",
      draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
      designDoc: { problemStatement: "Fix overlap" },
      designReview: { decision: "pass", summary: "ok", issues: [] },
      plan: null,
      brief: { acceptanceCriteria: ["Header does not overlap content."] },
      buildPlan: {
        fileStructure: [{ path: "apps/web/components/build/BuildStudio.tsx", action: "modify", purpose: "Fix overlap" }],
        tasks: [{ title: "Fix overlap", testFirst: "Reproduce", implement: "Patch layout", verify: "Run checks" }],
      },
      planReview: { decision: "pass", summary: "ok", issues: [] },
      taskResults: { completedTasks: 1, totalTasks: 1, tasks: [{ title: "Fix overlap", outcome: "DONE" }] },
      verificationOut: { typecheckPassed: true, testsFailed: 0, testsPassed: 4 },
      acceptanceMet: [{ criterion: "Header does not overlap content.", met: true }],
      uxTestResults: [{ step: "Header remains visible", passed: true }],
      uxVerificationStatus: "complete",
      sandboxId: "dpf-sandbox-1",
      threadId: null,
    });
    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({
      governedBacklogEnabled: true,
    });
    mockListReleasableSandboxFiles.mockResolvedValue([]);

    expect(await advanceBuildPhase("FB-123", "ship")).toEqual({
      ok: false,
      message:
        "No releasable source changes are present in the sandbox. Resume implementation and make a real code change before continuing to release.",
    });

    expect(mockPrisma.featureBuild.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buildId: "FB-123" },
        data: expect.objectContaining({ phase: "ship" }),
      }),
    );
  });
});
