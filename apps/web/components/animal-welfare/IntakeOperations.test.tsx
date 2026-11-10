// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(shell)/workspace/rescue/intake/actions", () => ({ manageIntakeAction: vi.fn() }));

import { IntakeOperations } from "./IntakeOperations";
import type { IntakeWorkspace } from "@/lib/animal-welfare/intake-workspace";

const workspace: IntakeWorkspace = {
  limit: 25,
  housing: [{ id: "k1", label: "D1", kindSlug: "kennel", available: 1 }],
  existingAnimals: [],
  entries: [
    {
      animalProfileId: "a1", animalRef: "AN-1", name: "Ranger", species: "dog", episodeRef: "CE-1", version: 2, stage: "legal-hold", intakeType: "stray",
      openedAt: "2026-09-17T11:00:00.000Z", holdActive: true, holdReason: "legal hold · ordinance", housingLabel: "D2",
      checklist: { satisfied: 1, total: 8, missing: ["vaccination"] },
      readiness: { ready: false, blockers: [{ code: "hold_active", message: "A legal or policy hold is active and needs a human release.", recordIds: ["ep-1"] }, { code: "requirement_missing", requirementKey: "vaccination", message: "Vaccination has no evidence.", recordIds: [] }] },
      group: "blocked",
    },
    {
      animalProfileId: "a2", animalRef: "AN-2", name: "Saffron", species: "cat", episodeRef: "CE-2", version: 5, stage: "care", intakeType: "owner-relinquished",
      openedAt: "2026-09-10T00:00:00.000Z", holdActive: false, holdReason: null, housingLabel: "C1",
      checklist: { satisfied: 8, total: 8, missing: [] }, readiness: { ready: true, blockers: [] }, group: "ready",
    },
  ],
};

describe("IntakeOperations", () => {
  afterEach(cleanup);

  it("explains every blocker in words, offers the hold release only on a held animal, and the readiness action only when ready", () => {
    render(<IntakeOperations workspace={workspace} />);
    expect(screen.getByRole("form", { name: "Admit an animal" })).toBeTruthy();
    expect(screen.getByText("A legal or policy hold is active and needs a human release.")).toBeTruthy();
    expect(screen.getByText("Vaccination has no evidence.")).toBeTruthy();
    expect(screen.getByText("Checklist 1 of 8 complete.")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Release hold" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Verify placement readiness" })).toHaveLength(1);
    expect(screen.getByText("Blocked")).toBeTruthy();
    expect(screen.getByText("Ready to verify")).toBeTruthy();
  });

  it("disables admission when there is no open housing and says why", () => {
    render(<IntakeOperations workspace={{ ...workspace, housing: [], entries: [] }} />);
    expect((screen.getByRole("button", { name: "Admit and house" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Add or unblock a unit/)).toBeTruthy();
    expect(screen.getByText("No animals are in intake.")).toBeTruthy();
  });
});
