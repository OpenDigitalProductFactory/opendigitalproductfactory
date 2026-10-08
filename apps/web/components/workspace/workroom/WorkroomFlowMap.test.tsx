// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { getWorkShape } from "@/lib/work-management/work-shapes";
import { buildWorkroomFlowMap } from "@/lib/work-management/workroom-flow-map";

import { WorkroomFlowMap } from "./WorkroomFlowMap";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("processLayout=map"),
  usePathname: () => "/workspace/cases/WC-1",
  useRouter: () => ({ replace }),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const definition = getWorkShape("dependency-advisory-watch")!;
const now = new Date(Date.UTC(2026, 9, 7, 12));
const model = buildWorkroomFlowMap({
  definition,
  current: { action: "pause", reason: "conformance_pause", stageKey: "raise", cycleKey: "c" },
  roomRows: [],
  snapshots: [],
  now,
});

describe("WorkroomFlowMap", () => {
  it("names every step with its state, the hold cause and the deciding person", () => {
    render(<WorkroomFlowMap model={model} />);
    expect(screen.getByRole("button", { name: /^Sweep.*Done/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Raise.*Blocked: conformance pause/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Decide.*A person decides the way out \(role:security-owner\)/ })).toBeInTheDocument();
    expect(screen.getByText(model.signature)).toBeInTheDocument();
  });

  it("opens a step's inspection by click or keyboard, through the same URL state as the step list", () => {
    render(<WorkroomFlowMap model={model} />);
    fireEvent.click(screen.getByRole("button", { name: /^Decide/ }));
    expect(replace).toHaveBeenLastCalledWith(expect.stringContaining("processStep=decide"), { scroll: false });
    fireEvent.keyDown(screen.getByRole("button", { name: /^Sweep/ }), { key: "Enter" });
    expect(replace).toHaveBeenLastCalledWith(expect.stringContaining("processStep=sweep"), { scroll: false });
  });

  it("says when history is too thin instead of showing a number", () => {
    render(<WorkroomFlowMap model={model} />);
    expect(screen.getAllByText("not enough history yet")).toHaveLength(3);
  });

  it("declines to draw a parallel shape as a line", () => {
    render(<WorkroomFlowMap model={{ ...model, graphFlow: true }} />);
    expect(screen.queryByRole("button", { name: /^Sweep/ })).not.toBeInTheDocument();
    expect(screen.getByText(/runs some steps in parallel/)).toBeInTheDocument();
  });

  it("uses only theme tokens for colour", () => {
    const { container } = render(<WorkroomFlowMap model={model} />);
    const colours = [...container.querySelectorAll("[fill],[stroke]")]
      .flatMap((el) => [el.getAttribute("fill"), el.getAttribute("stroke")])
      .filter((value): value is string => Boolean(value) && value !== "none");
    expect(colours.filter((value) => !value.startsWith("var(--dpf-"))).toEqual([]);
  });
});
