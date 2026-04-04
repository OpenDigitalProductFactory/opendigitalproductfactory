import { describe, expect, it } from "vitest";
import {
  shouldDegradeModelForInterfaceDrift,
  shouldReconcileProviderAfterError,
} from "./provider-reconciliation";

describe("provider reconciliation heuristics", () => {
  it("reconciles after model_not_found", () => {
    expect(
      shouldReconcileProviderAfterError("model_not_found", "Model not found on provider"),
    ).toBe(true);
  });

  it("reconciles after unsupported parameter drift", () => {
    expect(
      shouldReconcileProviderAfterError(
        "provider_error",
        "Unsupported parameter: reasoning_effort",
      ),
    ).toBe(true);
  });

  it("degrades after unsupported tool drift", () => {
    expect(
      shouldDegradeModelForInterfaceDrift(
        "provider_error",
        "Function calling is not supported for this model",
      ),
    ).toBe(true);
  });

  it("does not reconcile auth failures", () => {
    expect(
      shouldReconcileProviderAfterError("auth", "Invalid API key"),
    ).toBe(false);
  });

  it("does not reconcile plain network failures", () => {
    expect(
      shouldReconcileProviderAfterError("network", "ECONNRESET"),
    ).toBe(false);
  });
});
