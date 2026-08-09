import { describe, it, expect } from "vitest";
import {
  parseProgrammaticToolCallingConfig,
  PROGRAMMATIC_TOOL_CALLING_DEFAULTS,
  deriveReadOnlyScopes,
  wrapToolScript,
  parseToolScriptOutput,
  TOOL_SCRIPT_RESULT_MARKER,
  TOOL_SCRIPT_TOKEN_PATH,
} from "./tool-script";

describe("parseProgrammaticToolCallingConfig", () => {
  it("defaults to enabled (BI-9893614D) with safe caps when no row", () => {
    expect(parseProgrammaticToolCallingConfig(null)).toEqual(PROGRAMMATIC_TOOL_CALLING_DEFAULTS);
    // The feature is reachable by default; the per-agent tool_script_exec grant is
    // the real gate. An operator can still force it off via the PlatformConfig row.
    expect(PROGRAMMATIC_TOOL_CALLING_DEFAULTS.enabled).toBe(true);
  });

  it("lets an operator force the feature off via an explicit row", () => {
    expect(parseProgrammaticToolCallingConfig({ enabled: false }).enabled).toBe(false);
  });

  it("honors explicit enabled + caps", () => {
    const cfg = parseProgrammaticToolCallingConfig({ enabled: true, maxOutputChars: 4000, timeoutMs: 30000 });
    expect(cfg).toEqual({ enabled: true, maxOutputChars: 4000, timeoutMs: 30000 });
  });

  it("clamps absurd caps and ignores invalid types", () => {
    const cfg = parseProgrammaticToolCallingConfig({ enabled: "yes", maxOutputChars: 9_000_000, timeoutMs: -5 });
    expect(cfg.enabled).toBe(true); // non-boolean → default (now enabled)
    expect(cfg.maxOutputChars).toBe(50_000); // clamped
    expect(cfg.timeoutMs).toBe(PROGRAMMATIC_TOOL_CALLING_DEFAULTS.timeoutMs); // invalid → default
  });
});

describe("deriveReadOnlyScopes", () => {
  it("drops side-effecting grants, keeps read grants, adds backlog_read, sorts", () => {
    const out = deriveReadOnlyScopes([
      "registry_read",
      "marketing_write",
      "backlog_create",
      "document_read",
      "build_execute",
    ]);
    expect(out).toEqual(["backlog_read", "document_read", "registry_read"]);
  });

  it("never grants recursion (tool_script_exec excluded)", () => {
    expect(deriveReadOnlyScopes(["tool_script_exec", "code_graph_read"])).toEqual([
      "backlog_read",
      "code_graph_read",
    ]);
  });

  it("drops send/publish/delete/approve/promote/triage too", () => {
    const out = deriveReadOnlyScopes([
      "linkedin_publish",
      "email_send",
      "item_delete",
      "decomposition_approve",
      "build_promote",
      "backlog_triage",
      "file_read",
    ]);
    expect(out).toEqual(["backlog_read", "file_read"]);
  });
});

describe("wrapToolScript", () => {
  const wrapped = wrapToolScript("const x = await callTool('search_knowledge', { query: 'a' }); emit(x.length);", {
    portalUrl: "http://portal:3000",
  });

  it("inlines the model code and provides callTool + emit", () => {
    expect(wrapped).toContain("async function callTool(name, args)");
    expect(wrapped).toContain("function emit(value)");
    expect(wrapped).toContain("await callTool('search_knowledge'");
    expect(wrapped).toContain("===== model code start =====");
  });

  it("reads the token from the fixed path and posts to the governed MCP route", () => {
    expect(wrapped).toContain(TOOL_SCRIPT_TOKEN_PATH);
    expect(wrapped).toContain('PORTAL + "/api/mcp/v1"');
    expect(wrapped).toContain('"X-MCP-Session": TOKEN');
    expect(wrapped).toContain(TOOL_SCRIPT_RESULT_MARKER);
  });

  it("makes each AI-coworker tool call a self-contained 2026 Tasks-capable request", () => {
    expect(wrapped).toContain('"MCP-Protocol-Version": "2026-07-28"');
    expect(wrapped).toContain('"Mcp-Method": "tools/call"');
    expect(wrapped).toContain('"Mcp-Name": name');
    expect(wrapped).toContain('"io.modelcontextprotocol/protocolVersion": "2026-07-28"');
    expect(wrapped).toContain('"io.modelcontextprotocol/tasks": {}');
    expect(wrapped).toContain('name: "dpf-ai-coworker-tool-script"');
  });

  it("uses no dynamic eval in the generated script (containment is the sandbox, not new Function)", () => {
    expect(wrapped).not.toMatch(/new\s+Function/);
    expect(wrapped).not.toMatch(/\beval\(/);
  });
});

describe("parseToolScriptOutput", () => {
  it("extracts an ok result from the marker line", () => {
    const stdout = `some noise\n${TOOL_SCRIPT_RESULT_MARKER}${JSON.stringify({ ok: true, result: { n: 5 } })}\n`;
    const out = parseToolScriptOutput(stdout);
    expect(out.ok).toBe(true);
    expect(out.output).toBe('{"n":5}');
  });

  it("returns a string result verbatim", () => {
    const stdout = `${TOOL_SCRIPT_RESULT_MARKER}${JSON.stringify({ ok: true, result: "hello" })}`;
    expect(parseToolScriptOutput(stdout)).toEqual({ ok: true, output: "hello" });
  });

  it("surfaces a script error", () => {
    const stdout = `${TOOL_SCRIPT_RESULT_MARKER}${JSON.stringify({ ok: false, error: "boom" })}`;
    const out = parseToolScriptOutput(stdout);
    expect(out.ok).toBe(false);
    expect(out.output).toContain("boom");
  });

  it("handles missing marker with a diagnostic tail", () => {
    const out = parseToolScriptOutput("just some logs\nno result here");
    expect(out.ok).toBe(false);
    expect(out.output).toContain("no result");
  });
});
