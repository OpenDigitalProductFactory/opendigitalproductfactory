import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "../src/client";
import { Prisma } from "../generated/client/client";

// Task A2 of the coworker execution adapter substrate:
//   docs/superpowers/plans/2026-04-29-coworker-execution-adapter-substrate-plan.md
//   docs/superpowers/specs/2026-04-29-coworker-execution-adapter-substrate-design.md §4.3
//
// AdapterRunTelemetry captures one row per adapter execution attempt. It is
// the canonical run ledger feeding outcome scoring and shadow/race comparison.

const TEST_ADAPTER_KIND = "test-adapter-a2";

async function clearTestRows() {
  await prisma.adapterRunTelemetry.deleteMany({
    where: { adapterKind: { startsWith: TEST_ADAPTER_KIND } },
  });
}

beforeEach(async () => {
  await clearTestRows();
});

afterAll(async () => {
  await clearTestRows();
  await prisma.$disconnect();
});

function buildTelemetryInput(
  overrides: Partial<Prisma.AdapterRunTelemetryCreateInput> = {},
): Prisma.AdapterRunTelemetryCreateInput {
  return {
    adapterKind: TEST_ADAPTER_KIND,
    adapterVersion: "1.0.0-a2-test",
    providerId: "test-provider",
    modelId: "test-model",

    executionMode: "single",
    startedAt: new Date(),

    status: "success",
    inputTokens: 100,
    outputTokens: 50,
    estimatedCostUsd: new Prisma.Decimal("0.001234"),
    capabilitiesUsed: ["supportsStreamingEvents"],

    ...overrides,
  };
}

describe("AdapterRunTelemetry prisma model", () => {
  it("exposes the AdapterRunTelemetry delegate and model name", () => {
    expect(Prisma.ModelName.AdapterRunTelemetry).toBe("AdapterRunTelemetry");
    expect(prisma.adapterRunTelemetry).toBeDefined();
  });

  it("creates a row with all required fields", async () => {
    const created = await prisma.adapterRunTelemetry.create({
      data: buildTelemetryInput(),
    });

    expect(created.id).toBeDefined();
    expect(created.adapterKind).toBe(TEST_ADAPTER_KIND);
    expect(created.executionMode).toBe("single");
    expect(created.status).toBe("success");
    expect(created.inputTokens).toBe(100);
    expect(created.toolCallsTotal).toBe(0); // default
    expect(created.toolCallsInvalid).toBe(0); // default
    expect(created.schemaDriftDetected).toBe(false); // default
  });

  it("preserves Decimal(10, 6) precision for estimatedCostUsd", async () => {
    const cost = new Prisma.Decimal("0.123456");
    const created = await prisma.adapterRunTelemetry.create({
      data: buildTelemetryInput({ estimatedCostUsd: cost }),
    });

    const fetched = await prisma.adapterRunTelemetry.findUniqueOrThrow({
      where: { id: created.id },
    });

    expect(fetched.estimatedCostUsd).not.toBeNull();
    expect(fetched.estimatedCostUsd!.toString()).toBe("0.123456");
  });

  it("round-trips the capabilitiesUsed String[] array", async () => {
    const caps = [
      "supportsStreamingEvents",
      "supportsMcpAttach",
      "supportsTodoState",
    ];
    const created = await prisma.adapterRunTelemetry.create({
      data: buildTelemetryInput({ capabilitiesUsed: caps }),
    });

    const fetched = await prisma.adapterRunTelemetry.findUniqueOrThrow({
      where: { id: created.id },
    });

    expect(fetched.capabilitiesUsed).toEqual(caps);
  });

  it("permits omission of all nullable fields", async () => {
    const created = await prisma.adapterRunTelemetry.create({
      data: {
        adapterKind: TEST_ADAPTER_KIND,
        adapterVersion: "1.0.0-a2-test",
        providerId: "test-provider",
        modelId: "test-model",
        executionMode: "single",
        startedAt: new Date(),
        status: "success",
        capabilitiesUsed: [],
      },
    });

    expect(created.threadId).toBeNull();
    expect(created.agentMessageId).toBeNull();
    expect(created.buildId).toBeNull();
    expect(created.raceCohortId).toBeNull();
    expect(created.finishedAt).toBeNull();
    expect(created.durationMs).toBeNull();
    expect(created.firstEventLatencyMs).toBeNull();
    expect(created.refusalReason).toBeNull();
    expect(created.errorClass).toBeNull();
    expect(created.inputTokens).toBeNull();
    expect(created.cachedInputTokens).toBeNull();
    expect(created.outputTokens).toBeNull();
    expect(created.reasoningTokens).toBeNull();
    expect(created.estimatedCostUsd).toBeNull();
    expect(created.quotaPoolConsumed).toBeNull();
    expect(created.userAccepted).toBeNull();
    expect(created.acceptedAt).toBeNull();
    expect(created.rawEventDigest).toBeNull();
  });

  it("groups concurrent runs by raceCohortId", async () => {
    const cohortId = `cohort-${Date.now()}`;

    await prisma.adapterRunTelemetry.create({
      data: buildTelemetryInput({
        adapterKind: `${TEST_ADAPTER_KIND}-primary`,
        executionMode: "race-primary",
        raceCohortId: cohortId,
      }),
    });

    await prisma.adapterRunTelemetry.create({
      data: buildTelemetryInput({
        adapterKind: `${TEST_ADAPTER_KIND}-loser`,
        executionMode: "race-loser",
        raceCohortId: cohortId,
      }),
    });

    const cohortRows = await prisma.adapterRunTelemetry.findMany({
      where: { raceCohortId: cohortId },
      orderBy: { adapterKind: "asc" },
    });

    expect(cohortRows).toHaveLength(2);
    expect(cohortRows[0].executionMode).toBe("race-loser");
    expect(cohortRows[1].executionMode).toBe("race-primary");
  });

  it("captures the three status-like fields independently", async () => {
    const created = await prisma.adapterRunTelemetry.create({
      data: buildTelemetryInput({
        status: "refusal",
        executionMode: "shadow-alt",
        quotaPoolConsumed: "anthropic-oauth",
      }),
    });

    expect(created.status).toBe("refusal");
    expect(created.executionMode).toBe("shadow-alt");
    expect(created.quotaPoolConsumed).toBe("anthropic-oauth");
  });
});
