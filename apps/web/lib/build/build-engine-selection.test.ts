import { describe, expect, it } from "vitest";

import {
  classifyRetrySafePreDispatchFailure,
  selectBuildEngineFromCandidates,
  type BuildEngineCandidate,
  type BuildEngineRouteResult,
} from "./build-engine-selection";

const NOW = Date.parse("2026-07-19T23:30:00.000Z");

function candidate(
  engine: BuildEngineCandidate["engine"],
  providerId: string,
  overrides: Partial<BuildEngineCandidate> = {},
): BuildEngineCandidate {
  return {
    engine,
    providerId,
    modelId: `${engine}-model`,
    local: engine === "opencode",
    registered: engine === "agentic" ? true : true,
    present: engine === "agentic" ? true : true,
    providerStatus: "active",
    authMethod: engine === "opencode" ? "none" : "oauth",
    credentialStatus: engine === "opencode" ? null : "active",
    credentialExpiresAt: engine === "opencode" ? null : NOW + 60_000,
    providerCapacityState: "available",
    providerRetryAt: null,
    cliRetryAt: null,
    providerHealth: "healthy",
    ...overrides,
  };
}

function route(
  selectedProviderId: string | null,
  fallbackProviderIds: string[] = [],
): BuildEngineRouteResult {
  return {
    selectedProviderId,
    selectedModelId: selectedProviderId ? `${selectedProviderId}-model` : null,
    reason: selectedProviderId
      ? `Selected ${selectedProviderId} through routeEndpointV2.`
      : "No endpoint satisfied the Build Studio contract.",
    fallbackProviderIds,
    rejectedProviders: [],
  };
}

describe("selectBuildEngineFromCandidates", () => {
  it("selects healthy Codex before dispatch when Claude OAuth is expired", () => {
    const result = selectBuildEngineFromCandidates({
      policy: { mode: "auto", pinnedEngine: null },
      candidates: [
        candidate("claude", "anthropic-sub", { credentialExpiresAt: NOW - 1 }),
        candidate("codex", "codex"),
      ],
      route: route("codex"),
      localOnly: false,
      nowMs: NOW,
    });

    expect(result.status).toBe("selected");
    expect(result.selected?.engine).toBe("codex");
    expect(result.rejected).toContainEqual(expect.objectContaining({
      engine: "claude",
      providerId: "anthropic-sub",
      code: "credential-expired",
    }));
  });

  it("excludes a saturated Codex pool and selects another eligible engine", () => {
    const result = selectBuildEngineFromCandidates({
      policy: { mode: "auto", pinnedEngine: null },
      candidates: [
        candidate("codex", "codex", { cliRetryAt: NOW + 30_000 }),
        candidate("claude", "anthropic-sub"),
      ],
      route: route("anthropic-sub"),
      localOnly: false,
      nowMs: NOW,
    });

    expect(result.selected?.engine).toBe("claude");
    expect(result.rejected).toContainEqual(expect.objectContaining({
      providerId: "codex",
      code: "capacity-retry-window",
    }));
  });

  it("never crosses a local-only boundary", () => {
    const result = selectBuildEngineFromCandidates({
      policy: { mode: "auto", pinnedEngine: null },
      candidates: [candidate("claude", "anthropic-sub"), candidate("opencode", "local")],
      route: route("local"),
      localOnly: true,
      nowMs: NOW,
    });

    expect(result.selected?.engine).toBe("opencode");
    expect(result.rejected).toContainEqual(expect.objectContaining({
      engine: "claude",
      code: "residency-local-only",
    }));
  });

  it("does not fail over an explicit hard pin", () => {
    const result = selectBuildEngineFromCandidates({
      policy: { mode: "pinned", pinnedEngine: "claude" },
      candidates: [
        candidate("claude", "anthropic-sub", { credentialStatus: "expired" }),
        candidate("codex", "codex"),
      ],
      route: route("codex"),
      localOnly: false,
      nowMs: NOW,
    });

    expect(result.status).toBe("blocked");
    expect(result.selected).toBeNull();
    expect(result.fallbackDisabled).toBe(true);
    expect(result.action).toMatch(/automatic fallback was disabled/i);
  });

  it("blocks before phase work with one actionable explanation when no engine is eligible", () => {
    const result = selectBuildEngineFromCandidates({
      policy: { mode: "auto", pinnedEngine: null },
      candidates: [
        candidate("claude", "anthropic-sub", { present: false }),
        candidate("codex", "codex", { providerCapacityState: "reauth_required" }),
      ],
      route: route(null),
      localOnly: false,
      nowMs: NOW,
    });

    expect(result.status).toBe("blocked");
    expect(result.action).toMatch(/connect, provision, or wait/i);
    expect(result.rejected).toHaveLength(2);
  });

  // BI-16A1B4A3 — live repro: every engine installed and credentialed, every
  // endpoint excluded by a quality floor, and the owner was told to "connect,
  // provision, or wait" — three actions, none of which could change the outcome.
  it("names the real routing cause instead of advising connect/provision/wait", () => {
    const result = selectBuildEngineFromCandidates({
      policy: { mode: "auto", pinnedEngine: null },
      candidates: [candidate("codex", "codex"), candidate("opencode", "local")],
      route: {
        selectedProviderId: null,
        selectedModelId: null,
        reason: "No endpoint satisfied the Build Studio contract.",
        fallbackProviderIds: [],
        rejectedProviders: [
          { providerId: "codex", reason: "Minimum quality dimensions not met (toolFidelity 80 < 85)" },
          { providerId: "local", reason: "Minimum quality dimensions not met (toolFidelity 82 < 85)" },
        ],
      },
      localOnly: false,
      nowMs: NOW,
    });

    expect(result.status).toBe("blocked");
    expect(result.action).not.toMatch(/connect, provision, or wait/i);
    expect(result.action).toMatch(/quality floor/i);
    expect(result.action).toMatch(/measured/i);
  });

  it("projects the router fallback chain and rationale without re-ranking it", () => {
    const result = selectBuildEngineFromCandidates({
      policy: { mode: "auto", pinnedEngine: null },
      candidates: [
        candidate("claude", "anthropic-sub"),
        candidate("codex", "codex"),
        candidate("opencode", "local"),
      ],
      route: route("anthropic-sub", ["codex", "local"]),
      localOnly: false,
      nowMs: NOW,
    });

    expect(result.reason).toBe("Selected anthropic-sub through routeEndpointV2.");
    expect(result.fallbackChain.map((entry) => entry.engine)).toEqual(["codex", "opencode"]);
  });
});

describe("classifyRetrySafePreDispatchFailure", () => {
  it.each([
    "Auth error: OAuth token expired",
    "rate limited before dispatch; retry-after: 30",
    "CLI unavailable: executable not found",
  ])("permits one pre-dispatch fallback for %s", (message) => {
    expect(classifyRetrySafePreDispatchFailure({ message, durationMs: 0 })).not.toBeNull();
  });

  it("does not retry after work may have started", () => {
    expect(classifyRetrySafePreDispatchFailure({
      message: "Auth error after agent edited files",
      durationMs: 250,
      sideEffectsStarted: true,
    })).toBeNull();
  });

  it("recognizes the observed short OAuth startup failure as pre-dispatch", () => {
    expect(classifyRetrySafePreDispatchFailure({
      message: "OAuth token has expired",
      durationMs: 300,
    })).toBe("auth");
  });
});
