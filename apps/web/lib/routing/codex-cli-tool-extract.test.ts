import { describe, it, expect } from "vitest";
import { extractToolCalls } from "./codex-cli-adapter";

describe("codex-cli-adapter extractToolCalls — variant handling", () => {
  it("parses the canonical tool_use shape", () => {
    const text = `{"type":"tool_use","id":"call_1","name":"start_scout_research","input":{"externalUrls":["https://ascensionpm.com/"]}}`;
    const calls = extractToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      id: "call_1",
      name: "start_scout_research",
      arguments: { externalUrls: ["https://ascensionpm.com/"] },
    });
  });

  it("parses XML-ish <tool_use> wrapped JSON with {tool, arguments} keys", () => {
    // This is the exact variant codex gpt-5.4 emitted during P2 Build Studio
    // e2e that silently failed before this parser was broadened.
    const text = `Some preamble.
<tool_use>
{"tool":"start_scout_research","arguments":{"externalUrls":["https://ascensionpm.com/"]}}
</tool_use>
Trailing chatter.`;
    const calls = extractToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      name: "start_scout_research",
      arguments: { externalUrls: ["https://ascensionpm.com/"] },
    });
  });

  it("parses markdown-fenced json block", () => {
    const text = "Explanation.\n```json\n{\"name\":\"read_project_file\",\"input\":{\"path\":\"apps/web/lib/mcp-tools.ts\"}}\n```";
    const calls = extractToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      name: "read_project_file",
      arguments: { path: "apps/web/lib/mcp-tools.ts" },
    });
  });

  it("parses multiple tool_use blocks and deduplicates by id+name", () => {
    const text = `
<tool_use>{"type":"tool_use","id":"c1","name":"search_project_files","input":{"query":"foo"}}</tool_use>
<tool_use>{"type":"tool_use","id":"c2","name":"read_project_file","input":{"path":"bar"}}</tool_use>
`;
    const calls = extractToolCalls(text);
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.name)).toEqual(["search_project_files", "read_project_file"]);
  });

  it("ignores text with no tool-call shape", () => {
    const text = "Just a regular answer with no JSON.";
    expect(extractToolCalls(text)).toEqual([]);
  });

  it("rejects objects with type set to something other than tool_use", () => {
    const text = `{"type":"text","name":"not_a_tool","input":{}}`;
    expect(extractToolCalls(text)).toEqual([]);
  });
});
