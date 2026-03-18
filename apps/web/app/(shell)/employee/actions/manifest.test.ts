import { describe, expect, it } from "vitest";
import { employeeActions } from "./manifest";

describe("employee action manifest", () => {
  it("has route /employee", () => {
    expect(employeeActions.route).toBe("/employee");
  });

  it("has at least one action", () => {
    expect(employeeActions.actions.length).toBeGreaterThan(0);
  });

  it("every action has a specRef", () => {
    for (const action of employeeActions.actions) {
      expect(action.specRef).toBeTruthy();
    }
  });
});
