import { describe, expect, it } from "vitest";
import { buildProviderTools } from "./provider-tools";
import { EMPTY_CAPABILITIES } from "./model-card-types";
import type { ModelCardCapabilities } from "./model-card-types";

function caps(overrides: Partial<ModelCardCapabilities> = {}): ModelCardCapabilities {
  return { ...EMPTY_CAPABILITIES, ...overrides };
}

describe("buildProviderTools", () => {
  // ── Gemini Code Execution ──
  it("Gemini + codeExecution + sync.code-gen → code_execution tool", () => {
    const tools = buildProviderTools("gemini", caps({ codeExecution: true }), "sync.code-gen");
    expect(tools).toEqual([{ code_execution: {} }]);
  });

  it("Gemini + codeExecution + wrong family → empty", () => {
    const tools = buildProviderTools("gemini", caps({ codeExecution: true }), "sync.greeting");
    expect(tools).toEqual([]);
  });

  it("Gemini + no codeExecution + sync.code-gen → empty", () => {
    const tools = buildProviderTools("gemini", caps({ codeExecution: false }), "sync.code-gen");
    expect(tools).toEqual([]);
  });

  // ── Gemini Grounding ──
  it("Gemini + webSearch + sync.web-search → google_search_retrieval tool", () => {
    const tools = buildProviderTools("gemini", caps({ webSearch: true }), "sync.web-search");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toHaveProperty("google_search_retrieval");
    expect((tools[0] as any).google_search_retrieval.dynamic_retrieval_config.mode).toBe("MODE_DYNAMIC");
  });

  it("Gemini + webSearch + wrong family → empty", () => {
    const tools = buildProviderTools("gemini", caps({ webSearch: true }), "sync.greeting");
    expect(tools).toEqual([]);
  });

  // ── Anthropic Computer Use ──
  it("Anthropic + computerUse + sync.tool-action → computer tool", () => {
    const tools = buildProviderTools("anthropic", caps({ computerUse: true }), "sync.tool-action");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      type: "computer_20241022",
      name: "computer",
      display_width_px: 1024,
      display_height_px: 768,
    });
  });

  it("anthropic- prefix + computerUse + sync.tool-action → computer tool", () => {
    const tools = buildProviderTools("anthropic-vertex", caps({ computerUse: true }), "sync.tool-action");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toHaveProperty("type", "computer_20241022");
  });

  it("Anthropic + computerUse + wrong family → empty", () => {
    const tools = buildProviderTools("anthropic", caps({ computerUse: true }), "sync.code-gen");
    expect(tools).toEqual([]);
  });

  it("Anthropic + no computerUse → empty", () => {
    const tools = buildProviderTools("anthropic", caps({ computerUse: false }), "sync.tool-action");
    expect(tools).toEqual([]);
  });

  // ── Multiple capabilities ──
  it("Gemini with both codeExecution and webSearch → only matching family", () => {
    const tools = buildProviderTools(
      "gemini",
      caps({ codeExecution: true, webSearch: true }),
      "sync.code-gen",
    );
    expect(tools).toEqual([{ code_execution: {} }]);
  });

  // ── Other providers ──
  it("OpenAI provider → empty array", () => {
    const tools = buildProviderTools("openai", caps({ codeExecution: true }), "sync.code-gen");
    expect(tools).toEqual([]);
  });

  it("Ollama provider → empty array", () => {
    const tools = buildProviderTools("ollama", caps(), "sync.code-gen");
    expect(tools).toEqual([]);
  });

  it("Unknown provider → empty array", () => {
    const tools = buildProviderTools("litellm", caps(), "sync.code-gen");
    expect(tools).toEqual([]);
  });

  // ── Null capabilities ──
  it("null codeExecution → empty", () => {
    const tools = buildProviderTools("gemini", caps({ codeExecution: null }), "sync.code-gen");
    expect(tools).toEqual([]);
  });
});
