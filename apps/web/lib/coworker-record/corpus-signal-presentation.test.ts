import { describe, expect, it } from "vitest";

import { presentCorpusSignals } from "./corpus-signal-presentation";
import type { CorpusSignalTotals } from "./corpus-signal-presentation";

function totals(
  overrides: Partial<CorpusSignalTotals> = {},
): CorpusSignalTotals {
  return { injected: 0, missed: 0, openGaps: 0, injectionRatePct: null, ...overrides };
}

describe("presentCorpusSignals — no signal is not good signal (BI-579210DD)", () => {
  // Founder-reported: a coworker that had never run rendered green and told the
  // operator "every coworker turn has been grounded in its profession corpus".
  // Vacuously true over an empty set, and indistinguishable from a corpus that
  // has never once been injected. These tests pin the distinction.

  describe("with no recorded turns", () => {
    const present = presentCorpusSignals(totals());

    it("reports no usage", () => {
      expect(present.hasUsage).toBe(false);
    });

    it("does NOT paint zero gaps as success", () => {
      // The specific regression. Zero gaps only means something once turns have
      // happened; with none, nothing has had the chance to go wrong.
      expect(present.gapsIntent).toBe("neutral");
    });

    it("does NOT paint zero injections as success", () => {
      expect(present.injectionsIntent).toBe("neutral");
    });

    it("says the figures are empty rather than healthy", () => {
      expect(present.noUsageNotice).toMatch(/empty, not healthy/);
    });

    it("never claims turns were grounded", () => {
      expect(present.emptyGapsCopy).not.toMatch(/every coworker turn has been grounded/);
      expect(present.emptyGapsCopy).toMatch(/absence of evidence, not evidence of health/);
    });
  });

  describe("with a genuinely healthy corpus", () => {
    const present = presentCorpusSignals(totals({ injected: 40, injectionRatePct: 100 }));

    it("reports usage and keeps the success reading", () => {
      expect(present.hasUsage).toBe(true);
      expect(present.injectionsIntent).toBe("success");
      expect(present.gapsIntent).toBe("success");
    });

    it("drops the no-usage banner", () => {
      expect(present.noUsageNotice).toBeNull();
    });

    it("restores the grounded claim, which is now earned", () => {
      expect(present.emptyGapsCopy).toMatch(/every coworker turn has been grounded/);
    });
  });

  it("treats a miss as usage — the path ran and did not answer", () => {
    // A miss is a real (bad) signal, not an absent one, so the panel must stop
    // apologising for having no data the moment anything is recorded.
    const present = presentCorpusSignals(totals({ missed: 3, injectionRatePct: 0 }));
    expect(present.hasUsage).toBe(true);
    expect(present.noUsageNotice).toBeNull();
    expect(present.missesIntent).toBe("warning");
  });

  it("warns on open gaps regardless of usage volume", () => {
    expect(presentCorpusSignals(totals({ injected: 10, openGaps: 2 })).gapsIntent).toBe("warning");
  });

  it("never returns success for any intent when nothing has run", () => {
    // Blanket guard: whatever tiles get added later, an unused corpus must not
    // be able to render a single green reading.
    const present = presentCorpusSignals(totals({ openGaps: 0 }));
    expect(Object.values(present).filter((v) => v === "success")).toEqual([]);
  });
});
