import { describe, expect, it } from "vitest";
import { escalationSelfFixLabel, escalationAgeLabel } from "./escalation-attention";

describe("escalationSelfFixLabel", () => {
  it("maps each self-fix class to a human label", () => {
    expect(escalationSelfFixLabel("needs-human")).toBe("Needs human");
    expect(escalationSelfFixLabel("needs-external-capability")).toBe("Needs external capability");
    expect(escalationSelfFixLabel("auto-recoverable")).toBe("Auto-recoverable");
  });

  it("falls back to a generic label for null / unknown", () => {
    expect(escalationSelfFixLabel(null)).toBe("Escalation");
    expect(escalationSelfFixLabel(undefined)).toBe("Escalation");
    expect(escalationSelfFixLabel("something-else")).toBe("Escalation");
  });
});

describe("escalationAgeLabel", () => {
  const now = new Date("2026-06-22T12:00:00Z").getTime();

  it("reports sub-minute ages as just now", () => {
    expect(escalationAgeLabel("2026-06-22T11:59:30Z", now)).toBe("just now");
    expect(escalationAgeLabel("2026-06-22T12:00:00Z", now)).toBe("just now");
  });

  it("reports minutes, hours, then days", () => {
    expect(escalationAgeLabel("2026-06-22T11:45:00Z", now)).toBe("15m ago");
    expect(escalationAgeLabel("2026-06-22T09:00:00Z", now)).toBe("3h ago");
    expect(escalationAgeLabel("2026-06-20T12:00:00Z", now)).toBe("2d ago");
  });

  it("is defensive against an unparseable timestamp", () => {
    expect(escalationAgeLabel("not-a-date", now)).toBe("just now");
  });
});
