// apps/web/lib/routing/adapter-telemetry-writer.test.ts
//
// Phase A7 — unit tests for writeAdapterTelemetry().
//
// We exercise the override hook rather than the real Prisma client so the
// suite stays hermetic. The integration test that touches the database
// lives in packages/db/test/adapter-run-telemetry.test.ts (A2).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  writeAdapterTelemetry,
  _setAdapterTelemetryWriteOverrideForTests,
} from "./adapter-telemetry-writer";

const writeOverride = vi.fn();

beforeEach(() => {
  writeOverride.mockReset();
  writeOverride.mockResolvedValue(undefined);
  _setAdapterTelemetryWriteOverrideForTests(writeOverride);
});

afterEach(() => {
  _setAdapterTelemetryWriteOverrideForTests(null);
});

describe("writeAdapterTelemetry", () => {
  it("writes a row with all required fields", async () => {
    const startedAt = new Date("2026-05-16T10:00:00.000Z");
    await writeAdapterTelemetry({
      adapterKind: "claude-code-cli",
      adapterVersion: "claude-code/1.2.3",
      providerId: "anthropic-sub",
      modelId: "claude-opus-4-7",
      executionMode: "single",
      startedAt,
      status: "success",
    });
    expect(writeOverride).toHaveBeenCalledTimes(1);
    expect(writeOverride).toHaveBeenCalledWith(
      expect.objectContaining({
        adapterKind: "claude-code-cli",
        adapterVersion: "claude-code/1.2.3",
        providerId: "anthropic-sub",
        modelId: "claude-opus-4-7",
        executionMode: "single",
        startedAt,
        status: "success",
      }),
    );
  });

  it("includes optional attribution fields when provided (agentId, skillId, threadId)", async () => {
    await writeAdapterTelemetry({
      adapterKind: "http-anthropic",
      adapterVersion: "anthropic-http/2024-06-01",
      providerId: "anthropic",
      modelId: "claude-sonnet-4-6",
      executionMode: "single",
      startedAt: new Date(),
      status: "success",
      threadId: "thread_123",
      agentId: "agent_456",
      skillId: "skill_789",
      buildId: "build_abc",
    });
    expect(writeOverride).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread_123",
        agentId: "agent_456",
        skillId: "skill_789",
        buildId: "build_abc",
      }),
    );
  });

  it("persists agentMessageId so the badge/cost-rollup join key reaches the row", async () => {
    // Regression for PR #964 follow-up: the assistant-turn badge joins
    // AdapterRunTelemetry → AgentMessage on agentMessageId. If the writer
    // drops the field, every turn degrades to provider-name-only.
    await writeAdapterTelemetry({
      adapterKind: "claude-code-cli",
      adapterVersion: "claude-code/1.2.3",
      providerId: "anthropic-sub",
      modelId: "claude-opus-4-7",
      executionMode: "single",
      startedAt: new Date(),
      status: "success",
      agentMessageId: "msg_abc123",
    });
    expect(writeOverride).toHaveBeenCalledWith(
      expect.objectContaining({ agentMessageId: "msg_abc123" }),
    );
  });

  it("omits optional fields when undefined (no nulls forced)", async () => {
    await writeAdapterTelemetry({
      adapterKind: "codex-cli",
      adapterVersion: "codex-cli/0.125.0",
      providerId: "codex",
      modelId: "gpt-5",
      executionMode: "single",
      startedAt: new Date(),
      status: "success",
    });
    const call = writeOverride.mock.calls[0][0] as Record<string, unknown>;
    expect(call).not.toHaveProperty("threadId");
    expect(call).not.toHaveProperty("agentId");
    expect(call).not.toHaveProperty("skillId");
    expect(call).not.toHaveProperty("raceCohortId");
    expect(call).not.toHaveProperty("durationMs");
  });

  it("forwards race-cohort + execution-mode for shadow runs", async () => {
    await writeAdapterTelemetry({
      adapterKind: "codex-cli",
      adapterVersion: "codex-cli/0.125.0",
      providerId: "codex",
      modelId: "gpt-5",
      executionMode: "shadow-alt",
      startedAt: new Date(),
      status: "success",
      raceCohortId: "cohort_xyz",
    });
    expect(writeOverride).toHaveBeenCalledWith(
      expect.objectContaining({
        executionMode: "shadow-alt",
        raceCohortId: "cohort_xyz",
      }),
    );
  });

  it("captures error-shaped outcomes (status + errorClass)", async () => {
    await writeAdapterTelemetry({
      adapterKind: "codex-cli",
      adapterVersion: "codex-cli/0.125.0",
      providerId: "codex",
      modelId: "gpt-5",
      executionMode: "single",
      startedAt: new Date(),
      status: "error",
      errorClass: "codex-mcp-json-degradation",
    });
    expect(writeOverride).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        errorClass: "codex-mcp-json-degradation",
      }),
    );
  });

  it("swallows write failures (fire-and-forget contract)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeOverride.mockRejectedValueOnce(new Error("DB unavailable"));

    // Must NOT throw — that would break the coworker turn.
    await expect(
      writeAdapterTelemetry({
        adapterKind: "http-anthropic",
        adapterVersion: "anthropic-http/2024-06-01",
        providerId: "anthropic",
        modelId: "claude-opus-4-7",
        executionMode: "single",
        startedAt: new Date(),
        status: "success",
      }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      "[adapter-telemetry-writer] write failed (suppressed):",
      expect.any(Error),
    );
    warn.mockRestore();
  });
});
