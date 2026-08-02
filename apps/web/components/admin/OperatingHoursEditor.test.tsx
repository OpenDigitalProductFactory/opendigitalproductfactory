// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
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
    const picker = screen.getByRole("combobox", { name: /Business timezone/i }) as HTMLInputElement;
    // Orthodox: "(UTC−05:00) America/New York" — offset prefix, no underscore.
    expect(picker.value).toMatch(/^\(UTC[+−±]\d{2}:\d{2}\) America\/New York$/);
    expect(picker.value).not.toContain("_");
  });

  it("keeps the full timezone corpus hidden until the picker is opened and searched", () => {
    render(<OperatingHoursEditor defaultSchedule={schedule} timezone="America/Chicago" onSave={vi.fn()} />);
    const picker = screen.getByRole("combobox", { name: /Business timezone/i });

    expect(screen.queryByRole("option", { name: /Europe\/London/ })).not.toBeInTheDocument();

    fireEvent.click(picker);
    expect(screen.getAllByRole("option")).toHaveLength(12);

    fireEvent.change(screen.getByRole("textbox", { name: "Search timezones" }), {
      target: { value: "London" },
    });

    expect(screen.getByRole("option", { name: /Europe\/London/ })).toBeInTheDocument();
  });
});
