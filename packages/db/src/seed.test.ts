import { describe, it, expect } from "vitest";
import { parseRoleId, parseAgentTier, parseAgentType } from "./seed-helpers.js";

describe("seed helpers", () => {
  it("parseRoleId accepts valid HR-xxx codes", () => {
    expect(parseRoleId("HR-000")).toBe("HR-000");
    expect(parseRoleId("HR-500")).toBe("HR-500");
  });

  it("parseRoleId rejects invalid codes", () => {
    expect(() => parseRoleId("INVALID")).toThrow();
  });

  it("parseAgentTier extracts numeric tier from AGT id", () => {
    expect(parseAgentTier("AGT-ORCH-000")).toBe(1);
    expect(parseAgentTier("AGT-100")).toBe(2);
    expect(parseAgentTier("AGT-900")).toBe(3);
  });

  it("parseAgentType classifies correctly", () => {
    expect(parseAgentType("AGT-ORCH-000")).toBe("orchestrator");
    expect(parseAgentType("AGT-100")).toBe("specialist");
    expect(parseAgentType("AGT-900")).toBe("cross-cutting");
  });

  it("exports seedEaReferenceModels", async () => {
    const mod = await import("./index.js");
    expect(typeof mod.seedEaReferenceModels).toBe("function");
  });
});
