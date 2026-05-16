import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentSkillAttributionChip } from "./AgentSkillAttributionChip";

describe("AgentSkillAttributionChip", () => {
  it("renders nothing when no skill is supplied", () => {
    const html = renderToStaticMarkup(<AgentSkillAttributionChip skill={null} />);
    expect(html).toBe("");
  });

  it("renders the skill label and a leading 'skill' marker", () => {
    const html = renderToStaticMarkup(
      <AgentSkillAttributionChip skill={{ skillId: "build-page", label: "Build a Page" }} />,
    );
    expect(html).toContain("Build a Page");
    expect(html).toContain("skill");
    expect(html).toContain('data-testid="skill-attribution-chip"');
  });

  it("uses an accessible aria-label that names the active skill", () => {
    const html = renderToStaticMarkup(
      <AgentSkillAttributionChip skill={{ skillId: "review-pr", label: "Review PR" }} />,
    );
    expect(html).toContain('aria-label="Active skill: Review PR"');
  });

  it("uses only CSS variables (no hardcoded hex colors) on the rendered inline styles", () => {
    const html = renderToStaticMarkup(
      <AgentSkillAttributionChip skill={{ skillId: "x", label: "X" }} />,
    );
    expect(html).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(html).toContain("var(--dpf-");
  });
});
