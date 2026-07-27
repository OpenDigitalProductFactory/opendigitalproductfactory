import { describe, it, expect, vi, beforeEach } from "vitest";

// BI-QUIESCE-005 gate: startBuildPhaseRun now calls getQuiescenceLevel.
// Default to "normal" so existing tests pass through unchanged.
vi.mock("@/lib/self-upgrade/quiescence", () => ({
  getQuiescenceLevel: vi.fn().mockResolvedValue("normal"),
  QuiescingError: class QuiescingError extends Error {
    readonly code = "PORTAL_QUIESCING";
    readonly retryAfterSeconds: number;
    readonly level: string;
    constructor(level: string, retryAfterSeconds = 30) {
      super(`Portal is ${level} for upgrade — new work refused`);
      this.name = "QuiescingError";
      this.level = level;
      this.retryAfterSeconds = retryAfterSeconds;
    }
  },
}));

// ── Mock Prisma ──────────────────────────────────────────────────────────────
const phaseRuns = new Map<string, Record<string, unknown>>();

vi.mock("@dpf/db", () => ({
  prisma: {
    buildPhaseRun: {
      upsert: vi.fn(async ({ where, create }: { where: { buildId_phase: { buildId: string; phase: string } }; create: Record<string, unknown> }) => {
        const key = `${where.buildId_phase.buildId}:${where.buildId_phase.phase}`;
        if (!phaseRuns.has(key)) {
          phaseRuns.set(key, { ...create });
        }
        return phaseRuns.get(key)!;
      }),
      findUnique: vi.fn(async ({ where }: { where: { buildId_phase: { buildId: string; phase: string } } }) => {
        const key = `${where.buildId_phase.buildId}:${where.buildId_phase.phase}`;
        return phaseRuns.get(key) ?? null;
      }),
      update: vi.fn(async ({ where, data }: { where: { buildId_phase: { buildId: string; phase: string } }; data: Record<string, unknown> }) => {
        const key = `${where.buildId_phase.buildId}:${where.buildId_phase.phase}`;
        const existing = phaseRuns.get(key) ?? {};
        phaseRuns.set(key, { ...existing, ...data });
        return phaseRuns.get(key)!;
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const key = `${data.buildId}:${data.phase}`;
        phaseRuns.set(key, { ...data });
        return phaseRuns.get(key)!;
      }),
    },
    adapterRunTelemetry: {
      aggregate: vi.fn(async () => ({
        _sum: { inputTokens: 150, outputTokens: 80, estimatedCostUsd: 0.0012 },
        _count: { id: 3 },
      })),
    },
  },
}));

import {
  completeBuildPhaseRun,
  stampBuildPhaseExecutionProfile,
  startBuildPhaseRun,
} from "./build-phase-run";
import { prisma } from "@dpf/db";

beforeEach(() => {
  phaseRuns.clear();
  vi.clearAllMocks();
});

describe("startBuildPhaseRun", () => {
  it("upserts a row with startedAt when called", async () => {
    await startBuildPhaseRun("build-123", "ideate");
    expect(prisma.buildPhaseRun.upsert).toHaveBeenCalledOnce();
    const call = vi.mocked(prisma.buildPhaseRun.upsert).mock.calls[0]![0];
    expect(call.where.buildId_phase).toEqual({ buildId: "build-123", phase: "ideate" });
    expect(call.create.startedAt).toBeInstanceOf(Date);
  });

  it("is idempotent — does not overwrite an existing startedAt on second call", async () => {
    await startBuildPhaseRun("build-123", "ideate");
    await startBuildPhaseRun("build-123", "ideate");
    expect(prisma.buildPhaseRun.upsert).toHaveBeenCalledTimes(2);
    // update: {} means no overwrite on second call
    const secondCall = vi.mocked(prisma.buildPhaseRun.upsert).mock.calls[1]![0];
    expect(secondCall.update).toEqual({});
  });

  it("stamps the compact resolved execution profile on the actual phase row", async () => {
    const executionProfileRef = {
      schemaVersion: 1 as const,
      patternKey: "autonomous-build",
      patternVersion: 2,
      bindingId: "AB-active",
      activityKey: "build.implement",
      riskClass: "internal-reversible" as const,
      modelProfileId: "quality-first",
      providerId: "openai",
      modelId: "gpt-5",
      promotionPolicyKey: "governed-playbook",
      promotionPolicyVersion: 1,
      sourceExperimentTaskRunId: "TR-experiment",
      recoveryPolicyVersion: "autonomous-build-recovery/v1" as const,
    };

    await startBuildPhaseRun("build-profile", "build", {
      executionProfileRef,
    });

    const call = vi.mocked(prisma.buildPhaseRun.upsert).mock.calls[0]![0];
    expect(call.create.executionProfileRef).toEqual(executionProfileRef);
    expect(call.update).toEqual({});
  });

  it("swallows db errors without throwing", async () => {
    vi.mocked(prisma.buildPhaseRun.upsert).mockRejectedValueOnce(new Error("db down"));
    await expect(startBuildPhaseRun("build-123", "ideate")).resolves.not.toThrow();
  });
});

describe("completeBuildPhaseRun", () => {
  it("updates existing row with completedAt and token aggregation", async () => {
    // Arrange: create the start row first
    await startBuildPhaseRun("build-456", "build");
    vi.clearAllMocks(); // reset call counts

    await completeBuildPhaseRun("build-456", "build");
    expect(prisma.buildPhaseRun.update).toHaveBeenCalledOnce();

    const updateCall = vi.mocked(prisma.buildPhaseRun.update).mock.calls[0]![0];
    expect(updateCall.data.completedAt).toBeInstanceOf(Date);
    expect(updateCall.data.inputTokens).toBe(150);
    expect(updateCall.data.outputTokens).toBe(80);
    expect(updateCall.data.inferenceCount).toBe(3);
  });

  it("creates a new row retroactively when no start row exists", async () => {
    await completeBuildPhaseRun("build-789", "review");
    expect(prisma.buildPhaseRun.create).toHaveBeenCalledOnce();
    const createCall = vi.mocked(prisma.buildPhaseRun.create).mock.calls[0]![0];
    expect(createCall.data.phase).toBe("review");
    expect(createCall.data.completedAt).toBeInstanceOf(Date);
  });

  it("passes providerId when provided", async () => {
    await startBuildPhaseRun("build-101", "plan");
    vi.clearAllMocks();

    await completeBuildPhaseRun("build-101", "plan", { providerId: "anthropic" });
    const updateCall = vi.mocked(prisma.buildPhaseRun.update).mock.calls[0]![0];
    expect(updateCall.data.providerId).toBe("anthropic");
  });

  it("stamps the profile when completing a legacy phase without a start row", async () => {
    const executionProfileRef = {
      schemaVersion: 1 as const,
      patternKey: "autonomous-build",
      patternVersion: 2,
      bindingId: "AB-active",
      activityKey: "build.implement",
      riskClass: "internal-reversible" as const,
      modelProfileId: "quality-first",
      providerId: "openai",
      modelId: "gpt-5",
      promotionPolicyKey: "governed-playbook",
      promotionPolicyVersion: 1,
      sourceExperimentTaskRunId: "TR-experiment",
      recoveryPolicyVersion: "autonomous-build-recovery/v1" as const,
    };

    await completeBuildPhaseRun("build-retro-profile", "review", {
      executionProfileRef,
    });

    const createCall = vi.mocked(prisma.buildPhaseRun.create).mock.calls[0]![0];
    expect(createCall.data.executionProfileRef).toEqual(executionProfileRef);
  });

  it("swallows db errors without throwing", async () => {
    vi.mocked(prisma.buildPhaseRun.findUnique).mockRejectedValueOnce(new Error("db down"));
    await expect(completeBuildPhaseRun("build-123", "ideate")).resolves.not.toThrow();
  });
});

describe("stampBuildPhaseExecutionProfile", () => {
  it("updates only the open actual phase row", async () => {
    const executionProfileRef = {
      schemaVersion: 1 as const,
      patternKey: "build-review",
      patternVersion: 2,
      bindingId: "AB-active",
      activityKey: "build.implement",
      riskClass: "internal-reversible" as const,
      modelProfileId: "frontier-coding",
      providerId: "fallback",
      modelId: "fallback-model",
      promotionPolicyKey: "governed-build-playbook-promotion",
      promotionPolicyVersion: 1,
      sourceExperimentTaskRunId: "TR-experiment",
      recoveryPolicyVersion: "autonomous-build-recovery/v1" as const,
    };

    await stampBuildPhaseExecutionProfile(
      "build-profile",
      "ideate",
      executionProfileRef,
    );

    expect(prisma.buildPhaseRun.updateMany).toHaveBeenCalledWith({
      where: {
        buildId: "build-profile",
        phase: "ideate",
        completedAt: null,
      },
      data: { executionProfileRef },
    });
  });
});
