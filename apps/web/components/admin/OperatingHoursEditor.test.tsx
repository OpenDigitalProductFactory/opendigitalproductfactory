// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WeeklySchedule } from "@/lib/operating-hours-types";
import { OperatingHoursEditor } from "./OperatingHoursEditor";

afterEach(() => cleanup());

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const schedule = Object.fromEntries(
  DAYS.map((d) => [d, { enabled: d === "monday", open: "09:00", close: "17:00" }]),
) as unknown as WeeklySchedule;

describe("OperatingHoursEditor save feedback", () => {
  it("shows a success toast after a successful save", async () => {
    const onSave = vi.fn(async () => {});
    render(<OperatingHoursEditor defaultSchedule={schedule} timezone="America/Chicago" onSave={onSave} />);

    expect(screen.queryByText(/operating hours saved/i)).toBeNull();
    fireEvent.click(screen.getByText("Save Operating Hours"));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/operating hours saved/i)).toBeTruthy());
  });
});

describe("OperatingHoursEditor timezone options", () => {
  it("labels zones with a UTC-offset prefix and a de-underscored name", () => {
    render(<OperatingHoursEditor defaultSchedule={schedule} timezone="America/New_York" onSave={vi.fn()} />);
    const select = screen.getByLabelText(/Business timezone/i) as HTMLSelectElement;
    const selected = Array.from(select.options).find((o) => o.value === "America/New_York");
    // Orthodox: "(UTC−05:00) America/New York" — offset prefix, no underscore.
    expect(selected?.textContent).toMatch(/^\(UTC[+−±]\d{2}:\d{2}\) America\/New York$/);
    expect(selected?.textContent).not.toContain("_");
  });

  it("orders options by UTC offset, not raw alphabetical", () => {
    render(<OperatingHoursEditor defaultSchedule={schedule} timezone="America/Chicago" onSave={vi.fn()} />);
    const select = screen.getByLabelText(/Business timezone/i) as HTMLSelectElement;
    const offsets = Array.from(select.options).map((o) => {
      const m = o.textContent?.match(/^\(UTC([+−±])(\d{2}):(\d{2})\)/);
      if (!m) return 0;
      const sign = m[1] === "−" ? -1 : 1;
      return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
    });
    const sorted = [...offsets].sort((a, b) => a - b);
    expect(offsets).toEqual(sorted);
  });
});
