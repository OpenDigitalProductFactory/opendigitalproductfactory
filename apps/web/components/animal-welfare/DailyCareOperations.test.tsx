// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(shell)/workspace/rescue/care/actions", () => ({ manageCareAction: vi.fn() }));

import { DailyCareOperations } from "./DailyCareOperations";
import type { DailyCareBoard } from "@/lib/animal-welfare/daily-care-vocabulary";

const board: DailyCareBoard = {
  limit: 100,
  animals: [{ animalProfileId: "a1", name: "Ranger", animalRef: "AN-1" }],
  rounds: [
    { id: "r1", title: "Feed — Ranger", kind: "feed", instruction: "Half a cup", animalProfileId: "a1", animalName: "Ranger", animalRef: "AN-1", dueAt: "2026-09-17T07:00:00.000Z", status: "planned", overdue: true, medicationOverdue: false }, // clock-bomb-guard: allow — overdue flags are precomputed by the loader; the component never compares dueAt to the wall clock
    { id: "r2", title: "Medication: Bravecto — Ranger", kind: "medication", instruction: "Bravecto", animalProfileId: "a1", animalName: "Ranger", animalRef: "AN-1", dueAt: "2026-09-17T06:00:00.000Z", status: "planned", overdue: true, medicationOverdue: true }, // clock-bomb-guard: allow — overdue flags are precomputed by the loader; the component never compares dueAt to the wall clock
    { id: "r3", title: "Walk — Ranger", kind: "walk", instruction: null, animalProfileId: "a1", animalName: "Ranger", animalRef: "AN-1", dueAt: "2026-09-17T16:00:00.000Z", status: "planned", overdue: false, medicationOverdue: false }, // clock-bomb-guard: allow — overdue flags are precomputed by the loader; the component never compares dueAt to the wall clock
  ],
  escalations: [{ id: "esc-1", title: "Welfare follow-up: Feed — Ranger", reason: "not-eaten: nothing since yesterday", animalName: "Ranger", raisedAt: "2026-09-17T09:00:00.000Z" }],
};

describe("DailyCareOperations", () => {
  afterEach(cleanup);

  it("shows follow-ups first, flags overdue medication in words, and offers the escalation count", () => {
    render(<DailyCareOperations board={board} timeZone="UTC" />);
    expect(screen.getByText("Welfare follow-up: Feed — Ranger")).toBeTruthy();
    expect(screen.getByText("not-eaten: nothing since yesterday")).toBeTruthy();
    expect(screen.getByText("Medication overdue")).toBeTruthy();
    expect(screen.getAllByText("Overdue")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Escalate 1 missed medication" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Record" })).toHaveLength(3);
    expect(screen.getByRole("form", { name: "Set up a routine" })).toBeTruthy();
  });

  it("explains the empty list and disables routine setup with no animals in care", () => {
    render(<DailyCareOperations board={{ ...board, rounds: [], escalations: [], animals: [] }} timeZone="UTC" />);
    expect(screen.getByText(/No rounds are due/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Schedule routine" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "No medication overdue" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
