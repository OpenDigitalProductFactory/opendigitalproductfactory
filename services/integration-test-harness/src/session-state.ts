import type { ScenarioStateStore } from "./types.js";

export function createScenarioStateStore(): ScenarioStateStore {
  const state = new Map<string, string>();

  return {
    getScenario(vendor: string, sessionId: string): string | null {
      return state.get(buildKey(vendor, sessionId)) ?? null;
    },
    setScenario(vendor: string, sessionId: string, scenario: string): void {
      state.set(buildKey(vendor, sessionId), scenario);
    },
  };
}

function buildKey(vendor: string, sessionId: string): string {
  return `${vendor}::${sessionId}`;
}
