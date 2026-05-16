// apps/web/lib/routing/resolve-execution-adapter.test.ts
//
// Phase A6: Unit tests for `resolveExecutionAdapter()` — the wrapper that
// replaces the hard-coded `isCliAdapter` boolean check in ai-inference.ts.
//
// Plan: docs/superpowers/plans/2026-04-29-coworker-execution-adapter-substrate-plan.md (Task A6)
// Spec: docs/superpowers/specs/2026-04-29-coworker-execution-adapter-substrate-design.md §5.2

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Prisma } from "@dpf/db";

const {
  mockGetExecutionAdapter,
  mockGetOrProbeCapabilityProfile,
} = vi.hoisted(() => ({
  mockGetExecutionAdapter: vi.fn(),
  mockGetOrProbeCapabilityProfile: vi.fn(),
}));

vi.mock("./execution-adapter-registry", () => ({
  getExecutionAdapter: mockGetExecutionAdapter,
}));

vi.mock("./capability-profile-cache", () => ({
  getOrProbeCapabilityProfile: mockGetOrProbeCapabilityProfile,
}));

import {
  resolveExecutionAdapter,
  CapabilityRequirementUnsatisfiedError,
} from "./resolve-execution-adapter";
import type { AdapterCapabilityRequirement } from "./execution-adapter-types";

type AdapterCapabilityProfile = Prisma.AdapterCapabilityProfileModel;

// Minimal capability-profile factory — only the boolean fields the tests need.
function profile(
  overrides: Partial<AdapterCapabilityProfile> = {},
): AdapterCapabilityProfile {
  return {
    id: "test-id",
    adapterKind: "claude-code-cli",
    adapterVersion: "test/0.0.0",
    probedAt: new Date(),
    probedBy: "test",
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
    supportsOutputSchema: true,
    maxInteractiveLatencyMs: 1000,
    supportedAuthModes: ["oauth"],
    knownDegradations: null,
    ...overrides,
  } as AdapterCapabilityProfile;
}

describe("resolveExecutionAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: registry returns a tagged stub so tests can assert which legacy
    // string was used.
    mockGetExecutionAdapter.mockImplementation((type: string) => ({
      type,
      execute: vi.fn(),
    }));
  });

  // ── Backward compat: legacy strings ──────────────────────────────────────

  it("legacy string \"claude-cli\" dispatches to claude CLI handler", async () => {
    const handler = await resolveExecutionAdapter("claude-cli");
    expect(mockGetExecutionAdapter).toHaveBeenCalledWith("claude-cli");
    expect(handler).toMatchObject({ type: "claude-cli" });
  });

  it("legacy string \"codex-cli\" dispatches to codex CLI handler", async () => {
    const handler = await resolveExecutionAdapter("codex-cli");
    expect(mockGetExecutionAdapter).toHaveBeenCalledWith("codex-cli");
    expect(handler).toMatchObject({ type: "codex-cli" });
  });

  it("legacy string \"chat\" dispatches to chat handler (HTTP)", async () => {
    const handler = await resolveExecutionAdapter("chat");
    expect(mockGetExecutionAdapter).toHaveBeenCalledWith("chat");
    expect(handler).toMatchObject({ type: "chat" });
  });

  // ── New structured selectors map to same legacy handlers ─────────────────

  it("structured {kind: \"claude-code-cli\"} resolves to same handler as \"claude-cli\"", async () => {
    await resolveExecutionAdapter({ kind: "claude-code-cli", authMode: "oauth" });
    expect(mockGetExecutionAdapter).toHaveBeenCalledWith("claude-cli");
  });

  it("structured {kind: \"codex-cli\"} resolves to codex handler", async () => {
    await resolveExecutionAdapter({ kind: "codex-cli", authMode: "oauth" });
    expect(mockGetExecutionAdapter).toHaveBeenCalledWith("codex-cli");
  });

  it("structured {kind: \"http-generic\"} resolves to chat handler", async () => {
    await resolveExecutionAdapter({ kind: "http-generic", authMode: "api-key" });
    expect(mockGetExecutionAdapter).toHaveBeenCalledWith("chat");
  });

  it("structured http-anthropic / http-openai / http-gemini / http-ollama all resolve to chat handler", async () => {
    await resolveExecutionAdapter({ kind: "http-anthropic", authMode: "api-key" });
    await resolveExecutionAdapter({ kind: "http-openai", authMode: "api-key" });
    await resolveExecutionAdapter({ kind: "http-gemini", authMode: "api-key" });
    await resolveExecutionAdapter({ kind: "http-ollama", authMode: "local" });

    const calls = mockGetExecutionAdapter.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(["chat", "chat", "chat", "chat"]);
  });

  // ── Capability gating ────────────────────────────────────────────────────

  it("required capability satisfied → resolves successfully", async () => {
    mockGetOrProbeCapabilityProfile.mockResolvedValue(
      profile({ adapterKind: "claude-code-cli", supportsSubagents: true }),
    );
    const reqs: AdapterCapabilityRequirement[] = [
      { capability: "supportsSubagents", required: true },
    ];

    const handler = await resolveExecutionAdapter(
      { kind: "claude-code-cli", authMode: "oauth" },
      reqs,
    );

    expect(mockGetOrProbeCapabilityProfile).toHaveBeenCalledWith("claude-code-cli");
    expect(handler).toMatchObject({ type: "claude-cli" });
  });

  it("required capability UNSATISFIED → throws CapabilityRequirementUnsatisfiedError", async () => {
    mockGetOrProbeCapabilityProfile.mockResolvedValue(
      profile({ adapterKind: "codex-cli", supportsSubagents: false }),
    );
    const reqs: AdapterCapabilityRequirement[] = [
      { capability: "supportsSubagents", required: true },
    ];

    await expect(
      resolveExecutionAdapter({ kind: "codex-cli", authMode: "oauth" }, reqs),
    ).rejects.toBeInstanceOf(CapabilityRequirementUnsatisfiedError);

    // The error should name the missing capability and the adapter kind
    await expect(
      resolveExecutionAdapter({ kind: "codex-cli", authMode: "oauth" }, reqs),
    ).rejects.toThrow(/supportsSubagents/);
  });

  it("advisory (required:false) capability missing → resolves without error", async () => {
    mockGetOrProbeCapabilityProfile.mockResolvedValue(
      profile({ adapterKind: "codex-cli", supportsSubagents: false }),
    );
    const reqs: AdapterCapabilityRequirement[] = [
      { capability: "supportsSubagents", required: false },
    ];

    const handler = await resolveExecutionAdapter(
      { kind: "codex-cli", authMode: "oauth" },
      reqs,
    );

    expect(handler).toMatchObject({ type: "codex-cli" });
  });

  it("no capability requirements → does not call the profile cache", async () => {
    await resolveExecutionAdapter({ kind: "claude-code-cli", authMode: "oauth" });
    expect(mockGetOrProbeCapabilityProfile).not.toHaveBeenCalled();
  });

  it("empty capability requirements array → does not call the profile cache", async () => {
    await resolveExecutionAdapter(
      { kind: "claude-code-cli", authMode: "oauth" },
      [],
    );
    expect(mockGetOrProbeCapabilityProfile).not.toHaveBeenCalled();
  });

  it("only advisory requirements → does not call the profile cache (no need to gate)", async () => {
    // Pure-advisory requirements aren't enforced today — A6 just resolves.
    // (A future task may probe + log capabilitiesUsed; for A6, advisory is a no-op.)
    await resolveExecutionAdapter(
      { kind: "codex-cli", authMode: "oauth" },
      [{ capability: "supportsSubagents", required: false }],
    );
    expect(mockGetOrProbeCapabilityProfile).not.toHaveBeenCalled();
  });

  // ── Unknown / invalid input ──────────────────────────────────────────────

  it("unknown legacy string throws via parseExecutionAdapterSelector", async () => {
    await expect(resolveExecutionAdapter("nope-cli")).rejects.toThrow(
      /Unknown executionAdapter/,
    );
  });

  it("unsupported kind (codex-mcp-server) throws — no handler registered yet", async () => {
    await expect(
      resolveExecutionAdapter({ kind: "codex-mcp-server", authMode: "oauth" }),
    ).rejects.toThrow(/codex-mcp-server/);
  });

  it("unsupported kind (local-runtime) throws — no handler registered yet", async () => {
    await expect(
      resolveExecutionAdapter({ kind: "local-runtime", authMode: "local" }),
    ).rejects.toThrow(/local-runtime/);
  });
});
