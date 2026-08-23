import { beforeEach, describe, expect, it, vi } from "vitest";
import { SETUP_STEPS, type StepStatus } from "@/lib/actions/setup-constants";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
  runSetupCompletionSeeds: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    platformSetupProgress: {
      findFirst: mocks.findFirst,
      update: mocks.update,
    },
    organization: { findFirst: vi.fn() },
  },
}));
vi.mock("./setup-completion-seeds", () => ({
  runSetupCompletionSeeds: mocks.runSetupCompletionSeeds,
}));

import { completeSetupStepFromEvidence } from "./setup-progress-service.server";

function pendingSteps(): Record<string, StepStatus> {
  return Object.fromEntries(SETUP_STEPS.map((step) => [step, "pending"]));
}

describe("completeSetupStepFromEvidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockImplementation(async ({ data }: { data: unknown }) => data);
  });

  it("records storefront evidence without skipping an earlier pending step", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "progress-1",
      organizationId: "org-1",
      currentStep: "operating-hours",
      completedAt: null,
      steps: {
        ...pendingSteps(),
        "account-bootstrap": "completed",
        "business-context": "completed",
        "ai-providers": "completed",
        branding: "completed",
        "how-you-decide": "completed",
      },
    });

    await completeSetupStepFromEvidence("org-1", "storefront");

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "progress-1" },
      data: expect.objectContaining({
        currentStep: "operating-hours",
        steps: expect.objectContaining({ storefront: "completed" }),
      }),
    });
    expect(mocks.runSetupCompletionSeeds).not.toHaveBeenCalled();
  });

  it("does nothing when the evidence is already reflected", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "progress-1",
      organizationId: "org-1",
      currentStep: "platform-development",
      completedAt: null,
      steps: {
        ...pendingSteps(),
        "account-bootstrap": "completed",
        "business-context": "completed",
        "ai-providers": "completed",
        branding: "completed",
        "how-you-decide": "completed",
        "operating-hours": "completed",
        storefront: "completed",
      },
    });

    await completeSetupStepFromEvidence("org-1", "storefront");

    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("runs completion seeds only when the final pending step is resolved", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "progress-1",
      organizationId: "org-1",
      currentStep: "workspace",
      completedAt: null,
      steps: Object.fromEntries(
        SETUP_STEPS.map((step) => [step, step === "workspace" ? "pending" : "completed"]),
      ),
    });

    await completeSetupStepFromEvidence("org-1", "workspace");

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "progress-1" },
      data: expect.objectContaining({ completedAt: expect.any(Date) }),
    });
    expect(mocks.runSetupCompletionSeeds).toHaveBeenCalledWith("org-1");
  });
});
