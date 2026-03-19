import { describe, it, expect } from "vitest";
import { extractAnthropicToolCalls, extractOpenAIToolCalls } from "./ai-inference";

describe("extractToolCalls", () => {
  describe("Anthropic format", () => {
    it("preserves tool_use block IDs", () => {
      const contentBlocks = [
        { type: "text", text: "Searching..." },
        { type: "tool_use", id: "toolu_01A09q90qw90", name: "search_project_files", input: { query: "agent" } },
        { type: "tool_use", id: "toolu_01B99x88yy88", name: "read_project_file", input: { path: "lib/foo.ts" } },
      ];
      const result = extractAnthropicToolCalls(contentBlocks);
      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe("toolu_01A09q90qw90");
      expect(result[0]!.name).toBe("search_project_files");
      expect(result[1]!.id).toBe("toolu_01B99x88yy88");
    });

    it("generates synthetic IDs when missing", () => {
      const contentBlocks = [
        { type: "tool_use", name: "search", input: {} },
      ];
      const result = extractAnthropicToolCalls(contentBlocks);
      expect(result[0]!.id).toMatch(/^synth_/);
    });
  });

  describe("OpenAI-compatible format", () => {
    it("preserves tool_call IDs", () => {
      const toolCalls = [
        { id: "call_abc123", type: "function", function: { name: "search_project_files", arguments: '{"query":"agent"}' } },
      ];
      const result = extractOpenAIToolCalls(toolCalls);
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("call_abc123");
      expect(result[0]!.name).toBe("search_project_files");
      expect(result[0]!.arguments).toEqual({ query: "agent" });
    });

    it("generates synthetic IDs when missing", () => {
      const toolCalls = [
        { function: { name: "search", arguments: '{}' } },
      ];
      const result = extractOpenAIToolCalls(toolCalls);
      expect(result[0]!.id).toMatch(/^synth_/);
    });
  });
});
