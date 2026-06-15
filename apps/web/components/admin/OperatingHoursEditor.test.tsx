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
