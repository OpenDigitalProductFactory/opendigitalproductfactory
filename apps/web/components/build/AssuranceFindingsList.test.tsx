// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssuranceFindingsList } from "./AssuranceFindingsList";

vi.mock("@/lib/actions/assurance", () => ({
  setAssuranceFindingStatus: vi.fn(async () => ({ findingKey: "fk-1", previousStatus: "open", status: "accepted" })),
  requestBacklogFromAssuranceFinding: vi.fn(async () => ({
    findingKey: "fk-1",
    backlogItemId: "BI-NEW",
    epicCuid: "epic-cuid",
    alreadyLinked: false,
  })),
}));

import {
  requestBacklogFromAssuranceFinding,
  setAssuranceFindingStatus,
} from "@/lib/actions/assurance";

afterEach(cleanup);

const baseFinding = {
  findingKey: "fk-1",
  findingKind: "vulnerability",
  title: "Critical issue in vulnerable-lib",
  status: "open",
  policySeverity: "critical" as const,
  releaseImpact: "block",
  adapterKey: "pnpm-audit",
  vendorIdentifier: "GHSA-1111",
  affectedType: "bom-component",
  affectedId: "key-vulnerable",
  lastSeenAt: new Date("2026-05-22T12:00:00.000Z"),
  component: {
    name: "vulnerable-lib",
    version: "1.2.0",
    packageUrl: "pkg:npm/vulnerable-lib@1.2.0",
  },
};

describe("AssuranceFindingsList", () => {
  it("renders empty state when no findings exist", () => {
    render(<AssuranceFindingsList findings={[]} emptyLabel="Nothing here" />);

    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });

  it("renders a finding row with severity, component, vendor id, and action controls", () => {
    render(<AssuranceFindingsList findings={[baseFinding]} />);

    expect(screen.getByText("Critical issue in vulnerable-lib")).toBeInTheDocument();
    expect(screen.getByText("vulnerable-lib@1.2.0")).toBeInTheDocument();
    expect(screen.getByText("GHSA-1111")).toBeInTheDocument();
    expect(screen.getByTestId("assurance-finding-status-select")).toBeInTheDocument();
    expect(screen.getByTestId("assurance-finding-create-backlog")).toBeInTheDocument();
  });

  it("calls setAssuranceFindingStatus when the status select changes", async () => {
    render(<AssuranceFindingsList findings={[baseFinding]} />);

    fireEvent.change(screen.getByTestId("assurance-finding-status-select"), {
      target: { value: "accepted" },
    });

    await waitFor(() => {
      expect(setAssuranceFindingStatus).toHaveBeenCalledWith({
        findingKey: "fk-1",
        status: "accepted",
      });
    });
  });

  it("calls requestBacklogFromAssuranceFinding when Create backlog is clicked", async () => {
    render(<AssuranceFindingsList findings={[baseFinding]} />);

    fireEvent.click(screen.getByTestId("assurance-finding-create-backlog"));

    await waitFor(() => {
      expect(requestBacklogFromAssuranceFinding).toHaveBeenCalledWith("fk-1");
    });
    await waitFor(() => {
      expect(screen.getByText(/Linked BI-NEW/i)).toBeInTheDocument();
    });
  });

  it("hides remediation controls in read-only mode", () => {
    render(<AssuranceFindingsList findings={[baseFinding]} readOnly />);

    expect(screen.queryByTestId("assurance-finding-status-select")).not.toBeInTheDocument();
    expect(screen.queryByTestId("assurance-finding-create-backlog")).not.toBeInTheDocument();
  });
});
