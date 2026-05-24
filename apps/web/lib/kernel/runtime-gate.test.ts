import { describe, expect, it } from "vitest";
import { evaluateExecution, type EnforceablePrinciple } from "./runtime-gate";

describe("evaluateExecution — empty registry", () => {
  it("allows everything when no principles are registered", () => {
    expect(
      evaluateExecution(
        { kind: "shell", command: "docker", args: ["volume", "rm", "dpf_pgdata"] },
        "interactive",
        [],
      ),
    ).toEqual({ verdict: "allow" });
  });
});
