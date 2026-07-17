import { describe, it, expect } from "vitest";

import {
  computeReadinessState,
  readinessCopy,
} from "../readiness-state";
import type { ReadinessState } from "../types";

describe("readinessCopy", () => {
  it("returns the spec-table copy verbatim for every state", () => {
    expect(readinessCopy("ready")).toEqual({
      message: "Claude Code and Codex are ready for DPF work.",
      primaryAction: "Open readiness",
    });
    expect(readinessCopy("partial")).toEqual({
      message: "One contributor client is ready; the other needs setup.",
      primaryAction: "Repair toolchain",
    });
    expect(readinessCopy("missing_cli")).toEqual({
      message: "Install the selected agent client to enable contributor sessions.",
      primaryAction: "Open setup guide",
    });
    expect(readinessCopy("missing_token")).toEqual({
      message: "DPF MCP needs a development token before agents can use governed tools.",
      primaryAction: "Issue development token",
    });
    expect(readinessCopy("needs_refresh")).toEqual({
      message: "A token exists, but the running client has not picked it up yet.",
      primaryAction: "Refresh client binding",
    });
    expect(readinessCopy("failed_smoke")).toEqual({
      message: "The agent is installed but did not apply a DPF kernel principle.",
      primaryAction: "View evidence",
    });
    expect(readinessCopy("portal-unavailable")).toEqual({
      message: "The portal is rebooting; I can still repair local agent tooling and will sync evidence when it comes back.",
      primaryAction: "Continue local repair",
    });
    expect(readinessCopy("mcp-unavailable")).toEqual({
      message: "DPF coordination is unavailable; I can still repair local agent tooling and will sync evidence when it returns.",
      primaryAction: "Continue local repair",
    });
  });

  it("contains no substrate names in any banner copy (UX contract)", () => {
    const forbidden = [
      "config.toml",
      "installed_plugins.json",
      ".codex",
      ".claude/plugins",
      "claude plugin install",
      "superpowers",
      ".\\scripts\\",
      "./scripts/",
    ];
    const states: ReadinessState[] = [
      "ready",
      "partial",
      "missing_cli",
      "missing_token",
      "needs_refresh",
      "failed_smoke",
      "portal-unavailable",
      "mcp-unavailable",
    ];
    for (const state of states) {
      const copy = readinessCopy(state);
      const combined = `${copy.message} ${copy.primaryAction}`;
      for (const forbiddenString of forbidden) {
        expect(
          combined.toLowerCase().includes(forbiddenString.toLowerCase()),
          `state="${state}" contained forbidden substring "${forbiddenString}" in: ${combined}`,
        ).toBe(false);
      }
    }
  });
});

describe("computeReadinessState", () => {
  it("returns missing_cli when neither client is wired", () => {
    expect(
      computeReadinessState({ claudeCodeWired: false, codexCwiredTypo: false } as never),
    ).toBe("missing_cli");
  });

  it("returns missing_token when MCP probe says no_token", () => {
    expect(
      computeReadinessState({
        claudeCodeWired: true,
        codexWired: true,
        mcpReadiness: { ok: false, reason: "no_token", httpStatus: 401 },
      }),
    ).toBe("missing_token");
  });

  it("returns missing_token when MCP probe says scope_insufficient", () => {
    expect(
      computeReadinessState({
        claudeCodeWired: true,
        codexWired: true,
        mcpReadiness: { ok: false, reason: "scope_insufficient", httpStatus: 403 },
      }),
    ).toBe("missing_token");
  });

  it("returns portal-unavailable when the portal cannot be reached or is rebooting", () => {
    expect(
      computeReadinessState({
        claudeCodeWired: true,
        codexWired: true,
        mcpReadiness: { ok: false, reason: "portal-unavailable", httpStatus: null },
      }),
    ).toBe("portal-unavailable");
  });

  it("returns mcp-unavailable when the portal is reachable but MCP is unavailable", () => {
    expect(
      computeReadinessState({
        claudeCodeWired: true,
        codexWired: true,
        mcpReadiness: { ok: false, reason: "mcp-unavailable", httpStatus: 404 },
      }),
    ).toBe("mcp-unavailable");
  });

  it("returns failed_smoke when the smoke test failed but everything else is fine", () => {
    expect(
      computeReadinessState({
        claudeCodeWired: true,
        codexWired: true,
        mcpReadiness: { ok: true, toolCount: 5, observedAt: "2026-05-27T00:00:00.000Z" },
        smokeTest: { result: "failed", transcript: "...", reason: "no signature" },
      }),
    ).toBe("failed_smoke");
  });

  it("returns partial when one client is wired but the other is not", () => {
    expect(
      computeReadinessState({
        claudeCodeWired: true,
        codexWired: false,
        mcpReadiness: { ok: true, toolCount: 5, observedAt: "2026-05-27T00:00:00.000Z" },
        smokeTest: { result: "passed", kernelPrincipleObserved: "destructive-actions-require-explicit-go", transcript: "..." },
      }),
    ).toBe("partial");
  });

  it("treats Antigravity (agy) as additive: agy-only install is not missing_cli, but does not reach ready without claude+codex", () => {
    // agy present, claude+codex absent → counts toward "not missing_cli" but
    // readiness stays anchored on the claude+codex pair (→ partial).
    expect(
      computeReadinessState({
        claudeCodeWired: false,
        codexWired: false,
        antigravityWired: true,
        mcpReadiness: { ok: true, toolCount: 5, observedAt: "2026-07-17T00:00:00.000Z" },
        smokeTest: { result: "skipped", reason: "no_token" },
      }),
    ).toBe("partial");
  });

  it("does not regress a ready claude+codex install when Antigravity is absent", () => {
    expect(
      computeReadinessState({
        claudeCodeWired: true,
        codexWired: true,
        antigravityWired: false,
        mcpReadiness: { ok: true, toolCount: 5, observedAt: "2026-07-17T00:00:00.000Z" },
        smokeTest: { result: "passed", kernelPrincipleObserved: "destructive-actions-require-explicit-go", transcript: "..." },
      }),
    ).toBe("ready");
  });

  it("returns ready when everything is wired, probe ok, smoke passed", () => {
    expect(
      computeReadinessState({
        claudeCodeWired: true,
        codexWired: true,
        mcpReadiness: { ok: true, toolCount: 5, observedAt: "2026-05-27T00:00:00.000Z" },
        smokeTest: { result: "passed", kernelPrincipleObserved: "destructive-actions-require-explicit-go", transcript: "..." },
      }),
    ).toBe("ready");
  });

  it("treats smoke skipped as non-failure when everything else is ready", () => {
    expect(
      computeReadinessState({
        claudeCodeWired: true,
        codexWired: true,
        mcpReadiness: { ok: true, toolCount: 5, observedAt: "2026-05-27T00:00:00.000Z" },
        smokeTest: { result: "skipped", reason: "claude_not_on_path" },
      }),
    ).toBe("ready");
  });
});
