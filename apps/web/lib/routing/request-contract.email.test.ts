import { describe, expect, it } from "vitest";
import { inferContract } from "./request-contract";

// No module mocks. inferContract resolves the REAL TaskRequirement (DB-first, with
// a built-in fallback). In a no-DB unit environment the DB lookup fails and the
// built-in catalogue is used — which now carries the email-* routing-posture
// defaults this asserts. A file-scoped vi.mock of the shared ./task-requirements
// (or @dpf/db) module can leak across files under the forks pool, so this suite
// deliberately avoids it and tests the integrated path instead.

const MSGS = [{ role: "user", content: "hello" }];

describe("inferContract honours task-requirement routing-posture defaults", () => {
  it("email-triage → utility posture (minimize_cost + low reasoning) from its requirement", async () => {
    const c = await inferContract("email-triage", MSGS);
    expect(c.budgetClass).toBe("minimize_cost");
    expect(c.reasoningDepth).toBe("low");
  });

  it("an explicit caller routeContext overrides the requirement default", async () => {
    const c = await inferContract("email-triage", MSGS, undefined, undefined, {
      budgetClass: "quality_first",
    });
    expect(c.budgetClass).toBe("quality_first");
  });

  it("existing task type without posture defaults is unchanged (regression: summarization)", async () => {
    const c = await inferContract("summarization", MSGS);
    expect(c.budgetClass).toBe("balanced");
    expect(c.reasoningDepth).toBe("low"); // DEFAULT_REASONING_DEPTH["summarization"]
    expect(c.residencyPolicy).toBeUndefined();
  });

  it("unknown task type falls back to balanced posture, no residency; depth from content (BI-08CE1ADF)", async () => {
    const c = await inferContract("totally-unknown-task-xyz", MSGS);
    expect(c.budgetClass).toBe("balanced");
    // No declared depth for this task type → classified from content. MSGS is a
    // bare "hello" greeting, so the classifier returns minimal (was a blanket
    // "medium" before the content classifier landed).
    expect(c.reasoningDepth).toBe("minimal");
    expect(c.residencyPolicy).toBeUndefined();
  });
});
