import { describe, it, expect } from "vitest";
import { measureToolFidelity, GOLDEN_CASES, buildToolFidelitySurface, scoreToolFidelitySelection, scoreToolFidelityExecution, type RunTurnFn } from "./tool-fidelity-harness";
import { deriveMeasuredToolCeiling } from "./tool-fidelity-policy";

describe("measureToolFidelity", () => {
  it("has a non-empty golden set covering the taxonomy", () => {
    expect(GOLDEN_CASES.length).toBeGreaterThan(0);
    expect(new Set(GOLDEN_CASES.map((c) => c.taskClass)).size).toBeGreaterThanOrEqual(3);
  });

  it("produces a fidelity curve that locates a model's cliff", async () => {
    // Fake model: selects the correct tool reliably at <=24 tools, then collapses
    // (picks nothing) above 24 — a realistic small-local-model cliff.
    const runTurn: RunTurnFn = async ({ surfaceSize, prompt }) => {
      if (surfaceSize <= 24) {
        const correct = GOLDEN_CASES.find((c) => c.prompt === prompt)!.correctToolNames[0];
        return { calledTool: correct };
      }
      return { calledTool: null };
    };
    const samples = await measureToolFidelity({ surfaceSizes: [15, 24, 32, 48], runTurn });
    expect(samples.find((s) => s.surfaceSize === 15)!.accuracy).toBe(1);
    expect(samples.find((s) => s.surfaceSize === 24)!.accuracy).toBe(1);
    expect(samples.find((s) => s.surfaceSize === 32)!.accuracy).toBe(0);
    // The derived ceiling from this curve is the cliff (24), not the window.
    expect(deriveMeasuredToolCeiling(samples, { minSampleCount: 1 })).toBe(24);
  });

  it("scores a wrong-tool selection as incorrect", async () => {
    const runTurn: RunTurnFn = async () => ({ calledTool: "some_unrelated_tool" });
    const samples = await measureToolFidelity({ surfaceSizes: [15], runTurn });
    expect(samples[0]!.accuracy).toBe(0);
  });
});

describe("question-complete authorized surfaces", () => {
  const read = (name: string) => ({ name, description: "Injected read fixture", sideEffect: false,
    requiredCapability: null, inputSchema: { type: "object", properties: {} } });
  const required = ["list_backlog_items", "get_ai_platform_posture", "resolve_model_selection", "get_build_progress_visibility"];
  const catalog = [...Array.from({ length: 48 }, (_, index) => read(`aaa_${index}`)), ...required.map(read)];
  it.each([8, 15, 24, 32, 48])("pins each question's reader at size %i without padding or rewriting", size => {
    const surface = buildToolFidelitySurface(catalog, size);
    expect(surface).toHaveLength(size);
    for (const name of required) expect(surface!.some(tool => tool.name === name)).toBe(true);
    expect(surface!.every(tool => catalog.some(original => original === tool))).toBe(true);
    expect(buildToolFidelitySurface([...catalog].reverse(), size)).toEqual(surface);
  });
  it("refuses a class-complete catalog missing the actual model resolver", () => {
    expect(buildToolFidelitySurface([...catalog.filter(tool => tool.name !== "resolve_model_selection"),
      read("get_build_engine_readiness"), read("get_self_upgrade_queue_status")], 8)).toBeNull();
  });
  it("refuses missing space, duplicate identities and non-integer surfaces", () => {
    expect(buildToolFidelitySurface(catalog, 3)).toBeNull();
    expect(buildToolFidelitySurface(catalog, 100)).toBeNull();
    expect(buildToolFidelitySurface([...catalog, read(required[0]!)], 8)).toBeNull();
    expect(buildToolFidelitySurface(catalog, 8.5)).toBeNull();
  });
  it.each([
    { sideEffect: true }, { consequence: "authority" as const }, { requiresExternalAccess: true },
    { secretResultKeys: ["secret"] },
  ])("does not substitute an unsafe expected reader: %j", unsafe => {
    expect(buildToolFidelitySurface(catalog.map(tool => tool.name === "resolve_model_selection"
      ? { ...tool, ...unsafe } : tool), 8)).toBeNull();
  });
});

const readTool = { name: "query_backlog", description: "Read backlog", requiredCapability: null,
  sideEffect: false, inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1 } },
    required: ["limit"], additionalProperties: false } };
const golden = GOLDEN_CASES[0]!;
const answer = { finishReason: "tool_calls", toolCalls: [{ name: "query_backlog", arguments: { limit: 2 } }] };

describe("per-question golden authority", () => {
  const tool = (name: string) => ({ ...readTool, name,
    inputSchema: { type: "object", properties: {} } });
  const choose = (name: string) => ({ finishReason: "tool_calls", toolCalls: [{ name, arguments: {} }] });
  it.each([3, 5])("accepts the recorded provider-state reader for health question %i", index => {
    expect(scoreToolFidelitySelection(GOLDEN_CASES[index]!, [tool("get_ai_platform_posture")],
      choose("get_ai_platform_posture")).status).toBe("passed");
  });
  it.each(["get_build_engine_readiness", "get_self_upgrade_queue_status"])(
    "does not accept %s as evidence of the next phase's selected model", name => {
      expect(scoreToolFidelitySelection(GOLDEN_CASES[4]!, [tool(name)], choose(name)).status).toBe("failed");
    });
  it("accepts the actual per-phase model resolver", () => {
    expect(scoreToolFidelitySelection(GOLDEN_CASES[4]!, [tool("resolve_model_selection")],
      choose("resolve_model_selection")).status).toBe("passed");
  });
  it("does not accept a targeted workroom detail as current-build progress", () => {
    expect(scoreToolFidelitySelection(GOLDEN_CASES[6]!, [tool("get_workroom")], choose("get_workroom")).status)
      .toBe("failed");
  });
});

describe("actual fidelity observations", () => {
  it("requires a valid actual first attached call, not prose", () => {
    expect(scoreToolFidelitySelection(golden, [readTool], answer).status).toBe("passed");
    expect(scoreToolFidelitySelection(golden, [readTool], { finishReason: "stop", content: "query_backlog" }).status).toBe("failed");
  });
  it.each([
    { finishReason: "tool_calls", toolCalls: [{ name: "query_backlog", arguments: { limit: "2" } }] },
    { finishReason: "tool_calls", toolCalls: [{ name: "query_backlog", arguments: { limit: 0 } }] },
    { finishReason: "tool_calls", toolCalls: [{ name: "query_backlog", arguments: {} }] },
    { finishReason: "tool_calls", toolCalls: [{ name: "get_backlog_item", arguments: { limit: 2 } }] },
    { finishReason: "tool_calls", toolCalls: [{ name: "unrelated", arguments: {} }, answer.toolCalls[0]] },
  ])("rejects wrong, unattached or invalid first calls", result => {
    expect(scoreToolFidelitySelection(golden, [readTool], result).status).toBe("failed");
  });
  it.each([{ ...answer, truncated: true }, { ...answer, finishReason: "length" },
    { toolCalls: answer.toolCalls }])("keeps incomplete output unverified", result => {
    expect(scoreToolFidelitySelection(golden, [readTool], result).status).toBe("incomplete");
  });
  it("does not authorize a mutating tool through a golden label", () => {
    expect(scoreToolFidelitySelection(golden, [{ ...readTool, sideEffect: true }], answer).status).toBe("failed");
  });
  it("keeps an unsupported schema constraint unverified instead of accepting a partial validator", () => {
    expect(scoreToolFidelitySelection(golden, [{ ...readTool, inputSchema: {
      ...readTool.inputSchema, if: { required: ["limit"] }, then: { properties: { limit: { minimum: 5 } } },
    } }], answer).status).toBe("incomplete");
  });

  const expected = { toolName: "query_backlog", parameters: { limit: 2 },
    userId: "u", agentId: "agent", threadId: "thread", taskRunId: null };
  const row = { ...expected, id: "exec-1", success: true, durationMs: 0, result: { success: true } };
  it("requires exact positive persisted readback and actor/parameter identity", () => {
    expect(scoreToolFidelityExecution(expected, "exec-1", row)).toBe(true);
    expect(scoreToolFidelityExecution(expected, undefined, row)).toBe(false);
    expect(scoreToolFidelityExecution(expected, "exec-1", null)).toBe(false);
  });
  it("uses the exact server-returned audit identity when metrics-only retention intentionally omits arguments", () => {
    const metrics = { ...row, auditClass: "metrics_only", parameters: {}, result: {} };
    expect(scoreToolFidelityExecution(expected, "exec-1", metrics, { success: true })).toBe(true);
    expect(scoreToolFidelityExecution(expected, "exec-1", metrics)).toBe(false);
    expect(scoreToolFidelityExecution(expected, "exec-1", { ...metrics, parameters: { limit: 3 } }, { success: true })).toBe(false);
    expect(scoreToolFidelityExecution(expected, "foreign", metrics, { success: true })).toBe(false);
    expect(scoreToolFidelityExecution(expected, "exec-1", metrics, { success: true, data: { status: "proposed" } })).toBe(false);
  });
  it.each([
    { ...row, id: "foreign" }, { ...row, userId: "other" }, { ...row, agentId: "other" },
    { ...row, threadId: "other" }, { ...row, taskRunId: "foreign-task" },
    { ...row, toolName: "get_backlog_item" }, { ...row, parameters: {} },
    { ...row, success: false }, { ...row, durationMs: null },
    { ...row, result: { success: true, data: { status: "proposed" } } },
  ])("refuses mismatched, failed, proposed or unexecuted audit evidence", evidence => {
    expect(scoreToolFidelityExecution(expected, "exec-1", evidence)).toBe(false);
  });
});
