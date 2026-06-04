import { describe, expect, it, vi } from "vitest";

import { recordWorkspaceHomeResolution } from "./telemetry";
import type {
  WorkspaceHomeArchetypeRef,
  WorkspaceHomeContribution,
  WorkspaceHomeResolution,
} from "./types";

function fakeCounter() {
  return { inc: vi.fn() };
}

function exactResolution(): WorkspaceHomeResolution {
  return {
    mode: "vertical",
    match: "exact",
    contribution: { id: "home-hvac-dispatch" } as WorkspaceHomeContribution,
    fallback: null,
    setupAction: null,
  };
}

function categoryResolution(): WorkspaceHomeResolution {
  return {
    mode: "vertical",
    match: "category",
    contribution: { id: "home-trades" } as WorkspaceHomeContribution,
    fallback: null,
    setupAction: null,
  };
}

function unconfiguredResolution(): WorkspaceHomeResolution {
  return {
    mode: "unconfigured",
    match: "none",
    contribution: null,
    fallback: "platform",
    setupAction: "choose-or-finish-business-setup",
  };
}

describe("recordWorkspaceHomeResolution", () => {
  it("records match=exact + has_archetype=true on a happy-path vertical resolution", async () => {
    const counter = fakeCounter();
    const archetype: WorkspaceHomeArchetypeRef = {
      archetypeId: "hvac-contractor",
      category: "trades-maintenance",
      name: "HVAC Contractor",
    };

    await recordWorkspaceHomeResolution(exactResolution(), archetype, counter);

    expect(counter.inc).toHaveBeenCalledExactlyOnceWith({
      match: "exact",
      has_archetype: "true",
    });
  });

  it("records match=category + has_archetype=true on a category fallback", async () => {
    const counter = fakeCounter();
    const archetype: WorkspaceHomeArchetypeRef = {
      archetypeId: "plumbing-contractor",
      category: "trades-maintenance",
      name: "Plumbing Contractor",
    };

    await recordWorkspaceHomeResolution(categoryResolution(), archetype, counter);

    expect(counter.inc).toHaveBeenCalledExactlyOnceWith({
      match: "category",
      has_archetype: "true",
    });
  });

  it("records the silent-fallback gap as match=none + has_archetype=true when an archetype is configured but no contribution matches", async () => {
    const counter = fakeCounter();
    const archetype: WorkspaceHomeArchetypeRef = {
      archetypeId: "training-company",
      category: "education-training",
      name: "Training Company",
    };

    await recordWorkspaceHomeResolution(unconfiguredResolution(), archetype, counter);

    // This is the load-bearing case: configured archetype + no contribution
    // = the substrate's honest fallback to PlatformWorkspaceHome. Alerts
    // should fire on this label combo.
    expect(counter.inc).toHaveBeenCalledExactlyOnceWith({
      match: "none",
      has_archetype: "true",
    });
  });

  it("records match=none + has_archetype=false on a cold install with no StorefrontConfig", async () => {
    const counter = fakeCounter();

    await recordWorkspaceHomeResolution(unconfiguredResolution(), null, counter);

    expect(counter.inc).toHaveBeenCalledExactlyOnceWith({
      match: "none",
      has_archetype: "false",
    });
  });

  it("treats an archetype ref with both ids null as no-archetype", async () => {
    const counter = fakeCounter();
    const blankArchetype: WorkspaceHomeArchetypeRef = {
      archetypeId: null,
      category: null,
    };

    await recordWorkspaceHomeResolution(unconfiguredResolution(), blankArchetype, counter);

    expect(counter.inc).toHaveBeenCalledExactlyOnceWith({
      match: "none",
      has_archetype: "false",
    });
  });

  it("considers a category-only archetype as having an archetype (legitimate partial match input)", async () => {
    const counter = fakeCounter();
    const archetype: WorkspaceHomeArchetypeRef = {
      archetypeId: null,
      category: "trades-maintenance",
    };

    await recordWorkspaceHomeResolution(categoryResolution(), archetype, counter);

    expect(counter.inc).toHaveBeenCalledExactlyOnceWith({
      match: "category",
      has_archetype: "true",
    });
  });
});
