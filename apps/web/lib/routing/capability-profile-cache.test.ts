// apps/web/lib/routing/capability-profile-cache.test.ts
//
// Phase A5: Failing test for the DB-backed capability profile cache.
//
// Plan: docs/superpowers/plans/2026-04-29-coworker-execution-adapter-substrate-plan.md (Task A5)
// Spec: docs/superpowers/specs/2026-04-29-coworker-execution-adapter-substrate-design.md §4.1, §5.2

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Prisma mock ─────────────────────────────────────────────────────────────
const mockFindUnique = vi.fn();
const mockUpsert = vi.fn();

// `Prisma.JsonNull` is a sentinel value the real Prisma client uses to set
// a nullable Json column to null. Tests don't go through real Prisma — the
// cache module just imports it and forwards it to upsert(). A unique string
// stand-in is sufficient for unit-test mocking.
vi.mock("@dpf/db", () => ({
  prisma: {
    adapterCapabilityProfile: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      upsert: (...args: unknown[]) => mockUpsert(...args),
    },
  },
  Prisma: {
    JsonNull: "__PRISMA_JSON_NULL__",
  },
}));

// ── Probe mocks ─────────────────────────────────────────────────────────────
const mockProbeClaudeCli = vi.fn();
const mockProbeCodexCli = vi.fn();
const mockProbeHttpAnthropic = vi.fn();
const mockProbeHttpOpenAI = vi.fn();

vi.mock("./capability-probes/probe-claude-cli", () => ({
  probeClaudeCli: (...args: unknown[]) => mockProbeClaudeCli(...args),
}));
vi.mock("./capability-probes/probe-codex-cli", () => ({
  probeCodexCli: (...args: unknown[]) => mockProbeCodexCli(...args),
}));
vi.mock("./capability-probes/probe-http-anthropic", () => ({
  probeHttpAnthropic: (...args: unknown[]) => mockProbeHttpAnthropic(...args),
}));
vi.mock("./capability-probes/probe-http-openai", () => ({
  probeHttpOpenAI: (...args: unknown[]) => mockProbeHttpOpenAI(...args),
}));

import { getOrProbeCapabilityProfile } from "./capability-profile-cache";

// Deterministic claude probe shape used across tests
function fakeClaudeProbe() {
  return {
    adapterKind: "claude-code-cli",
    adapterVersion: "claude-code/9.9.9",
    supportsStreamingEvents: true,
    supportsMcpAttach: true,
    supportsMcpAttachPerInvoke: true,
    supportsSubagents: true,
    supportsHooks: true,
    supportsPlanState: true,
    supportsTodoState: true,
    supportsWebFetch: true,
    supportsWebSearch: true,
    supportsSessionResume: true,
    supportsExtendedThinking: true,
    supportsOutputSchema: false,
    maxInteractiveLatencyMs: 180_000,
    supportedAuthModes: ["oauth", "api-key"],
    knownDegradations: null,
  };
}

describe("getOrProbeCapabilityProfile", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockUpsert.mockReset();
    mockProbeClaudeCli.mockReset();
    mockProbeCodexCli.mockReset();
    mockProbeHttpAnthropic.mockReset();
    mockProbeHttpOpenAI.mockReset();
  });

  it("cache miss: runs probe, upserts row, returns profile with probedBy + probedAt", async () => {
    mockProbeClaudeCli.mockResolvedValue(fakeClaudeProbe());
    mockFindUnique.mockResolvedValue(null);
    mockUpsert.mockImplementation(({ create }) => ({
      id: "cuid-x",
      probedAt: create.probedAt,
      probedBy: create.probedBy,
      ...create,
    }));

    const profile = await getOrProbeCapabilityProfile("claude-code-cli");

    expect(mockProbeClaudeCli).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(profile.adapterKind).toBe("claude-code-cli");
    expect(profile.adapterVersion).toBe("claude-code/9.9.9");
    expect(typeof profile.probedBy).toBe("string");
    expect(profile.probedBy.length).toBeGreaterThan(0);
    const ageMs = Date.now() - new Date(profile.probedAt).getTime();
    expect(ageMs).toBeLessThan(5_000);
  });

  it("cache hit within TTL: skips probe body, returns cached row", async () => {
    // Probe runs only ONCE for the version detection
    mockProbeClaudeCli.mockResolvedValue(fakeClaudeProbe());

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const cached = {
      id: "cuid-cached",
      adapterKind: "claude-code-cli",
      adapterVersion: "claude-code/9.9.9",
      probedAt: oneHourAgo,
      probedBy: "previous-host:1234",
      supportsStreamingEvents: true,
      supportsMcpAttach: true,
      supportsMcpAttachPerInvoke: true,
      supportsSubagents: true,
      supportsHooks: true,
      supportsPlanState: true,
      supportsTodoState: true,
      supportsWebFetch: true,
      supportsWebSearch: true,
      supportsSessionResume: true,
      supportsExtendedThinking: true,
      supportsOutputSchema: false,
      maxInteractiveLatencyMs: 180_000,
      supportedAuthModes: ["oauth", "api-key"],
      knownDegradations: null,
    };
    mockFindUnique.mockResolvedValue(cached);

    const profile = await getOrProbeCapabilityProfile("claude-code-cli");

    expect(mockUpsert).not.toHaveBeenCalled();
    expect(profile.id).toBe("cuid-cached");
    expect(profile.probedBy).toBe("previous-host:1234");
    expect(profile.probedAt).toEqual(oneHourAgo);
    // Probe is allowed to be called once for version discovery
    expect(mockProbeClaudeCli.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("cache stale (>24h): re-runs probe and upserts fresh row", async () => {
    mockProbeClaudeCli.mockResolvedValue(fakeClaudeProbe());

    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    mockFindUnique.mockResolvedValue({
      id: "cuid-old",
      adapterKind: "claude-code-cli",
      adapterVersion: "claude-code/9.9.9",
      probedAt: twoDaysAgo,
      probedBy: "old-host:1",
      supportsStreamingEvents: true,
      supportsMcpAttach: true,
      supportsMcpAttachPerInvoke: true,
      supportsSubagents: true,
      supportsHooks: true,
      supportsPlanState: true,
      supportsTodoState: true,
      supportsWebFetch: true,
      supportsWebSearch: true,
      supportsSessionResume: true,
      supportsExtendedThinking: true,
      supportsOutputSchema: false,
      maxInteractiveLatencyMs: 180_000,
      supportedAuthModes: ["oauth", "api-key"],
      knownDegradations: null,
    });
    mockUpsert.mockImplementation(({ create }) => ({
      id: "cuid-new",
      probedAt: create.probedAt,
      probedBy: create.probedBy,
      ...create,
    }));

    const profile = await getOrProbeCapabilityProfile("claude-code-cli");

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(profile.id).toBe("cuid-new");
    expect(new Date(profile.probedAt).getTime()).toBeGreaterThan(twoDaysAgo.getTime());
  });

  it("dispatches by adapter kind", async () => {
    mockProbeCodexCli.mockResolvedValue({
      adapterKind: "codex-cli",
      adapterVersion: "codex-cli/0.125.0",
      supportsStreamingEvents: true,
      supportsMcpAttach: true,
      supportsMcpAttachPerInvoke: false,
      supportsSubagents: false,
      supportsHooks: false,
      supportsPlanState: true,
      supportsTodoState: true,
      supportsWebFetch: true,
      supportsWebSearch: true,
      supportsSessionResume: true,
      supportsExtendedThinking: true,
      supportsOutputSchema: true,
      maxInteractiveLatencyMs: 180_000,
      supportedAuthModes: ["oauth", "api-key"],
      knownDegradations: [{ trigger: "x", behavior: "y", source: "z" }],
    });
    mockFindUnique.mockResolvedValue(null);
    mockUpsert.mockImplementation(({ create }) => ({
      id: "cuid-codex",
      probedAt: create.probedAt,
      probedBy: create.probedBy,
      ...create,
    }));

    const profile = await getOrProbeCapabilityProfile("codex-cli");
    expect(profile.adapterKind).toBe("codex-cli");
    expect(mockProbeCodexCli).toHaveBeenCalled();
    expect(mockProbeClaudeCli).not.toHaveBeenCalled();
  });

  it("throws for adapter kinds without a registered probe", async () => {
    await expect(getOrProbeCapabilityProfile("http-gemini")).rejects.toThrow(
      /No capability probe/,
    );
    await expect(getOrProbeCapabilityProfile("http-ollama")).rejects.toThrow(
      /No capability probe/,
    );
    await expect(getOrProbeCapabilityProfile("codex-mcp-server")).rejects.toThrow(
      /No capability probe/,
    );
    await expect(getOrProbeCapabilityProfile("local-runtime")).rejects.toThrow(
      /No capability probe/,
    );
    await expect(getOrProbeCapabilityProfile("http-generic")).rejects.toThrow(
      /No capability probe/,
    );
  });

  it("HTTP probes work end-to-end through the cache", async () => {
    mockProbeHttpAnthropic.mockResolvedValue({
      adapterKind: "http-anthropic",
      adapterVersion: "anthropic-http/2023-06-01",
      supportsStreamingEvents: true,
      supportsMcpAttach: false,
      supportsMcpAttachPerInvoke: false,
      supportsSubagents: false,
      supportsHooks: false,
      supportsPlanState: false,
      supportsTodoState: false,
      supportsWebFetch: false,
      supportsWebSearch: false,
      supportsSessionResume: false,
      supportsExtendedThinking: true,
      supportsOutputSchema: false,
      maxInteractiveLatencyMs: 60_000,
      supportedAuthModes: ["api-key", "oauth"],
      knownDegradations: null,
    });
    mockFindUnique.mockResolvedValue(null);
    mockUpsert.mockImplementation(({ create }) => ({
      id: "cuid-http-anthropic",
      probedAt: create.probedAt,
      probedBy: create.probedBy,
      ...create,
    }));

    const profile = await getOrProbeCapabilityProfile("http-anthropic");

    expect(profile.adapterKind).toBe("http-anthropic");
    expect(profile.supportsExtendedThinking).toBe(true);
    expect(profile.supportsMcpAttach).toBe(false);
  });
});
