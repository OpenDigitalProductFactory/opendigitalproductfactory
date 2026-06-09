// apps/web/components/platform/engine-readiness-badge.test.ts
import { describe, expect, it } from "vitest";
import { engineReadinessBadgeContent } from "./engine-readiness-badge";

describe("engineReadinessBadgeContent", () => {
  it("present with a version → installed (success) and includes the version", () => {
    const r = engineReadinessBadgeContent(true, "1.2.3");
    expect(r.tone).toBe("success");
    expect(r.icon).toBe("✓");
    expect(r.text).toContain("1.2.3");
  });

  it("present without a version → 'Installed in sandbox'", () => {
    const r = engineReadinessBadgeContent(true, null);
    expect(r.tone).toBe("success");
    expect(r.text).toBe("Installed in sandbox");
  });

  it("absent → not installed (warning)", () => {
    const r = engineReadinessBadgeContent(false, null);
    expect(r.tone).toBe("warning");
    expect(r.icon).toBe("✗");
    expect(r.text).toMatch(/not installed/i);
  });

  it("never probed (null) → muted, not probed", () => {
    const r = engineReadinessBadgeContent(null, null);
    expect(r.tone).toBe("muted");
    expect(r.text).toMatch(/not yet probed/i);
  });
});
