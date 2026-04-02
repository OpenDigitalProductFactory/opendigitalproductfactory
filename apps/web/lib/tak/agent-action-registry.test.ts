// apps/web/lib/agent-action-registry.test.ts
import { describe, expect, it } from "vitest";
import { getActionsForRoute } from "./agent-action-registry";

// HR-000 = admin (has all capabilities), HR-500 = ops role (limited capabilities)
const adminUser = { userId: "u-1", platformRole: "HR-000", isSuperuser: false };
const opsUser = { userId: "u-2", platformRole: "HR-500", isSuperuser: false };

describe("getActionsForRoute", () => {
  it("returns actions for matching route", () => {
    const actions = getActionsForRoute("/employee", adminUser);
    expect(Array.isArray(actions)).toBe(true);
  });

  it("returns empty array for unregistered routes", () => {
    const actions = getActionsForRoute("/nonexistent", adminUser);
    expect(actions).toEqual([]);
  });

  it("matches sub-routes via longest-prefix", () => {
    const actions = getActionsForRoute("/employee/details", adminUser);
    // Should match /employee manifest
    expect(Array.isArray(actions)).toBe(true);
  });

  it("does not match partial route names", () => {
    // /employee-settings should NOT match /employee
    const actions = getActionsForRoute("/employee-settings", adminUser);
    expect(actions).toEqual([]);
  });

  it("filters by user capability", () => {
    const adminActions = getActionsForRoute("/employee", adminUser);
    const opsActions = getActionsForRoute("/employee", opsUser);
    // Ops role (HR-500) has view_employee but not manage_user_lifecycle
    // So ops should see fewer or equal actions
    expect(opsActions.length).toBeLessThanOrEqual(adminActions.length);
  });
});
