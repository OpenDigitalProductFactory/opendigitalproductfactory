import { describe, it, expect, vi } from "vitest";

// Mock prisma with in-memory state
vi.mock("@dpf/db", () => {
  const records: Record<string, any> = {};
  return {
    prisma: {
      organization: {
        count: vi.fn(() => 0),
        findFirst: vi.fn(() => null),
      },
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

// SETUP_STEPS has 9 entries:
//   0: account-bootstrap
//   1: ai-providers
//   2: branding
//   3: business-context
//   4: operating-hours
//   5: storefront
//   6: platform-development
//   7: build-studio
//   8: workspace

describe("setup flow integration", () => {
  it("walks through the full step sequence", async () => {
    // First run detected
    expect(await isFirstRun()).toBe(true);

    // Create setup progress — starts at step 0
    const progress = await createSetupProgress();
    expect(progress.currentStep).toBe("account-bootstrap");

    // Advance step 0 → step 1
    const step1 = await advanceStep(progress.id, { orgName: "Test Co" });
    expect(step1.currentStep).toBe("ai-providers");

    // Skip step 1 → step 2
    const step2 = await skipStep(progress.id);
    expect(step2.currentStep).toBe("branding");

    // Advance step 2 → step 3
    const step3 = await advanceStep(progress.id);
    expect(step3.currentStep).toBe("business-context");

    // Advance step 3 → step 4
    const step4 = await advanceStep(progress.id);
    expect(step4.currentStep).toBe("operating-hours");

    const step5 = await advanceStep(progress.id);
    expect(step5.currentStep).toBe("storefront");

    const step6 = await advanceStep(progress.id);
    expect(step6.currentStep).toBe("platform-development");

    const step7 = await advanceStep(progress.id);
    expect(step7.currentStep).toBe("build-studio");

    // Advance into the final workspace step
    const step8 = await advanceStep(progress.id);
    expect(step8.currentStep).toBe("workspace");

    // Advance workspace — final, sets completedAt
    const final = await advanceStep(progress.id);
    expect(final.completedAt).toBeTruthy();
  });

  it("keeps the final setup step at workspace before completion", async () => {
    const progress = await createSetupProgress();

    let current = progress;
    for (let i = 0; i < SETUP_STEPS.length - 1; i += 1) {
      current = await advanceStep(current.id);
    }

    expect(current.currentStep).toBe("workspace");
  });
});
