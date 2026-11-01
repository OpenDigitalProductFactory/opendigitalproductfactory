import { describe, expect, it } from "vitest";
import { SETUP_STEPS, STEP_ROUTES, visibleSetupSteps, type StepStatus } from "@/lib/actions/setup-constants";
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
    expect(result.currentStep).toBe("mailroom");
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

function stepsReadyForMonitoring(): Record<string, StepStatus> {
  return Object.fromEntries(
    SETUP_STEPS.map((step) => [
      step,
      SETUP_STEPS.indexOf(step) <= SETUP_STEPS.indexOf("platform-development") ? "completed" : "pending",
    ]),
  ) as Record<string, StepStatus>;
}

describe("monitoring setup step", () => {
  it("includes monitoring and its settings route only while the decision is undecided", () => {
    expect(visibleSetupSteps("undecided")).toContain("monitoring");
    expect(SETUP_STEPS.indexOf("monitoring")).toBe(SETUP_STEPS.indexOf("platform-development") + 1);
    expect(STEP_ROUTES.monitoring).toBe("/admin/settings/monitoring");
    const projected = projectSetupStepCompletion({
      completedStep: "platform-development",
      steps: stepsReadyForMonitoring(),
      monitoringDecision: "undecided",
    });
    expect(projected.steps.monitoring).toBe("pending");
    expect(projected.currentStep).toBe("monitoring");
  });

  it("omits monitoring when the decision is enabled, disabled, or absent", () => {
    for (const decision of ["enabled", "disabled", null, undefined] as const) {
      expect(visibleSetupSteps(decision)).not.toContain("monitoring");
    }
  });

  it("completes a recorded decision so monitoring is not the current pending step", () => {
    for (const decision of ["enabled", "disabled"] as const) {
      const projected = projectSetupStepCompletion({
        completedStep: "platform-development",
        steps: stepsReadyForMonitoring(),
        monitoringDecision: decision,
      });
      expect(projected.steps.monitoring).toBe("completed");
      expect(projected.currentStep).toBe("build-studio");
    }
  });

  it("skips an absent decision so the hidden step does not block the next one", () => {
    const projected = projectSetupStepCompletion({
      completedStep: "platform-development",
      steps: stepsReadyForMonitoring(),
      monitoringDecision: null,
    });
    expect(projected.steps.monitoring).toBe("skipped");
    expect(projected.currentStep).toBe("build-studio");
    expect(projected.isComplete).toBe(false);
  });
});
