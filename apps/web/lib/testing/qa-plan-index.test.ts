import { describe, expect, it } from "vitest";
import { extractQaPlanIds, hasQaPlanId } from "./qa-plan-index";

const sample = `
| BUILD-20 | Advance a build from plan -> build -> review | UX status flips running |
| AI-15 | Ask why this item needs human review | Uses four signals |
| AUTH-GOV-11 | On /ops, ask agent to create a backlog item | ToolExecution record appears |
`;

describe("qa-plan-index", () => {
  it("extracts stable QA IDs from markdown tables", () => {
    expect(extractQaPlanIds(sample)).toEqual(["BUILD-20", "AI-15", "AUTH-GOV-11"]);
  });

  it("checks whether an ID exists in the parsed index", () => {
    const ids = extractQaPlanIds(sample);

    expect(hasQaPlanId(ids, "AI-15")).toBe(true);
    expect(hasQaPlanId(ids, "AI-99")).toBe(false);
  });
});
