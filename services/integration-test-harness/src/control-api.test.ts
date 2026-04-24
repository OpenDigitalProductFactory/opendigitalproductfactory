import { describe, expect, it, vi } from "vitest";

import { applyScenarioControl, ControlApiError } from "./control-api.js";
import { createScenarioStateStore } from "./session-state.js";

describe("control-api", () => {
  it("rejects missing sessionId", async () => {
    const state = createScenarioStateStore();

    await expect(
      applyScenarioControl(
        {
          vendor: "adp",
          scenario: "happy-path",
          sessionId: "",
          providedToken: "secret-token",
        },
        {
          isTestMode: true,
          controlToken: "secret-token",
          state,
          logAdminEvent: vi.fn(async () => {}),
        },
      ),
    ).rejects.toBeInstanceOf(ControlApiError);
  });

  it("rejects missing or invalid shared secret", async () => {
    const state = createScenarioStateStore();

    await expect(
      applyScenarioControl(
        {
          vendor: "adp",
          scenario: "happy-path",
          sessionId: "run-1",
          providedToken: "wrong-token",
        },
        {
          isTestMode: true,
          controlToken: "secret-token",
          state,
          logAdminEvent: vi.fn(async () => {}),
        },
      ),
    ).rejects.toBeInstanceOf(ControlApiError);
  });

  it("rejects requests when not in explicit test mode", async () => {
    const state = createScenarioStateStore();

    await expect(
      applyScenarioControl(
        {
          vendor: "adp",
          scenario: "happy-path",
          sessionId: "run-1",
          providedToken: "secret-token",
        },
        {
          isTestMode: false,
          controlToken: "secret-token",
          state,
          logAdminEvent: vi.fn(async () => {}),
        },
      ),
    ).rejects.toBeInstanceOf(ControlApiError);
  });

  it("stores scenario state per vendor and session and logs an admin event", async () => {
    const state = createScenarioStateStore();
    const logAdminEvent = vi.fn(async () => {});

    const result = await applyScenarioControl(
      {
        vendor: "adp",
        scenario: "rate-limited",
        sessionId: "ci-run-42",
        providedToken: "secret-token",
      },
      {
        isTestMode: true,
        controlToken: "secret-token",
        state,
        logAdminEvent,
      },
    );

    expect(result).toEqual({
      vendor: "adp",
      scenario: "rate-limited",
      sessionId: "ci-run-42",
    });
    expect(state.getScenario("adp", "ci-run-42")).toBe("rate-limited");
    expect(logAdminEvent).toHaveBeenCalledTimes(1);
  });
});
