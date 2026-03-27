import { describe, expect, it } from "vitest";
import { employeeActions } from "./manifest";

describe("employee action manifest", () => {
  it("has route /employee", () => {
    expect(employeeActions.route).toBe("/employee");
  });

  it("every action has a specRef (if any exist)", () => {
    // An empty manifest is valid — employee tools live in the global platform tool set.
    // This test guards against accidentally adding actions without spec traceability.
    for (const action of employeeActions.actions) {
      expect(action.specRef).toBeTruthy();
    }
  });

  it("does not duplicate tools that already exist in the global platform tool set", () => {
    // Tools like create_employee, query_employees, list_departments, list_positions,
    // transition_employee_status, propose_leave_policy, and submit_feedback are defined
    // in mcp-tools.ts with correct schemas. Duplicating them here with different schemas
    // causes conflicting tool definitions that confuse the LLM.
    const GLOBAL_HR_TOOLS = new Set([
      "create_employee",
      "query_employees",
      "list_departments",
      "list_positions",
      "transition_employee_status",
      "propose_leave_policy",
      "submit_feedback",
    ]);
    for (const action of employeeActions.actions) {
      expect(GLOBAL_HR_TOOLS.has(action.name)).toBe(false);
    }
  });
});
