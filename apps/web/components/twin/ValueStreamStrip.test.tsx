// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { ValueStreamStrip } from "./ValueStreamStrip";
import type { TwinStageFlow } from "./snapshot";

// Running the pet-rescue operating day found sixteen correctly named stages,
// every one reading 0, every one carrying a chevron, none of them clickable
// (BI-AF50DBD5). Exactly one of the sixteen has a queue or a zone bound to it,
// so fifteen of those zeros were counts nothing had ever been able to produce.
function stage(over: Partial<TwinStageFlow> & { stageKey: string }): TwinStageFlow {
  return {
    label: over.stageKey,
    order: 0,
    loadBearing: false,
    observable: false,
    count: 0,
    ...over,
  };
}

const RESCUE_STAGES: TwinStageFlow[] = [
  stage({ stageKey: "intake-report-handoff", label: "Report, retrieval, or handoff", order: 110 }),
  stage({
    stageKey: "intake-capacity-decision",
    label: "Make the capacity decision",
    order: 130,
    loadBearing: true,
    observable: true,
    count: 2,
  }),
  stage({ stageKey: "welfare-daily-care", label: "Deliver daily care", order: 210, loadBearing: true }),
];

afterEach(cleanup);

describe("ValueStreamStrip", () => {
  it("renders no chevron — the tiles are not controls and never were", () => {
    const { container } = render(<ValueStreamStrip stages={RESCUE_STAGES} />);
    expect(container.textContent).not.toContain("›");
  });

  it("offers nothing clickable, so it promises no destination", () => {
    render(<ValueStreamStrip stages={RESCUE_STAGES} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("prints a count only for a stage something can actually record", () => {
    render(<ValueStreamStrip stages={RESCUE_STAGES} />);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("shows the absence of a measurement as an absence, not as zero", () => {
    const { container } = render(<ValueStreamStrip stages={RESCUE_STAGES} />);
    const untracked = container.querySelectorAll('[data-stage-observable="false"]');
    expect(untracked).toHaveLength(2);
    for (const tile of untracked) {
      expect(tile.textContent).toContain("—");
    }
    // and it is legible to a screen reader, not only to the eye
    expect(screen.getAllByText("Not tracked yet")).toHaveLength(2);
  });

  it("still names every stage of the operator's day", () => {
    render(<ValueStreamStrip stages={RESCUE_STAGES} />);
    for (const s of RESCUE_STAGES) {
      expect(screen.getByText(s.label)).toBeInTheDocument();
    }
  });

  it("explains the dash once, and only when there is one", () => {
    const { rerender } = render(<ValueStreamStrip stages={RESCUE_STAGES} />);
    expect(screen.getByText("A dash means nothing records that stage yet.")).toBeInTheDocument();

    rerender(<ValueStreamStrip stages={RESCUE_STAGES.filter((s) => s.observable)} />);
    expect(
      screen.queryByText("A dash means nothing records that stage yet."),
    ).not.toBeInTheDocument();
  });

  it("renders nothing when the archetype has no stages", () => {
    const { container } = render(<ValueStreamStrip stages={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps inherited backbone stages behind a disclosure so composing the model adds no words on arrival", () => {
    render(
      <ValueStreamStrip
        stages={[
          stage({ stageKey: "welfare-daily-care", label: "Deliver daily care", order: 210 }),
          stage({ stageKey: "attract", label: "Attract", order: 1010, inherited: true }),
          stage({ stageKey: "capture", label: "Capture", order: 1020, inherited: true }),
        ]}
      />,
    );
    const details = document.querySelector("details[data-dpf-disclosure]");
    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(false);
    expect(screen.getByText("2 inherited backbone stages")).toBeTruthy();
    expect(screen.getByLabelText("Value stream").textContent).toContain("Deliver daily care");
    expect(screen.getByLabelText("Value stream").textContent).not.toContain("Attract");
    expect(screen.getByLabelText("Inherited backbone stages").textContent).toContain("Attract");
  });
});
