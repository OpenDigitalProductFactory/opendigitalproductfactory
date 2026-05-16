import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/skill-curator-actions", () => ({
  runSkillCuratorAction: vi.fn(),
  pinSkillAction: vi.fn(),
  quarantineSkillAction: vi.fn(),
  unpinSkillAction: vi.fn(),
}));

import { SkillCuratorReportPanel } from "./SkillCuratorReportPanel";

describe("SkillCuratorReportPanel", () => {
  it("renders an empty state when no report exists yet", () => {
    const html = renderToStaticMarkup(<SkillCuratorReportPanel report={null} />);
    expect(html).toContain("Curator report");
    expect(html).toContain("not run yet");
    expect(html).toContain("Run curator now");
  });

  it("renders totals + findings table when a report is present", () => {
    const html = renderToStaticMarkup(
      <SkillCuratorReportPanel
        report={{
          artifactId: "ta-1",
          scannedAt: "2026-05-15T07:00:00.000Z",
          totals: { active: 4, stale: 2, pinned: 1, quarantined: 0, archived: 1 },
          findings: [
            { skillId: "build-page", fromState: "active", toState: "stale", reason: "no invocations in the last 30 days", changed: true },
            { skillId: "ship-feature", fromState: "active", toState: "active", reason: "in use", changed: false },
          ],
          createdAt: "2026-05-15T07:00:01.000Z",
        }}
      />,
    );
    expect(html).toContain("active: 4");
    expect(html).toContain("stale: 2");
    expect(html).toContain("pinned: 1");
    expect(html).toContain("build-page");
    expect(html).toContain("ship-feature");
    expect(html).toContain("no invocations in the last 30 days");
  });

  it("uses only theme tokens — no hardcoded hex colors", () => {
    const html = renderToStaticMarkup(
      <SkillCuratorReportPanel
        report={{
          artifactId: "ta-1",
          scannedAt: "2026-05-15T07:00:00.000Z",
          totals: { active: 1, stale: 0, pinned: 0, quarantined: 0, archived: 0 },
          findings: [],
          createdAt: "2026-05-15T07:00:01.000Z",
        }}
      />,
    );
    expect(html).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(html).toContain("var(--dpf-");
  });
});
