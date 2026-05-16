import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/skill-curator-actions", () => ({
  pinSkillAction: vi.fn(),
  quarantineSkillAction: vi.fn(),
  unpinSkillAction: vi.fn(),
  runSkillCuratorAction: vi.fn(),
}));

import { SkillLifecycleControls } from "./SkillLifecycleControls";

describe("SkillLifecycleControls", () => {
  it("renders the three lifecycle actions and shows current state", () => {
    const html = renderToStaticMarkup(
      <SkillLifecycleControls skillId="build-page" currentState="active" />,
    );
    expect(html).toContain("Pin");
    expect(html).toContain("Quarantine");
    expect(html).toContain("Reset to active");
    expect(html).toContain("Lifecycle:");
    expect(html).toContain("active");
  });

  it("disables Pin when the skill is already pinned", () => {
    const html = renderToStaticMarkup(
      <SkillLifecycleControls skillId="build-page" currentState="pinned" />,
    );
    // The Pin button is disabled but the Reset/Quarantine buttons are not.
    // renderToStaticMarkup emits the `disabled` attribute on disabled buttons.
    expect(html).toMatch(/<button[^>]*disabled[^>]*>\s*Pin\s*<\/button>/);
  });

  it("uses only theme tokens — no hardcoded hex colors", () => {
    const html = renderToStaticMarkup(
      <SkillLifecycleControls skillId="build-page" currentState="stale" />,
    );
    expect(html).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(html).toContain("var(--dpf-");
  });
});
