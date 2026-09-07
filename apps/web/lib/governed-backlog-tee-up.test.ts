import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseFixContextFromBody } from "./governed-backlog-tee-up";

describe("parseFixContextFromBody (BI-E7BB3816)", () => {
  it("parses label-line Fix Context fields", () => {
    const parsed = parseFixContextFromBody(
      [
        "Reproduction steps: click save",
        "Expected: row persists",
        "Actual: 500",
        "Root cause: null deref",
        "Fix approach: null-check before write",
      ].join("\n"),
    );
    expect(parsed).toEqual({
      reproSteps: "click save",
      expected: "row persists",
      actual: "500",
      rootCause: "null deref",
      fixApproach: "null-check before write",
    });
  });

  it("parses multi-line markdown headings", () => {
    const parsed = parseFixContextFromBody(
      [
        "## Reproduction steps",
        "step 1",
        "step 2",
        "## Root cause",
        "parser drops fields",
        "## Fix approach",
        "map body → fixContext",
      ].join("\n"),
    );
    expect(parsed.reproSteps).toBe("step 1\nstep 2");
    expect(parsed.rootCause).toBe("parser drops fields");
    expect(parsed.fixApproach).toBe("map body → fixContext");
  });

  it("returns empty object for body without Fix Context labels", () => {
    expect(parseFixContextFromBody("just a free-form bug note")).toEqual({});
    expect(parseFixContextFromBody(null)).toEqual({});
  });
});

const mockPrisma = vi.hoisted(() => ({
  platformDevConfig: {
    findUnique: vi.fn(),
  },
  backlogItem: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  epic: {
    create: vi.fn(),
  },
  featureBuild: {
    create: vi.fn(),
    update: vi.fn(),
  },
  buildActivity: {
    create: vi.fn(),
  },
  backlogItemActivity: {
    create: vi.fn(),
  },
  workroom: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn().mockResolvedValue(null),
  },
  workroomActivity: {
    create: vi.fn(),
  },
  platformIssueReport: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
}));

describe("governed backlog tee-up", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({
      id: "singleton",
      governedBacklogEnabled: true,
      backlogTeeUpDailyCap: 2,
    });
    mockPrisma.backlogItemActivity.create.mockResolvedValue({});
    mockPrisma.workroom.findUnique.mockResolvedValue(null);
    mockPrisma.workroom.create.mockResolvedValue({
      id: "capsule-row-1",
      capsuleId: "WC-BUILD01",
    });
    mockPrisma.workroomActivity.create.mockResolvedValue({});
    mockPrisma.featureBuild.update.mockResolvedValue({});
    mockPrisma.platformIssueReport.findUnique.mockResolvedValue(null);
    mockPrisma.platformIssueReport.findFirst.mockResolvedValue(null);
    mockPrisma.platformIssueReport.updateMany.mockResolvedValue({ count: 0 });

    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => {
      return callback(mockPrisma);
    });
  });

  it("selects only eligible items, preferring active-epic work before bootstrap candidates", async () => {
    const { selectGovernedBacklogTeeUpCandidates } = await import("./governed-backlog-tee-up");

    const selected = selectGovernedBacklogTeeUpCandidates(
      [
        {
          id: "bootstrap-older",
          itemId: "BI-BOOT-OLDER",
          title: "Bootstrap older",
          body: null,
          status: "open",
          triageOutcome: "build",
          effortSize: "medium",
          activeBuildId: null,
          activeEpicId: null,
          digitalProductId: null,
          epicId: null,
          createdAt: new Date("2026-04-24T12:00:00.000Z"),
          epic: null,
        },
        {
          id: "epic-newer",
          itemId: "BI-EPIC-NEWER",
          title: "Epic newer",
          body: null,
          status: "open",
          triageOutcome: "build",
          effortSize: "large",
          activeBuildId: null,
          activeEpicId: null,
          digitalProductId: null,
          epicId: "epic-1",
          createdAt: new Date("2026-04-24T13:00:00.000Z"),
          epic: { status: "open" },
        },
        {
          id: "epic-older",
          itemId: "BI-EPIC-OLDER",
          title: "Epic older",
          body: null,
          status: "open",
          triageOutcome: "build",
          effortSize: "small",
          activeBuildId: null,
          activeEpicId: null,
          digitalProductId: null,
          epicId: "epic-2",
          createdAt: new Date("2026-04-24T11:00:00.000Z"),
          epic: { status: "in-progress" },
        },
        {
          id: "xlarge",
          itemId: "BI-XL",
          title: "Too large",
          body: null,
          status: "open",
          triageOutcome: "build",
          effortSize: "xlarge",
          activeBuildId: null,
          activeEpicId: null,
          digitalProductId: null,
          epicId: "epic-3",
          createdAt: new Date("2026-04-24T10:00:00.000Z"),
          epic: { status: "open" },
        },
        {
          id: "already-active",
          itemId: "BI-ACTIVE",
          title: "Already active",
          body: null,
          status: "open",
          triageOutcome: "build",
          effortSize: "medium",
          activeBuildId: "build-row-1",
          activeEpicId: null,
          digitalProductId: null,
          epicId: null,
          createdAt: new Date("2026-04-24T09:00:00.000Z"),
          epic: null,
        },
        {
          // BI-1D0CA7A0: a prior build for this item was decomposed, so its
          // activeEpicId points at a live Epic whose children carry the work.
          // Re-promoting it would mint the duplicate build that collides on
          // Epic.originatingBacklogItemId — it MUST be excluded even though its
          // activeBuildId is null and it is otherwise the oldest candidate.
          id: "already-decomposed",
          itemId: "BI-DECOMPOSED",
          title: "Already decomposed",
          body: null,
          status: "open",
          triageOutcome: "build",
          effortSize: "medium",
          activeBuildId: null,
          activeEpicId: "epic-decomposed-1",
          digitalProductId: null,
          epicId: "epic-4",
          createdAt: new Date("2026-04-24T08:00:00.000Z"),
          epic: { status: "open" },
        },
      ],
      3,
    );

    // BI-DECOMPOSED is excluded despite being the oldest and otherwise eligible.
    expect(selected.map((item) => item.itemId)).toEqual([
      "BI-EPIC-OLDER",
      "BI-EPIC-NEWER",
      "BI-BOOT-OLDER",
    ]);
    expect(selected.map((item) => item.itemId)).not.toContain("BI-DECOMPOSED");
  });

  it("creates draft builds for the selected items and auto-approves them under governed flow (BI-52022707 axis D)", async () => {
    mockPrisma.backlogItem.findMany.mockResolvedValue([
      {
        id: "backlog-epic",
        itemId: "BI-EPIC-1",
        title: "Epic-backed workflow work",
        body: "Implement governed workflow details",
        status: "open",
        triageOutcome: "build",
        effortSize: "medium",
        activeBuildId: null,
        digitalProductId: "product-1",
        portfolioId: "portfolio-1",
        epicId: "epic-1",
        createdAt: new Date("2026-04-24T10:00:00.000Z"),
        epic: { status: "open" },
      },
      {
        id: "backlog-bootstrap",
        itemId: "BI-BOOT-2",
        title: "Bootstrap workflow work",
        body: "Create a safe draft",
        status: "open",
        triageOutcome: "build",
        effortSize: "large",
        activeBuildId: null,
        digitalProductId: null,
        epicId: null,
        createdAt: new Date("2026-04-24T11:00:00.000Z"),
        epic: null,
      },
    ]);
    mockPrisma.backlogItem.findUnique
      .mockResolvedValueOnce({
        id: "backlog-epic",
        itemId: "BI-EPIC-1",
        title: "Epic-backed workflow work",
        body: "Implement governed workflow details",
        status: "open",
        triageOutcome: "build",
        effortSize: "medium",
        activeBuildId: null,
        digitalProductId: "product-1",
        portfolioId: "portfolio-1",
        epicId: "epic-1",
        taxonomyNodeId: "taxonomy-node-1",
        createdAt: new Date("2026-04-24T10:00:00.000Z"),
        epic: { epicId: "EP-WORKFLOW-1" },
      })
      .mockResolvedValueOnce({
        id: "backlog-bootstrap",
        itemId: "BI-BOOT-2",
        title: "Bootstrap workflow work",
        body: "Create a safe draft",
        status: "open",
        triageOutcome: "build",
        effortSize: "large",
        activeBuildId: null,
        digitalProductId: null,
        epicId: null,
        taxonomyNodeId: null,
        createdAt: new Date("2026-04-24T11:00:00.000Z"),
        epic: null,
      });

    mockPrisma.epic.create.mockResolvedValueOnce({
      id: "epic-cuid-bootstrap",
      epicId: "EP-BUILD-AAAAAA",
    });

    mockPrisma.featureBuild.create
      .mockResolvedValueOnce({ id: "build-row-1", buildId: "FB-11111111" })
      .mockResolvedValueOnce({ id: "build-row-2", buildId: "FB-22222222" });

    const { runGovernedBacklogTeeUp } = await import("./governed-backlog-tee-up");
    const result = await runGovernedBacklogTeeUp({
      prisma: mockPrisma,
      userId: "user-1",
      trigger: "daily",
    });

    expect(result).toEqual({
      trigger: "daily",
      requestedLimit: 2,
      selectedCount: 2,
      createdCount: 2,
      skippedCount: 0,
      builds: [
        { backlogItemId: "BI-EPIC-1", buildId: "FB-11111111" },
        { backlogItemId: "BI-BOOT-2", buildId: "FB-22222222" },
      ],
    });

    expect(mockPrisma.featureBuild.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          title: "Epic-backed workflow work",
          description: "Implement governed workflow details",
          digitalProductId: "product-1",
          portfolioId: "portfolio-1",
          originatingBacklogItemId: "backlog-epic",
          // BI-52022707 axis D: draft created with draftApprovedAt=null;
          // the auto-approve happens as a separate featureBuild.update
          // immediately after creation when governedBacklogEnabled=true
          // and the BI body is non-empty (verified by the update assertion
          // and the approve_start activity row assertion below).
          draftApprovedAt: null,
        }),
      }),
    );

    // BI-52022707 axis D — auto-approve fires on governed-mode promotion
    // when the BI body is non-empty. The approve_start BuildActivity row
    // pairs with the featureBuild.update that populates draftApprovedAt.
    expect(mockPrisma.featureBuild.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "build-row-1" },
        data: expect.objectContaining({
          draftApprovedAt: expect.any(Date),
        }),
      }),
    );
    expect(mockPrisma.buildActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          buildId: "FB-11111111",
          tool: "approve_start",
          summary: expect.stringContaining("Auto-approved by governed backlog flow"),
        }),
      }),
    );
    expect(mockPrisma.backlogItem.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { itemId: "BI-EPIC-1" },
        data: expect.objectContaining({
          activeBuildId: "build-row-1",
          status: "open",
        }),
      }),
    );
    expect(mockPrisma.buildActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          buildId: "FB-11111111",
          tool: "governed_backlog_tee_up",
          summary: expect.stringContaining("daily backlog tee-up"),
        }),
      }),
    );
    expect(mockPrisma.workroom.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: "build-studio",
          executorKind: "build-studio",
          executorRef: "FB-11111111",
          status: "working",
          backlogItemId: "backlog-epic",
          epicId: "epic-1",
          featureBuildId: "build-row-1",
          idempotencyKey: "build-studio:FB-11111111",
        }),
      }),
    );
    expect(mockPrisma.backlogItemActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          backlogItemId: "backlog-epic",
          kind: "build-studio-capsule-attached",
          recordedById: "user-1",
          summary: expect.stringContaining("FB-11111111"),
          payload: expect.objectContaining({
            buildId: "FB-11111111",
            capsuleId: "WC-BUILD01",
            featureBuildId: "build-row-1",
          }),
        }),
      }),
    );
  });

  it("skips processing when governed backlog mode is disabled", async () => {
    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({
      id: "singleton",
      governedBacklogEnabled: false,
      backlogTeeUpDailyCap: 2,
    });

    const { runGovernedBacklogTeeUp } = await import("./governed-backlog-tee-up");
    const result = await runGovernedBacklogTeeUp({
      prisma: mockPrisma,
      userId: "user-1",
      trigger: "manual",
    });

    expect(result).toEqual({
      trigger: "manual",
      requestedLimit: 2,
      selectedCount: 0,
      createdCount: 0,
      skippedCount: 0,
      builds: [],
    });
    expect(mockPrisma.backlogItem.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.featureBuild.create).not.toHaveBeenCalled();
  });

  it("requires an evidence-cleared active playbook before enforce-mode auto-start", async () => {
    const { shouldAutoApproveGovernedDraft } = await import(
      "./governed-backlog-tee-up"
    );
    const ineligible = {
      eligible: false,
      lane: "standard" as const,
      sensitivity: "low" as const,
      blockers: ["active_pattern_binding_missing"],
      nextGovernedAction: "escalate" as const,
    };
    const eligible = {
      eligible: true,
      lane: "one-shot" as const,
      sensitivity: "low" as const,
      activePatternVersion: 2,
      blockers: [],
      nextGovernedAction: "auto-start" as const,
    };

    expect(shouldAutoApproveGovernedDraft({
      governedBacklogEnabled: true,
      hasBody: true,
      autonomousStart: { mode: "enforce", eligibility: ineligible },
    })).toBe(false);
    expect(shouldAutoApproveGovernedDraft({
      governedBacklogEnabled: true,
      hasBody: true,
      autonomousStart: { mode: "enforce", eligibility: eligible },
    })).toBe(true);
  });

  describe("promoteBacklogItemToBuildDraft intake initialization", () => {
    it("seeds happyPathState.intake from a BI with an existing epic and taxonomy", async () => {
      mockPrisma.backlogItem.findUnique.mockResolvedValueOnce({
        id: "bi-cuid-1",
        itemId: "BI-EPIC-OK",
        title: "Add taxonomy filter to operations map",
        body: "Operators need to scope the map by taxonomy node.",
        status: "open",
        triageOutcome: "build",
        effortSize: "medium",
        activeBuildId: null,
        digitalProductId: "product-1",
        epicId: "epic-cuid-1",
        taxonomyNodeId: "taxonomy-cuid-ops",
        epic: { epicId: "EP-OPS-001" },
      });
      mockPrisma.featureBuild.create.mockResolvedValueOnce({
        id: "build-row-1",
        buildId: "FB-12345678",
      });

      const { promoteBacklogItemToBuildDraft } = await import("./governed-backlog-tee-up");
      const result = await promoteBacklogItemToBuildDraft({
        tx: mockPrisma,
        itemId: "BI-EPIC-OK",
        userId: "user-1",
        governedBacklogEnabled: true,
      });

      expect(result.kind).toBe("success");
      if (result.kind === "success") {
        expect(result.capsuleId).toBe("WC-BUILD01");
      }
      expect(mockPrisma.epic.create).not.toHaveBeenCalled();
      expect(mockPrisma.workroom.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            source: "build-studio",
            executorKind: "build-studio",
            executorRef: "FB-12345678",
            status: "working",
            backlogItemId: "bi-cuid-1",
            epicId: "epic-cuid-1",
            featureBuildId: "build-row-1",
            idempotencyKey: "build-studio:FB-12345678",
            workspaceState: expect.objectContaining({
              buildStudio: expect.objectContaining({
                buildId: "FB-12345678",
                phase: "ideate",
              }),
              backlogItem: expect.objectContaining({
                itemId: "BI-EPIC-OK",
              }),
            }),
          }),
        }),
      );
      expect(mockPrisma.backlogItemActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            backlogItemId: "bi-cuid-1",
            kind: "build-studio-capsule-attached",
            recordedById: "user-1",
            payload: expect.objectContaining({
              buildId: "FB-12345678",
              capsuleId: "WC-BUILD01",
              featureBuildId: "build-row-1",
            }),
          }),
        }),
      );

      const createCall = mockPrisma.featureBuild.create.mock.calls[0]![0];
      const intake = createCall.data.plan.happyPathState.intake;
      expect(intake).toEqual({
        status: "ready",
        backlogItemId: "BI-EPIC-OK",
        epicId: "EP-OPS-001",
        taxonomyNodeId: "taxonomy-cuid-ops",
        constrainedGoal: "Add taxonomy filter to operations map",
        failureReason: null,
      });
    });

    it("promotes a bug workType item as kind=fix, carries fixContext, and back-links the issue report", async () => {
      mockPrisma.backlogItem.findUnique.mockResolvedValueOnce({
        id: "bi-cuid-bug",
        itemId: "BI-PIR-abcd1234",
        title: "Contact form 500s on submit",
        body: "Server error on submit\n\nRoute: /portal/contact\n\nSource report: PIR-ABCDE",
        status: "open",
        triageOutcome: "build",
        effortSize: "small",
        activeBuildId: null,
        digitalProductId: null,
        epicId: null,
        taxonomyNodeId: null,
        // workType drives kind derivation (post 2026-05-30 spec). The legacy
        // source value is left at the canonicalized origin so any reader of
        // source sees the intake channel, not the work-type.
        workType: "bug",
        source: "automated-detection",
        epic: null,
      });
      mockPrisma.platformIssueReport.findUnique.mockResolvedValueOnce({
        id: "pir-row-1",
        reportId: "PIR-ABCDE",
        severity: "high",
        routeContext: "/portal/contact",
        errorStack: "TypeError: cannot read 'format' of undefined\n  at submitContact",
        description: "500 error when submitting the contact form",
      });
      mockPrisma.epic.create.mockResolvedValueOnce({ id: "epic-cuid-fix", epicId: "EP-BUILD-FIX001" });
      mockPrisma.featureBuild.create.mockResolvedValueOnce({ id: "build-row-fix", buildId: "FB-FIX00001" });

      const { promoteBacklogItemToBuildDraft } = await import("./governed-backlog-tee-up");
      const result = await promoteBacklogItemToBuildDraft({
        tx: mockPrisma,
        itemId: "BI-PIR-abcd1234",
        userId: "user-1",
        governedBacklogEnabled: true,
      });

      expect(result.kind).toBe("success");

      const createData = mockPrisma.featureBuild.create.mock.calls[0]![0].data;
      expect(createData.kind).toBe("fix");
      expect(createData.brief.fixContext).toEqual(
        expect.objectContaining({
          severity: "high",
          originatingIssueReportId: "pir-row-1",
          originatingIssueReportPublicId: "PIR-ABCDE",
          routeContext: "/portal/contact",
        }),
      );
      expect(createData.brief.fixContext.errorStackExcerpt).toContain("TypeError");

      // Back-link written in-transaction, guarded on featureBuildId: null.
      expect(mockPrisma.platformIssueReport.updateMany).toHaveBeenCalledWith({
        where: { id: "pir-row-1", featureBuildId: null },
        data: { featureBuildId: "build-row-fix" },
      });
    });

    it("maps structured Fix Context body fields onto fixContext (BI-E7BB3816)", async () => {
      const body = [
        "Contact form 500s on submit",
        "",
        "Source report: PIR-ABCDE",
        "",
        "## Reproduction steps",
        "1. Open /portal/contact",
        "2. Submit the form",
        "",
        "Expected: Form saves and shows a success toast",
        "Actual: HTTP 500 and blank page",
        "Root cause: format() called on undefined locale",
        "Fix approach: Guard locale before format(); add regression test",
      ].join("\n");

      mockPrisma.backlogItem.findUnique.mockResolvedValueOnce({
        id: "bi-cuid-diagnosed",
        itemId: "BI-DIAG-001",
        title: "Contact form 500s on submit",
        body,
        status: "open",
        triageOutcome: "build",
        effortSize: "small",
        activeBuildId: null,
        digitalProductId: null,
        epicId: null,
        taxonomyNodeId: null,
        workType: "bug",
        source: "automated-detection",
        epic: null,
      });
      mockPrisma.platformIssueReport.findUnique.mockResolvedValueOnce({
        id: "pir-row-1",
        reportId: "PIR-ABCDE",
        severity: "high",
        routeContext: "/portal/contact",
        errorStack: "TypeError: cannot read 'format'",
        description: "truncated PIR description that must not replace structured actual",
      });
      mockPrisma.epic.create.mockResolvedValueOnce({ id: "epic-cuid-fix", epicId: "EP-BUILD-FIX002" });
      mockPrisma.featureBuild.create.mockResolvedValueOnce({ id: "build-row-fix2", buildId: "FB-FIX00002" });

      const { promoteBacklogItemToBuildDraft } = await import("./governed-backlog-tee-up");
      const result = await promoteBacklogItemToBuildDraft({
        tx: mockPrisma,
        itemId: "BI-DIAG-001",
        userId: "user-1",
        governedBacklogEnabled: true,
      });

      expect(result.kind).toBe("success");
      const fc = mockPrisma.featureBuild.create.mock.calls[0]![0].data.brief.fixContext;
      expect(fc.reproSteps).toContain("Open /portal/contact");
      expect(fc.expected).toContain("success toast");
      expect(fc.actual).toBe("HTTP 500 and blank page");
      expect(fc.rootCause).toContain("format()");
      expect(fc.fixApproach).toContain("Guard locale");
    });

    it("auto-creates a solo epic and falls back to a triaged-bi taxonomy anchor when BI has neither", async () => {
      mockPrisma.backlogItem.findUnique.mockResolvedValueOnce({
        id: "bi-cuid-solo",
        itemId: "BI-SOLO",
        title: "Surface stale agent grants in admin",
        body: null,
        status: "open",
        triageOutcome: "build",
        effortSize: "small",
        activeBuildId: null,
        digitalProductId: null,
        epicId: null,
        taxonomyNodeId: null,
        epic: null,
      });
      mockPrisma.epic.create.mockResolvedValueOnce({
        id: "epic-cuid-solo",
        epicId: "EP-BUILD-ABCDEF",
      });
      mockPrisma.featureBuild.create.mockResolvedValueOnce({
        id: "build-row-solo",
        buildId: "FB-SOLO0001",
      });

      const { promoteBacklogItemToBuildDraft } = await import("./governed-backlog-tee-up");
      const result = await promoteBacklogItemToBuildDraft({
        tx: mockPrisma,
        itemId: "BI-SOLO",
        userId: "user-1",
        governedBacklogEnabled: true,
      });

      expect(result.kind).toBe("success");

      // Epic was minted from the BI title and linked back to the BI before
      // the build was created.
      expect(mockPrisma.epic.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: "Surface stale agent grants in admin",
            status: "open",
            epicId: expect.stringMatching(/^EP-BUILD-[A-F0-9]{6}$/),
          }),
        }),
      );
      expect(mockPrisma.backlogItem.update).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { itemId: "BI-SOLO" },
          data: { epicId: "epic-cuid-solo" },
        }),
      );

      const mintedEpicId = mockPrisma.epic.create.mock.calls[0]![0].data.epicId;
      const createCall = mockPrisma.featureBuild.create.mock.calls[0]![0];
      const intake = createCall.data.plan.happyPathState.intake;
      expect(intake).toEqual({
        status: "ready",
        backlogItemId: "BI-SOLO",
        epicId: mintedEpicId,
        taxonomyNodeId: "triaged-bi:bi-cuid-solo",
        constrainedGoal: "Surface stale agent grants in admin",
        failureReason: null,
      });
    });

    it("derives constrainedGoal from the BI title, truncated to 280 chars", async () => {
      const longTitle = "Long feature title ".repeat(20).trim(); // ~ 380 chars
      mockPrisma.backlogItem.findUnique.mockResolvedValueOnce({
        id: "bi-cuid-long",
        itemId: "BI-LONG",
        title: longTitle,
        body: "Even longer body. ".repeat(200),
        status: "open",
        triageOutcome: "build",
        effortSize: "medium",
        activeBuildId: null,
        digitalProductId: null,
        epicId: "epic-cuid-long",
        taxonomyNodeId: null,
        epic: { epicId: "EP-LONG-001" },
      });
      mockPrisma.featureBuild.create.mockResolvedValueOnce({
        id: "build-row-long",
        buildId: "FB-LONG0001",
      });

      const { promoteBacklogItemToBuildDraft } = await import("./governed-backlog-tee-up");
      const result = await promoteBacklogItemToBuildDraft({
        tx: mockPrisma,
        itemId: "BI-LONG",
        userId: "user-1",
        governedBacklogEnabled: true,
      });

      expect(result.kind).toBe("success");

      const createCall = mockPrisma.featureBuild.create.mock.calls[0]![0];
      const intake = createCall.data.plan.happyPathState.intake;
      expect(intake.constrainedGoal).toHaveLength(280);
      expect(longTitle.startsWith(intake.constrainedGoal)).toBe(true);
    });
  });
});
