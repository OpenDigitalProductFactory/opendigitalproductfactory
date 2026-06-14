import { describe, expect, it } from "vitest";
// No module mocks. Importing the real @dpf/db is harmless here — reading
// BUILT_IN_TASK_REQUIREMENTS (a const) triggers no DB query. A file-scoped
// vi.mock("@dpf/db") can leak across files under the forks pool (it broke an
// unrelated ollama-health test in CI shard 3/4), so this suite avoids it.
import { BUILT_IN_TASK_REQUIREMENTS } from "./task-requirements";

// SysML AI-cockpit model, Slice E1 (REQ-AIC-E1): inbound-email triage must route
// to the utility tier — never frontier — and minimize cost. These assertions pin
// the requirement contract that makes that true.
describe("email-* built-in task requirements", () => {
  for (const taskType of ["email-triage", "email-summarize", "email-extract"]) {
    it(`${taskType} is pinned to the utility tier and minimize_cost`, () => {
      const req = BUILT_IN_TASK_REQUIREMENTS[taskType];
      expect(req, `${taskType} must exist in BUILT_IN_TASK_REQUIREMENTS`).toBeDefined();
      // Utility tier: adequate, never frontier/strong (the core privacy/cost win).
      expect(req!.minimumTier).toBe("adequate");
      expect(req!.budgetClassDefault).toBe("minimize_cost");
      expect(req!.preferCheap).toBe(true);
      expect(req!.origin).toBe("system");
    });
  }

  it("does NOT hard-require structured output (keeps local models eligible)", () => {
    // email-extract benefits from structured output but must not exclude local
    // models that don't declare the capability — it is a preference, not a gate.
    expect(BUILT_IN_TASK_REQUIREMENTS["email-extract"]!.requiredCapabilities.supportsStructuredOutput)
      .toBeUndefined();
  });

  it("leaves residencyPolicy unset by default so no-local installs are not starved", () => {
    // local_only hardening is an operator opt-in via the DB TaskRequirement row.
    for (const taskType of ["email-triage", "email-summarize", "email-extract"]) {
      expect(BUILT_IN_TASK_REQUIREMENTS[taskType]!.residencyPolicy).toBeUndefined();
    }
  });
});
