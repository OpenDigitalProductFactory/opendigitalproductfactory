import { describe, expect, it } from "vitest";
import { resolveAssuranceReadiness } from "./readiness";

describe("resolveAssuranceReadiness", () => {
  it("returns ready when grant, runtime tool, token scope, and adapter approval all pass", () => {
    expect(
      resolveAssuranceReadiness({
        toolName: "create_backlog_item",
        agentGrants: ["backlog_write"],
        runtimeTools: ["create_backlog_item"],
        tokenScope: "write",
        requiredScope: "write",
        adapterKey: "diff-security",
        approvedAdapters: ["diff-security"],
      }),
    ).toEqual({ ready: true, reasons: [] });
  });

  it("reports unmapped runtime tools", () => {
    expect(
      resolveAssuranceReadiness({
        toolName: "vulnerability_scan",
        agentGrants: ["vulnerability_scan"],
        runtimeTools: ["create_backlog_item"],
        tokenScope: "write",
        requiredScope: "write",
        adapterKey: "grype",
        approvedAdapters: ["grype"],
      }).reasons,
    ).toContain("tool_not_mapped_to_grant");
  });

  it("reports missing runtime tool and unapproved adapter separately", () => {
    const result = resolveAssuranceReadiness({
      toolName: "evaluate_tool",
      agentGrants: ["tool_evaluation_create"],
      runtimeTools: [],
      tokenScope: "read",
      requiredScope: "write",
      adapterKey: "black-duck",
      approvedAdapters: [],
    });

    expect(result.ready).toBe(false);
    expect(result.reasons).toEqual([
      "runtime_tool_unavailable",
      "insufficient_token_scope",
      "adapter_not_approved",
    ]);
  });
});
