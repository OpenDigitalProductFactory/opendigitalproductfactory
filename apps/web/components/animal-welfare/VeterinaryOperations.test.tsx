// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(shell)/workspace/rescue/care/actions", () => ({ manageCareAction: vi.fn() }));

import { VeterinaryOperations } from "./VeterinaryOperations";
import type { VeterinaryWorkspace } from "@/lib/animal-welfare/veterinary-vocabulary";

const workspace: VeterinaryWorkspace = {
  limit: 50,
  animals: [{ animalProfileId: "a1", name: "Ranger", animalRef: "AN-1" }],
  practices: [{ locationId: "loc-1", supplierId: "sup", name: "Oak & Prairie Vets", contactName: "Dr Julia", phone: null, arrangement: "Charity rate" }],
  appointments: [
    { appointmentId: "a1", version: 1, status: "booked", kind: "sterilization", kindLabel: "Spay / neuter surgery", animalProfileId: "a1", animalName: "Ranger", animalRef: "AN-1", practiceName: "Oak & Prairie Vets", scheduledStart: "2026-09-22T09:00:00.000Z", scheduledEnd: "2026-09-22T10:30:00.000Z", recoveryUntil: "2026-09-29T10:30:00.000Z", inRecovery: false, note: null }, // clock-bomb-guard: allow — display-only fixture; inRecovery is precomputed by the loader
    { appointmentId: "a2", version: 3, status: "fulfilled", kind: "dental", kindLabel: "Dental", animalProfileId: "a1", animalName: "Ranger", animalRef: "AN-1", practiceName: null, scheduledStart: "2026-09-15T09:00:00.000Z", scheduledEnd: "2026-09-15T10:00:00.000Z", recoveryUntil: "2026-09-19T10:00:00.000Z", inRecovery: true, note: null }, // clock-bomb-guard: allow — display-only fixture; inRecovery is precomputed by the loader
  ],
};

describe("VeterinaryOperations", () => {
  afterEach(cleanup);

  it("lists booked and recovering visits, closes only open ones, and shows partner practices", () => {
    render(<VeterinaryOperations workspace={workspace} timeZone="UTC" />);
    expect(screen.getByText(/Spay \/ neuter surgery · Ranger/)).toBeTruthy();
    expect(screen.getByText("In recovery")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Close visit" })).toHaveLength(1);
    expect(screen.getByText("Oak & Prairie Vets", { selector: "span" })).toBeTruthy();
    expect(screen.getByRole("form", { name: "Book a visit" })).toBeTruthy();
  });

  it("explains an empty board and disables booking with no animals", () => {
    render(<VeterinaryOperations workspace={{ ...workspace, appointments: [], animals: [], practices: [] }} timeZone="UTC" />);
    expect(screen.getByText(/No visits are booked/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Book visit" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("form", { name: "Register a partner practice" })).toBeTruthy();
  });
});
