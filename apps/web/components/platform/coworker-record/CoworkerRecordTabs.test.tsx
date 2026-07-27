// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CoworkerRecordTabs } from "./CoworkerRecordTabs";

beforeEach(() => {
  window.history.replaceState({}, "", "/platform/ai/agent/customer-advisor");
});
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
      screen
        .getByRole("tabpanel", { name: "Availability" })
        .hasAttribute("hidden"),
    ).toBe(false);
    expect(window.location.hash).toBe("#availability");
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
      screen
        .getByRole("tab", { name: "Availability" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("restores a linked section from the URL hash", () => {
    window.history.replaceState(
      {},
      "",
      "/platform/ai/agent/customer-advisor#availability",
    );

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

    expect(
      screen
        .getByRole("tab", { name: "Availability" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });
});
