import { describe, expect, it } from "vitest";
import { evaluateExecution, type EnforceablePrinciple } from "./runtime-gate";

const NEVER_WIPE_DB: EnforceablePrinciple = {
  id: "p1",
  slug: "never-wipe-db-for-code-fixes",
  tier: "commandment",
  runtime: {
    interactiveMode: "confirm",
    autonomousMode: "refuse",
    patterns: [
      { kind: "shell", regex: "^docker\\s+volume\\s+rm\\b", rationale: "Wipes operator state" },
    ],
  },
};

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

describe("evaluateExecution — shell refuse (autonomous)", () => {
  it("refuses a shell command matching a commandment in autonomous mode", () => {
    const d = evaluateExecution(
      { kind: "shell", command: "docker", args: ["volume", "rm", "dpf_pgdata"] },
      "autonomous",
      [NEVER_WIPE_DB],
    );
    expect(d.verdict).toBe("refuse");
    if (d.verdict === "refuse") {
      expect(d.principleSlug).toBe("never-wipe-db-for-code-fixes");
      expect(d.rationale).toContain("Wipes operator state");
    }
  });

  it("allows a non-matching shell command", () => {
    expect(
      evaluateExecution(
        { kind: "shell", command: "docker", args: ["ps"] },
        "autonomous",
        [NEVER_WIPE_DB],
      ),
    ).toEqual({ verdict: "allow" });
  });

  it("returns require_confirm in interactive mode with a typed phrase", () => {
    const d = evaluateExecution(
      { kind: "shell", command: "docker", args: ["volume", "rm", "dpf_pgdata"] },
      "interactive",
      [NEVER_WIPE_DB],
    );
    expect(d.verdict).toBe("require_confirm");
    if (d.verdict === "require_confirm") {
      expect(d.requiredPhrase).toMatch(
        /^I-MEAN-IT-never-wipe-db-for-code-fixes-[A-Z0-9]{4}$/,
      );
    }
  });
});
