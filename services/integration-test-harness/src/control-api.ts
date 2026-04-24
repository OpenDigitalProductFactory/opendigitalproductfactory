import type { ScenarioControlDeps, ScenarioControlInput, ScenarioControlResult } from "./types.js";

export class ControlApiError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "ControlApiError";
    this.statusCode = statusCode;
  }
}

export async function applyScenarioControl(
  input: ScenarioControlInput,
  deps: ScenarioControlDeps,
): Promise<ScenarioControlResult> {
  if (!deps.isTestMode) {
    throw new ControlApiError("Scenario control is only available in explicit test mode", 403);
  }

  if (!input.sessionId.trim()) {
    throw new ControlApiError("sessionId is required", 400);
  }

  if (input.providedToken !== deps.controlToken) {
    throw new ControlApiError("Invalid control token", 401);
  }

  deps.state.setScenario(input.vendor, input.sessionId, input.scenario);

  await deps.logAdminEvent({
    kind: "scenario_flip",
    vendor: input.vendor,
    sessionId: input.sessionId,
    scenario: input.scenario,
    changedAt: new Date().toISOString(),
  });

  return {
    vendor: input.vendor,
    scenario: input.scenario,
    sessionId: input.sessionId,
  };
}
