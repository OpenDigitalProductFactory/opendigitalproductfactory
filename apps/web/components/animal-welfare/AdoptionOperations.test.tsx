// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(shell)/workspace/rescue/adoptions/actions", () => ({ manageAdoptionAction: vi.fn() }));

import { AdoptionOperations } from "./AdoptionOperations";
import type { AdoptionWorkspace } from "@/lib/animal-welfare/adoption-vocabulary";

const base = { applicationRef: "AA-1", version: 1, submittedAt: "2026-09-10T00:00:00.000Z", decisionReason: null, animalProfileId: "a1", animalName: "Ranger", animalRef: "AN-1", animalReady: true, animalOnHold: false, reservedForOther: null, reservation: null, nextVisitAt: null }; // clock-bomb-guard: allow — dates are display-only fixtures; nothing compares them to the wall clock

const workspace: AdoptionWorkspace = {
  limit: 50,
  currency: "USD",
  animals: [{ animalProfileId: "a1", name: "Ranger", animalRef: "AN-1", ready: true }],
  housing: [{ id: "k1", label: "D1", available: 1 }],
  applications: [
    { ...base, applicationId: "app-1", applicantName: "Dana Ortiz", status: "home-check" },
    { ...base, applicationId: "app-2", applicationRef: "AA-2", applicantName: "Sam Lee", status: "screening", reservedForOther: "Dana Ortiz" },
    { ...base, applicationId: "app-3", applicationRef: "AA-3", applicantName: "Kim Park", status: "approved", reservation: { placementId: "pl-3", status: "reserved" } },
  ],
  placements: [{ placementId: "pl-9", version: 1, animalName: "Saffron", animalRef: "AN-2", adopterName: "Ola N", placedAt: "2026-09-01T00:00:00.000Z" }], // clock-bomb-guard: allow — display-only fixture
};

describe("AdoptionOperations", () => {
  afterEach(cleanup);

  it("offers approval only where the animal is free, completes a reservation, and can take an animal back", () => {
    render(<AdoptionOperations workspace={workspace} timeZone="UTC" />);
    expect(screen.getByText(/Dana Ortiz for Ranger/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Complete adoption" })).toHaveLength(1);
    expect(screen.getByText("Reserved")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Take back/ })).toBeTruthy();
    expect(screen.getByRole("form", { name: "Record an application" })).toBeTruthy();
  });

  it("explains an empty queue and disables recording with no animals", () => {
    render(<AdoptionOperations workspace={{ ...workspace, applications: [], animals: [], placements: [] }} timeZone="UTC" />);
    expect(screen.getByText(/No open applications/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Record application" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
