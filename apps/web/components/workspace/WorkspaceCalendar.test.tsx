// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// Running the operating day recorded the business calendar as unable to create
// anything (BI-460BFA84). Driving the live install corrected half of that: the
// day-click chooser does open. What was true is that the page carried no create
// control at all, so the only way in was a gesture nothing announced.

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/workspace/calendar",
}));

// FullCalendar owns a canvas of day cells that jsdom cannot lay out. Stand in
// for it and expose the two handlers under test, so a plain click (which fires
// dateClick AND select) can be reproduced exactly.
const calendarProps: Record<string, unknown> = {};
vi.mock("@fullcalendar/react", () => ({
  default: (props: Record<string, unknown>) => {
    Object.assign(calendarProps, props);
    return <div data-testid="fullcalendar" />;
  },
}));
vi.mock("@fullcalendar/daygrid", () => ({ default: {} }));
vi.mock("@fullcalendar/timegrid", () => ({ default: {} }));
vi.mock("@fullcalendar/interaction", () => ({ default: {} }));
vi.mock("./CalendarEventPopover", () => ({
  CalendarEventPopover: ({ defaultDate }: { defaultDate?: string }) => (
    <div data-testid="create-popover">{defaultDate}</div>
  ),
}));
vi.mock("./CalendarDetailPopover", () => ({ CalendarDetailPopover: () => null }));
vi.mock("./CalendarAgentScheduler", () => ({ CalendarAgentScheduler: () => null }));
vi.mock("./CalendarSyncPanel", () => ({ CalendarSyncPanel: () => null }));

import { WorkspaceCalendar } from "./WorkspaceCalendar";

afterEach(() => {
  cleanup();
  for (const key of Object.keys(calendarProps)) delete calendarProps[key];
});

function dayRect() {
  return { top: 100, left: 40, bottom: 140, right: 200, width: 160, height: 40 } as DOMRect;
}

describe("WorkspaceCalendar", () => {
  it("offers a create control on the page, not only a gesture", () => {
    render(<WorkspaceCalendar events={[]} />);
    expect(screen.getByRole("button", { name: "New event" })).toBeInTheDocument();
  });

  it("opens the create form from that control", () => {
    render(<WorkspaceCalendar events={[]} />);
    expect(screen.queryByTestId("create-popover")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New event" }));
    expect(screen.getByTestId("create-popover")).toBeInTheDocument();
  });

  it("keeps the day chooser anchored to the day that was clicked", () => {
    render(<WorkspaceCalendar events={[]} />);

    // A plain click on a day fires dateClick, then select for the same day.
    const dateClick = calendarProps.dateClick as (info: unknown) => void;
    const select = calendarProps.select as (info: unknown) => void;
    act(() => {
      dateClick({ dateStr: "2026-08-27", dayEl: { getBoundingClientRect: dayRect } });
      select({ startStr: "2026-08-27", endStr: "2026-08-28" });
    });

    // Anchored: the menu sits under the day cell, not in the middle of the screen.
    const chooser = screen.getByRole("button", { name: "Create event" }).parentElement!;
    expect(chooser.style.top).toBe("144px");
    expect(chooser.style.transform).toBe("");
  });

  it("still centres the chooser for a real multi-day drag", () => {
    render(<WorkspaceCalendar events={[]} />);

    const select = calendarProps.select as (info: unknown) => void;
    act(() => select({ startStr: "2026-08-27", endStr: "2026-08-30" }));

    const chooser = screen.getByRole("button", { name: "Create event" }).parentElement!;
    expect(chooser.style.transform).toBe("translate(-50%, -50%)");
  });
});
