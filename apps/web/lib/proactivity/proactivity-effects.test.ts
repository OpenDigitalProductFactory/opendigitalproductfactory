import { describe, expect, it } from "vitest";

import { describeProactivityEffects } from "./proactivity-effects";

const registered = {
  registered: true,
  cadence: { balanced: "weekly", assertive: "daily" } as const,
};
const unregistered = { registered: false, cadence: null };

describe("describeProactivityEffects", () => {
  it("lists only enforced consumers — never monitoring/approval/escalation", () => {
    for (const level of ["quiet", "balanced", "assertive"] as const) {
      const labels = describeProactivityEffects(level, registered).map((l) => l.label);
      expect(labels).toEqual(["In chat", "Opening briefing", "Scheduled self-tasks", "If its task fails"]);
      const text = JSON.stringify(describeProactivityEffects(level, registered)).toLowerCase();
      // The BI-AB7CD55B mislabel surface: these were displayed but nothing enforces them.
      expect(text).not.toContain("monitoring");
      expect(text).not.toContain("approval");
      expect(text).not.toContain("escalat");
    }
  });

  it("maps self-task cadence per level for registered coworkers", () => {
    expect(describeProactivityEffects("quiet", registered).find((l) => l.label === "Scheduled self-tasks")?.value).toBe("Off");
    expect(describeProactivityEffects("balanced", registered).find((l) => l.label === "Scheduled self-tasks")?.value).toBe("Weekly");
    expect(describeProactivityEffects("assertive", registered).find((l) => l.label === "Scheduled self-tasks")?.value).toBe("Daily");
  });

  it("is honest when a coworker has no self-task registration", () => {
    const line = describeProactivityEffects("assertive", unregistered).find((l) => l.label === "Scheduled self-tasks");
    expect(line?.value).toBe("Not available for this coworker yet");
  });

  it("gates the opening briefing by level", () => {
    expect(describeProactivityEffects("quiet", unregistered).find((l) => l.label === "Opening briefing")?.value).toBe("Silent on open");
    expect(describeProactivityEffects("assertive", unregistered).find((l) => l.label === "Opening briefing")?.value).toContain("Always briefs");
  });
});
