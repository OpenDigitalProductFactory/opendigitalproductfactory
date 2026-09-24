import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => {
  const create = vi.fn();
  const prisma = { taskRun: { create } };
  return {
    prisma: { ...prisma, $transaction: vi.fn(async (callback) => callback(prisma)) },
  };
});

vi.mock("@/lib/platform-runtime/work-admission", () => ({ admitRuntimeGuardedWork: vi.fn() }));

describe("detectScheduledRunInferenceFailure", () => {
  it("flags the live-reproduced all-endpoints-failed apology as a failed run (BI-E0F27E0E)", async () => {
    const { detectScheduledRunInferenceFailure } = await import("./scheduled-task-runs");
    expect(
      detectScheduledRunInferenceFailure({
        executedToolCount: 0,
        content:
          "The AI providers are momentarily busy (usually rate-limited or overloaded). Please try again in about 30 seconds — no setup change is needed.",
      }),
    ).toBe("rate-limit");
  });

  it("flags config-gap and connection apologies too", async () => {
    const { detectScheduledRunInferenceFailure } = await import("./scheduled-task-runs");
    expect(
      detectScheduledRunInferenceFailure({
        executedToolCount: 0,
        content: "No AI providers are configured for this workspace.",
      }),
    ).toBe("config");
    expect(
      detectScheduledRunInferenceFailure({ executedToolCount: 0, content: "fetch failed" }),
    ).toBe("connection");
  });

  it("never flags a run that executed tools, whatever the closing text", async () => {
    const { detectScheduledRunInferenceFailure } = await import("./scheduled-task-runs");
    expect(
      detectScheduledRunInferenceFailure({
        executedToolCount: 2,
        content: "The AI providers are momentarily busy (usually rate-limited or overloaded).",
      }),
    ).toBeNull();
  });

  it("returns null for real content and empty output", async () => {
    const { detectScheduledRunInferenceFailure } = await import("./scheduled-task-runs");
    expect(
      detectScheduledRunInferenceFailure({
        executedToolCount: 0,
        content: "Reviewed 8 orders; Margherita Pizza is trending at 11 units.",
      }),
    ).toBeNull();
    expect(detectScheduledRunInferenceFailure({ executedToolCount: 0, content: null })).toBeNull();
    expect(detectScheduledRunInferenceFailure({ executedToolCount: 0, content: "" })).toBeNull();
  });
});

describe("detectScheduledRequiredToolFailure", () => {
  it("rejects TR-SCHED-7841123E instead of recording ok when its required governed mutation executed zero tools", async () => {
    const { detectScheduledRequiredToolFailure } = await import("./scheduled-task-runs");
    expect(
      detectScheduledRequiredToolFailure({
        prompt: "Use only promote_to_build_studio to promote BI-37719AAB.",
        authorizedTools: [
          { name: "get_backlog_item", sideEffect: false },
          { name: "promote_to_build_studio", sideEffect: true },
        ],
        executedTools: [],
      }),
    ).toBe("required governed tool promote_to_build_studio executed zero times");
  });

  it("does not call a diverted proposal a failed run (BI-4F64C5D3)", async () => {
    // This case used to report "executed zero times". A proposal is genuinely
    // not delivery — but when the run's actionBoundary is "propose", diverting
    // the call is the run behaving correctly, and calling that a failure put
    // every propose-boundary coworker into the BI-754C9E82 retry cadence, which
    // re-proposed what it had already proposed. Measured on the reference
    // install 2026-09-12: 183 proposals since 2026-08-26, none approved,
    // including 55 copies of a single run_hive_scout_ingest.
    //
    // The distinction the old boolean could not carry now lives in
    // classifyScheduledRequiredTools: absent is a failure, proposed is not.
    const { detectScheduledRequiredToolFailure } = await import("./scheduled-task-runs");
    expect(
      detectScheduledRequiredToolFailure({
        prompt: "Use only promote_to_build_studio to promote BI-NOT-REAL.",
        authorizedTools: [{ name: "promote_to_build_studio", sideEffect: true }],
        executedTools: [
          {
            name: "promote_to_build_studio",
            result: {
              success: true,
              data: { proposalId: "prop-live-repro", status: "proposed" },
            },
          },
        ],
      }),
    ).toBeNull();
  });
});

describe("classifyScheduledRequiredTools (BI-4F64C5D3)", () => {
  const REQUIRED = [{ name: "run_hive_scout_ingest", sideEffect: true }];
  const PROMPT = "Invoke run_hive_scout_ingest once before writing any summary.";

  it("calls a landed mutation executed", async () => {
    const { classifyScheduledRequiredTools } = await import("./scheduled-task-runs");
    expect(
      classifyScheduledRequiredTools({
        prompt: PROMPT,
        authorizedTools: REQUIRED,
        executedTools: [{ name: "run_hive_scout_ingest", result: { success: true } }],
      }),
    ).toEqual({ kind: "executed" });
  });

  it("calls a diverted mutation proposed, and names the tool", async () => {
    // The live shape: the coworker said "the daily external catalog scout pass
    // has been proposed and is now awaiting your approval", and the platform
    // filed the run as a failure.
    const { classifyScheduledRequiredTools } = await import("./scheduled-task-runs");
    expect(
      classifyScheduledRequiredTools({
        prompt: PROMPT,
        authorizedTools: REQUIRED,
        executedTools: [
          {
            name: "run_hive_scout_ingest",
            result: { success: true, data: { proposalId: "prop-1", status: "proposed" } },
          },
        ],
      }),
    ).toEqual({ kind: "proposed", toolName: "run_hive_scout_ingest" });
  });

  it("calls a mutation that was never attempted absent — still a failure", async () => {
    const { classifyScheduledRequiredTools } = await import("./scheduled-task-runs");
    expect(
      classifyScheduledRequiredTools({
        prompt: PROMPT,
        authorizedTools: REQUIRED,
        executedTools: [{ name: "get_marketing_summary", result: { success: true } }],
      }),
    ).toEqual({ kind: "absent", toolName: "run_hive_scout_ingest" });
  });

  it("a failed attempt is absent, not proposed", async () => {
    const { classifyScheduledRequiredTools } = await import("./scheduled-task-runs");
    expect(
      classifyScheduledRequiredTools({
        prompt: PROMPT,
        authorizedTools: REQUIRED,
        executedTools: [{ name: "run_hive_scout_ingest", result: { success: false } }],
      }),
    ).toEqual({ kind: "absent", toolName: "run_hive_scout_ingest" });
  });

  it("one landed attempt beats an earlier diverted one", async () => {
    const { classifyScheduledRequiredTools } = await import("./scheduled-task-runs");
    expect(
      classifyScheduledRequiredTools({
        prompt: PROMPT,
        authorizedTools: REQUIRED,
        executedTools: [
          {
            name: "run_hive_scout_ingest",
            result: { success: true, data: { proposalId: "p", status: "proposed" } },
          },
          { name: "run_hive_scout_ingest", result: { success: true } },
        ],
      }),
    ).toEqual({ kind: "executed" });
  });

  it("a genuinely absent mutation outranks a diverted one elsewhere", async () => {
    // A run that proposed one thing and never attempted another has still
    // failed: the retry cadence is the right home for the missing one.
    const { classifyScheduledRequiredTools } = await import("./scheduled-task-runs");
    expect(
      classifyScheduledRequiredTools({
        prompt: "Call run_hive_scout_ingest, then create_backlog_item.",
        authorizedTools: [
          { name: "run_hive_scout_ingest", sideEffect: true },
          { name: "create_backlog_item", sideEffect: true },
        ],
        executedTools: [
          {
            name: "run_hive_scout_ingest",
            result: { success: true, data: { proposalId: "p", status: "proposed" } },
          },
        ],
      }),
    ).toEqual({ kind: "absent", toolName: "create_backlog_item" });
  });

  it("calls an approval-envelope rejection proposed, not absent", async () => {
    // The live marketing repro, TR-SCHED-76846488 on 2026-09-07: the coworker
    // read its context, then called create_marketing_campaign_brief, which was
    // rejected with error "approval_required" and an envelope expiring 15
    // minutes later. Nobody was watching a Monday 16:10 autonomous run, so the
    // envelope lapsed; the coworker saw a failed call and retried until it hit
    // its safety limit. The run was filed as an error, and its last words were
    // "couldn't complete a final answer before hitting my safety limit".
    //
    // 425 tool failures on this install carry that error since 2026-08-25.
    const { classifyScheduledRequiredTools } = await import("./scheduled-task-runs");
    expect(
      classifyScheduledRequiredTools({
        prompt: "If there is NO recent brief, create one with create_marketing_campaign_brief.",
        authorizedTools: [{ name: "create_marketing_campaign_brief", sideEffect: true }],
        executedTools: [
          {
            name: "create_marketing_campaign_brief",
            result: { success: false, error: "approval_required" },
          },
        ],
      }),
    ).toEqual({ kind: "proposed", toolName: "create_marketing_campaign_brief" });
  });

  it("a failure that is not an approval request is still absent", async () => {
    // Only a pending human decision earns the third verdict. A validation
    // error, a denied grant or a crash is a real failure and must keep its
    // retry.
    const { classifyScheduledRequiredTools } = await import("./scheduled-task-runs");
    expect(
      classifyScheduledRequiredTools({
        prompt: PROMPT,
        authorizedTools: REQUIRED,
        executedTools: [
          { name: "run_hive_scout_ingest", result: { success: false, error: "grant_denied" } },
        ],
      }),
    ).toEqual({ kind: "absent", toolName: "run_hive_scout_ingest" });
  });

  it("a later successful call beats an earlier approval rejection", async () => {
    const { classifyScheduledRequiredTools } = await import("./scheduled-task-runs");
    expect(
      classifyScheduledRequiredTools({
        prompt: PROMPT,
        authorizedTools: REQUIRED,
        executedTools: [
          { name: "run_hive_scout_ingest", result: { success: false, error: "approval_required" } },
          { name: "run_hive_scout_ingest", result: { success: true } },
        ],
      }),
    ).toEqual({ kind: "executed" });
  });

  it("a read-only tool is never required", async () => {
    const { classifyScheduledRequiredTools } = await import("./scheduled-task-runs");
    expect(
      classifyScheduledRequiredTools({
        prompt: "Call get_marketing_summary first.",
        authorizedTools: [{ name: "get_marketing_summary" }],
        executedTools: [],
      }),
    ).toEqual({ kind: "executed" });
  });
});

describe("createTaskRunForScheduledTask", () => {
  beforeEach(async () => {
    const { prisma } = await import("@dpf/db");
    vi.mocked(prisma.taskRun.create).mockReset();
  });

  it("creates a proactive TaskRun with the scheduled-task source ref", async () => {
    const { prisma } = await import("@dpf/db");
    vi.mocked(prisma.taskRun.create).mockResolvedValue({
      id: "tr_internal_1",
      taskRunId: "TR-SCHED-ABCDE",
      contextId: "thread-1",
    } as never);

    const { createTaskRunForScheduledTask } = await import("./scheduled-task-runs");

    const ref = await createTaskRunForScheduledTask({
      taskId: "discovery-taxonomy-gap-triage-daily",
      ownerUserId: "user-1",
      agentId: "inventory-specialist",
      threadId: "thread-1",
      routeContext: "/platform/tools/discovery",
      title: "Discovery Taxonomy Gap Triage",
      prompt: "Triage taxonomy gaps from discovery.",
    });

    expect(ref).toEqual({
      id: "tr_internal_1",
      taskRunId: "TR-SCHED-ABCDE",
      contextId: "thread-1",
    });

    expect(prisma.taskRun.create).toHaveBeenCalledOnce();
    const arg = vi.mocked(prisma.taskRun.create).mock.calls[0]?.[0];
    expect(arg?.data).toMatchObject({
      userId: "user-1",
      threadId: "thread-1",
      contextId: "thread-1",
      initiatingAgentId: "inventory-specialist",
      currentAgentId: "inventory-specialist",
      routeContext: "/platform/tools/discovery",
      title: "Discovery Taxonomy Gap Triage",
      objective: "Triage taxonomy gaps from discovery.",
      source: "proactive",
      status: "working",
      authorityScope: [],
      a2aMetadata: {
        trigger: "scheduled",
        sourceRef: {
          kind: "scheduled-task",
          id: "discovery-taxonomy-gap-triage-daily",
        },
      },
    });
    expect(String(arg?.data?.taskRunId)).toMatch(/^TR-SCHED-/);
  });

  it("passes scheduled proactivity plans into TaskRun metadata", async () => {
    const { prisma } = await import("@dpf/db");
    vi.mocked(prisma.taskRun.create).mockResolvedValue({
      id: "tr_internal_2",
      taskRunId: "TR-SCHED-PROACT",
      contextId: "thread-2",
    } as never);

    const proactivity = {
      resolvedLevel: "balanced" as const,
      policyId: "proactivity:scheduled-task:balanced",
      attentionWindowMinutes: 60,
      followUpCadenceMinutes: [120],
      maxAttempts: 2,
      spendClass: "standard" as const,
      channelPolicy: "preferred-channel" as const,
      escalationTarget: "attention-surface" as const,
      actionBoundary: "propose" as const,
      explanation: "Balanced scheduled follow-up.",
      evidenceRefs: [{ kind: "activity-family", id: "scheduled-task" }],
    };

    const { createTaskRunForScheduledTask } = await import("./scheduled-task-runs");

    await createTaskRunForScheduledTask({
      taskId: "daily-summary",
      ownerUserId: "user-1",
      agentId: "workspace-coworker",
      threadId: "thread-2",
      routeContext: "/workspace",
      title: "Daily Summary",
      prompt: "Summarize today.",
      proactivity,
    });

    const arg = vi.mocked(prisma.taskRun.create).mock.calls[0]?.[0];
    expect(arg?.data?.a2aMetadata).toMatchObject({
      trigger: "scheduled",
      proactivity,
    });
  });
});

describe("a tool name is a token, not a substring (BI-4F64C5D3 follow-on)", () => {
  // The live pair: create_marketing_campaign (marketing-pack) is a prefix of
  // create_marketing_campaign_brief (marketing-ops-pack). On 2026-09-23 the
  // coworker wrote "Foster Carer Recruitment Drive" and the run was still
  // filed `error` for "create_marketing_campaign executed zero times".
  const PROMPT =
    "If there is NO active or recent campaign brief, create one with create_marketing_campaign_brief.";
  const BOTH = [
    { name: "create_marketing_campaign", sideEffect: true },
    { name: "create_marketing_campaign_brief", sideEffect: true },
  ];

  it("does not demand a tool whose name is merely a prefix of the one asked for", async () => {
    const { classifyScheduledRequiredTools } = await import("./scheduled-task-runs");
    expect(
      classifyScheduledRequiredTools({
        prompt: PROMPT,
        authorizedTools: BOTH,
        executedTools: [
          { name: "create_marketing_campaign_brief", result: { success: true } },
        ],
      }),
    ).toEqual({ kind: "executed" });
  });

  it("still demands the prefix tool when the prompt names it on its own", async () => {
    const { classifyScheduledRequiredTools } = await import("./scheduled-task-runs");
    expect(
      classifyScheduledRequiredTools({
        prompt: "Run create_marketing_campaign for the quarter.",
        authorizedTools: BOTH,
        executedTools: [],
      }),
    ).toEqual({ kind: "absent", toolName: "create_marketing_campaign" });
  });

  it("matches a name followed by punctuation, not only whitespace", async () => {
    const { classifyScheduledRequiredTools } = await import("./scheduled-task-runs");
    expect(
      classifyScheduledRequiredTools({
        prompt: "Call `create_marketing_campaign`, then stop.",
        authorizedTools: BOTH,
        executedTools: [],
      }),
    ).toEqual({ kind: "absent", toolName: "create_marketing_campaign" });
  });

  it("is not fooled by a longer name that merely contains the tool", async () => {
    const { classifyScheduledRequiredTools } = await import("./scheduled-task-runs");
    expect(
      classifyScheduledRequiredTools({
        prompt: "Use xx_create_marketing_campaign_yy only.",
        authorizedTools: [{ name: "create_marketing_campaign", sideEffect: true }],
        executedTools: [],
      }),
    ).toEqual({ kind: "executed" });
  });
});
