import { describe, expect, it } from "vitest";
import { currentInferenceOrigin } from "@/lib/inference/inference-admission";
import { runAsBuildPhase } from "./build-phase-inference-origin";

describe("runAsBuildPhase (BI-2F9DE752)", () => {
  it("binds the autonomous inference origin for the whole async subtree", async () => {
    expect(currentInferenceOrigin()).toBe("interactive");
    const seen = await runAsBuildPhase(async () => {
      await Promise.resolve();
      return currentInferenceOrigin();
    });
    expect(seen).toBe("autonomous");
    expect(currentInferenceOrigin()).toBe("interactive");
  });
});
