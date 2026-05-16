import { describe, expect, it } from "vitest";

import {
  classifySkillLifecycle,
  isCuratorImmutable,
  isSkillLifecycleState,
  SKILL_LIFECYCLE_STATES,
} from "./lifecycle";

describe("SKILL_LIFECYCLE_STATES", () => {
  it("carries the five canonical states from the spec", () => {
    expect([...SKILL_LIFECYCLE_STATES]).toEqual([
      "active",
      "stale",
      "pinned",
      "quarantined",
      "archived",
    ]);
  });
});

describe("isSkillLifecycleState", () => {
  it("accepts valid values and rejects everything else", () => {
    expect(isSkillLifecycleState("active")).toBe(true);
    expect(isSkillLifecycleState("pinned")).toBe(true);
    expect(isSkillLifecycleState("none")).toBe(false);
    expect(isSkillLifecycleState(null)).toBe(false);
    expect(isSkillLifecycleState(42)).toBe(false);
  });
});

describe("isCuratorImmutable", () => {
  it("only pinned and quarantined are immutable by the curator", () => {
    expect(isCuratorImmutable("pinned")).toBe(true);
    expect(isCuratorImmutable("quarantined")).toBe(true);
    expect(isCuratorImmutable("active")).toBe(false);
    expect(isCuratorImmutable("stale")).toBe(false);
    expect(isCuratorImmutable("archived")).toBe(false);
  });
});

describe("classifySkillLifecycle", () => {
  it("never moves a pinned skill", () => {
    const result = classifySkillLifecycle({
      current: "pinned",
      usage30d: { invoked: 0, failed: 0 },
      assignmentCount: 0,
      lastUsedAt: null,
      hasContent: false,
    });
    expect(result.next).toBe("pinned");
    expect(result.reason).toContain("preserved");
  });

  it("never moves a quarantined skill", () => {
    const result = classifySkillLifecycle({
      current: "quarantined",
      usage30d: { invoked: 999, failed: 0 },
      assignmentCount: 10,
      lastUsedAt: new Date(),
      hasContent: true,
    });
    expect(result.next).toBe("quarantined");
  });

  it("archives a skill that has no content, no assignments, and no use", () => {
    const result = classifySkillLifecycle({
      current: "active",
      usage30d: { invoked: 0, failed: 0 },
      assignmentCount: 0,
      lastUsedAt: null,
      hasContent: false,
    });
    expect(result.next).toBe("archived");
    expect(result.reason).toContain("no content");
  });

  it("marks a skill stale when it has no content but at least one assignment", () => {
    const result = classifySkillLifecycle({
      current: "active",
      usage30d: { invoked: 0, failed: 0 },
      assignmentCount: 1,
      lastUsedAt: null,
      hasContent: false,
    });
    expect(result.next).toBe("stale");
    expect(result.reason).toContain("no SKILL.md body");
  });

  it("marks a skill stale when it has content but no invocations in 30 days", () => {
    const result = classifySkillLifecycle({
      current: "active",
      usage30d: { invoked: 0, failed: 0 },
      assignmentCount: 3,
      lastUsedAt: new Date("2026-01-01"),
      hasContent: true,
    });
    expect(result.next).toBe("stale");
    expect(result.reason).toContain("30 days");
  });

  it("returns active when the skill has content and invocations", () => {
    const result = classifySkillLifecycle({
      current: "active",
      usage30d: { invoked: 12, failed: 1 },
      assignmentCount: 4,
      lastUsedAt: new Date(),
      hasContent: true,
    });
    expect(result.next).toBe("active");
  });

  it("does NOT archive a stale skill — stale is recoverable", () => {
    const result = classifySkillLifecycle({
      current: "stale",
      usage30d: { invoked: 0, failed: 0 },
      assignmentCount: 0,
      lastUsedAt: null,
      hasContent: true,
    });
    // No content + no assignments + no use would archive a never-stale skill,
    // but a stale-with-content skill stays stale until content disappears
    // or operator intervenes.
    expect(result.next).toBe("stale");
  });
});
