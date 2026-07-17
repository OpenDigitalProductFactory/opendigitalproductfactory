import { describe, it, expect } from "vitest";
import { routeToSpecialist, taskClassesWithSpecialist, SPECIALIST_BY_TASK_CLASS } from "./specialist-router";
import { TASK_CLASSES } from "./intent-taxonomy";

describe("routeToSpecialist", () => {
  it("recommends the backlog specialist for backlog-status when a different coworker asks", () => {
    const r = routeToSpecialist({ taskClass: "backlog-status", currentAgentId: "marketing-specialist" });
    expect(r?.specialistAgentId).toBe("ops-coordinator");
    expect(r?.specialistDisplayName).toBe("Scrum Master");
    expect(r?.reason).toMatch(/Scrum Master/);
  });

  it("returns null when the current coworker already owns the task class (no self-delegation)", () => {
    expect(routeToSpecialist({ taskClass: "backlog-status", currentAgentId: "ops-coordinator" })).toBeNull();
  });

  it("returns null for an unknown or absent task class", () => {
    expect(routeToSpecialist({ taskClass: null })).toBeNull();
    expect(routeToSpecialist({ taskClass: "no-such-class", currentAgentId: "x" })).toBeNull();
  });

  it("recommends the AI Ops Engineer for provider-health", () => {
    const r = routeToSpecialist({ taskClass: "provider-health", currentAgentId: "ops-coordinator" });
    expect(r?.specialistAgentId).toBe("platform-engineer");
  });

  it("every taxonomy task class has a registered specialist owner", () => {
    const owners = taskClassesWithSpecialist();
    for (const def of TASK_CLASSES) {
      expect(owners.has(def.taskClass), `no specialist for ${def.taskClass}`).toBe(true);
    }
    // and every specialist maps to a real task class
    for (const tc of Object.keys(SPECIALIST_BY_TASK_CLASS)) {
      expect(TASK_CLASSES.some((d) => d.taskClass === tc)).toBe(true);
    }
  });
});
