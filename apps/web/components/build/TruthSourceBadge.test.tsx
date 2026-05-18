// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TruthSourceBadge } from "./TruthSourceBadge";

describe("TruthSourceBadge", () => {
  it("renders source, age, and conflict state", () => {
    render(
      <TruthSourceBadge
        source="db-task-results"
        observedAt="2026-05-18T12:00:00.000Z"
        ageLabel="2m ago"
        conflict
      />,
    );

    expect(screen.getByText("DB")).toBeInTheDocument();
    expect(screen.getByText("2m ago")).toBeInTheDocument();
    expect(screen.getByText("conflict")).toBeInTheDocument();
  });
});
