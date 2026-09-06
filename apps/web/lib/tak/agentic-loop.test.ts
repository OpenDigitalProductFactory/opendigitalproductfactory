import { describe, it, expect, vi, beforeEach } from "vitest";

// Import pure functions that don't need mocks
import {
  shouldNudge,
  detectFabrication,
  buildRepeatedQuestionNudge,
  buildRepeatedToolStopMessage,
  buildRuntimeLimitToolLoopMessage,
  detectToolRefusedDespiteAvailability,
  phaseRequiresToolCall,
  detectUnsavedEvidence,
  buildToolSessionHintMessage,
  buildUnsavedAdviceNote,
  HARD_COMPLETION_CLAIM_PATTERN,
} from "./agentic-loop";
import { buildAnthropicSystem } from "../routing/anthropic-cache";
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "./prompt-boundary";

vi.mock("@dpf/db", () => ({
  prisma: {
    agentModelConfig: {
      findUnique: vi.fn(),
    },
    toolExecution: {
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    platformIssueReport: {
      create: vi.fn(),
    },
    coworkerTurnMetric: {
      upsert: vi.fn(),
    },
  },
}));
vi.mock("@/lib/routed-inference", () => ({
  routeAndCall: vi.fn(),
}));
vi.mock("@/lib/mcp-tools", () => ({
  executeTool: vi.fn(),
  PLATFORM_TOOLS: [],
}));
vi.mock("@/lib/mcp-governed-execute", () => ({
  governedExecuteTool: vi.fn(),
}));

import { runAgenticLoop } from "./agentic-loop";
import { routeAndCall } from "@/lib/routed-inference";
import { INV5_UNVERIFIED_MESSAGE } from "./evidence-requirement";
import { executeTool } from "@/lib/mcp-tools";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { prisma } from "@dpf/db";

// Helper to build a mock RoutedInferenceResult
function mockResult(overrides: {
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  inputTokens?: number;
  outputTokens?: number;
  providerId?: string;
  modelId?: string;
  toolsStripped?: boolean;
  downgraded?: boolean;
  downgradeMessage?: string | null;
  downgradeReason?: "provider-unavailable" | "not-eligible" | null;
  /** True when the provider cut generation off at max_tokens/length (BI-1D144CC1). */
  truncated?: boolean;
}) {
  return {
    content: overrides.content,
    providerId: overrides.providerId ?? "anthropic-sub",
    modelId: overrides.modelId ?? "claude-haiku-4-5-20251001",
    downgraded: overrides.downgraded ?? false,
    downgradeMessage: overrides.downgradeMessage ?? null,
    // Default matches routed-inference: a downgrade with no stated cause can only
    // have come from a real dispatch failure (BI-F4D3B9E9d).
    downgradeReason: overrides.downgradeReason
      ?? (overrides.downgraded ? "provider-unavailable" as const : null),
    toolsStripped: overrides.toolsStripped ?? false,
    truncated: overrides.truncated ?? false,
    inputTokens: overrides.inputTokens ?? 100,
    outputTokens: overrides.outputTokens ?? 50,
    toolCalls: overrides.toolCalls ?? [],
    routeDecision: {} as any,
    responseId: undefined,
  };
}

describe("shouldNudge", () => {
  it("nudges on first iteration when model returns text-only with tools available", () => {
    expect(shouldNudge({
      continuationNudges: 0, iteration: 0, maxIterations: 40,
      hasTools: true, executedToolCount: 0, responseLength: 44,
      responseText: "I can help with that.",
    })).toBe(true);
  });

  it("does not nudge on a setup-tour turn (route persona says 'no tool calls')", () => {
    expect(shouldNudge({
      continuationNudges: 0, iteration: 0, maxIterations: 40,
      hasTools: true,             // tools delivered (read-only / context tools)
      isSetupTourTurn: true,      // SetupOverlay "[Setup step: …]" auto-message
      executedToolCount: 0, responseLength: 44,
      responseText: "Welcome to your workspace! Day-to-day work happens here.",
    })).toBe(false);
  });

  it("does not nudge when response is a short clarifying question", () => {
    expect(shouldNudge({
      continuationNudges: 0, iteration: 0, maxIterations: 40,
      hasTools: true, executedToolCount: 0, responseLength: 35,
      responseText: "What is John's last name?",
    })).toBe(false);
  });

  it("does not nudge when response is a multi-field clarifying question", () => {
    expect(shouldNudge({
      continuationNudges: 0, iteration: 0, maxIterations: 40,
      hasTools: true, executedToolCount: 0, responseLength: 70,
      responseText: "To add this employee I need their last name and department — could you provide those?",
    })).toBe(false);
  });

  it("nudges when response is a long non-question text (model stalled)", () => {
    expect(shouldNudge({
      continuationNudges: 0, iteration: 0, maxIterations: 40,
      hasTools: true, executedToolCount: 0, responseLength: 120,
      responseText: "I can help you add an employee. The system has several tools available including create_employee and list_departments that you can use.",
    })).toBe(false);
  });

  it("does not nudge when no tools available", () => {
    expect(shouldNudge({
      continuationNudges: 0, iteration: 0, maxIterations: 40,
      hasTools: false, executedToolCount: 0, responseLength: 44,
    })).toBe(false);
  });

  it("does not nudge on first iteration when response is long and not narration", () => {
    expect(shouldNudge({
      continuationNudges: 0, iteration: 2, maxIterations: 40,
      hasTools: true, executedToolCount: 3, responseLength: 250,
      responseText: "The feature brief describes the notification system and acceptance criteria.",
    })).toBe(false);
  });

  it("nudges when response contains code narration patterns", () => {
    expect(shouldNudge({
      continuationNudges: 0, iteration: 3, maxIterations: 40,
      hasTools: true, executedToolCount: 5, responseLength: 500,
      responseText: "Here's the exact code to add to agent-routing.ts for each agent.",
    })).toBe(true);
  });

  it("does not nudge governed External Access permission requests", () => {
    expect(shouldNudge({
      continuationNudges: 0,
      iteration: 0,
      maxIterations: 40,
      hasTools: true,
      executedToolCount: 0,
      responseLength: 140,
      responseText: "External Access is off for this page. Would you like me to use External Access so I can verify the official public sources before I answer?",
    })).toBe(false);
  });

  it("nudges when tools were used and model stalls with short response", () => {
    expect(shouldNudge({
      continuationNudges: 0, iteration: 3, maxIterations: 40,
      hasTools: true, executedToolCount: 2, responseLength: 5,
    })).toBe(true);
  });

  it("does not nudge a short summary after an authoritative action tool", () => {
    expect(shouldNudge({
      continuationNudges: 0, iteration: 3, maxIterations: 40,
      hasTools: true, executedToolCount: 1, responseLength: 42,
      responseText: "Discovery triage skipped for today's cadence.",
      hasAuthoritativeToolExecution: true,
    })).toBe(false);
  });

  it("does not nudge if already nudged once", () => {
    expect(shouldNudge({
      continuationNudges: 1, iteration: 0, maxIterations: 40,
      hasTools: true, executedToolCount: 0, responseLength: 44,
    })).toBe(false);
  });
  it("does not nudge a substantive conversational answer that ends with a helpful offer (post-tool-call)", () => {
    expect(shouldNudge({
      continuationNudges: 0, iteration: 4, maxIterations: 200,
      hasTools: true, executedToolCount: 5, responseLength: 260,
      responseText:
        "The archetype selector is DPF's onboarding screen — it's where you choose the business archetype that defines your industry model (plumber, restaurant, gym, consultant, nonprofit, and others). Since it's already set for your business, would you like me to walk you there?",
      isConversationalRoute: true,
    })).toBe(false);
  });

  // Guard against over-broadening: on a BUILD route the phase-transition contract
  // still applies, so a mid-phase permission-seeking stall must still be nudged.
  it("still nudges a permission-seeking answer on a build route (phase contract preserved)", () => {
    expect(shouldNudge({
      continuationNudges: 0, iteration: 4, maxIterations: 200,
      hasTools: true, executedToolCount: 5, responseLength: 260,
      responseText:
        "I have reviewed the design in full and mapped out the complete implementation approach across the affected modules, including the rollout order. Should I proceed with applying the fix now?",
      isConversationalRoute: false,
    })).toBe(true);
  });
});

describe("buildRepeatedToolStopMessage", () => {
  it("points non-build repeated tool loops to the activity trail without naming tools", () => {
    const msg = buildRepeatedToolStopMessage({
      toolName: "suggest_campaign_ideas",
      count: 3,
      routeContext: "/customer/marketing",
      reasonHint: "",
    });

    // Rule #5: do not leak tool names, call counts, or "reasonHint" architecture
    // language into the user-facing message.
    expect(msg).not.toContain("suggest_campaign_ideas");
    expect(msg).not.toMatch(/\d times with the same arguments/);
    expect(msg).not.toContain("coworker execution issue");
    expect(msg).toMatch(/activity panel/i);
    expect(msg.toLowerCase()).toContain("got stuck");
  });

  it("points Build Studio routes at the build details panel without naming tools", () => {
    const msg = buildRepeatedToolStopMessage({
      toolName: "saveBuildEvidence",
      count: 3,
      routeContext: "/build",
      reasonHint: "",
    });

    expect(msg).not.toContain("saveBuildEvidence");
    expect(msg).not.toMatch(/\d times with the same arguments/);
    expect(msg).toMatch(/build's details panel|build details/i);
    expect(msg.toLowerCase()).toContain("got stuck");
  });
});

describe("buildRuntimeLimitToolLoopMessage (BI-0C19AFDD)", () => {
  const anyTools = [
    { name: "search_knowledge", result: { ok: true } as never },
    { name: "query_ontology_graph", result: { ok: true } as never },
  ];

  it("stays domain-agnostic — never confabulates a finance domain", () => {
    const msg = buildRuntimeLimitToolLoopMessage(anyTools);
    // The prior copy hard-coded a "finance reports"/"finance-summary tool"
    // suggestion that surfaced for every non-finance coworker (Dale's
    // truck-parts build was told to "use the finance reports directly").
    expect(msg.toLowerCase()).not.toContain("finance");
    expect(msg).not.toMatch(/finance-summary tool/i);
  });

  it("gives a generic, honest next step and summarizes the tools it used", () => {
    const msg = buildRuntimeLimitToolLoopMessage(anyTools);
    expect(msg).toContain("search_knowledge");
    expect(msg.toLowerCase()).toContain("runtime limit");
    expect(msg).toMatch(/narrower question|smaller step/i);
  });

  it("falls back to a generic phrase when no tools were executed", () => {
    const msg = buildRuntimeLimitToolLoopMessage([]);
    expect(msg).toContain("the available tools");
    expect(msg.toLowerCase()).not.toContain("finance");
  });
});

// BI-F4D3B9E9(d) — the founder received one reply that said BOTH "your
// configured provider is active but wasn't eligible" (banner) and "My usual AI
// was unavailable" (this message). The message branched on the `downgraded`
// boolean, which conflated a dispatch failure with pre-dispatch ineligibility.

describe("buildToolSessionHintMessage — review-fail veto + tool-error notes in the messages tail", () => {
  // BI-56804810: these notes now ride in a per-turn user message (not tool
  // descriptions), so the Anthropic tools→system cache prefix stays stable.
  // The failure/veto semantics are unchanged from the prior in-description hint.

  it("names saveBuildEvidence + REVIEW REJECTION when reviewDesignDoc returned decision:fail", () => {
    const hint = buildToolSessionHintMessage([
      { name: "saveBuildEvidence", args: { field: "designDoc", value: "v1" }, result: { success: true, message: "Evidence saved." } },
      { name: "reviewDesignDoc", args: {}, result: { success: true, message: "Design review: fail.", data: { review: { decision: "fail", rationale: "Missing codebase research section." } } } },
    ]);
    expect(hint).not.toBeNull();
    expect(hint!).toContain("saveBuildEvidence");
    expect(hint!).toContain("REVIEW REJECTION");
    expect(hint!).toContain("Missing codebase research section.");
    expect(hint!).toContain("submitting identical arguments will be rejected");
  });

  it("clears the veto on a later passing review (returns null)", () => {
    const hint = buildToolSessionHintMessage([
      { name: "saveBuildEvidence", args: { field: "designDoc", value: "v1" }, result: { success: true, message: "Evidence saved." } },
      { name: "reviewDesignDoc", args: {}, result: { success: true, data: { review: { decision: "fail", rationale: "Missing research." } } } },
      { name: "saveBuildEvidence", args: { field: "designDoc", value: "v2" }, result: { success: true, message: "Evidence saved." } },
      { name: "reviewDesignDoc", args: {}, result: { success: true, data: { review: { decision: "pass" } } } },
    ]);
    expect(hint).toBeNull();
  });

  it("keeps the veto sticky across a subsequent saveBuildEvidence success (intermediate save still rejected)", () => {
    // FB-C26D5B50 scenario: the next saveBuildEvidence succeeds at the protocol
    // level but the review veto from the prior failed review must remain visible
    // until a passing review clears it.
    const hint = buildToolSessionHintMessage([
      { name: "saveBuildEvidence", args: { field: "designDoc", value: "v1" }, result: { success: true, message: "Evidence saved." } },
      { name: "reviewDesignDoc", args: {}, result: { success: true, data: { review: { decision: "fail", rationale: "Missing codebase research." } } } },
      { name: "saveBuildEvidence", args: { field: "designDoc", value: "v1-again" }, result: { success: true, message: "Evidence saved." } },
    ]);
    expect(hint).not.toBeNull();
    expect(hint!).toContain("REVIEW REJECTION");
    expect(hint!).toContain("Missing codebase research.");
  });

  it("treats data.blocked=true as a veto even without decision:fail", () => {
    const hint = buildToolSessionHintMessage([
      { name: "reviewDesignDoc", args: {}, result: { success: true, data: { review: { decision: "pass" }, blocked: true } } },
    ]);
    expect(hint).not.toBeNull();
    expect(hint!).toContain("REVIEW REJECTION");
  });

  it("returns null when there are no review failures and no tool errors", () => {
    const hint = buildToolSessionHintMessage([
      { name: "saveBuildEvidence", args: { field: "designDoc", value: "v1" }, result: { success: true, message: "Evidence saved." } },
      { name: "reviewDesignDoc", args: {}, result: { success: true, data: { review: { decision: "pass" } } } },
    ]);
    expect(hint).toBeNull();
  });

  it("returns null with no executed tools yet (first turn)", () => {
    expect(buildToolSessionHintMessage([])).toBeNull();
  });

  it("preserves the error-warning path when a tool itself failed", () => {
    const hint = buildToolSessionHintMessage([
      { name: "saveBuildEvidence", args: { field: "designDoc", value: "v1" }, result: { success: false, error: "Network timeout on persistence layer" } },
    ]);
    expect(hint).not.toBeNull();
    expect(hint!).toContain("saveBuildEvidence");
    expect(hint!).toContain("WARNING");
    expect(hint!).toContain("Network timeout on persistence layer");
  });

  it("clears a tool's warning once it later succeeds", () => {
    const hint = buildToolSessionHintMessage([
      { name: "search_code_graph", args: {}, result: { success: false, error: "index cold" } },
      { name: "search_code_graph", args: {}, result: { success: true, message: "ok" } },
    ]);
    expect(hint).toBeNull();
  });
});

describe("Anthropic cache-prefix stability across a tool failure (BI-56804810)", () => {
  // Functional proof that the fix keeps Anthropic prompt caching alive. Anthropic
  // hashes its cache prefix as tools → system → messages, so the tools+system
  // bytes ARE the cache key that gates usage.cache_read_input_tokens. This asserts
  // those bytes are stable turn-over-turn once a tool has failed.

  // Mirrors chat-adapter.ts: OpenAI-format function tools → Anthropic tool shape.
  const toAnthropicTools = (
    tools: Array<{ function: { name: string; description: string; parameters: unknown } }>,
  ) => tools.map((t) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters }));

  const TOOLS = [
    { function: { name: "search_code_graph", description: "Search the code graph.", parameters: { type: "object" } } },
    { function: { name: "saveBuildEvidence", description: "Save build evidence.", parameters: { type: "object" } } },
  ];
  const SYSTEM =
    "You are DPF. Identity, mode, and mission are fixed for this session." +
    SYSTEM_PROMPT_DYNAMIC_BOUNDARY +
    "Today is 2026-08-12.";

  // The exact bytes Anthropic hashes for the cached prefix: tools then system.
  const cachePrefixSurface = (tools: unknown) => JSON.stringify({ tools, system: buildAnthropicSystem(SYSTEM) });

  it("keeps the tools+system prefix byte-identical after a tool failure (the fix → cache HIT)", () => {
    // Turn 1: nothing executed yet.
    const turn1 = cachePrefixSurface(toAnthropicTools(TOOLS));

    // Turn 2: a tool failed. Under the fix, tools pass through unchanged and the
    // note is routed to the messages tail instead of a tool description.
    const hint = buildToolSessionHintMessage([
      { name: "search_code_graph", result: { success: false, error: "index cold" } },
    ]);
    const turn2 = cachePrefixSurface(toAnthropicTools(TOOLS));

    expect(hint).not.toBeNull(); // the model still receives the "don't blindly retry" signal…
    expect(turn2).toBe(turn1); // …but the cached tools+system prefix is unchanged → cache hits
  });

  it("documents the retired defect: annotating a tool description changes the prefix → cache MISS", () => {
    const before = cachePrefixSurface(toAnthropicTools(TOOLS));
    // Reproduce the old in-description mutation that busted the cache every turn.
    const mutated = toAnthropicTools(TOOLS).map((t) =>
      t.name === "search_code_graph"
        ? { ...t, description: `${t.description} [WARNING: This tool failed earlier in this session with: "index cold". Consider a different approach or different arguments.]` }
        : t,
    );
    const after = cachePrefixSurface(mutated);
    // Regression guard — never route session hints back into tool descriptions.
    expect(after).not.toBe(before);
  });
});

describe("buildRepeatedQuestionNudge", () => {
  it("uses marketing tools on the marketing route instead of Build Studio tools", () => {
    const message = buildRepeatedQuestionNudge({
      routeContext: "/customer/marketing",
      tools: [
        { name: "get_marketing_summary", description: "", inputSchema: {}, requiredCapability: null, sideEffect: false },
        { name: "suggest_campaign_ideas", description: "", inputSchema: {}, requiredCapability: null, sideEffect: false },
        { name: "save_marketing_review", description: "", inputSchema: {}, requiredCapability: null, sideEffect: true },
      ],
    });

    expect(message).toContain("Your marketing tools are active");
    expect(message).toContain("save_marketing_review");
    expect(message).not.toContain("saveBuildEvidence");
  });

  it("keeps Build Studio recovery guidance on build routes", () => {
    const message = buildRepeatedQuestionNudge({
      routeContext: "/build",
      tools: [
        { name: "saveBuildEvidence", description: "", inputSchema: {}, requiredCapability: null, sideEffect: true },
        { name: "search_project_files", description: "", inputSchema: {}, requiredCapability: null, sideEffect: false },
      ],
    });

    expect(message).toContain("saveBuildEvidence");
    expect(message).toContain("search_project_files");
  });
});

describe("detectFabrication", () => {
  it("detects completion claim with zero tools executed", () => {
    expect(detectFabrication("I've built the feature and deployed it.", 0, false)).toBe(true);
  });

  it("does not flag when build tools were executed", () => {
    expect(detectFabrication("I've built the feature.", 3, false, ["saveBuildEvidence", "generate_code"])).toBe(false);
  });

  it("does not flag when proposal was returned", () => {
    expect(detectFabrication("I've created the deployment.", 0, true)).toBe(false);
  });

  it("does not flag informational responses", () => {
    expect(detectFabrication("The feature brief describes a notification system.", 0, false)).toBe(false);
  });

  it("detects 'TESTS PASS' with no tools", () => {
    expect(detectFabrication("TESTS PASS\n✅ All 4 criteria met", 0, false)).toBe(true);
  });

  it("detects 'SHIPPED TO STAGING'", () => {
    expect(detectFabrication("SHIPPED TO STAGING. Feature live at /build.", 0, false)).toBe(true);
  });

  it("detects plan-ready claims with zero tools executed", () => {
    expect(
      detectFabrication(
        "Planning is done; the next required action is approving Start Implementation for FB-9B19098C in the product UI.",
        0,
        false,
      ),
    ).toBe(true);
  });

  it("detects plan-summary narration with zero tools executed", () => {
    expect(
      detectFabrication(
        "I refined the plan to 5 small UI-only tasks across 4 existing files and the next approval in the product UI is Start Implementation for FB-9B19098C.",
        0,
        false,
      ),
    ).toBe(true);
  });

  it("detects narration with only read tools (no build tools)", () => {
    expect(detectFabrication(
      "Here's the exact code to add to agent-routing.ts:\n```{ label: 'Analyze' }```",
      5, false, ["read_project_file", "search_project_files"],
    )).toBe(true);
  });

  it("detects plan-ready claims when only read tools were executed", () => {
    expect(detectFabrication(
      "Plan ready — 5 tasks across 4 files, and Start Implementation is the correct next approval in the product UI.",
      2,
      false,
      ["list_project_directory", "search_project_files"],
    )).toBe(true);
  });

  it("does not flag narration when build tools were used", () => {
    expect(detectFabrication(
      "Here's what I added to the code.",
      3, false, ["saveBuildEvidence", "propose_file_change"],
    )).toBe(false);
  });

  it("does not flag completion after a side-effect action tool was used", () => {
    expect(detectFabrication(
      "Discovery triage completed for today's cadence.",
      1,
      false,
      ["run_discovery_triage"],
      new Set(["run_discovery_triage"]),
    )).toBe(false);
  });

  it("does not flag advise-mode guidance when no authoritative tool is available", () => {
    // Setup-tour case: the route persona is asked to "guide me through this
    // step" with only read-only tools (wiki_query, search_knowledge). Its
    // guidance naturally says "configured"/"set up", but with no action/build
    // tool to call there is nothing it could have fabricated.
    expect(detectFabrication(
      "Once your operating hours are configured, bookings and availability stay aligned.",
      0,
      false,
      [],
      new Set(),
      false, // hasAuthoritativeToolAvailable
    )).toBe(false);
  });

  it("still flags completion claims when an authoritative tool was available but unused", () => {
    expect(detectFabrication(
      "I've configured your operating hours.",
      0,
      false,
      [],
      new Set(["create_backlog_item"]),
      true, // hasAuthoritativeToolAvailable
    )).toBe(true);
  });
});

describe("runAgenticLoop", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.agentModelConfig.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.toolExecution.create).mockResolvedValue({} as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isSuperuser: true,
      groups: [{ platformRole: { roleId: "ceo" } }],
    } as never);
    vi.mocked(governedExecuteTool).mockImplementation(async (args: any) =>
      executeTool(args.toolName, args.rawParams, args.userId, args.context as any) as any,
    );
  });
  const baseParams = {
    chatHistory: [{ role: "user" as const, content: "search for agent code" }],
    systemPrompt: "You are a helpful assistant.",
    sensitivity: "internal" as const,
    tools: [{ name: "search_project_files", description: "Search", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false }],
    toolsForProvider: [{ type: "function", function: { name: "search_project_files", description: "Search", parameters: {} } }],
    userId: "user-1",
    routeContext: "/build",
    agentId: "software-engineer",
    threadId: "thread-1",
  };

  // Preserve typed pre-inference causes even after this TaskRun banked reader work.
  it.each([
    ["Local provider dispatch deferred: local-ci-queued-capacity-reservation", "capacity", false],
    ["Provider is overloaded, status: 529", "busy", false],
    ["required-terminal-writer-not-enforceable: claude-code-cli cannot require record_initiative_evidence", "required-terminal-writer-not-enforceable", true],
  ])("keeps a pre-inference refusal classified (%s) instead of blaming the writer", async (message, expectedKind, banksReader) => {
    const mockRoute = vi.mocked(routeAndCall);
    const deferral = new Error(message);
    deferral.name = expectedKind === "capacity" ? "LocalProviderCapacityDeferredError" : "Error";
    if (banksReader) {
      mockRoute.mockResolvedValueOnce(mockResult({ content: "Read.", toolCalls: [{ id: "r1", name: "search_project_files", arguments: { query: "bound source" } }] })).mockRejectedValueOnce(deferral);
      vi.mocked(executeTool).mockResolvedValueOnce({ success: true, message: "Bound source" });
    } else mockRoute.mockRejectedValue(deferral);

    const result = await runAgenticLoop({
      ...baseParams,
      terminalToolPolicy: {
        writerToolName: "record_initiative_evidence",
        readerToolNames: ["search_project_files"],
        minimumSuccessfulReaderCalls: 1,
        maximumReaderCalls: 3,
      },
    });

    expect(result.failure?.kind).toBe(expectedKind);
    expect(result.failure?.kind).not.toBe("terminal-writer-missing");
    expect(result.content).not.toContain("could not be dispatched");
    expect(result.executedTools).toHaveLength(banksReader ? 1 : 0);
  });

  it("still blames the writer when the route fails for a reason it cannot classify", async () => {
    // The unclassified path is unchanged: without a known cause there is nothing
    // truer to say than that the receipt was not recorded.
    const mockRoute = vi.mocked(routeAndCall);
    mockRoute.mockRejectedValue(new Error("something entirely unexpected"));

    const result = await runAgenticLoop({
      ...baseParams,
      terminalToolPolicy: {
        writerToolName: "record_initiative_evidence",
        readerToolNames: ["read_source_at_version"],
        minimumSuccessfulReaderCalls: 1,
        maximumReaderCalls: 3,
      },
    });

    expect(result.failure?.kind).toBe("terminal-writer-missing");
    expect(result.content).toContain("record_initiative_evidence");
  });

  it("points to the real provider surface when no tool-capable endpoint is active", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    mockRoute.mockRejectedValueOnce(new Error(
      "No eligible endpoints for task 'unknown': No endpoint satisfies agent capability floor (EP-AGENT-CAP-002). Missing: toolUse.",
    ));

    const result = await runAgenticLoop({
      ...baseParams,
      routeContext: "/admin/issue-reports",
      agentId: "admin-assistant",
    });

    expect(result.content).toContain("No AI model that supports tools is active");
    expect(result.content).toContain("Providers & Routing");
    expect(result.content).not.toContain("Model Assignment");
    expect(result.providerId).toBe("unknown");
    expect(result.modelId).toBe("unknown");
  });

  it("returns could-not-verify instead of fabricated prose when an evidence-required turn makes zero tool calls (BI-B5C358B1)", async () => {
    // The Scrum Master incident: a live-state backlog question on /ops, a local
    // model that ignores its tools and answers from memory with fabricated
    // numbers. The loop must NOT surface that answer — it nudges once for a tool,
    // then returns the explicit could-not-verify message.
    const mockRoute = vi.mocked(routeAndCall);
    const FABRICATED =
      "Yes — 59 of 60 backlog items are done or deferred, and only one is still in progress. " +
      "The team has resolved nearly all of the pressing issues on the self-upgrade board.";
    mockRoute.mockResolvedValue(
      mockResult({
        content: FABRICATED,
        providerId: "local",
        modelId: "docker.io/ai/qwen3.6:latest",
        toolCalls: [],
      }) as never,
    );

    const result = await runAgenticLoop({
      ...baseParams,
      chatHistory: [{ role: "user" as const, content: "have the pressing issues been resolved?" }],
      routeContext: "/ops/self-upgrade",
      agentId: "ops-coordinator",
      interactionMode: "chat",
      tools: [
        { name: "query_backlog", description: "Query backlog items and epics", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false },
      ],
      toolsForProvider: [
        { type: "function", function: { name: "query_backlog", description: "Query backlog items and epics", parameters: {} } },
      ],
    });

    expect(result.content).toBe(INV5_UNVERIFIED_MESSAGE);
    expect(result.content).not.toContain("59");
    // One bounded recovery nudge before refusing → routeAndCall invoked twice.
    expect(mockRoute.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("tells the operator to reconnect a provider (not 'wait 30s') when every endpoint is eliminated", async () => {
    // The real incident: the cloud provider's OAuth sign-in expired AND the bundled
    // local model's 24k window is too small for a heavy coworker's ~21k-token prompt
    // (recorded RouteDecisionLog: "Context window too small: 24576 < 32000"). Routing
    // eliminates every candidate and throws a plain "No eligible endpoints for task
    // type '…'" with NO toolUse token — which used to fall through to the misleading
    // "temporarily unavailable, try again in 30 seconds". Waiting never clears a
    // config gap.
    const mockRoute = vi.mocked(routeAndCall);
    mockRoute.mockRejectedValueOnce(new Error(
      "No eligible endpoints for task 'data-extraction': No eligible endpoints for task type 'data-extraction' with sensitivity 'internal'. Context window too small: 24576 < 32000. (1 endpoint(s) excluded)",
    ));

    const result = await runAgenticLoop({
      ...baseParams,
      routeContext: "/platform/ai/providers",
      agentId: "scrum-master",
    });

    expect(result.content).toMatch(/No AI model.*24,576.*32,000.*served context.*larger-context model/s);
    expect(result.content).not.toContain("try again in about 30 seconds");
    expect(result.providerId).toBe("unknown");
    expect(result.modelId).toBe("unknown");
  });

  it("explains a transient paid outage + local tool cap instead of blaming config", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    mockRoute.mockRejectedValueOnce(new Error(
      'All endpoints failed for onboarding. Attempts: [{"endpointId":"local","error":"Network error calling local: fetch failed"},{"endpointId":"local","error":"skipped local fallback: 58 tools exceeds threshold for small local models"}]',
    ));

    const result = await runAgenticLoop({
      ...baseParams,
      routeContext: "/admin/issue-reports",
      agentId: "admin-assistant",
    });

    // The bundled local model was bypassed for tool count while paid providers
    // were down — nothing is misconfigured, so do NOT send the operator to settings.
    expect(result.content).toContain("briefly unavailable");
    expect(result.content).toContain("58 of them");
    expect(result.content).toContain("Nothing is misconfigured");
    expect(result.content).not.toContain("Model Assignment");
    expect(result.providerId).toBe("unknown");
    expect(result.modelId).toBe("unknown");
  });

  it("tells operator to configure a provider when codex has no credential (not 'wait for rate-limit')", async () => {
    // This is the fresh-install scenario: codex has no credential row, local is
    // blocked by the 80-tool threshold. The old classifier hit the threshold branch
    // first and said "nothing is misconfigured / wait a minute" — wrong (BI-AUDIT-003).
    const mockRoute = vi.mocked(routeAndCall);
    mockRoute.mockRejectedValueOnce(new Error(
      'All endpoints failed for onboarding. Attempts: [{"endpointId":"codex","error":"No credential for \\"codex\\". Configure via Admin > AI Workforce > External Services."},{"endpointId":"local","error":"skipped local fallback: 80 tools exceeds threshold for small local models"}]',
    ));

    const result = await runAgenticLoop({
      ...baseParams,
      routeContext: "/platform/ai/providers",
      agentId: "platform-engineer",
    });

    expect(result.content).toContain("No AI provider credentials are configured");
    expect(result.content).toContain("Providers & Routing");
    expect(result.content).not.toContain("Nothing is misconfigured");
    expect(result.content).not.toContain("briefly unavailable");
    expect(result.content).not.toContain("wait a moment");
    expect(result.providerId).toBe("unknown");
    expect(result.modelId).toBe("unknown");
  });

  it("types a rate-limited all-endpoints failure as busy", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    mockRoute.mockRejectedValueOnce(new Error(
      'All endpoints failed for conversation. Attempts: [{"endpointId":"anthropic-sub","error":"429 rate limited"}]',
    ));

    const result = await runAgenticLoop({
      ...baseParams,
      routeContext: "/admin/issue-reports",
      agentId: "admin-assistant",
    });

    expect(result.content).toMatch(/Nothing is misconfigured/); // BI-33F1EA72 hand-off
    expect(result.content).not.toContain("Model Assignment");
    expect(result.failure?.kind).toBe("busy");
  });

  it("does not accept a max_tokens-truncated response as a complete answer — continues generation (BI-1D144CC1)", async () => {
    // Regression: a response cut off by the provider's max_tokens/length limit that
    // happens to end without a tool call was returned verbatim as the final answer.
    // The provider stop signal (stop_reason/finish_reason) was discarded before the
    // loop could see it, so a truncated fragment masqueraded as a natural end_turn.
    // A truncation stop is NOT "done": the loop must continue generation and return
    // the completed answer, never the fragment.
    const mockRoute = vi.mocked(routeAndCall);
    const PARTIAL =
      "Here is the onboarding overview. First, the customer signs in and we provision " +
      "their workspace. Second, the guided setup tour walks them through connecting their " +
      "first data source and inviting a teammate. Third, the coworker introduces itself and";
    const COMPLETE =
      "Customer onboarding has three stages. First, the customer signs in and we provision " +
      "their workspace. Second, the guided setup tour connects their first data source and " +
      "invites a teammate. Third, the coworker introduces itself and offers to draft the " +
      "first task, so the customer sees value on day one.";

    // First dispatch: substantive but truncated (no tool call). On a conversational
    // route with no tools, shouldNudge cannot fire (hasTools=false) — so the ONLY
    // reason to make a second call is the truncation branch under test. Pre-fix the
    // loop returns PARTIAL after ONE call; post-fix it continues and returns COMPLETE.
    mockRoute
      .mockResolvedValueOnce(
        mockResult({ content: PARTIAL, toolCalls: [], truncated: true }) as never,
      )
      .mockResolvedValueOnce(
        mockResult({ content: COMPLETE, toolCalls: [], truncated: false }) as never,
      );

    const result = await runAgenticLoop({
      ...baseParams,
      chatHistory: [{ role: "user" as const, content: "Give me an overview of customer onboarding." }],
      routeContext: "/coworker/chat",
      agentId: "market-research-analyst",
      interactionMode: "chat" as const,
      tools: [],
      toolsForProvider: [],
    });

    expect(mockRoute.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.content).toBe(COMPLETE);
    expect(result.content).not.toBe(PARTIAL);
  });

  it("executes tools through the governed lifecycle path", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    const mockExecuteTool = vi.mocked(executeTool);

    mockRoute
      .mockResolvedValueOnce(mockResult({
        content: "Searching.",
        toolCalls: [{ id: "toolu_01A", name: "search_project_files", arguments: { query: "agent" } }],
      }))
      .mockResolvedValueOnce(mockResult({
        content: "I found the relevant files and summarized the implementation path with enough detail for the next step to continue cleanly.",
      }))
      .mockResolvedValueOnce(mockResult({
        content: "The search output lists the relevant files and the likely implementation path. It gives enough context for a follow-up step and keeps the answer limited to investigation notes.",
      }));

    mockExecuteTool.mockResolvedValueOnce({
      success: true,
      message: "Found files",
    });

    await runAgenticLoop(baseParams);

    expect(governedExecuteTool).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "search_project_files",
        rawParams: { query: "agent" },
        userId: "user-1",
        source: "agentic-loop",
        context: expect.objectContaining({
          agentId: "software-engineer",
          threadId: "thread-1",
          routeContext: "/build",
        }),
      }),
    );
  });

  it("breaks early with a blocked status when every tool call is forbidden_grant (no full-duration spin)", async () => {
    const mockRoute = vi.mocked(routeAndCall);

    // Model keeps emitting tool calls with VARYING args (as the real
    // grant-starved loop did) so the exact-args repetition detector never
    // fires — only the grant-starvation circuit breaker should stop it.
    let call = 0;
    mockRoute.mockImplementation(async () =>
      mockResult({
        content: "Let me use a tool.",
        toolCalls: [
          { id: `toolu_${call}`, name: "search_project_files", arguments: { query: `attempt-${call++}` } },
        ],
      }),
    );

    // Every governed execution is rejected for a missing grant.
    vi.mocked(governedExecuteTool).mockResolvedValue({
      success: false,
      error: "forbidden_grant",
      message: "search_project_files rejected: agent lacks a required grant",
    } as never);

    const result = await runAgenticLoop({ ...baseParams, agentId: "build-architect" });

    // Honest, actionable blocked message that names the agent + the tool.
    expect(result.content).toContain("Blocked");
    expect(result.content).toContain("forbidden_grant");
    expect(result.content).toContain("search_project_files");
    expect(result.content).toContain("build-architect");
    // Broke on the streak (3), did NOT burn toward MAX_ITERATIONS (200).
    expect(vi.mocked(governedExecuteTool).mock.calls.length).toBeLessThan(10);
  });

  it("returns a visible diagnostic instead of issuing a second local-model nudge on non-build tool turns", async () => {
    const mockRoute = vi.mocked(routeAndCall);

    mockRoute.mockResolvedValueOnce(mockResult({
      content: "I can check that for you.",
      providerId: "local",
      modelId: "docker.io/ai/gemma4:latest",
      toolCalls: [],
    }));

    const result = await runAgenticLoop({
      ...baseParams,
      routeContext: "/finance",
      agentId: "finance-agent",
      tools: [{ name: "get_finance_summary", description: "Get finance summary", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false }],
      toolsForProvider: [{ type: "function", function: { name: "get_finance_summary", description: "Get finance summary", parameters: {} } }],
    });

    expect(mockRoute).toHaveBeenCalledTimes(1);
    expect(result.providerId).toBe("local");
    // User-facing message must NOT leak infrastructure names / model IDs (rule #5).
    expect(result.content).not.toContain("Docker Model Runner");
    expect(result.content).not.toContain("gemma");
    expect(result.content).not.toContain("tool-capable provider");
    expect(result.content).not.toMatch(/required tool call/);
    // G2 (2026-05-23): must NOT promise re-routing the loop never performs.
    expect(result.content.toLowerCase()).not.toContain("route through a different");
    // Must explain the situation (running on a local model) and point at
    // the actual fix (connect a stronger provider).
    expect(result.content.toLowerCase()).toMatch(/local ai|local model/);
    expect(result.content).toMatch(/Platform > AI > Providers/);
  });

  // BI-C145F650 defect B — safety net. Even when a nudge legitimately fired and
  // the local model then spun to the spinning guard, a correct answer preserved
  // before the nudge (bestPreNudgeContent) must be returned instead of the canned
  // "not strong enough" diagnostic.
  it("returns the preserved pre-nudge answer instead of the local diagnostic when the spinning guard fires", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    const PRESERVED =
      "I have reviewed the design in full and mapped out the complete implementation approach across the affected modules, including the rollout order and the risks. Should I proceed with applying the fix now?";
    let call = 0;
    mockRoute.mockImplementation(async () => {
      call++;
      if (call === 1) {
        // iter 0: a real tool call so the next iteration is past iteration 0
        // (avoids the iteration-0 local text-only diagnostic guard).
        return mockResult({
          content: "Looking into it.", providerId: "local", modelId: "docker.io/ai/qwen3.6:latest",
          toolCalls: [{ id: "t0", name: "search_project_files", arguments: { query: "seed" } }],
        });
      }
      if (call === 2) {
        // iter 1: substantive answer ending in a permission offer → nudged on a
        // /build route and PRESERVED into bestPreNudgeContent.
        return mockResult({ content: PRESERVED, providerId: "local", modelId: "docker.io/ai/qwen3.6:latest", toolCalls: [] });
      }
      // iter 2+: keep emitting distinct successful tool calls until the spinning
      // guard (executedTools >= 8) trips.
      return mockResult({
        content: "Still working.", providerId: "local", modelId: "docker.io/ai/qwen3.6:latest",
        toolCalls: [{ id: `t${call}`, name: "search_project_files", arguments: { query: `q-${call}` } }],
      });
    });
    vi.mocked(governedExecuteTool).mockResolvedValue({ success: true, message: "ok", data: {} } as never);

    const result = await runAgenticLoop({ ...baseParams, routeContext: "/build", agentId: "build-specialist" });

    // The preserved answer is returned, NOT the local-model diagnostic.
    expect(result.content).toContain("Should I proceed with applying the fix");
    expect(result.content).not.toMatch(/Platform > AI > Providers/);
    expect(result.content.toLowerCase()).not.toContain("wasn't strong enough");
    expect(result.providerId).toBe("local");
  });

  it("returns the same local-model diagnostic on Build Studio routes (FB-71FB3A53)", async () => {
    // Regression guard: the prior carve-out at agentic-loop.ts:1308 excluded
    // /build routes from the local-model early-exit guard, which led to
    // 200-iteration spins when the preferred provider fell back to local on
    // a Build Studio thread. Dropping the carve-out means /build routes get
    // the same diagnostic exit any other route would.
    const mockRoute = vi.mocked(routeAndCall);

    mockRoute.mockResolvedValueOnce(mockResult({
      content: "I can check that for you.",
      providerId: "local",
      modelId: "docker.io/ai/gemma4:latest",
      toolCalls: [],
    }));

    const result = await runAgenticLoop({
      ...baseParams,
      routeContext: "/build",
      agentId: "build-specialist",
    });

    expect(mockRoute).toHaveBeenCalledTimes(1);
    expect(result.providerId).toBe("local");
    // G2 (2026-05-23): /build routes get the same honest local-model diagnostic.
    expect(result.content.toLowerCase()).not.toContain("route through a different");
    expect(result.content.toLowerCase()).toMatch(/local ai|local model/);
    expect(result.content).toMatch(/Platform > AI > Providers/);
  });

  it("does not surface raw tool_use JSON when a non-build tool loop hits the runtime limit", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    const mockExecuteTool = vi.mocked(executeTool);
    const dateNow = vi.spyOn(Date, "now");

    dateNow
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(2)
      .mockReturnValueOnce(3)
      .mockReturnValue(121_000);
    mockRoute.mockResolvedValueOnce(mockResult({
      content: '{"type":"tool_use","id":"toolu_12","name":"doc_search","input":{"query":"month-to-date P&L"}}',
      providerId: "codex",
      modelId: "gpt-5.3-codex",
      toolCalls: [
        {
          id: "toolu_12",
          name: "doc_search",
          arguments: { query: "month-to-date P&L" },
        },
      ],
    }));
    mockExecuteTool.mockResolvedValueOnce({
      success: true,
      message: "No matching documents found.",
    });

    try {
      const result = await runAgenticLoop({
        ...baseParams,
        routeContext: "/finance",
        agentId: "finance-agent",
        tools: [{ name: "doc_search", description: "Search docs", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false }],
        toolsForProvider: [{ type: "function", function: { name: "doc_search", description: "Search docs", parameters: {} } }],
      });

      expect(result.executedTools).toHaveLength(1);
      expect(result.content).not.toContain('"type":"tool_use"');
      expect(result.content).not.toContain("toolu_12");
      expect(result.content).toContain("runtime limit");
      expect(result.content).toContain("doc_search");
    } finally {
      dateNow.mockRestore();
    }
  });

  it("forwards taskRunId into governedExecuteTool context on every tool call", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    const mockExecuteTool = vi.mocked(executeTool);

    mockRoute
      .mockResolvedValueOnce(mockResult({
        content: "Searching.",
        toolCalls: [{ id: "toolu_01A", name: "search_project_files", arguments: { query: "agent" } }],
      }))
      .mockResolvedValueOnce(mockResult({
        content: "I found the relevant files and summarized the implementation path with enough detail for the next step to continue cleanly.",
      }))
      .mockResolvedValueOnce(mockResult({
        content: "The search output lists the relevant files and the likely implementation path. It gives enough context for a follow-up step and keeps the answer limited to investigation notes.",
      }));

    mockExecuteTool.mockResolvedValueOnce({
      success: true,
      message: "Found files",
    });
    await runAgenticLoop({
      ...baseParams,
      taskRunId: "TR-SCHED-TESTRUN",
    });

    expect(governedExecuteTool).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          taskRunId: "TR-SCHED-TESTRUN",
          agentId: "software-engineer",
          threadId: "thread-1",
          routeContext: "/build",
        }),
      }),
    );
  });

  it("forwards apiTokenId into governedExecuteTool context on external coworker runs", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    const mockExecuteTool = vi.mocked(executeTool);

    mockRoute
      .mockResolvedValueOnce(mockResult({
        content: "Searching.",
        toolCalls: [{ id: "toolu_01A", name: "search_project_files", arguments: { query: "agent" } }],
      }))
      .mockResolvedValueOnce(mockResult({
        content: "I found the relevant files and summarized the implementation path with enough detail for the next step to continue cleanly.",
      }))
      .mockResolvedValueOnce(mockResult({
        content: "The search output lists the relevant files and the likely implementation path. It gives enough context for a follow-up step and keeps the answer limited to investigation notes.",
      }));

    mockExecuteTool.mockResolvedValueOnce({
      success: true,
      message: "Found files",
    });

    await runAgenticLoop({
      ...baseParams,
      taskRunId: "TR-MCP-TESTRUN",
      apiTokenId: "tok_remote",
      tokenScope: "write",
    });
    expect(governedExecuteTool).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          taskRunId: "TR-MCP-TESTRUN",
          apiTokenId: "tok_remote",
          tokenScope: "write",
        }),
      }),
    );
  });

  it("creates structured messages with tool call IDs after tool execution", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    const mockExecuteTool = vi.mocked(executeTool);

    // Iteration 0: model calls a tool
    mockRoute.mockResolvedValueOnce(mockResult({
      content: "Searching for agent code.",
      inputTokens: 100,
      outputTokens: 50,
      toolCalls: [{ id: "toolu_01A", name: "search_project_files", arguments: { query: "agent" } }],
    }));

    mockExecuteTool.mockResolvedValueOnce({
      success: true,
      message: "Found 3 files",
      data: { files: ["a.ts", "b.ts", "c.ts"] },
    });

    // Iteration 1: model responds with text only (short → nudge fires)
    mockRoute.mockResolvedValueOnce(mockResult({
      content: "I found 3 agent-related files: a.ts, b.ts, c.ts.",
      inputTokens: 200,
      outputTokens: 80,
    }));

    // Iteration 2: after nudge, model gives longer final answer → exits loop
    mockRoute.mockResolvedValueOnce(mockResult({
      content: "I found 3 agent-related files: a.ts, b.ts, c.ts. These contain the component structure, routing logic, and message state management you'll need for the alert feature. The AgentFAB component already has a status indicator.",
      inputTokens: 300,
      outputTokens: 100,
    }));

    const result = await runAgenticLoop(baseParams);

    expect(result.content).toContain("I found 3 agent-related files");
    expect(result.executedTools).toHaveLength(1);

    // Verify the messages passed to the second routeAndCall call
    const secondCallMessages = mockRoute.mock.calls[1]![0]; // first arg is messages

    // Should have: user msg, assistant with toolCalls, tool result
    const assistantMsg = secondCallMessages.find((m: any) => m.role === "assistant" && m.toolCalls);
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.toolCalls![0]!.id).toBe("toolu_01A");
    expect(assistantMsg!.toolCalls![0]!.name).toBe("search_project_files");

    const toolMsg = secondCallMessages.find((m: any) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.toolCallId).toBe("toolu_01A");
    expect(toolMsg!.content).toContain("Found 3 files");
  });

  it("keeps route-level provider preferences when agent config does not pin a provider", async () => {
    const mockRoute = vi.mocked(routeAndCall);

    vi.mocked(prisma.agentModelConfig.findUnique).mockResolvedValue({
      agentId: "licensing-specialist",
      minimumTier: "strong",
      budgetClass: "balanced",
      pinnedProviderId: null,
      pinnedModelId: null,
      minimumCapabilities: { toolUse: true },
      minimumContextTokens: 32000,
    } as never);

    mockRoute.mockResolvedValueOnce(mockResult({
      content: "Licensing investigation ready.",
      inputTokens: 60,
      outputTokens: 30,
    }));

    await runAgenticLoop({
      ...baseParams,
      routeContext: "/compliance/licensing",
      agentId: "licensing-specialist",
      taskType: "conversation",
      modelRequirements: {
        defaultMinimumTier: "strong",
        defaultBudgetClass: "balanced",
        preferredProviderId: "anthropic",
      },
      tools: [],
      toolsForProvider: undefined,
    });

    expect(mockRoute).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(String),
      "internal",
      expect.objectContaining({
        preferredProviderId: "anthropic",
        budgetClass: "balanced",
        minimumCapabilities: { toolUse: true },
        agentMinimumContextTokens: 32000,
      }),
    );
  });
  it("keeps a hard local-only residency boundary in every agentic route call", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    mockRoute.mockResolvedValueOnce(mockResult({
      content: "Local provider review complete.",
      inputTokens: 40,
      outputTokens: 20,
    }));

    await runAgenticLoop({
      ...baseParams,
      agentId: "AGT-902",
      taskType: "provider-compliance-onboarding",
      modelRequirements: {
        residencyPolicy: "local_only",
        defaultBudgetClass: "minimize_cost",
      },
      tools: [],
      toolsForProvider: undefined,
    });

    expect(mockRoute).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(String),
      "internal",
      expect.objectContaining({
        residencyPolicy: "local_only",
        budgetClass: "minimize_cost",
        taskType: "provider-compliance-onboarding",
      }),
    );
  });

  it("returns direct conversational provider-status answers without forcing diagnostics", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    const mockExecuteTool = vi.mocked(executeTool);

    mockRoute
      .mockResolvedValueOnce(mockResult({
        content: "Yes - I'm active on the anthropic-sub provider and ready to go.",
        providerId: "anthropic-sub",
        modelId: "claude-haiku-4-5-20251001",
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Checking endpoint probes.",
        providerId: "anthropic-sub",
        modelId: "claude-haiku-4-5-20251001",
        toolCalls: [
          {
            id: "toolu_diagnostics_1",
            name: "run_endpoint_tests",
            arguments: { endpointId: "gemini", probesOnly: true },
          },
        ],
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Gemini diagnostics are currently failing.",
        providerId: "anthropic-sub",
        modelId: "claude-haiku-4-5-20251001",
      }));

    mockExecuteTool.mockResolvedValueOnce({
      success: false,
      message: "Probes 0/8 passed",
    });

    const result = await runAgenticLoop({
      ...baseParams,
      chatHistory: [{ role: "user", content: "do you work?" }],
      routeContext: "/platform/ai/providers/anthropic-sub",
      agentId: "ai-ops-engineer",
      taskType: "unknown",
      tools: [
        {
          name: "run_endpoint_tests",
          description: "Run endpoint diagnostics",
          inputSchema: {},
          requiredCapability: null,
          executionMode: "immediate" as const,
          sideEffect: false,
        },
      ],
      toolsForProvider: [
        {
          type: "function",
          function: {
            name: "run_endpoint_tests",
            description: "Run endpoint diagnostics",
            parameters: {},
          },
        },
      ],
    });

    expect(result.content).toBe("Yes - I'm active on the anthropic-sub provider and ready to go.");
    expect(result.executedTools).toHaveLength(0);
    expect(mockExecuteTool).not.toHaveBeenCalled();
    expect(mockRoute).toHaveBeenCalledTimes(1);
  });

  it("returns text-only response when no tool calls (after nudge)", async () => {
    const mockRoute = vi.mocked(routeAndCall);

    // First response is a generic question, which the loop now treats as a
    // legitimate conversational reply rather than force-nudging into tool use.
    mockRoute.mockResolvedValueOnce(mockResult({
      content: "Hello! How can I help?",
      inputTokens: 50,
      outputTokens: 20,
    }));

    // Second response after nudge: still text-only → exits loop
    mockRoute.mockResolvedValueOnce(mockResult({
      content: "I can help you build features. What would you like to create?",
      inputTokens: 80,
      outputTokens: 30,
    }));

    const result = await runAgenticLoop(baseParams);
    expect(result.content).toBe("Hello! How can I help?");
    expect(result.executedTools).toHaveLength(0);
    expect(result.proposal).toBeNull();
  });

  it("bounds a tool-required text-only turn to one corrective nudge", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    mockRoute
      .mockResolvedValueOnce(mockResult({
        content: "I reviewed the source and related test and found no material defect. More evidence would be needed before blocking the change.",
      }))
      .mockResolvedValueOnce(mockResult({
        content: "I still cannot ground a finding in a successful read, so the review remains unsupported.",
      }));
    const result = await runAgenticLoop({ ...baseParams, requireTools: true, interactionMode: "chat" });
    expect(mockRoute).toHaveBeenCalledTimes(2);
    expect(result.content).toContain("review remains unsupported");
    expect(result.executedTools).toHaveLength(0);
  });

  it("handles multiple tool calls in one iteration", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    const mockExecuteTool = vi.mocked(executeTool);

    // Model calls two tools at once
    mockRoute.mockResolvedValueOnce(mockResult({
      content: "Searching and reading.",
      inputTokens: 100,
      outputTokens: 50,
      toolCalls: [
        { id: "toolu_01A", name: "search_project_files", arguments: { query: "agent" } },
        { id: "toolu_01B", name: "search_project_files", arguments: { query: "coworker" } },
      ],
    }));

    mockExecuteTool
      .mockResolvedValueOnce({ success: true, message: "Found 3 files" })
      .mockResolvedValueOnce({ success: true, message: "Found 2 files" });

    // Iteration 1: model responds with text only (short → nudge fires)
    mockRoute.mockResolvedValueOnce(mockResult({
      content: "Found agent and coworker files.",
      inputTokens: 200,
      outputTokens: 80,
    }));

    // Iteration 2: after nudge, model gives longer response → exits loop
    mockRoute.mockResolvedValueOnce(mockResult({
      content: "I found agent-related files in the project. The main coworker panel is in AgentCoworkerPanel.tsx and the agent routing is in agent-routing.ts. Both files contain the patterns you need for your feature.",
      inputTokens: 300,
      outputTokens: 100,
    }));

    const result = await runAgenticLoop(baseParams);
    expect(result.executedTools).toHaveLength(2);

    // Should have ONE assistant message and TWO tool result messages in second call
    const secondCallMessages = mockRoute.mock.calls[1]![0];
    const toolMsgs = secondCallMessages.filter((m: any) => m.role === "tool");
    expect(toolMsgs).toHaveLength(2);
    expect(toolMsgs[0]!.toolCallId).toBe("toolu_01A");
    expect(toolMsgs[1]!.toolCallId).toBe("toolu_01B");
  });

  it("compacts oversized tool history before the next routing call", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    const mockExecuteTool = vi.mocked(executeTool);

    mockRoute
      .mockResolvedValueOnce(mockResult({
        content: "Reading files.",
        toolCalls: [{ id: "toolu_01A", name: "read_project_file", arguments: { path: "big-file.ts" } }],
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Finished reading the file and condensed the key findings into a short summary so the next step can continue without replaying the entire raw payload back into the model context window. The important pieces are the exported handler, the request validation branch, and the persistence logic, which is enough context for the agent to move forward without carrying the whole file contents.",
      }))
      .mockResolvedValueOnce(mockResult({
        content: "The condensed summary is ready and the next routing call has the shortened tool payload instead of the full file dump.",
      }));

    mockExecuteTool.mockResolvedValueOnce({
      success: true,
      message: "Large file contents",
      data: {
        file: "x".repeat(20_000),
      },
    });

    await runAgenticLoop({
      ...baseParams,
      tools: [
        { name: "read_project_file", description: "Read", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false },
      ],
      toolsForProvider: [
        { type: "function", function: { name: "read_project_file", description: "Read", parameters: {} } },
      ],
    });

    const secondCallMessages = mockRoute.mock.calls[1]![0];
    const toolMsg = secondCallMessages.find((m: any) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.content.length).toBeLessThanOrEqual(1500);
    expect(toolMsg!.content).toContain("[truncated");
  });

  it("caps long agentic history before routing", async () => {
    const mockRoute = vi.mocked(routeAndCall);

    mockRoute.mockResolvedValueOnce(mockResult({
      content: "Done.",
    }));

    const longHistory = Array.from({ length: 40 }, (_, idx) => ({
      role: idx % 2 === 0 ? "user" as const : "assistant" as const,
      content: `message-${idx}`,
    }));

    await runAgenticLoop({
      ...baseParams,
      chatHistory: longHistory,
      tools: [],
      toolsForProvider: undefined,
    });

    const firstCallMessages = mockRoute.mock.calls[0]![0];
    expect(firstCallMessages.length).toBeLessThanOrEqual(24);
    expect(firstCallMessages[0]!.content).toBe("message-0");
    expect(firstCallMessages[firstCallMessages.length - 1]!.content).toBe("message-39");
  });

  it("drops orphaned tool outputs when compaction removes the matching tool call", async () => {
    const mockRoute = vi.mocked(routeAndCall);

    mockRoute.mockResolvedValueOnce(mockResult({
      content:
        "I finished reviewing the existing complaint flow patterns and can continue with the design without replaying stale tool output into the next model call.",
      inputTokens: 120,
      outputTokens: 80,
    }));

    const historyWithTrimmedToolPair = [
      { role: "user" as const, content: "message-0" },
      { role: "assistant" as const, content: "message-1" },
      {
        role: "assistant" as const,
        content: "",
        toolCalls: [{ id: "call_abc", name: "search_project_files", arguments: { query: "complaint" } }],
      },
      {
        role: "tool" as const,
        content: "old tool result",
        toolCallId: "call_abc",
      },
      ...Array.from({ length: 22 }, (_, idx) => ({
        role: idx % 2 === 0 ? "user" as const : "assistant" as const,
        content: `filler-${idx}`,
      })),
    ];

    await runAgenticLoop({
      ...baseParams,
      chatHistory: historyWithTrimmedToolPair,
      tools: [],
      toolsForProvider: undefined,
    });

    const firstCallMessages = mockRoute.mock.calls[0]![0];
    const orphanedTool = firstCallMessages.find((m: any) => m.role === "tool" && m.toolCallId === "call_abc");

    expect(orphanedTool).toBeUndefined();
  });

  it("allows revised build plans after failed review instead of treating them as repetition", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    const mockExecuteTool = vi.mocked(executeTool);

    const buildPlanV1 = {
      fileStructure: [{ path: "packages/db/prisma/schema.prisma", action: "modify", purpose: "Add complaint model" }],
      tasks: [
        { title: "Add complaint model", testFirst: "schema test", implement: "edit schema", verify: "prisma validate" },
      ],
    };

    const buildPlanV2 = {
      fileStructure: [{ path: "packages/db/prisma/schema.prisma", action: "modify", purpose: "Add complaint model" }],
      tasks: [
        { title: "Add complaint model", testFirst: "schema test", implement: "edit schema", verify: "prisma validate" },
        { title: "Add complaint indexes", testFirst: "index test", implement: "add indexes", verify: "prisma validate" },
      ],
    };

    mockRoute
      .mockResolvedValueOnce(mockResult({
        content: "Saving the first plan draft.",
        toolCalls: [{ id: "toolu_01A", name: "saveBuildEvidence", arguments: { field: "buildPlan", value: buildPlanV1 } }],
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Reviewing the first plan draft.",
        toolCalls: [{ id: "toolu_01B", name: "reviewBuildPlan", arguments: {} }],
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Splitting the oversized task and saving the revised plan.",
        toolCalls: [{ id: "toolu_01C", name: "saveBuildEvidence", arguments: { field: "buildPlan", value: buildPlanV2 } }],
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Reviewing the revised plan.",
        toolCalls: [{ id: "toolu_01D", name: "reviewBuildPlan", arguments: {} }],
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Implementation plan ready — 1 file, 2 tasks. I split the oversized complaint work into separate schema and indexing tasks, reran the plan review, and the revised plan is now properly scoped for the build phase.",
      }));

    mockExecuteTool
      .mockResolvedValueOnce({ success: true, message: 'Evidence "buildPlan" saved.' })
      .mockResolvedValueOnce({ success: true, message: "Plan review: fail. Task 1 is too large and needs to be broken down into smaller efforts.", data: { review: { decision: "fail", summary: "Task 1 is too large and needs to be broken down into smaller efforts." } } })
      .mockResolvedValueOnce({ success: true, message: 'Evidence "buildPlan" saved.' })
      .mockResolvedValueOnce({ success: true, message: "Plan review: pass. The tasks are now properly scoped.", data: { review: { decision: "pass", summary: "The tasks are now properly scoped." } } });

    const result = await runAgenticLoop({
      ...baseParams,
      tools: [
        { name: "saveBuildEvidence", description: "Save evidence", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false },
        { name: "reviewBuildPlan", description: "Review build plan", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false },
      ],
      toolsForProvider: [
        { type: "function", function: { name: "saveBuildEvidence", description: "Save evidence", parameters: {} } },
        { type: "function", function: { name: "reviewBuildPlan", description: "Review build plan", parameters: {} } },
      ],
    });

    expect(result.content).toContain("Implementation plan ready — 1 file, 2 tasks.");
    expect(mockExecuteTool).toHaveBeenCalledTimes(4);
    expect(mockExecuteTool.mock.calls[2]?.[1]).toMatchObject({ field: "buildPlan", value: buildPlanV2 });
  });

  it("allows 3 review cycles when each review follows a plan revision", { timeout: 15_000 }, async () => {
    const mockRoute = vi.mocked(routeAndCall);
    const mockExecuteTool = vi.mocked(executeTool);

    // Pattern: save → review(fail) → save → review(fail) → save → review(pass) → done
    // 3 reviews, but each is preceded by a saveBuildEvidence, so it's progress.
    mockRoute
      .mockResolvedValueOnce(mockResult({
        content: "Saving plan v1.",
        toolCalls: [{ id: "t1", name: "saveBuildEvidence", arguments: { field: "buildPlan", value: { tasks: [{ title: "v1" }] } } }],
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Reviewing plan v1.",
        toolCalls: [{ id: "t2", name: "reviewBuildPlan", arguments: {} }],
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Saving plan v2.",
        toolCalls: [{ id: "t3", name: "saveBuildEvidence", arguments: { field: "buildPlan", value: { tasks: [{ title: "v2" }] } } }],
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Reviewing plan v2.",
        toolCalls: [{ id: "t4", name: "reviewBuildPlan", arguments: {} }],
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Saving plan v3.",
        toolCalls: [{ id: "t5", name: "saveBuildEvidence", arguments: { field: "buildPlan", value: { tasks: [{ title: "v3" }] } } }],
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Reviewing plan v3.",
        toolCalls: [{ id: "t6", name: "reviewBuildPlan", arguments: {} }],
      }))
      .mockResolvedValue(mockResult({
        content: "Plan passed after 3 revisions. The tasks are now properly scoped and include data seeding, schema changes, and API implementation with proper test coverage.",
      }));

    mockExecuteTool
      .mockResolvedValueOnce({ success: true, message: 'Evidence "buildPlan" saved.' })
      .mockResolvedValueOnce({ success: true, message: "Plan review: fail.", data: { review: { decision: "fail" } } })
      .mockResolvedValueOnce({ success: true, message: 'Evidence "buildPlan" saved.' })
      .mockResolvedValueOnce({ success: true, message: "Plan review: fail.", data: { review: { decision: "fail" } } })
      .mockResolvedValueOnce({ success: true, message: 'Evidence "buildPlan" saved.' })
      .mockResolvedValueOnce({ success: true, message: "Plan review: pass.", data: { review: { decision: "pass" } } });

    const result = await runAgenticLoop({
      ...baseParams,
      tools: [
        { name: "saveBuildEvidence", description: "Save evidence", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false },
        { name: "reviewBuildPlan", description: "Review build plan", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false },
      ],
      toolsForProvider: [
        { type: "function", function: { name: "saveBuildEvidence", description: "Save evidence", parameters: {} } },
        { type: "function", function: { name: "reviewBuildPlan", description: "Review build plan", parameters: {} } },
      ],
    });

    // User-facing message must NOT leak tool names or counts (rule #5).
    expect(result.content).not.toContain("saveBuildEvidence");
    expect(result.content).not.toMatch(/\d times with the same arguments/);
    // It must still tell the user a stop happened and point them at the build details.
    expect(result.content.toLowerCase()).toContain("got stuck");
    expect(result.content).toMatch(/build's details panel|build details/i);
    expect(mockExecuteTool).toHaveBeenCalledTimes(6);
  });

  it("does not treat scoped search_sandbox calls as repetition when glob changes", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    const mockExecuteTool = vi.mocked(executeTool);

    for (let idx = 0; idx < 7; idx++) {
      mockRoute.mockResolvedValueOnce(mockResult({
        content: `Searching complaint scope ${idx}.`,
        toolCalls: [
          {
            id: `toolu_search_${idx}`,
            name: "search_sandbox",
            arguments: { pattern: "complaint", glob: `apps/web/scope-${idx}/**/*`, maxResults: 20 },
          },
        ],
      }));
    }

    mockRoute.mockResolvedValueOnce(mockResult({
      content:
        "Completed complaint schema research across multiple codebase scopes and confirmed the implementation boundaries for schema, API, and UI wiring without repeating the same discovery calls. I mapped where Prisma models belong, identified the API route conventions for intake and triage, and captured the UI handoff points needed to replace placeholder state with persisted complaint workflow data end to end.",
    }));

    for (let idx = 0; idx < 7; idx++) {
      mockExecuteTool.mockResolvedValueOnce({ success: true, message: `Search results scope ${idx}` });
    }

    const result = await runAgenticLoop({
      ...baseParams,
      tools: [
        { name: "search_sandbox", description: "Search sandbox", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false },
      ],
      toolsForProvider: [
        { type: "function", function: { name: "search_sandbox", description: "Search sandbox", parameters: {} } },
      ],
    });

    expect(result.content).toContain("Completed complaint schema research across multiple codebase scopes");
    expect(result.executedTools).toHaveLength(7);
    expect(mockRoute).toHaveBeenCalledTimes(8);
  });

  it("nudges status-only build updates to continue implementation", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    const mockExecuteTool = vi.mocked(executeTool);

    mockRoute
      .mockResolvedValueOnce(mockResult({
        content: "Inspecting schema and searching complaint references.",
        toolCalls: [
          {
            id: "toolu_01A",
            name: "search_sandbox",
            arguments: { pattern: "complaint", glob: "packages/db/prisma/schema.prisma", maxResults: 20 },
          },
        ],
      }))
      .mockResolvedValueOnce(mockResult({
        content:
          "I confirmed there is no complaint model yet and the next step is defining enums and relations. Ready to proceed when you confirm.",
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Creating schema changes now.",
        toolCalls: [
          {
            id: "toolu_01B",
            name: "edit_sandbox_file",
            arguments: { path: "packages/db/prisma/schema.prisma", old_text: "model User {", new_text: "enum ComplaintStatus {\\n  open\\n}\\n\\nmodel User {" },
          },
        ],
      }))
      .mockResolvedValueOnce(mockResult({
        content:
          "Implemented the complaint schema enum scaffolding and started wiring relations. Next I can continue with API routes and verification.",
      }));

    mockExecuteTool
      .mockResolvedValueOnce({ success: true, message: "Search results for complaint" })
      .mockResolvedValueOnce({ success: true, message: "Updated schema.prisma" });

    const result = await runAgenticLoop({
      ...baseParams,
      routeContext: "/build",
      tools: [
        { name: "search_sandbox", description: "Search sandbox", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false },
        { name: "edit_sandbox_file", description: "Edit sandbox file", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false },
      ],
      toolsForProvider: [
        { type: "function", function: { name: "search_sandbox", description: "Search sandbox", parameters: {} } },
        { type: "function", function: { name: "edit_sandbox_file", description: "Edit sandbox file", parameters: {} } },
      ],
    });

    expect(result.executedTools).toHaveLength(2);
    expect(result.content).toContain("Implemented the complaint schema enum scaffolding");
    const thirdCallMessages = mockRoute.mock.calls[2]?.[0] ?? [];
    const lastUserMessage = [...thirdCallMessages].reverse().find((m: any) => m.role === "user");
    expect(lastUserMessage?.content).toContain("Do not pause with status-only updates");
  });

  it("does not allow plan-ready claims after read-only tool use without build-plan persistence", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    const mockExecuteTool = vi.mocked(executeTool);

    // First dispatch does a read-only tool call; every subsequent dispatch
    // repeats the same fabricated "Plan ready" claim. A build route now retries
    // fabrication up to 3 times (maxFabricationRetries = isBuildRoute ? 3 : 1,
    // BI-PIR-cc091267), so the default keeps the result defined across all
    // retry dispatches before the guard emits its final message.
    mockRoute
      .mockResolvedValueOnce(mockResult({
        content: "Checking the existing Build Studio workflow files.",
        toolCalls: [{ id: "toolu_read_1", name: "search_project_files", arguments: { query: "BuildStudio workflow actions" } }],
      }))
      .mockResolvedValue(mockResult({
        content: "Plan ready — 5 tasks across 4 files, and Start Implementation is the correct next approval in the product UI.",
      }));

    mockExecuteTool.mockResolvedValueOnce({ success: true, message: "Found Build Studio workflow files." });

    // A real /build session exposes the authoritative build tools — the
    // scenario is "the plan wasn't persisted via saveBuildEvidence", so those
    // tools must be present for the read-only-claim to count as fabrication.
    const result = await runAgenticLoop({
      ...baseParams,
      tools: [
        ...baseParams.tools,
        { name: "saveBuildEvidence", description: "Save evidence", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false, buildPhases: ["plan"] as const },
        { name: "reviewBuildPlan", description: "Review plan", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false, buildPhases: ["plan"] as const },
      ],
    });

    expect(result.content).not.toContain("Plan ready");
    expect(mockExecuteTool).toHaveBeenCalledTimes(1);
  });

  it("uses a plan-specific recovery nudge when the model claims Start Implementation is next without saving build evidence", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    const mockExecuteTool = vi.mocked(executeTool);

    const buildPlan = {
      fileStructure: [
        { path: "apps/web/components/build/BuildStudio.tsx", action: "modify", purpose: "Fix header overlap" },
      ],
      tasks: [
        { title: "Stabilize build studio header layout", testFirst: "render workflow at constrained height", implement: "adjust layout containers", verify: "pnpm --filter web typecheck" },
      ],
    };

    mockRoute
      .mockResolvedValueOnce(mockResult({
        content: "Plan ready — 5 tasks across 4 files. Building now.",
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Saving the implementation plan now.",
        toolCalls: [{ id: "toolu_plan_1", name: "saveBuildEvidence", arguments: { field: "buildPlan", value: buildPlan } }],
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Reviewing the implementation plan now.",
        toolCalls: [{ id: "toolu_plan_2", name: "reviewBuildPlan", arguments: {} }],
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Plan ready — 1 task across 1 file, and Start Implementation is the correct next approval in the product UI. I saved the implementation plan, completed the review, and confirmed the scoped header-overlap fix is ready for sandbox execution.",
      }));

    mockExecuteTool
      .mockResolvedValueOnce({ success: true, message: 'Evidence "buildPlan" saved.' })
      .mockResolvedValueOnce({ success: true, message: "Plan review: pass.", data: { review: { decision: "pass" } } });

    const result = await runAgenticLoop({
      ...baseParams,
      tools: [
        { name: "saveBuildEvidence", description: "Save evidence", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false },
        { name: "reviewBuildPlan", description: "Review build plan", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false },
      ],
      toolsForProvider: [
        { type: "function", function: { name: "saveBuildEvidence", description: "Save evidence", parameters: {} } },
        { type: "function", function: { name: "reviewBuildPlan", description: "Review build plan", parameters: {} } },
      ],
    });

    expect(result.content).toContain("Start Implementation is the correct next approval");
    expect(mockExecuteTool).toHaveBeenCalledTimes(2);
    const secondCallMessages = mockRoute.mock.calls[1]?.[0] ?? [];
    const lastUserMessage = [...secondCallMessages].reverse().find((m: any) => m.role === "user");
    expect(lastUserMessage?.content).toContain('saveBuildEvidence with field "buildPlan"');
    expect(lastUserMessage?.content).toContain("reviewBuildPlan");
  });

  it("blocks a repeated fabricated plan-ready reply instead of surfacing it to the user", async () => {
    const mockRoute = vi.mocked(routeAndCall);

    // Every dispatch repeats the fabricated claim. A build route retries
    // fabrication up to 3 times (BI-PIR-cc091267); the default keeps the result
    // defined across all retries until the guard blocks and emits its message.
    mockRoute.mockResolvedValue(mockResult({
      content: "Plan ready — 5 tasks across 4 files. Building now.",
    }));

    const result = await runAgenticLoop({
      ...baseParams,
      tools: [
        { name: "saveBuildEvidence", description: "Save evidence", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false },
        { name: "reviewBuildPlan", description: "Review build plan", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false },
      ],
      toolsForProvider: [
        { type: "function", function: { name: "saveBuildEvidence", description: "Save evidence", parameters: {} } },
        { type: "function", function: { name: "reviewBuildPlan", description: "Review build plan", parameters: {} } },
      ],
    });

    expect(result.content).not.toContain("Plan ready");
    // User-facing message must NOT leak tool / schema names (rule #5).
    expect(result.content).not.toContain("saveBuildEvidence");
    expect(result.content).not.toContain("reviewBuildPlan");
    expect(result.content).not.toContain("buildPlan");
    // G2 (2026-05-23): must NOT use meta-self-talk language ("I caught myself")
    // and must NOT promise re-routing that the loop never actually performs.
    expect(result.content.toLowerCase()).not.toContain("caught myself");
    expect(result.content.toLowerCase()).not.toContain("route through a different");
    // It must explain what happened in plain language and offer a next move.
    expect(result.content.toLowerCase()).toMatch(/plan.*(wasn't|was not).*recorded|plan.*saved/);
    expect(result.content.toLowerCase()).toContain("build details");
  });

  it("nudges build agent to use fallback steps after failed read stalls", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    const mockExecuteTool = vi.mocked(executeTool);

    mockRoute
      .mockResolvedValueOnce(mockResult({
        content: "Trying to read Prisma schema.",
        toolCalls: [
          {
            id: "toolu_02A",
            name: "run_sandbox_command",
            arguments: { command: "cat /workspace/packages/db/prisma/schema.prisma" },
          },
        ],
      }))
      .mockResolvedValueOnce(mockResult({
        content:
          "I inspected the API folder layout and tried reading the Prisma schema to confirm complaint model updates, but the file read command kept failing, so I'll pause there. Next I'll reattempt schema access.",
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Applying schema scaffolding now.",
        toolCalls: [
          {
            id: "toolu_02B",
            name: "edit_sandbox_file",
            arguments: {
              path: "packages/db/prisma/schema.prisma",
              old_text: "model User {",
              new_text: "enum ComplaintSeverity {\\n  low\\n  medium\\n  high\\n}\\n\\nmodel User {",
            },
          },
        ],
      }))
      .mockResolvedValueOnce(mockResult({
        content:
          "Added initial complaint severity enum scaffolding and resumed implementation with concrete schema updates instead of pausing on read retries.",
      }));

    mockExecuteTool
      .mockResolvedValueOnce({ success: false, message: "Could not read schema.prisma", error: "File not found: packages/db/prisma/schema.prisma" })
      .mockResolvedValueOnce({ success: true, message: "Updated schema.prisma" });

    const result = await runAgenticLoop({
      ...baseParams,
      routeContext: "/build",
      tools: [
        { name: "run_sandbox_command", description: "Run sandbox command", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false },
        { name: "edit_sandbox_file", description: "Edit sandbox file", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false },
      ],
      toolsForProvider: [
        { type: "function", function: { name: "run_sandbox_command", description: "Run sandbox command", parameters: {} } },
        { type: "function", function: { name: "edit_sandbox_file", description: "Edit sandbox file", parameters: {} } },
      ],
    });

    expect(result.executedTools).toHaveLength(2);
    expect(result.content).toContain("Added initial complaint severity enum scaffolding");
    const thirdCallMessages = mockRoute.mock.calls[2]?.[0] ?? [];
    // The stall nudge must reach the model. It is no longer guaranteed to be the
    // LAST user message: BI-56804810 routes session tool-notes into a message at
    // the tail (a failed run_sandbox_command yields such a note here), so assert
    // the nudge is present among the delivered user messages rather than last.
    const userMessages = thirdCallMessages.filter((m: any) => m.role === "user");
    expect(userMessages.some((m: any) => typeof m.content === "string" && m.content.includes("Do not pause after a failed read"))).toBe(true);
  });

  // ─── Infra-aware fabrication guard (routing-resilience Slice D) ───────────
  // An infrastructure failover (preferred provider failed, a backup answered)
  // must NOT be reported to the user as model fabrication ("the underlying work
  // wasn't recorded"). This is the 2026-06-02 incident. detectFabrication stays
  // strict for healthy-provider false claims.
  // Tools that make a completion-claim "fabrication" (need an authoritative,
  // side-effecting tool available, else the claim is ordinary advice).
  const authoritativeTools = {
    tools: [
      { name: "update_estate_posture", description: "Update estate posture", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: true },
    ],
    toolsForProvider: [
      { type: "function", function: { name: "update_estate_posture", description: "Update estate posture", parameters: {} } },
    ],
  };

  it("keeps the backup's answer on a downgraded conversational turn (does NOT show fabrication copy)", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    // Single downgraded response that trips the completion-claim guard.
    mockRoute.mockResolvedValueOnce(mockResult({
      content: "I've completed the analysis and configured the estate posture summary for you.",
      downgraded: true,
      downgradeMessage: "Switched to Claude after the preferred endpoint was unavailable.",
    }));

    const result = await runAgenticLoop({
      ...baseParams,
      routeContext: "/platform/estate", // NOT a /build route
      ...authoritativeTools,
    });

    // The real answer is preserved; the build-recording failure copy is gone.
    expect(result.content).toContain("completed the analysis");
    expect(result.content.toLowerCase()).not.toContain("wasn't recorded");
    expect(result.content.toLowerCase()).not.toContain("was not recorded");
    expect(result.downgraded).toBe(true);
  });

  it("uses honest infra copy (not fabrication copy) for a downgraded build-route claim", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    // Every dispatch repeats the fabricated build claim → build-route retries
    // exhausted (maxFabricationRetries = 3, BI-PIR-cc091267) → final emission.
    mockRoute.mockResolvedValue(mockResult({
      content: "Built and deployed the feature — implementation completed.",
      downgraded: true,
      downgradeMessage: "Switched to Claude after the preferred endpoint was unavailable.",
    }));

    const result = await runAgenticLoop({
      ...baseParams,
      routeContext: "/build",
      ...authoritativeTools,
    });

    // Honest infrastructure attribution, NOT "the underlying work wasn't recorded".
    expect(result.content.toLowerCase()).not.toContain("wasn't recorded");
    expect(result.content.toLowerCase()).toMatch(/unavailable|backup/);
    // Must not leak internals (IDENTITY_BLOCK rule #5).
    expect(result.content).not.toContain("update_estate_posture");
  });

  it("STILL fires the fabrication guard on a healthy (non-downgraded) false claim", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    // Healthy provider, every dispatch repeats the fabricated claim → build-route
    // retries exhausted (maxFabricationRetries = 3, BI-PIR-cc091267) → fabrication
    // copy must win.
    mockRoute.mockResolvedValue(mockResult({
      content: "Built and deployed the feature — implementation completed.",
      downgraded: false,
    }));

    const result = await runAgenticLoop({
      ...baseParams,
      routeContext: "/build",
      ...authoritativeTools,
    });

    // The original guard is unchanged for healthy providers.
    expect(result.content).not.toContain("deployed the feature");
    expect(result.content.toLowerCase()).toContain("wasn't recorded");
  });

  // ─── Conversational-route fabrication: keep the advice, don't nuke it ──────
  // The fabrication guard exists to stop a BUILD agent from falsely claiming it
  // shipped code. On an advisory chat (the marketing strategist is the one
  // advise-mode route that still carries authoritative artifact tools) the same
  // signal fires on genuinely useful advice that merely forgot to persist.
  // Replacing it with build copy ("open the build details") is the bug the user
  // reported. These cases lock in: keep the advice, use domain-appropriate
  // copy, and correct only a hard, unbacked completion claim.
  const marketingTools = {
    tools: [
      { name: "save_marketing_review", description: "Save a marketing recommendation", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: true, coworkerArtifact: true },
    ],
    toolsForProvider: [
      { type: "function", function: { name: "save_marketing_review", description: "Save a marketing recommendation", parameters: {} } },
    ],
  };

  it("keeps marketing advice (narration, no tool call) instead of showing build copy", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    // Every dispatch narrates intent without calling the persist tool.
    mockRoute.mockResolvedValue(mockResult({
      content: "Here's your owner-operator segment profile: trades owners on Facebook groups. Let me create the campaign brief for you now.",
      downgraded: false,
    }));

    const result = await runAgenticLoop({
      ...baseParams,
      routeContext: "/customer/marketing",
      agentId: "marketing-specialist",
      ...marketingTools,
    });

    // Advice is preserved; build copy is gone.
    expect(result.content).toContain("owner-operator segment profile");
    expect(result.content.toLowerCase()).not.toContain("wasn't recorded");
    expect(result.content.toLowerCase()).not.toContain("build details");
    // Plain narration (no hard completion claim) gets no correction note.
    expect(result.content).not.toContain("haven't saved this to your marketing workspace");
  });

  it("keeps marketing advice but appends an honest note on a hard, unbacked completion claim", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    mockRoute.mockResolvedValue(mockResult({
      content: "Done — I've saved your campaign brief and it's now in your approval queue.",
      downgraded: false,
    }));

    const result = await runAgenticLoop({
      ...baseParams,
      routeContext: "/customer/marketing",
      agentId: "marketing-specialist",
      ...marketingTools,
    });

    // The model's text is kept...
    expect(result.content).toContain("campaign brief");
    // ...with an honest correction so the user is not misled, and NO build copy.
    expect(result.content).toContain("haven't saved this to your marketing workspace");
    expect(result.content.toLowerCase()).not.toContain("build details");
  });

  it("nudges the marketing coworker to persist (domain copy, not build/code copy)", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    mockRoute.mockResolvedValue(mockResult({
      content: "Let me create the campaign brief for you now.",
      downgraded: false,
    }));

    await runAgenticLoop({
      ...baseParams,
      routeContext: "/customer/marketing",
      agentId: "marketing-specialist",
      ...marketingTools,
    });

    // Second dispatch carries the recovery nudge as the last user message.
    const secondCallMessages = mockRoute.mock.calls[1]?.[0] ?? [];
    const lastUserMessage = [...secondCallMessages].reverse().find((m: any) => m.role === "user");
    expect(lastUserMessage?.content).toContain("save_marketing_review");
    expect(lastUserMessage?.content).not.toContain("Do NOT show code");
  });
});

describe("buildUnsavedAdviceNote", () => {
  it("uses marketing-specific copy on the marketing route", () => {
    const note = buildUnsavedAdviceNote("/customer/marketing");
    expect(note).toContain("marketing workspace");
    expect(note.toLowerCase()).not.toContain("build details");
  });

  it("uses generic workspace copy off the marketing route and never mentions builds", () => {
    const note = buildUnsavedAdviceNote("/platform/estate");
    expect(note.toLowerCase()).not.toContain("build details");
    expect(note.toLowerCase()).toContain("workspace");
  });
});

describe("HARD_COMPLETION_CLAIM_PATTERN", () => {
  it("matches first-person persistence/publish claims that would mislead", () => {
    for (const claim of [
      "I've saved your campaign brief.",
      "Done — I saved that for you.",
      "Your post is now live on LinkedIn.",
      "I've added it to your approval queue.",
      "The email has been sent.",
      "It's now in your approval queue.",
    ]) {
      expect(HARD_COMPLETION_CLAIM_PATTERN.test(claim)).toBe(true);
    }
  });

  it("does not match intent/narration or plain advice", () => {
    for (const text of [
      "Let me draft the campaign brief for you now.",
      "Here's your owner-operator segment profile.",
      "I'll create the campaign brief next.",
      "I recommend a weekly LinkedIn cadence targeting trades owners.",
    ]) {
      expect(HARD_COMPLETION_CLAIM_PATTERN.test(text)).toBe(false);
    }
  });
});

// ─── Build-specialist Operator Contract platform guards ────────────────────
// Spec: docs/superpowers/specs/2026-04-30-build-specialist-operator-contract.md §2.6

describe("detectToolRefusedDespiteAvailability (clause 2.6)", () => {
  const tools = [{ name: "start_ideate_research" }, { name: "saveBuildEvidence" }];

  it("returns the tool name when response asserts unavailability of a delivered tool", () => {
    const out = detectToolRefusedDespiteAvailability(
      "Blocker: start_ideate_research is not available in the current runtime.",
      tools,
    );
    expect(out).toBe("start_ideate_research");
  });

  it("returns null when response does not assert unavailability", () => {
    const out = detectToolRefusedDespiteAvailability("I'll call start_ideate_research now.", tools);
    expect(out).toBeNull();
  });

  it("returns null when the named tool is not in the delivered list", () => {
    const out = detectToolRefusedDespiteAvailability(
      "I cannot call do_something_else because it's not available.",
      tools,
    );
    expect(out).toBeNull();
  });

  it("matches alternate phrasings", () => {
    expect(
      detectToolRefusedDespiteAvailability("saveBuildEvidence isn't enabled yet — pending grants.", tools),
    ).toBe("saveBuildEvidence");
  });

  it("returns the unspecified sentinel for generic 'currently []' refusals", () => {
    const out = detectToolRefusedDespiteAvailability(
      "The tool grants are currently `[]` for this persona.",
      tools,
    );
    expect(out).not.toBeNull();
    expect(out).toContain("unspecified");
  });
});

describe("phaseRequiresToolCall (clause 2.2)", () => {
  it("returns true for ideate/plan/build/review", () => {
    expect(phaseRequiresToolCall("ideate")).toBe(true);
    expect(phaseRequiresToolCall("plan")).toBe(true);
    expect(phaseRequiresToolCall("build")).toBe(true);
    expect(phaseRequiresToolCall("review")).toBe(true);
  });

  it("returns false for ship/complete/null/undefined", () => {
    expect(phaseRequiresToolCall("ship")).toBe(false);
    expect(phaseRequiresToolCall("complete")).toBe(false);
    expect(phaseRequiresToolCall(null)).toBe(false);
    expect(phaseRequiresToolCall(undefined)).toBe(false);
  });
});

describe("detectUnsavedEvidence (clause 2.4)", () => {
  it("flags ideate response that contains a design-doc structure but no saveBuildEvidence call", () => {
    const out = detectUnsavedEvidence(
      "Here's the design doc:\n\n## Approach\nReplace gray classes with var(--dpf-*) tokens.",
      [],
      "ideate",
    );
    expect(out).toBe("designDoc");
  });

  it("returns null when saveBuildEvidence(designDoc) was called", () => {
    const out = detectUnsavedEvidence(
      "Saved the design doc.",
      [{ name: "saveBuildEvidence", args: { field: "designDoc", value: {} } }],
      "ideate",
    );
    expect(out).toBeNull();
  });

  it("flags plan response with task list but no saved buildPlan", () => {
    const out = detectUnsavedEvidence(
      "Here is the implementation plan with tasks: 1) ... 2) ...",
      [],
      "plan",
    );
    expect(out).toBe("buildPlan");
  });

  it("flags review response with verification verdict but no saved verificationOut", () => {
    const out = detectUnsavedEvidence(
      "Typecheck passed and tests passed; verification complete.",
      [],
      "review",
    );
    expect(out).toBe("verificationOut");
  });

  it("returns null when phase is not ideate/plan/review", () => {
    expect(detectUnsavedEvidence("design doc", [], "build")).toBeNull();
    expect(detectUnsavedEvidence("design doc", [], null)).toBeNull();
  });
});

// ── interactionMode gate over Operator Contract platform guards ──
//
// Phase J finding: chat-mode coworker replies that mention plan-phase
// keywords ("yes do the truck list first") were triggering the unsaved-
// evidence guard and writing phantom PlatformIssueReport rows. The
// guards belong on autonomous phase execution (build-orchestrator,
// pipeline) but not on a real user asking the build coworker a
// conversational question.
//
// These tests pin the contract:
//   - interactionMode default "autonomous" preserves prior behavior
//     (guard fires on conversational-shaped text during plan phase)
//   - interactionMode "chat" suppresses ALL three guards so the chat
//     surface stops generating false-positive issue reports.
describe("runAgenticLoop interactionMode gate (Phase J)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.agentModelConfig.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.toolExecution.create).mockResolvedValue({} as never);
    vi.mocked(prisma.platformIssueReport.create).mockResolvedValue({} as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isSuperuser: true,
      groups: [{ platformRole: { roleId: "ceo" } }],
    } as never);
  });

  const planPhaseConversationalParams = {
    chatHistory: [
      { role: "user" as const, content: "yes do the truck list first" },
    ],
    systemPrompt: "You are a helpful assistant.",
    sensitivity: "internal" as const,
    tools: [
      {
        name: "saveBuildEvidence",
        description: "Save",
        inputSchema: {},
        requiredCapability: null,
        executionMode: "immediate" as const,
        sideEffect: true,
      },
    ],
    toolsForProvider: [
      {
        type: "function",
        function: { name: "saveBuildEvidence", description: "Save", parameters: {} },
      },
    ],
    userId: "user-1",
    routeContext: "/build",
    agentId: "software-engineer",
    threadId: "thread-1",
    buildPhase: "plan" as const,
    featureBuildId: "fb-internal-id",
  };

  // The agent's reply is a conversational Dale-answer that mentions
  // "tasks" and "build plan" — enough to trip detectUnsavedEvidence's
  // plan-phase regex. The first call returns the reply; the second/third
  // return short status responses so the loop terminates without nudging
  // forever.
  function setupConversationalReply() {
    const mockRoute = vi.mocked(routeAndCall);
    mockRoute
      .mockResolvedValueOnce(
        mockResult({
          content:
            "Got it. I'd recommend a smaller first slice: just the truck list with tasks: 1) show trucks, 2) attach techs. Parts can come in a follow-on build plan.",
        }),
      )
      .mockResolvedValueOnce(
        mockResult({
          content:
            "Confirmed: the smaller scope is captured and the follow-on is documented.",
        }),
      )
      .mockResolvedValueOnce(
        mockResult({
          content:
            "Confirmed: the smaller scope is captured and the follow-on is documented for the next pass.",
        }),
      );
  }

  it("writes a PlatformIssueReport in autonomous mode (default) for plan-phase conversational reply", async () => {
    setupConversationalReply();
    await runAgenticLoop(planPhaseConversationalParams);

    const createCalls = vi.mocked(prisma.platformIssueReport.create).mock.calls;
    const unsavedEvidenceCall = createCalls.find((c) =>
      String((c[0] as any)?.data?.title ?? "").includes("unsaved-evidence"),
    );
    expect(unsavedEvidenceCall).toBeDefined();
  });

  it('skips the unsaved-evidence guard when interactionMode is "chat"', async () => {
    setupConversationalReply();
    await runAgenticLoop({
      ...planPhaseConversationalParams,
      interactionMode: "chat",
    });

    const createCalls = vi.mocked(prisma.platformIssueReport.create).mock.calls;
    const unsavedEvidenceCall = createCalls.find((c) =>
      String((c[0] as any)?.data?.title ?? "").includes("unsaved-evidence"),
    );
    expect(unsavedEvidenceCall).toBeUndefined();
  });

  it('also skips the zero-tool-call guard when interactionMode is "chat"', async () => {
    setupConversationalReply();
    await runAgenticLoop({
      ...planPhaseConversationalParams,
      interactionMode: "chat",
    });

    const createCalls = vi.mocked(prisma.platformIssueReport.create).mock.calls;
    const zeroToolCall = createCalls.find((c) =>
      String((c[0] as any)?.data?.title ?? "").includes("zero-tool-call"),
    );
    expect(zeroToolCall).toBeUndefined();
  });
});

// BI-2AC48661 — persistent ExecutionPlan in the agentic loop.
describe("runAgenticLoop — execution plan", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.agentModelConfig.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.toolExecution.create).mockResolvedValue({} as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isSuperuser: true,
      groups: [{ platformRole: { roleId: "ceo" } }],
    } as never);
    vi.mocked(governedExecuteTool).mockImplementation(async (args: any) =>
      executeTool(args.toolName, args.rawParams, args.userId, args.context as any) as any,
    );
  });

  const planParams = {
    chatHistory: [{ role: "user" as const, content: "do a multi-step task" }],
    systemPrompt: "You are a helpful assistant.",
    sensitivity: "internal" as const,
    // No sideEffect/build tools → fabrication detection won't fire on text-only.
    tools: [{ name: "search_project_files", description: "Search", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false }],
    toolsForProvider: [{ type: "function", function: { name: "search_project_files", description: "Search", parameters: {} } }],
    userId: "user-1",
    routeContext: "/work",
    agentId: "software-engineer",
    threadId: "thread-plan",
  };

  it("exposes no plan tools and carries no plan when enableExecutionPlan is off", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    mockRoute.mockResolvedValueOnce(mockResult({ content: "Hi there, how can I help?", providerId: "anthropic-sub" }) as never);

    const result = await runAgenticLoop({ ...planParams });

    expect(result.content).toBe("Hi there, how can I help?");
    expect(result.executionPlan ?? null).toBeNull();
    // The provider tool list passed to routeAndCall has only the base tool.
    const optsArg = mockRoute.mock.calls[0]![3] as { tools?: Array<{ function?: { name?: string } }> };
    const names = (optsArg.tools ?? []).map((t) => t.function?.name);
    expect(names).toEqual(["search_project_files"]);
  });

  it("exposes the plan tools to the model when enabled", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    // Reply ends in "?" → treated as a clarifying question, so the loop accepts
    // it without nudging and we get a single deterministic dispatch to inspect.
    mockRoute.mockResolvedValueOnce(mockResult({ content: "What would you like me to tackle first?", providerId: "anthropic-sub" }) as never);

    await runAgenticLoop({ ...planParams, enableExecutionPlan: true });

    const optsArg = mockRoute.mock.calls[0]![3] as { tools?: Array<{ function?: { name?: string } }> };
    const names = (optsArg.tools ?? []).map((t) => t.function?.name);
    expect(names).toContain("record_execution_plan");
    expect(names).toContain("update_execution_plan_step");
  });

  it("intercepts plan tools (never dispatches them) and returns the final plan", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    mockRoute
      .mockResolvedValueOnce(mockResult({
        content: "",
        toolCalls: [{ id: "t1", name: "record_execution_plan", arguments: { goal: "g", steps: ["a", "b"] } }],
      }) as never)
      .mockResolvedValueOnce(mockResult({
        content: "",
        toolCalls: [
          { id: "t2", name: "update_execution_plan_step", arguments: { stepId: "s1", status: "done" } },
          { id: "t3", name: "update_execution_plan_step", arguments: { stepId: "s2", status: "done" } },
        ],
      }) as never)
      .mockResolvedValueOnce(mockResult({ content: "Everything is wrapped up." }) as never);

    const result = await runAgenticLoop({ ...planParams, enableExecutionPlan: true });

    // Plan tools are loop-intrinsic — governedExecuteTool is never called for them.
    const dispatched = vi.mocked(governedExecuteTool).mock.calls.map((c: any) => c[0].toolName);
    expect(dispatched).not.toContain("record_execution_plan");
    expect(dispatched).not.toContain("update_execution_plan_step");

    expect(result.content).toBe("Everything is wrapped up.");
    expect(result.executionPlan?.steps.map((s) => s.status)).toEqual(["done", "done"]);
  });

  it("bounces a premature text-only stop while plan steps remain open", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    mockRoute
      .mockResolvedValueOnce(mockResult({
        content: "",
        toolCalls: [{ id: "t1", name: "record_execution_plan", arguments: { goal: "g", steps: ["a", "b"] } }],
      }) as never)
      // Premature stop at iteration 1 — plan still has open steps → gate nudges.
      .mockResolvedValueOnce(mockResult({ content: "Standing by." }) as never)
      .mockResolvedValueOnce(mockResult({
        content: "",
        toolCalls: [
          { id: "t2", name: "update_execution_plan_step", arguments: { stepId: "s1", status: "done" } },
          { id: "t3", name: "update_execution_plan_step", arguments: { stepId: "s2", status: "skipped" } },
        ],
      }) as never)
      .mockResolvedValueOnce(mockResult({ content: "All wrapped up now." }) as never);

    const result = await runAgenticLoop({ ...planParams, enableExecutionPlan: true });

    // The premature stop forced an extra dispatch (4 total, not 2).
    expect(mockRoute.mock.calls.length).toBe(4);
    expect(result.content).toBe("All wrapped up now.");
    expect(result.executionPlan && (result.executionPlan.steps.every((s) => s.status === "done" || s.status === "skipped"))).toBe(true);
  });

  it("streams plan:update events as the plan is recorded and steps progress (BI-95C0835E)", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    mockRoute
      .mockResolvedValueOnce(mockResult({
        content: "",
        toolCalls: [{ id: "t1", name: "record_execution_plan", arguments: { goal: "ship it", steps: ["a", "b"] } }],
      }) as never)
      .mockResolvedValueOnce(mockResult({
        content: "",
        toolCalls: [{ id: "t2", name: "update_execution_plan_step", arguments: { stepId: "s1", status: "done" } }],
      }) as never)
      .mockResolvedValueOnce(mockResult({
        content: "",
        toolCalls: [{ id: "t3", name: "update_execution_plan_step", arguments: { stepId: "s2", status: "done" } }],
      }) as never)
      .mockResolvedValueOnce(mockResult({ content: "Done." }) as never);

    const events: Array<{ type: string; done?: number; total?: number }> = [];
    await runAgenticLoop({
      ...planParams,
      enableExecutionPlan: true,
      onProgress: (e) => events.push(e as { type: string; done?: number; total?: number }),
    });

    const planEvents = events.filter((e) => e.type === "plan:update") as Array<{ done: number; total: number }>;
    // One on record, one per step update = 3 total, with monotonic progress.
    expect(planEvents.map((e) => `${e.done}/${e.total}`)).toEqual(["0/2", "1/2", "2/2"]);
  });
});
