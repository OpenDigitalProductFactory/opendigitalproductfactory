// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkroomCoordinationContext } from "./WorkroomCoordinationContext";
afterEach(cleanup);
describe("coordination ownership and links", () => {
  it("labels dependency direction and inherited accountability without claiming a block", () => {
    render(<WorkroomCoordinationContext accountability={{ state: "resolved", principalId: "p1", source: "inherited-room", inheritedFrom: ["r1", "r2"] }} accountableName="Alex" partial={false}
      relationships={[{ id: "e1", relation: "depends-on", direction: "incoming", title: "Child", roomId: "WC-CHILD", href: "/workspace/cases/work-capsule%3AWC-CHILD?coordinationQuery=review" }]} />);
    expect(screen.getByText(/Alex/)).toBeInTheDocument();
    expect(screen.getByText(/inherited room/)).toBeInTheDocument();
    expect(screen.getByText(/Required by/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Child/ })).toHaveAttribute("href", expect.stringContaining("coordinationQuery=review"));
    expect(screen.queryByText(/blocked/i)).not.toBeInTheDocument();
  });
  it("keeps failed reads and missing owners visible", () => {
    render(<WorkroomCoordinationContext accountability={null} accountableName={null} relationships={[]} partial />);
    expect(screen.getByText(/Owner unknown/)).toBeInTheDocument();
    expect(screen.getByText(/Incomplete read/)).toBeInTheDocument();
  });
});
