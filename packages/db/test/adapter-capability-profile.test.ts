import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "../src/client";
import { Prisma } from "../generated/client/client";

// Task A1 of the coworker execution adapter substrate:
//   docs/superpowers/plans/2026-04-29-coworker-execution-adapter-substrate-plan.md
//   docs/superpowers/specs/2026-04-29-coworker-execution-adapter-substrate-design.md §4.1
//
// AdapterCapabilityProfile captures observed adapter capabilities per
// (adapterKind, adapterVersion). The unique compound key is the cache key —
// the same kind+version reuses the profile until TTL or version changes.

const TEST_ADAPTER_KIND = "test-adapter-a1";
const TEST_ADAPTER_VERSION_A = "1.0.0-a1-test";
const TEST_ADAPTER_VERSION_B = "1.0.0-a1-test-b";

async function clearTestRows() {
  await prisma.adapterCapabilityProfile.deleteMany({
    where: { adapterKind: TEST_ADAPTER_KIND },
  });
}

beforeEach(async () => {
  await clearTestRows();
});

afterAll(async () => {
  await clearTestRows();
  await prisma.$disconnect();
});

function buildProfileInput(
  adapterVersion: string,
): Prisma.AdapterCapabilityProfileCreateInput {
  return {
    adapterKind: TEST_ADAPTER_KIND,
    adapterVersion,
    probedAt: new Date(),
    probedBy: "vitest:adapter-capability-profile",

    supportsStreamingEvents: true,
    supportsMcpAttach: true,
    supportsMcpAttachPerInvoke: false,
    supportsSubagents: false,
    supportsHooks: true,
    supportsPlanState: false,
    supportsTodoState: true,
    supportsWebFetch: false,
    supportsWebSearch: false,
    supportsSessionResume: true,
    supportsExtendedThinking: false,
    supportsOutputSchema: false,

    maxInteractiveLatencyMs: 180_000,
    supportedAuthModes: ["api-key", "oauth"],

    knownDegradations: [
      {
        trigger: "--json + MCP",
        behavior: "stream malformed",
        source: "openai/codex#15451",
      },
    ],
  };
}

describe("AdapterCapabilityProfile prisma model", () => {
  it("exposes the AdapterCapabilityProfile delegate and model name", () => {
    expect(Prisma.ModelName.AdapterCapabilityProfile).toBe(
      "AdapterCapabilityProfile",
    );
    expect(prisma.adapterCapabilityProfile).toBeDefined();
  });

  it("creates a row with all required capability fields", async () => {
    const created = await prisma.adapterCapabilityProfile.create({
      data: buildProfileInput(TEST_ADAPTER_VERSION_A),
    });

    expect(created.id).toBeDefined();
    expect(created.adapterKind).toBe(TEST_ADAPTER_KIND);
    expect(created.adapterVersion).toBe(TEST_ADAPTER_VERSION_A);
    expect(created.supportsStreamingEvents).toBe(true);
    expect(created.supportsMcpAttachPerInvoke).toBe(false);
    expect(created.supportedAuthModes).toEqual(["api-key", "oauth"]);
    expect(created.maxInteractiveLatencyMs).toBe(180_000);
    expect(created.knownDegradations).toEqual([
      {
        trigger: "--json + MCP",
        behavior: "stream malformed",
        source: "openai/codex#15451",
      },
    ]);
  });

  it("rejects duplicate (adapterKind, adapterVersion) with a unique-constraint error", async () => {
    await prisma.adapterCapabilityProfile.create({
      data: buildProfileInput(TEST_ADAPTER_VERSION_A),
    });

    await expect(
      prisma.adapterCapabilityProfile.create({
        data: buildProfileInput(TEST_ADAPTER_VERSION_A),
      }),
    ).rejects.toMatchObject({
      // Prisma maps Postgres 23505 unique violation to error code P2002.
      code: "P2002",
    });
  });

  it("permits the same adapterKind across distinct adapterVersions", async () => {
    await prisma.adapterCapabilityProfile.create({
      data: buildProfileInput(TEST_ADAPTER_VERSION_A),
    });

    const second = await prisma.adapterCapabilityProfile.create({
      data: buildProfileInput(TEST_ADAPTER_VERSION_B),
    });

    expect(second.adapterKind).toBe(TEST_ADAPTER_KIND);
    expect(second.adapterVersion).toBe(TEST_ADAPTER_VERSION_B);
  });
});
