import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ALL_ARCHETYPES } from "@dpf/storefront-templates";

import { WorkspaceTwinHero } from "./WorkspaceTwinHero";
import { resolveWorkspaceTwinPresentation } from "@/lib/workspace-home/twin-panel-data";

const presentation = resolveWorkspaceTwinPresentation(ALL_ARCHETYPES[0].archetypeId)!;

function render() {
  return renderToStaticMarkup(
    <WorkspaceTwinHero
      cockpit={<div data-testid="cockpit-slot">What needs you now</div>}
      presentation={presentation}
      contribution={null}
      platformBody={<div data-testid="platform-slot">All workspace areas</div>}
    />,
  );
}

describe("WorkspaceTwinHero", () => {
  it("renders the twin as the hero body with the cockpit folded in as the HUD", () => {
    const html = render();
    // Identity: archetype name in the hero header.
    expect(html).toContain(presentation.archetypeName);
    expect(html).toContain("Living business");
    // The single attention surface (cockpit) is present as the HUD.
    expect(html).toContain("cockpit-slot");
    // The operational twin body renders (a capacity chip label from the profile).
    expect(html).toContain(presentation.snapshot.capacityChips[0].label);
    // Platform launcher demoted below.
    expect(html).toContain("platform-slot");
  });

  it("shows the honest demo badge while the live projection is pending", () => {
    expect(render()).toContain("Demo data — live business projection pending");
  });

  it("keeps exactly one attention surface — the twin's own cog + needs-you are suppressed", () => {
    const html = render();
    // No HITL cog confirm banner (suppressed on the home mount).
    expect(html).not.toContain("Assign ");
    // The twin's needs-you renders its empty state, not a rival quest list.
    expect(html).toContain("Nothing needs you right now");
  });
});

describe("WorkspaceTwinHero density (BI-BF53A701)", () => {
  const contribution = {
    primaryOperatingQuestion: "are we ready for the next service period?",
  } as never;

  function renderDensity(density: "simple" | "full") {
    return renderToStaticMarkup(
      <WorkspaceTwinHero
        cockpit={<div data-testid="cockpit-slot">What needs you now</div>}
        presentation={presentation}
        contribution={contribution}
        platformBody={<div data-testid="platform-slot">All workspace areas</div>}
        density={density}
      />,
    );
  }

  it("full mode shows builder chrome and the operational-twin body", () => {
    const html = renderDensity("full");
    expect(html).toContain("Living business");
    expect(html).toContain("The worker arrives asking");
    expect(html).toContain(presentation.snapshot.capacityChips[0].label);
    expect(html).toContain("Demo data — live business projection pending");
  });

  it("simple mode condenses to the next-action surface and hides builder detail", () => {
    const html = renderDensity("simple");
    // Essential owner surfaces stay: next actions + area launcher + identity.
    expect(html).toContain("cockpit-slot");
    expect(html).toContain("platform-slot");
    expect(html).toContain(presentation.archetypeName);
    // Builder terminology and the full twin body are hidden — materially less
    // content than Full mode.
    expect(html).not.toContain("Living business");
    expect(html).not.toContain("The worker arrives asking");
    expect(html).not.toContain(presentation.snapshot.capacityChips[0].label);
    expect(html).not.toContain("Demo data — live business projection pending");
  });

  it("Simple and Full render materially different content", () => {
    expect(renderDensity("simple")).not.toEqual(renderDensity("full"));
  });
});
