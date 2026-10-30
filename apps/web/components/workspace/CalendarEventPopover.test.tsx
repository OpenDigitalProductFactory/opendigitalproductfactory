// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/calendar", () => ({ createCalendarEvent: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock("@/lib/i18n/use-t", async () => {
  const { translate } = await import("@dpf/i18n");
  return { useT: () => (key: never) => translate("en-US", "shell", key) };
});

import { createCalendarEvent } from "@/lib/actions/calendar";
import { CalendarEventPopover } from "./CalendarEventPopover";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("native event date entry", () => {
  it("labels exclusive end and submits the selected civil dates unchanged", async () => {
    render(<CalendarEventPopover defaultDate="2026-10-29" defaultEndDate="2026-10-31" onClose={() => {}} />);
    expect(screen.getByLabelText("Start date")).toHaveValue("2026-10-29");
    expect(screen.getByLabelText("End date (not included)")).toHaveValue("2026-10-31");
    fireEvent.change(screen.getByPlaceholderText("Event title"), { target: { value: "Isolated fixture" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create" })); });
    expect(createCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({ startAt: "2026-10-29", endAt: "2026-10-31", allDay: true }));
  });
  it("uses the viewer's current day rather than the UTC day for its default", () => {
    vi.stubEnv("TZ", "Pacific/Kiritimati"); vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T11:30:00Z"));
    render(<CalendarEventPopover onClose={() => {}} />);
    expect(screen.getByLabelText("Start date")).toHaveValue("2026-10-29");
  });
});
