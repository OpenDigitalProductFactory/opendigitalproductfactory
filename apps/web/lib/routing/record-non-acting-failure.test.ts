/**
 * DPF2-REMOVABLE BRIDGE TEST (TDD).
 *
 * Verifies the non-acting penalty writer: one RouteOutcome with
 * toolSuccess=false carrying the synthetic non-acting provider error code,
 * counted against the exact route. RouteOutcome is the single durable record
 * of the miss (no separate tally table).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./route-outcome", () => ({
  recordRouteOutcome: vi.fn(),
}));

import { recordRouteOutcome } from "./route-outcome";
import { recordNonActingFailure } from "./record-non-acting-failure";
import { NON_ACTING_BRIDGE_CONFIG } from "./non-acting-bridge-config";

const BASE_INPUT = {
  providerId: "openai",
  modelId: "gpt-4o",
  adapter: "responses",
  taskType: "tool-action",
};

describe("recordNonActingFailure (non-acting bridge)", () => {
  beforeEach(() => {
    vi.mocked(recordRouteOutcome).mockReset();
    vi.mocked(recordRouteOutcome).mockResolvedValue(undefined);
  });

  it("records one failed RouteOutcome with the non-acting error code, keyed on the route", async () => {
    await recordNonActingFailure(BASE_INPUT);

    expect(recordRouteOutcome).toHaveBeenCalledOnce();
    expect(recordRouteOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "openai",
        modelId: "gpt-4o",
        taskType: "tool-action",
        contractFamily: "tool-action",
        toolSuccess: false,
        fallbackOccurred: false,
        providerErrorCode: NON_ACTING_BRIDGE_CONFIG.nonActingProviderErrorCode,
      }),
    );
  });

  it("never throws when the outcome write fails (fire-and-forget)", async () => {
    vi.mocked(recordRouteOutcome).mockRejectedValue(new Error("DB connection lost"));

    await expect(recordNonActingFailure(BASE_INPUT)).resolves.toBeUndefined();
  });
});
