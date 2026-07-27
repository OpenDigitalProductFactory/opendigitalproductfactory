import { describe, expect, it, vi } from "vitest";

import { mayCompleteAutonomousBuild } from "./autonomous-build-completion-gate";

describe("mayCompleteAutonomousBuild", () => {
  it("preserves the legacy path when the consumer is off", async () => {
    const resolve = vi.fn();
    await expect(mayCompleteAutonomousBuild({
      buildId: "FB-1",
      deps: { getMode: () => "off", resolve },
    })).resolves.toBe(true);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("observes without blocking in shadow mode", async () => {
    await expect(mayCompleteAutonomousBuild({
      buildId: "FB-2",
      deps: {
        getMode: () => "shadow",
        resolve: async () => ({
          mayAct: false,
          eligibility: { blockers: ["active_pattern_evidence_stale"] },
        }),
      },
    })).resolves.toBe(true);
  });

  it("parks an enforce-mode completion whose release evidence is withheld", async () => {
    const log = vi.fn();
    await expect(mayCompleteAutonomousBuild({
      buildId: "FB-3",
      logger: { log, error: vi.fn() },
      deps: {
        getMode: () => "enforce",
        resolve: async () => ({
          mayAct: false,
          eligibility: { blockers: ["active_pattern_evidence_stale"] },
        }),
      },
    })).resolves.toBe(false);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("active_pattern_evidence_stale"),
    );
  });

  it("fails closed on an unavailable enforce-mode oracle", async () => {
    const error = vi.fn();
    await expect(mayCompleteAutonomousBuild({
      buildId: "FB-4",
      logger: { log: vi.fn(), error },
      deps: {
        getMode: () => "enforce",
        resolve: async () => {
          throw new Error("oracle unavailable");
        },
      },
    })).resolves.toBe(false);
    expect(error).toHaveBeenCalled();
  });
});
