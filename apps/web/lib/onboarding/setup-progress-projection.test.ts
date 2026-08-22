import { describe, expect, it } from "vitest";
import { SETUP_STEPS, type StepStatus } from "@/lib/actions/setup-constants";
import { projectSetupStepCompletion } from "./setup-progress-projection";

function pendingSteps(): Record<string, StepStatus> {
  return Object.fromEntries(SETUP_STEPS.map((step) => [step, "pending"]));
}

describe("projectSetupStepCompletion", () => {
  it("advances to the first remaining pending step", () => {
    const result = projectSetupStepCompletion({
      completedStep: "storefront",
      steps: {
        ...pendingSteps(),
        "account-bootstrap": "completed",
        "business-context": "completed",
        "ai-providers": "completed",
        branding: "completed",
        "how-you-decide": "completed",
        "operating-hours": "completed",
      },
    });

    expect(result.steps.storefront).toBe("completed");
    expect(result.currentStep).toBe("platform-development");
    expect(result.isComplete).toBe(false);
  });

  it("records out-of-order evidence without skipping an earlier pending step", () => {
    const result = projectSetupStepCompletion({
      completedStep: "storefront",
      steps: {
        ...pendingSteps(),
        "account-bootstrap": "completed",
        "business-context": "completed",
        "ai-providers": "completed",
        branding: "completed",
        "how-you-decide": "completed",
      },
    });

    expect(result.steps.storefront).toBe("completed");
    expect(result.currentStep).toBe("operating-hours");
  });

  it("is idempotent and reports completion only after every step is resolved", () => {
    const resolved = Object.fromEntries(
      SETUP_STEPS.map((step) => [step, step === "storefront" ? "pending" : "completed"]),
    ) as Record<string, StepStatus>;

    const first = projectSetupStepCompletion({ completedStep: "storefront", steps: resolved });
    const second = projectSetupStepCompletion({ completedStep: "storefront", steps: first.steps });

    expect(second).toEqual(first);
    expect(second.currentStep).toBe("storefront");
    expect(second.isComplete).toBe(true);
  });
});
