import { describe, expect, it } from "vitest";
import { AGENT_MODEL_CONFIG_DEFAULTS } from "./agent-model-defaults";

describe("agent model config defaults", () => {
  it("covers route specialists that require tool-backed coworker work", () => {
    const byId = new Map(AGENT_MODEL_CONFIG_DEFAULTS.map((entry) => [entry.agentId, entry]));

    expect(byId.get("finance-agent")?.minimumCapabilities?.toolUse).toBe(true);
    expect(byId.get("finance-agent")?.minimumTier).toBe("strong");
    expect(byId.get("licensing-specialist")?.minimumCapabilities?.toolUse).toBe(true);
    expect(byId.get("licensing-specialist")?.minimumTier).toBe("strong");
  });
});
