import { describe, expect, it } from "vitest";

import { resolveCallConsequence } from "@/lib/tool-consequence";

import { workroomRuntimeConsequence } from "./runtime-consequence";

const tool = { consequence: "authority" as const, consequenceForCall: workroomRuntimeConsequence };
const call = (action: unknown) => resolveCallConsequence(tool, { toolName: "drive_workroom_runtime", params: { capsuleId: "WC-1", action }, userId: "u1" });

describe("drive_workroom_runtime per-call consequence", () => {
  it("does not gate reading or talking to an approved session", async () => {
    for (const action of ["status", "turn", "steer", "interrupt"]) {
      await expect(call(action)).resolves.toMatchObject({ consequence: null });
    }
  });

  it("keeps start, stop, decide and anything unknown consequential", async () => {
    for (const action of ["start", "stop", "decide", "fly", undefined]) {
      await expect(call(action)).resolves.toMatchObject({ consequence: "authority" });
    }
  });
});
