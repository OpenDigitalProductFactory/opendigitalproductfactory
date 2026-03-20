import React from "react";
import { render } from "@testing-library/react-native";
import { StatusBadge } from "./StatusBadge";
import type { BadgeStatus } from "./StatusBadge";

describe("StatusBadge", () => {
  const statuses: BadgeStatus[] = ["open", "in-progress", "done", "deferred"];

  it.each(statuses)("renders '%s' status badge", (status) => {
    const { toJSON } = render(<StatusBadge status={status} />);
    expect(toJSON()).toBeTruthy();
  });

  it("displays 'Open' label for open status", () => {
    const { getByText } = render(<StatusBadge status="open" />);
    expect(getByText("Open")).toBeTruthy();
  });

  it("displays 'In Progress' label for in-progress status", () => {
    const { getByText } = render(<StatusBadge status="in-progress" />);
    expect(getByText("In Progress")).toBeTruthy();
  });

  it("displays 'Done' label for done status", () => {
    const { getByText } = render(<StatusBadge status="done" />);
    expect(getByText("Done")).toBeTruthy();
  });

  it("displays 'Deferred' label for deferred status", () => {
    const { getByText } = render(<StatusBadge status="deferred" />);
    expect(getByText("Deferred")).toBeTruthy();
  });
});
