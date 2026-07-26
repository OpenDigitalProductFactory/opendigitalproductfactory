// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CoworkerRecordTabs } from "./CoworkerRecordTabs";

afterEach(cleanup);

describe("CoworkerRecordTabs", () => {
  it("switches sections from the mobile selector", () => {
    render(
      <CoworkerRecordTabs
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "availability", label: "Availability" },
        ]}
      >
        <div>Overview content</div>
        <div>Availability content</div>
      </CoworkerRecordTabs>,
    );

    fireEvent.change(screen.getByLabelText("Coworker section"), {
      target: { value: "1" },
    });

    expect(
      screen.getByRole("tabpanel", { name: "Availability" }),
    ).not.toHaveAttribute("hidden");
  });

  it("supports arrow-key navigation between desktop tabs", () => {
    render(
      <CoworkerRecordTabs
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "availability", label: "Availability" },
        ]}
      >
        <div>Overview content</div>
        <div>Availability content</div>
      </CoworkerRecordTabs>,
    );

    const overview = screen.getByRole("tab", { name: "Overview" });
    overview.focus();
    fireEvent.keyDown(overview, { key: "ArrowRight" });

    expect(
      screen.getByRole("tab", { name: "Availability" }),
    ).toHaveAttribute("aria-selected", "true");
  });
});
