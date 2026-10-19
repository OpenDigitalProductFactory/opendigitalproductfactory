import { describe, expect, it, vi } from "vitest";
import { ProviderAccountSelectionChangedError } from "../routing/provider-account-candidates";
import { NativeCliExecutionUncertainError } from "../routing/cli-owned-runner";
import {
  ProviderReconciliationRequiredError,
  shouldDegradeModelForInterfaceDrift,
  shouldReconcileProviderAfterError,
  withProviderReconciliationRetry,
} from "./provider-reconciliation";

describe("provider reconciliation heuristics", () => {
  it("rebuilds a stale account route once before dispatch without replaying uncertain native execution", async () => {
    const beforeRetry = vi.fn();
    const attempt = vi.fn().mockRejectedValueOnce(new ProviderAccountSelectionChangedError("openai", "Selected provider account changed")).mockResolvedValueOnce("fresh selection");
    await expect(withProviderReconciliationRetry(attempt, beforeRetry)).resolves.toBe("fresh selection");
    expect(attempt).toHaveBeenCalledTimes(2);
    attempt.mockReset().mockRejectedValue(new NativeCliExecutionUncertainError("codex"));
    await expect(withProviderReconciliationRetry(attempt, beforeRetry)).rejects.toBeInstanceOf(NativeCliExecutionUncertainError);
    expect(attempt).toHaveBeenCalledTimes(1);
  });
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

  it("retries one route build after reconciliation and never loops", async () => {
    const reconcile = vi.fn();
    const attempt = vi.fn()
      .mockRejectedValueOnce(new ProviderReconciliationRequiredError(["openai"], []))
      .mockResolvedValueOnce("recovered");

    await expect(withProviderReconciliationRetry(attempt, reconcile)).resolves.toBe("recovered");
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(reconcile).toHaveBeenCalledTimes(1);

    attempt.mockReset().mockRejectedValue(new ProviderReconciliationRequiredError(["openai"], []));
    await expect(withProviderReconciliationRetry(attempt, reconcile))
      .rejects.toBeInstanceOf(ProviderReconciliationRequiredError);
    expect(attempt).toHaveBeenCalledTimes(2);
  });
});
