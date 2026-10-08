// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import type { PortfolioFlowWithCost, ShapeFlowView } from "@/lib/work-management/area-flow.server";
import { getWorkShape } from "@/lib/work-management/work-shapes";
import { buildShapeFlowMap } from "@/lib/work-management/workroom-flow-map";

import { PortfolioFlowComparison, PortfolioFlowTiles, ShapeFlowDrillIn } from "./AreaFlowPanel";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("view=work&shape=delivery-small"),
  usePathname: () => "/area/delivery",
  useRouter: () => ({ replace: vi.fn() }),
}));
afterEach(cleanup);

const H = 3_600_000;
const flow = (key: PortfolioFlowWithCost["key"], overrides: Partial<PortfolioFlowWithCost> = {}): PortfolioFlowWithCost => ({
  key,
  rooms: 12,
  flowLoad: 7,
  flowTime: { p50Ms: 30 * H, priorP50Ms: 40 * H, runs: 9 },
  flowEfficiency: { value: 0.12, prior: 0.08 },
  throughput: { perWeek: 2.25, priorPerWeek: 1.5 },
  weeklyFlowTimeP50Ms: [50 * H, 45 * H, null, 40 * H, 38 * H, 35 * H, 32 * H, 30 * H],
  distribution: { feature: 4, defect: 2, risk: 1, debt: 0 },
  shapes: [{ shapeKey: "delivery-small", shapeRef: "delivery-small@1.0.0", roomsInFlow: 5, flowTimeP50Ms: 20 * H, runs: 6, bottleneck: { stageKey: "merge", roomsHeld: 3, cause: "awaiting-person" } }],
  points: { inFlight: 34, delivered: 21 },
  ...overrides,
});

describe("PortfolioFlowTiles", () => {
  it("shows the five measures with their change against the prior window", () => {
    render(<PortfolioFlowTiles flow={flow("manufactureAndDeliver")} areaHref="/area/delivery?view=work" />);
    expect(screen.getByText("In flow now")).toBeInTheDocument();
    expect(screen.getByText("1d 6h")).toBeInTheDocument();
    expect(screen.getByText(/−10h vs prior 28 days/)).toBeInTheDocument();
    expect(screen.getByText("12%")).toBeInTheDocument();
    expect(screen.getByText("2.3")).toBeInTheDocument();
    expect(screen.getByText("34 pts")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Median flow time per week/ })).toBeInTheDocument();
  });

  it("links each shape to its drill-in and names where it waits", () => {
    render(<PortfolioFlowTiles flow={flow("manufactureAndDeliver")} areaHref="/area/delivery?view=work" />);
    const link = screen.getByRole("link", { name: getWorkShape("delivery-small")!.title });
    expect(link).toHaveAttribute("href", "/area/delivery?view=work&shape=delivery-small");
    expect(screen.getByText("3 at merge · awaiting-person")).toBeInTheDocument();
  });

  it("says so when nothing is in flow, and shows dashes instead of invented numbers", () => {
    render(<PortfolioFlowTiles flow={flow("forEmployees", { flowLoad: 0, shapes: [], flowTime: { p50Ms: null, priorP50Ms: null, runs: 0 }, flowEfficiency: { value: null, prior: null } })} areaHref="/area/team?view=work" />);
    expect(screen.getByText("No rooms in this area are in flow right now.")).toBeInTheDocument();
    expect(screen.getByText("No runs finished yet")).toBeInTheDocument();
  });
});

describe("ShapeFlowDrillIn", () => {
  const definition = getWorkShape("delivery-small")!;
  const model = buildShapeFlowMap({
    definition,
    snapshots: [],
    liveCounts: new Map([[`wr:${definition.key}@${definition.version}:merge`, { wip: 3, depth: 3 }]]),
    now: new Date(),
  });
  const view: ShapeFlowView = {
    model,
    versions: [definition.version, "0.9.0"],
    roomsAtStep: [{ capsuleId: "WC-1", title: "Fix login", href: "/workspace/cases/x", state: "blocked", cause: "conformance_pause" }],
  };

  it("draws the shape across its rooms with queue counts, a version picker and the rooms at a step", () => {
    render(<ShapeFlowDrillIn view={view} backHref="/area/delivery?view=work" baseHref="/area/delivery?view=work" stageKey="merge" />);
    expect(screen.getByRole("button", { name: /^Merge.*3 rooms here, 3 waiting/ })).toBeInTheDocument();
    const versions = screen.getByRole("navigation", { name: "Shape version" });
    expect(within(versions).getByRole("link", { name: `v${definition.version}` })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Fix login" })).toBeInTheDocument();
    expect(screen.getByText("Blocked: conformance pause")).toBeInTheDocument();
  });
});

describe("PortfolioFlowComparison", () => {
  it("puts the four portfolios and the unplaced rooms side by side", () => {
    const flows = (["productsAndServicesSold", "manufactureAndDeliver", "forEmployees", "foundational", "unplaced"] as const).map((k) => flow(k, k === "unplaced" ? { points: null } : {}));
    render(<PortfolioFlowComparison flows={flows} areaHrefByRole={{ manufactureAndDeliver: "/area/delivery?view=work" }} />);
    expect(screen.getAllByRole("columnheader")).toHaveLength(6);
    expect(screen.getByRole("link", { name: "Manufacturing and delivery" })).toHaveAttribute("href", "/area/delivery?view=work");
    expect(screen.getByRole("columnheader", { name: "Unplaced" })).toBeInTheDocument();
  });
});
