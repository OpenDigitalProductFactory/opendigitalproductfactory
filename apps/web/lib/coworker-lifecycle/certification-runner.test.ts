import { describe, expect, it, vi } from "vitest";
import { COWORKER_AGENT_SEEDS } from "@dpf/db/workforce-seed";
import {
  certificationRouteFor,
  classifyToolAuthorization,
  runCoworkerCertificationSweep,
  type CertificationDeps,
} from "./certification-runner";
import { deriveCertificationStates } from "./certification-status";
import { journeysForCoworker } from "./golden-journeys";

// The runner tests exercise finding reopen and audit scoping, not WHICH journey a
// coworker has. Hardcoding one made them fail the moment that coworker gained a
// curated journey — a curation change breaking a runner test is noise, so the id
// is derived from the registry instead.
const COO_JOURNEY_ID = journeysForCoworker("coo")[0].journeyId;

type FindingRow = { findingKey: string; status: string };

function makeDeps(overrides?: {
  loopContent?: string;
  executedTools?: Array<{ name: string; result: { success: boolean } }>;
  /** Governed ToolExecution audit evidence returned for each journey's thread
   *  (BI-68BBF206) — the native-mcp/CLI-subprocess execution record. */
  governedEvidence?: Array<{ name: string; success: boolean }>;
  tools?: Array<{ name: string; sideEffect?: boolean }>;
  /** Grant keys the injected grant resolver returns for every agent
   *  (BI-68BBF206 authorization-envelope classification). */
  agentGrants?: string[];
  existingFindings?: FindingRow[];
  superuser?: { id: string } | null;
}) {
  const created: { runs: unknown[]; findings: unknown[] } = { runs: [], findings: [] };
  const updates: unknown[] = [];
  const updateManyCalls: unknown[] = [];
  const existing = new Map<string, FindingRow>(
    (overrides?.existingFindings ?? []).map((f) => [f.findingKey, f]),
  );

  const deps: CertificationDeps = {
    resolveAgent: vi.fn().mockResolvedValue({
      agentId: "x",
      systemPrompt: "You are a coworker.",
      sensitivity: "internal",
      modelRequirements: { minimumTier: "adequate" },
    }),
    resolveTools: vi.fn().mockResolvedValue({
      tools: overrides?.tools ?? [
        { name: "query_backlog", sideEffect: false },
        { name: "create_backlog_item", sideEffect: true },
      ],
      toolsForProvider: [],
    }),
    runLoop: vi.fn().mockResolvedValue({
      content:
        overrides?.loopContent ??
        "I used query_backlog and found 3 items; one is titled 'Certify coworkers'.",
      downgraded: false,
      executedTools: overrides?.executedTools ?? [
        { name: "query_backlog", result: { success: true } },
      ],
    }),
    fetchToolEvidence: vi.fn().mockResolvedValue(overrides?.governedEvidence ?? []),
    fetchAgentGrants: vi.fn().mockResolvedValue(overrides?.agentGrants ?? []),
    db: {
      user: {
        findFirst: vi
          .fn()
          .mockResolvedValue(overrides?.superuser === undefined ? { id: "usr-1" } : overrides.superuser),
      },
      assuranceRun: {
        create: vi.fn().mockImplementation(async (args: { data: unknown }) => {
          created.runs.push(args.data);
          return args.data;
        }),
      },
      assuranceFinding: {
        findUnique: vi
          .fn()
          .mockImplementation(async (args: { where: { findingKey: string } }) =>
            existing.get(args.where.findingKey) ?? null,
          ),
        create: vi.fn().mockImplementation(async (args: { data: { findingKey: string } }) => {
          created.findings.push(args.data);
          return args.data;
        }),
        update: vi.fn().mockImplementation(async (args: unknown) => {
          updates.push(args);
          return args;
        }),
        updateMany: vi.fn().mockImplementation(async (args: unknown) => {
          updateManyCalls.push(args);
          return { count: 0 };
        }),
      },
    } as unknown as CertificationDeps["db"],
    now: () => new Date("2026-07-08T04:40:00Z"),
  };
  return { deps, created, updates, updateManyCalls };
}

describe("coworker certification runner (EP-COWORKER-LIFECYCLE Phase 2)", () => {
  it("certifies the full roster: one AssuranceRun per coworker, all passed on healthy loops", async () => {
    const { deps, created } = makeDeps();
    const sweep = await runCoworkerCertificationSweep({ deps });

    expect(sweep.results).toHaveLength(COWORKER_AGENT_SEEDS.length);
    expect(sweep.failed).toBe(0);
    expect(created.runs).toHaveLength(COWORKER_AGENT_SEEDS.length);
    for (const run of created.runs as Array<Record<string, unknown>>) {
      expect(run.scopeType).toBe("agent");
      expect(run.adapterKey).toBe("coworker-cert");
      expect(run.status).toBe("passed");
    }
    expect(created.findings).toHaveLength(0);
  });

  it("offers only side-effect-free tools to the loop", async () => {
    const { deps } = makeDeps();
    await runCoworkerCertificationSweep({ agentIds: ["dispatcher"], deps });

    const loopCall = (deps.runLoop as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(loopCall.tools.map((t: { name: string }) => t.name)).toEqual(["query_backlog"]);
    expect(loopCall.requireTools).toBe(true);
  });

  it("a failed oracle produces a failed run plus an open finding keyed to the oracle", async () => {
    const { deps, created } = makeDeps({
      loopContent: "Done! Everything has been updated successfully.",
      executedTools: [],
    });
    const sweep = await runCoworkerCertificationSweep({ agentIds: ["coo"], deps });

    expect(sweep.failed).toBe(1);
    expect((created.runs[0] as Record<string, unknown>).status).toBe("failed");
    const keys = (created.findings as Array<{ findingKey: string }>).map((f) => f.findingKey);
    expect(keys.some((k) => k.startsWith("coworker-cert:coo:") && k.endsWith("ORACLE-TOOL"))).toBe(
      true,
    );
  });

  it("an inference admission timeout yields an INCONCLUSIVE run (to requeue), not a coworker failure", async () => {
    const { deps, created } = makeDeps();
    // Inference was at capacity: the admission wait exhausted its (patient) budget.
    // Tagged with the admission-timeout code the runner recognizes.
    const capacityErr = Object.assign(
      new Error("inference admission timeout on local engine after 1800000ms (origin=autonomous)"),
      { code: "INFERENCE_ADMISSION_TIMEOUT" },
    );
    (deps.runLoop as ReturnType<typeof vi.fn>).mockRejectedValue(capacityErr);

    const sweep = await runCoworkerCertificationSweep({ agentIds: ["coo"], deps });

    // Not a failure — capacity backpressure is inconclusive and gets requeued.
    expect(sweep.results[0].status).toBe("inconclusive");
    expect(sweep.inconclusive).toBe(1);
    expect(sweep.failed).toBe(0);
    expect((created.runs[0] as Record<string, unknown>).status).toBe("inconclusive");
    // every journey flagged capacity-inconclusive, and NO failure findings filed
    expect(sweep.results[0].journeys.every((j) => j.capacityInconclusive)).toBe(true);
    expect((created.findings as Array<unknown>).length).toBe(0);
  });

  it("a routed provider-capacity failure yields an INCONCLUSIVE run instead of failing the coworker", async () => {
    const { deps, created } = makeDeps({
      loopContent:
        "The AI providers are momentarily busy (usually rate-limited or overloaded). " +
        "Please try again in about 30 seconds — no setup change is needed.",
      executedTools: [],
    });

    const sweep = await runCoworkerCertificationSweep({ agentIds: ["coo"], deps });

    expect(sweep.results[0].status).toBe("inconclusive");
    expect(sweep.inconclusive).toBe(1);
    expect(sweep.failed).toBe(0);
    expect((created.runs[0] as Record<string, unknown>).status).toBe("inconclusive");
    expect(sweep.results[0].journeys.every((journey) => journey.capacityInconclusive)).toBe(true);
    expect(created.findings).toHaveLength(0);
  });

  it("a no-dispatch routing response yields an INCONCLUSIVE run instead of scoring operator-safe copy", async () => {
    const { deps, created } = makeDeps({
      loopContent:
        "No AI model can handle this request right now. This usually means your cloud " +
        "AI providers are disconnected or their sign-in has expired, and the built-in " +
        "local model can't fit this assistant's larger requests on its own. Open " +
        "Platform > AI Operations > Providers & Routing to reconnect a provider — " +
        "waiting won't clear this on its own.",
      executedTools: [],
    });

    const sweep = await runCoworkerCertificationSweep({ agentIds: ["coo"], deps });

    expect(sweep.results[0].status).toBe("inconclusive");
    expect(sweep.inconclusive).toBe(1);
    expect(sweep.failed).toBe(0);
    expect((created.runs[0] as Record<string, unknown>).status).toBe("inconclusive");
    expect(sweep.results[0].journeys.every((journey) => journey.capacityInconclusive)).toBe(true);
    expect(created.findings).toHaveLength(0);
  });

  it("a recovered oracle is absent-cleaned via updateMany scoped to the agent", async () => {
    const { deps, updateManyCalls } = makeDeps();
    await runCoworkerCertificationSweep({ agentIds: ["coo"], deps });

    expect(updateManyCalls).toHaveLength(1);
    const call = updateManyCalls[0] as {
      where: { findingKey: { startsWith: string } };
      data: { status: string };
    };
    expect(call.where.findingKey.startsWith).toBe("coworker-cert:coo:");
    expect(call.data.status).toBe("resolved");
  });

  it("reopens a previously resolved finding instead of duplicating it", async () => {
    const journeyId = COO_JOURNEY_ID;
    const { deps, created, updates } = makeDeps({
      loopContent: "Done! Everything has been updated successfully.",
      executedTools: [],
      existingFindings: [
        { findingKey: `coworker-cert:coo:${journeyId}:ORACLE-TOOL`, status: "resolved" },
      ],
    });
    await runCoworkerCertificationSweep({ agentIds: ["coo"], deps });

    const createdKeys = (created.findings as Array<{ findingKey: string }>).map(
      (f) => f.findingKey,
    );
    expect(createdKeys).not.toContain(`coworker-cert:coo:${journeyId}:ORACLE-TOOL`);
    const reopen = updates.find(
      (u) =>
        (u as { where: { findingKey: string } }).where.findingKey ===
        `coworker-cert:coo:${journeyId}:ORACLE-TOOL`,
    ) as { data: Record<string, unknown> };
    expect(reopen.data.status).toBe("open");
  });

  it("returns an empty sweep when no superuser exists (fresh install)", async () => {
    const { deps, created } = makeDeps({ superuser: null });
    const sweep = await runCoworkerCertificationSweep({ deps });
    expect(sweep.results).toHaveLength(0);
    expect(created.runs).toHaveLength(0);
  });

  it("a loop crash records a failed run, not a thrown sweep", async () => {
    const { deps, created } = makeDeps();
    (deps.runLoop as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("provider down"));
    const sweep = await runCoworkerCertificationSweep({ agentIds: ["coo"], deps });

    expect(sweep.failed).toBe(1);
    expect((created.runs[0] as Record<string, unknown>).status).toBe("failed");
  });

  it("routes certification through the coworker's bound route, workspace otherwise", () => {
    expect(certificationRouteFor("marketing-specialist")).not.toBe("/workspace");
    expect(certificationRouteFor("dispatcher")).toBe("/workspace");
  });
});

describe("governed ToolExecution evidence union (BI-68BBF206, native-mcp dispatch)", () => {
  // Under cli-adapter native-mcp mode the model's MCP tool calls execute inside
  // the CLI subprocess against the governed MCP server: ToolExecution audit rows
  // are written, but the in-process loop's executedTools list stays empty.
  // Pre-fix, ORACLE-TOOL failed every such journey with "attempted: none" even
  // though ORACLE-SURFACE passed and the reply cited real tool results.
  it("passes ORACLE-TOOL when the in-process list is empty but audit rows show a successful in-surface call", async () => {
    const { deps, created } = makeDeps({
      executedTools: [],
      governedEvidence: [{ name: "query_backlog", success: true }],
    });

    const sweep = await runCoworkerCertificationSweep({ agentIds: ["coo"], deps });

    expect(sweep.failed).toBe(0);
    expect(sweep.results[0].status).toBe("passed");
    expect((created.runs[0] as Record<string, unknown>).status).toBe("passed");
    const journey = sweep.results[0].journeys[0];
    expect(journey.executedToolNames).toContain("query_backlog");
    const toolVerdict = journey.verdicts.find((v) => v.oracleId === "ORACLE-TOOL");
    expect(toolVerdict?.passed).toBe(true);
  });

  it("scopes the audit query to the journey's thread, agent, and execution window", async () => {
    const { deps } = makeDeps();
    await runCoworkerCertificationSweep({ agentIds: ["coo"], deps });

    expect(deps.fetchToolEvidence).toHaveBeenCalled();
    const call = (deps.fetchToolEvidence as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    // Thread naming observed live: certification:<agentId>/<journeyId>.
    expect(call.threadId).toBe(`certification:${COO_JOURNEY_ID}`);
    expect(call.agentId).toBe("coo");
    expect(call.since).toBeInstanceOf(Date);
    expect(call.until).toBeInstanceOf(Date);
    expect(call.until.getTime()).toBeGreaterThanOrEqual(call.since.getTime());
  });

  it("fails ORACLE-PURITY when audit rows show a tool outside the offered read-only surface", async () => {
    const { deps, created } = makeDeps({
      governedEvidence: [{ name: "create_backlog_item", success: true }],
    });

    const sweep = await runCoworkerCertificationSweep({ agentIds: ["coo"], deps });

    expect(sweep.failed).toBe(1);
    expect((created.runs[0] as Record<string, unknown>).status).toBe("failed");
    const purity = sweep.results[0].journeys[0].verdicts.find(
      (v) => v.oracleId === "ORACLE-PURITY",
    );
    expect(purity?.passed).toBe(false);
    const keys = (created.findings as Array<{ findingKey: string }>).map((f) => f.findingKey);
    expect(
      keys.some((k) => k.startsWith("coworker-cert:coo:") && k.endsWith("ORACLE-PURITY")),
    ).toBe(true);
  });

  it("an audit-read failure falls back to in-loop evidence instead of failing the coworker", async () => {
    const { deps } = makeDeps();
    (deps.fetchToolEvidence as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("db unavailable"),
    );

    const sweep = await runCoworkerCertificationSweep({ agentIds: ["coo"], deps });

    // In-loop evidence (successful query_backlog) still certifies the journey.
    expect(sweep.failed).toBe(0);
    expect(sweep.results[0].status).toBe("passed");
  });

  it("does not consult audit evidence for a capacity-inconclusive journey", async () => {
    const { deps } = makeDeps();
    const capacityErr = Object.assign(new Error("inference admission timeout"), {
      code: "INFERENCE_ADMISSION_TIMEOUT",
    });
    (deps.runLoop as ReturnType<typeof vi.fn>).mockRejectedValue(capacityErr);

    const sweep = await runCoworkerCertificationSweep({ agentIds: ["coo"], deps });

    expect(sweep.results[0].status).toBe("inconclusive");
    expect(deps.fetchToolEvidence).not.toHaveBeenCalled();
  });
});

describe("ORACLE-PURITY validates the authorization envelope, not the attachment list (BI-68BBF206)", () => {
  // Live post-#4408 sweep: in native-mcp mode the CLI subprocess exposes the
  // coworker's FULL grant-derived read-only MCP toolset, while the runner's
  // offered surface is a narrower attachment. security-engineer executed
  // list_my_backlog — governed, grant-authorized (backlog_read), declared
  // sideEffect:false in the catalog — and PURITY flagged it as "Executed
  // outside the offered surface". The property PURITY guards is the
  // authorization envelope, not membership in the attachment list.
  const offeredSurface = [
    { name: "query_backlog", sideEffect: false },
    { name: "search_knowledge", sideEffect: false },
    { name: "read_operational_record", sideEffect: false },
    { name: "list_patch_posture", sideEffect: false },
    { name: "summarize_estate_posture", sideEffect: false },
    { name: "search_code_graph", sideEffect: false },
    { name: "doc_search", sideEffect: false },
    { name: "get_change_gate_context", sideEffect: false },
  ];

  it("passes when governed evidence shows a grant-authorized side-effect-free call outside the offered surface", async () => {
    const { deps, created } = makeDeps({
      tools: offeredSurface, // 8 read-only names, WITHOUT list_my_backlog
      governedEvidence: [{ name: "list_my_backlog", success: true }],
      agentGrants: ["backlog_read"],
    });

    const sweep = await runCoworkerCertificationSweep({ agentIds: ["security-engineer"], deps });

    expect(sweep.failed).toBe(0);
    expect(sweep.results[0].status).toBe("passed");
    expect((created.runs[0] as Record<string, unknown>).status).toBe("passed");
    const purity = sweep.results[0].journeys[0].verdicts.find(
      (v) => v.oracleId === "ORACLE-PURITY",
    );
    expect(purity?.passed).toBe(true);
    expect(deps.fetchAgentGrants).toHaveBeenCalledWith("security-engineer");
  });

  it("fails naming a side-effecting tool even when the agent's grants would allow it", async () => {
    const { deps } = makeDeps({
      tools: offeredSurface,
      governedEvidence: [{ name: "update_backlog_item_status", success: true }],
      agentGrants: ["backlog_read", "backlog_write"],
    });

    const sweep = await runCoworkerCertificationSweep({ agentIds: ["security-engineer"], deps });

    expect(sweep.failed).toBe(1);
    const purity = sweep.results[0].journeys[0].verdicts.find(
      (v) => v.oracleId === "ORACLE-PURITY",
    );
    expect(purity?.passed).toBe(false);
    expect(purity?.detail).toContain("update_backlog_item_status (side-effecting)");
  });

  it("fails a side-effect-free tool the agent's grants do not authorize", async () => {
    const { deps } = makeDeps({
      tools: offeredSurface,
      // get_my_coworker_profile is sideEffect:false but requires registry_read.
      governedEvidence: [{ name: "get_my_coworker_profile", success: true }],
      agentGrants: ["backlog_read"],
    });

    const sweep = await runCoworkerCertificationSweep({ agentIds: ["security-engineer"], deps });

    expect(sweep.failed).toBe(1);
    const purity = sweep.results[0].journeys[0].verdicts.find(
      (v) => v.oracleId === "ORACLE-PURITY",
    );
    expect(purity?.passed).toBe(false);
    expect(purity?.detail).toContain(
      "get_my_coworker_profile (not authorized by the agent's grants)",
    );
  });

  it("fails an executed tool that is not in the platform catalog", async () => {
    const { deps } = makeDeps({
      tools: offeredSurface,
      governedEvidence: [{ name: "totally_unknown_tool", success: true }],
      agentGrants: ["backlog_read"],
    });

    const sweep = await runCoworkerCertificationSweep({ agentIds: ["security-engineer"], deps });

    expect(sweep.failed).toBe(1);
    const purity = sweep.results[0].journeys[0].verdicts.find(
      (v) => v.oracleId === "ORACLE-PURITY",
    );
    expect(purity?.detail).toContain("totally_unknown_tool (not in the platform tool catalog)");
  });

  it("applies the same envelope rule to in-loop executed tools that were never offered", async () => {
    const { deps } = makeDeps({
      tools: offeredSurface,
      executedTools: [{ name: "list_my_backlog", result: { success: true } }],
      agentGrants: ["backlog_read"],
    });

    const sweep = await runCoworkerCertificationSweep({ agentIds: ["security-engineer"], deps });

    expect(sweep.failed).toBe(0);
    const purity = sweep.results[0].journeys[0].verdicts.find(
      (v) => v.oracleId === "ORACLE-PURITY",
    );
    expect(purity?.passed).toBe(true);
  });

  it("does not consult grant resolution when every executed tool was offered", async () => {
    const { deps } = makeDeps();

    await runCoworkerCertificationSweep({ agentIds: ["coo"], deps });

    expect(deps.fetchAgentGrants).not.toHaveBeenCalled();
  });

  it("a grant-resolution failure stays conservative: the non-offered tool fails as unauthorized", async () => {
    const { deps } = makeDeps({
      tools: offeredSurface,
      governedEvidence: [{ name: "list_my_backlog", success: true }],
    });
    (deps.fetchAgentGrants as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("grant store unavailable"),
    );

    const sweep = await runCoworkerCertificationSweep({ agentIds: ["security-engineer"], deps });

    expect(sweep.failed).toBe(1);
    const purity = sweep.results[0].journeys[0].verdicts.find(
      (v) => v.oracleId === "ORACLE-PURITY",
    );
    expect(purity?.passed).toBe(false);
    expect(purity?.detail).toContain("not authorized by the agent's grants");
  });
});

describe("classifyToolAuthorization (authorization-envelope classification)", () => {
  it("classifies against the real platform catalog and grant registry", () => {
    expect(classifyToolAuthorization("list_my_backlog", ["backlog_read"])).toBe(
      "grant-authorized-read-only",
    );
    expect(classifyToolAuthorization("update_backlog_item_status", ["backlog_write"])).toBe(
      "side-effecting",
    );
    expect(classifyToolAuthorization("get_my_coworker_profile", ["backlog_read"])).toBe(
      "unauthorized",
    );
    expect(classifyToolAuthorization("no_such_tool_anywhere", ["backlog_read"])).toBe("unknown");
  });
});

describe("certification tool resolution carries the journey route (BI-8D5BB185)", () => {
  // The runner computes routeContext via certificationRouteFor() and passes it to
  // resolveAgent and to runLoop — but omitted it when resolving TOOLS. routeContext
  // is what force-attaches a route's declared domain tools (tier 0), so without it
  // the journey's central tool is absent from the available list and the loop
  // refuses the call with "requires the `view_marketing` capability, which is not
  // available on this page". Observed live on 2026-08-01: the
  // marketing-specialist/campaign-readiness-review journey emitted a well-formed
  // get_marketing_summary call and was refused, so the journey could never pass.
  it("passes the journey's routeContext to resolveTools", async () => {
    const { deps } = makeDeps();

    await runCoworkerCertificationSweep({ agentIds: ["marketing-specialist"], deps });

    expect(deps.resolveTools).toHaveBeenCalled();
    const call = (deps.resolveTools as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.routeContext).toBe("/customer/marketing");
  });

  it("resolves tools and the agent under the SAME route", async () => {
    const { deps } = makeDeps();

    await runCoworkerCertificationSweep({ agentIds: ["marketing-specialist"], deps });

    const toolCall = (deps.resolveTools as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const agentCall = (deps.resolveAgent as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    // A split here is the defect: the agent is resolved for the route while its
    // tools are resolved for nowhere.
    expect(toolCall.routeContext).toBe(agentCall.routeContext);
  });
});

describe("certification state derivation", () => {
  const now = new Date("2026-07-08T12:00:00Z");

  it("latest run wins; pass=certified, fail=failed, old pass=stale, none=never", () => {
    const states = deriveCertificationStates(
      ["a", "b", "c", "d"],
      [
        { scopeId: "a", status: "passed", startedAt: new Date("2026-07-08T04:40:00Z") },
        { scopeId: "a", status: "failed", startedAt: new Date("2026-07-07T04:40:00Z") },
        { scopeId: "b", status: "failed", startedAt: new Date("2026-07-08T04:40:00Z") },
        { scopeId: "c", status: "passed", startedAt: new Date("2026-06-01T04:40:00Z") },
      ],
      now,
    );
    expect(states.get("a")?.status).toBe("certified");
    expect(states.get("b")?.status).toBe("failed");
    expect(states.get("c")?.status).toBe("stale");
    expect(states.get("d")?.status).toBe("never");
  });
});
