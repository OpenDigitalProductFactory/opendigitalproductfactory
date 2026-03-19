import { describe, it, expect } from "vitest";
import {
  extractAnthropicToolCalls,
  extractOpenAIToolCalls,
  formatMessageForAnthropic,
  formatMessageForOpenAI,
} from "./ai-inference";
import type { ChatMessage } from "./ai-inference";

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

describe("formatMessagesForProvider", () => {
  describe("Anthropic", () => {
    it("formats assistant message with toolCalls as content block array", () => {
      const msg: ChatMessage = {
        role: "assistant",
        content: "Searching...",
        toolCalls: [{ id: "toolu_01A", name: "search", arguments: { q: "agent" } }],
      };
      const formatted = formatMessageForAnthropic(msg);
      expect(formatted.role).toBe("assistant");
      expect(formatted.content).toEqual([
        { type: "text", text: "Searching..." },
        { type: "tool_use", id: "toolu_01A", name: "search", input: { q: "agent" } },
      ]);
    });

    it("formats assistant with empty content and toolCalls", () => {
      const msg: ChatMessage = {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "toolu_01A", name: "search", arguments: { q: "agent" } }],
      };
      const formatted = formatMessageForAnthropic(msg);
      expect(formatted.content).toEqual([
        { type: "tool_use", id: "toolu_01A", name: "search", input: { q: "agent" } },
      ]);
    });

    it("converts tool role message to user with tool_result block", () => {
      const msg: ChatMessage = {
        role: "tool",
        content: "Found 3 files",
        toolCallId: "toolu_01A",
      };
      const formatted = formatMessageForAnthropic(msg);
      expect(formatted.role).toBe("user");
      expect(formatted.content).toEqual([
        { type: "tool_result", tool_use_id: "toolu_01A", content: "Found 3 files" },
      ]);
    });

    it("passes plain messages unchanged", () => {
      const msg: ChatMessage = { role: "user", content: "hello" };
      const formatted = formatMessageForAnthropic(msg);
      expect(formatted).toEqual({ role: "user", content: "hello" });
    });
  });

  describe("OpenAI-compatible", () => {
    it("formats assistant message with tool_calls field", () => {
      const msg: ChatMessage = {
        role: "assistant",
        content: "Searching...",
        toolCalls: [{ id: "call_abc", name: "search", arguments: { q: "agent" } }],
      };
      const formatted = formatMessageForOpenAI(msg);
      expect(formatted.role).toBe("assistant");
      expect(formatted.content).toBe("Searching...");
      expect(formatted.tool_calls).toEqual([
        { id: "call_abc", type: "function", function: { name: "search", arguments: '{"q":"agent"}' } },
      ]);
    });

    it("formats tool role message with tool_call_id", () => {
      const msg: ChatMessage = {
        role: "tool",
        content: "Found 3 files",
        toolCallId: "call_abc",
      };
      const formatted = formatMessageForOpenAI(msg);
      expect(formatted.role).toBe("tool");
      expect(formatted.tool_call_id).toBe("call_abc");
      expect(formatted.content).toBe("Found 3 files");
    });

    it("passes plain messages unchanged", () => {
      const msg: ChatMessage = { role: "user", content: "hello" };
      const formatted = formatMessageForOpenAI(msg);
      expect(formatted).toEqual({ role: "user", content: "hello" });
    });
  });
});
