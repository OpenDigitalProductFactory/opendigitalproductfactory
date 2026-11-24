import { describe, expect, it, vi } from "vitest";

const { proposeMock } = vi.hoisted(() => ({
  proposeMock: vi.fn(),
}));

vi.mock("@/lib/tak/work-pattern-experiment-candidate", () => ({
  proposeWorkPatternExperimentCandidate: proposeMock,
}));

import { TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";
import { workPatternExperimentPack } from "./work-pattern-experiment-pack";

describe("work-pattern-experiment pack", () => {
  it("registers propose_work_pattern_experiment_candidate with authority consequence and matching grant", () => {
    expect(workPatternExperimentPack.packId).toBe("work-pattern-experiment");
    expect(workPatternExperimentPack.definitions.map((d) => d.name)).toEqual([
      "propose_work_pattern_experiment_candidate",
    ]);
    const def = workPatternExperimentPack.definitions[0];
    expect(def.requiredCapability).toBe("manage_platform");
    expect(def.sideEffect).toBe(true);
    expect(def.consequence).toBe("authority");
    expect(workPatternExperimentPack.grants.propose_work_pattern_experiment_candidate).toEqual([
      "registry_write",
    ]);
    expect(TOOL_TO_GRANTS.propose_work_pattern_experiment_candidate).toEqual([
      "registry_write",
    ]);
  });

  it("returns structured success on proposed/reused and failure on rejected", async () => {
    proposeMock.mockResolvedValueOnce({
      status: "proposed",
      assessmentId: "CWSA-1",
      needId: "CWN-1",
      agentId: "build-specialist",
      patternKey: "build.implement:dpf-standard",
      experimentDefinitionKey: "def-1",
      fingerprint: "fp-1",
      reviewRoute: "/platform/ai/agent/build-specialist",
    });

    const ok = await workPatternExperimentPack.handlers.propose_work_pattern_experiment_candidate(
      {
        agentId: "build-specialist",
        need: "Prove standard loop",
        blocks: "Unblocks enforce mode",
        candidate: {},
      },
      "user-1",
    );
    expect(ok.success).toBe(true);
    expect(ok.entityId).toBe("CWN-1");
    expect(ok.message).toContain("/platform/ai/agent/build-specialist");

    proposeMock.mockResolvedValueOnce({
      status: "rejected",
      reason: "authority_ceiling",
    });
    const bad = await workPatternExperimentPack.handlers.propose_work_pattern_experiment_candidate(
      {
        agentId: "build-specialist",
        need: "Bad candidate",
        blocks: "None",
        candidate: {},
      },
      "user-1",
    );
    expect(bad.success).toBe(false);
    expect(bad.error).toBe("authority_ceiling");
  });
});
