import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma with in-memory state
vi.mock("@dpf/db", () => {
  const records: Record<string, any> = {};
  return {
    prisma: {
      organization: { count: vi.fn(() => 0) },
      platformSetupProgress: {
        findFirst: vi.fn(() => null),
        findUniqueOrThrow: vi.fn((args: any) => {
          const record = records[args.where.id];
          if (!record) throw new Error(`Record not found: ${args.where.id}`);
          return record;
        }),
        create: vi.fn((args: any) => {
          const record = { id: "setup-1", ...args.data, completedAt: null };
          records["setup-1"] = record;
          return record;
        }),
        update: vi.fn((args: any) => {
          const existing = records[args.where.id];
          if (!existing) throw new Error(`Record not found: ${args.where.id}`);
          const record = { ...existing, ...args.data };
          records[args.where.id] = record;
          return record;
        }),
      },
    },
  };
});

import {
  isFirstRun,
  createSetupProgress,
  advanceStep,
  skipStep,
} from "./setup-progress";
import { SETUP_STEPS } from "./setup-constants";

// SETUP_STEPS has 8 entries:
//   0: business-identity
//   1: owner-account
//   2: ai-capabilities
//   3: branding
//   4: financial-basics
//   5: first-workspace
//   6: extensibility-preview
//   7: whats-next

describe("setup flow integration", () => {
  it("walks through the full step sequence", async () => {
    // First run detected
    expect(await isFirstRun()).toBe(true);

    // Create setup progress — starts at index 0
    const progress = await createSetupProgress();
    expect(progress.currentStep).toBe("business-identity");

    // Advance step 0 → moves to index 1
    const step2 = await advanceStep(progress.id, { orgName: "Test Co" });
    expect(step2.currentStep).toBe("owner-account");

    // Skip step 1 → moves to index 2
    const step3 = await skipStep(progress.id);
    expect(step3.currentStep).toBe("ai-capabilities");

    // Now at index 2. Need to advance through indices 2, 3, 4, 5, 6 without completing (5 advances),
    // then one final advance on index 7 that sets completedAt.

    let current = step3;

    // Advances on indices 2, 3, 4, 5, 6 — each moves forward without completing
    for (let i = 0; i < 5; i++) {
      current = await advanceStep(progress.id);
    }

    // After 5 advances from index 2, we are on index 7 (whats-next)
    expect(current.currentStep).toBe("whats-next");

    // Final advance on index 7 — nextStep is null → sets completedAt
    const final = await advanceStep(progress.id);
    expect(final.completedAt).toBeTruthy();
  });
});
