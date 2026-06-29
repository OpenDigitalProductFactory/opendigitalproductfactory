import { describe, expect, it } from "vitest";

import {
  composeAiReadinessSummary,
  projectBuildExecutionDomain,
  projectModelSupplyDomain,
  projectRoutingConfidenceDomain,
  projectToolAccessDomain,
  summarizeAiReadinessState,
  type AiReadinessProviderInput,
  type AiReadinessDomain,
} from "./readiness-summary";
import type { ContributorMcpReadiness } from "@/lib/mcp/contributor-readiness";
import type { RoutingEligibilityState } from "@/lib/routing/provider-routing-eligibility";

function domain(state: AiReadinessDomain["state"]): AiReadinessDomain {
  return {
    id: "model-supply",
    label: "Model Supply",
    state,
    summary: `${state} summary`,
    evidence: [],
    diagnosticsHref: "/platform/ai/providers",
  };
}

describe("summarizeAiReadinessState", () => {
  it("returns blocked when any domain is blocked", () => {
    expect(
      summarizeAiReadinessState([
        domain("ready"),
        { ...domain("blocked"), id: "tool-access", label: "Tool Access" },
        { ...domain("attention"), id: "routing-confidence", label: "Routing Confidence" },
      ]),
    ).toBe("blocked");
  });

  it("returns attention when no domain is blocked and at least one needs attention", () => {
    expect(
      summarizeAiReadinessState([
        domain("ready"),
        { ...domain("attention"), id: "build-execution", label: "Build Execution" },
        { ...domain("diagnostic"), id: "routing-confidence", label: "Routing Confidence" },
      ]),
    ).toBe("attention");
  });

  it("returns ready when all non-diagnostic domains are ready", () => {
    expect(
      summarizeAiReadinessState([
        domain("ready"),
        { ...domain("diagnostic"), id: "routing-confidence", label: "Routing Confidence" },
      ]),
    ).toBe("ready");
  });
});

function provider(
  state: RoutingEligibilityState,
  overrides: Partial<AiReadinessProviderInput> = {},
): AiReadinessProviderInput {
  return {
    providerId: overrides.providerId ?? "openai",
    name: overrides.name ?? "OpenAI",
    supportsToolUse: overrides.supportsToolUse ?? true,
    eligibility: {
      state,
      eligible: state === "routable",
      label: state,
      reason: `${state} reason`,
    },
  };
}

describe("projectModelSupplyDomain", () => {
  it("is ready when at least one model provider is routable", () => {
    const domain = projectModelSupplyDomain([
      provider("routable"),
      provider("needs_credentials", { providerId: "anthropic", name: "Anthropic" }),
    ]);

    expect(domain.state).toBe("ready");
    expect(domain.summary).toContain("1 routable");
    expect(domain.summary).toContain("2 providers");
    expect(domain.diagnosticsHref).toBe("/platform/ai/providers");
  });

  it("needs attention when providers exist but setup work remains", () => {
    const domain = projectModelSupplyDomain([
      provider("needs_credentials"),
      provider("no_models", { providerId: "zai", name: "Z.ai" }),
    ]);

    expect(domain.state).toBe("attention");
    expect(domain.blocker?.primaryActionLabel).toBe("Open providers");
    expect(domain.blocker?.href).toBe("/platform/ai/providers");
  });

  it("is blocked when no model providers are configured", () => {
    const domain = projectModelSupplyDomain([]);

    expect(domain.state).toBe("blocked");
    expect(domain.blocker?.code).toBe("no-model-providers");
    expect(domain.blocker?.primaryActionLabel).toBe("Connect provider");
  });

  it("keeps Z.ai-style non-tool models in model supply instead of build execution", () => {
    const domain = projectModelSupplyDomain([
      provider("routable", {
        providerId: "zai",
        name: "Z.ai",
        supportsToolUse: false,
      }),
    ]);

    expect(domain.state).toBe("ready");
    expect(domain.summary).toContain("1 routable");
    expect(domain.evidence.some((entry) => entry.value.includes("non-tool"))).toBe(true);
  });
});

describe("projectBuildExecutionDomain", () => {
  it("is ready when the selected build engine is present", () => {
    const domain = projectBuildExecutionDomain({
      selectedEngineId: "codex",
      selectedEngineLabel: "Codex CLI",
      selectedEnginePresent: true,
      readyEngineCount: 2,
      fallbackEngineLabel: null,
    });

    expect(domain.state).toBe("ready");
    expect(domain.summary).toContain("Codex CLI ready");
  });

  it("needs attention when engine presence has not been probed", () => {
    const domain = projectBuildExecutionDomain({
      selectedEngineId: "grok",
      selectedEngineLabel: "Grok CLI",
      selectedEnginePresent: null,
      readyEngineCount: 1,
      fallbackEngineLabel: "Codex CLI",
    });

    expect(domain.state).toBe("attention");
    expect(domain.summary).toContain("fallback");
    expect(domain.blocker?.primaryActionLabel).toBe("Review execution policy");
  });

  it("is blocked when the selected engine is absent and no fallback is ready", () => {
    const domain = projectBuildExecutionDomain({
      selectedEngineId: "claude",
      selectedEngineLabel: "Claude Code CLI",
      selectedEnginePresent: false,
      readyEngineCount: 0,
      fallbackEngineLabel: null,
    });

    expect(domain.state).toBe("blocked");
    expect(domain.blocker?.code).toBe("build-engine-unavailable");
    expect(domain.blocker?.href).toBe("/platform/ai/build-studio");
  });
});

function mcpReadiness(
  status: ContributorMcpReadiness["status"],
  missingGrants: string[] = [],
): ContributorMcpReadiness {
  return {
    status,
    recommendedAction:
      status === "ready"
        ? "test_connection"
        : status === "needs_grants"
          ? "rotate_development_token"
          : status === "needs_identity_binding"
            ? "none"
            : "issue_development_token",
    identityBinding: "not_available",
    token: null,
    missingGrants,
    requiredGrants: ["read_backlog", "record_execution_evidence"],
    recommendedScopes: ["read_backlog", "record_execution_evidence"],
    probe: { status: "not_run" },
  };
}

describe("projectToolAccessDomain", () => {
  it("is ready when contributor MCP readiness is ready", () => {
    const domain = projectToolAccessDomain(mcpReadiness("ready"));

    expect(domain.state).toBe("ready");
    expect(domain.summary).toContain("MCP token ready");
  });

  it("is blocked when required grants are missing", () => {
    const domain = projectToolAccessDomain(
      mcpReadiness("needs_grants", ["record_execution_evidence"]),
    );

    expect(domain.state).toBe("blocked");
    expect(domain.blocker?.code).toBe("needs_grants");
    expect(domain.blocker?.primaryActionLabel).toBe("Rotate development token");
  });

  it("needs attention for identity binding gaps that do not block token grants", () => {
    const domain = projectToolAccessDomain(mcpReadiness("needs_identity_binding"));

    expect(domain.state).toBe("attention");
    expect(domain.blocker).toBeUndefined();
  });
});

describe("projectRoutingConfidenceDomain", () => {
  it("is blocked when runtime phase preview has error flags", () => {
    const domain = projectRoutingConfidenceDomain({
      verdict: "mixed",
      summary: "Mixed routing.",
      buildEngine: "opencode",
      buildEngineLabel: "Local model (OpenCode)",
      generatedAt: "2026-06-29T00:00:00.000Z",
      notes: [],
      phases: [],
      flags: [
        {
          phase: "build",
          severity: "error",
          code: "no-eligible-endpoint",
          message: "No tool-capable endpoint.",
          remediation: "Connect a tool-capable endpoint.",
        },
      ],
    });

    expect(domain.state).toBe("blocked");
    expect(domain.blocker?.primaryActionLabel).toBe("Open runtime diagnostics");
  });

  it("needs attention when only warning or info flags are present", () => {
    const domain = projectRoutingConfidenceDomain({
      verdict: "mixed",
      summary: "Mixed routing.",
      buildEngine: "opencode",
      buildEngineLabel: "Local model (OpenCode)",
      generatedAt: "2026-06-29T00:00:00.000Z",
      notes: [],
      phases: [],
      flags: [
        {
          phase: "ideate",
          severity: "warning",
          code: "local-preflight-error",
          message: "Preflight stale.",
          remediation: "Refresh local endpoint.",
        },
      ],
    });

    expect(domain.state).toBe("attention");
    expect(domain.summary).toContain("1 routing warning");
  });

  it("is ready when phase preview has no flags", () => {
    const domain = projectRoutingConfidenceDomain({
      verdict: "all-cloud",
      summary: "All phases route to cloud providers.",
      buildEngine: "codex",
      buildEngineLabel: "Codex CLI",
      generatedAt: "2026-06-29T00:00:00.000Z",
      notes: [],
      phases: [],
      flags: [],
    });

    expect(domain.state).toBe("ready");
    expect(domain.summary).toContain("Phase preview passes");
  });
});

describe("composeAiReadinessSummary", () => {
  it("builds the top-level blocked verdict from domain precedence", () => {
    const summary = composeAiReadinessSummary({
      generatedAt: "2026-06-29T00:00:00.000Z",
      domains: [
        domain("ready"),
        { ...domain("blocked"), id: "tool-access", label: "Tool Access" },
      ],
    });

    expect(summary.state).toBe("blocked");
    expect(summary.summary).toBe("AI readiness is blocked by 1 domain.");
    expect(summary.generatedAt).toBe("2026-06-29T00:00:00.000Z");
  });

  it("builds an attention verdict when no domains are blocked", () => {
    const summary = composeAiReadinessSummary({
      generatedAt: "2026-06-29T00:00:00.000Z",
      domains: [
        domain("ready"),
        { ...domain("attention"), id: "build-execution", label: "Build Execution" },
      ],
    });

    expect(summary.state).toBe("attention");
    expect(summary.summary).toBe("AI readiness needs attention in 1 domain.");
  });

  it("builds a ready verdict when all domains are ready or diagnostic", () => {
    const summary = composeAiReadinessSummary({
      generatedAt: "2026-06-29T00:00:00.000Z",
      domains: [
        domain("ready"),
        { ...domain("diagnostic"), id: "routing-confidence", label: "Routing Confidence" },
      ],
    });

    expect(summary.state).toBe("ready");
    expect(summary.summary).toBe("AI is ready for governed work.");
  });
});
