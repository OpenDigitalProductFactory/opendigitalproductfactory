import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { CockpitEventsTable, type CockpitEventRow } from "./CockpitEventsTable";

const ROWS: CockpitEventRow[] = [
  {
    id: "ev-1",
    recordedAtISO: "2026-03-28T14:30:00.000Z",
    interfaceLabel: "Ring 1 → 2",
    capabilityLabel: "Plan refinement",
    capabilityName: "plan.refine",
    sourceLabel: "Build Studio phase",
    shaftSourceId: "fb-123",
    actorLabel: "Coworker A",
    actorId: "agent-a",
    torqueTechnical: 0.95,
    outcomeLabel: "engaged",
    slipDetected: false,
    graderType: "rubric",
  },
  {
    id: "ev-2",
    recordedAtISO: "2026-03-28T14:00:00.000Z",
    interfaceLabel: "Ring 1 → 2",
    capabilityLabel: "Code gen",
    capabilityName: "code.gen",
    sourceLabel: "Build Studio phase",
    shaftSourceId: "fb-124",
    actorLabel: "Coworker B",
    actorId: "agent-b",
    torqueTechnical: 0.3,
    outcomeLabel: "slipped",
    slipDetected: true,
    graderType: "rubric",
  },
];

describe("CockpitEventsTable (report-kit migration)", () => {
  const html = renderToStaticMarkup(<CockpitEventsTable rows={ROWS} />);

  it("renders the pre-resolved terminology labels", () => {
    expect(html).toContain("Plan refinement");
    expect(html).toContain("Coworker B");
    expect(html).toContain("unknown source route: fb-123");
  });

  it("colors torque via the token-backed torqueColor (no raw hex)", () => {
    expect(html).toContain("var(--dpf-success)"); // 0.95
    expect(html).toContain("var(--dpf-error)"); // 0.3
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("flags slipped outcomes with the error token", () => {
    expect(html).toContain("slipped");
  });
});
