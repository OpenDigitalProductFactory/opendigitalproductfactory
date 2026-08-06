import { describe, it, expect } from "vitest";
import {
  reverifyCitations,
  excerptSupported,
  type RecordedCitation,
  type LocatorResolver,
} from "./evidence-reverifier";
import type { StructuredLocator } from "@/lib/deliberation/evidence";

const loc = (line: number): StructuredLocator => ({ sourceType: "code", filePath: "resume.txt", line });

function citation(over: Partial<RecordedCitation> = {}): RecordedCitation {
  return {
    optionId: "cand",
    dimensionKey: "skill_match",
    locator: loc(12),
    recordedExcerpt: "10 years of Rust",
    ...over,
  };
}

describe("evidence-reverifier", () => {
  it("excerptSupported is whitespace-insensitive containment", () => {
    expect(excerptSupported("10 years of Rust", "…  10   years of   Rust …")).toBe(true);
    expect(excerptSupported("10 years of Rust", "5 years of Go")).toBe(false);
    expect(excerptSupported(null, null)).toBe(true); // nothing to contradict
  });

  it("confirms when the live source still supports the recorded excerpt", async () => {
    const resolve: LocatorResolver = async () => ({ resolved: true, liveExcerpt: "…10 years of Rust…" });
    const report = await reverifyCitations([citation()], resolve);
    expect(report.results[0].verdict).toBe("confirmed");
    expect(report.allConfirmed).toBe(true);
    expect(report.degrade).toEqual([]);
  });

  it("degrades when the source no longer supports the excerpt", async () => {
    const resolve: LocatorResolver = async () => ({ resolved: true, liveExcerpt: "2 years of Rust" });
    const report = await reverifyCitations([citation()], resolve);
    expect(report.results[0].verdict).toBe("degraded");
    expect(report.degrade).toEqual([{ optionId: "cand", dimensionKey: "skill_match" }]);
    expect(report.allConfirmed).toBe(false);
  });

  it("marks unresolved when the locator no longer resolves", async () => {
    const resolve: LocatorResolver = async () => ({ resolved: false, liveExcerpt: null });
    const report = await reverifyCitations([citation()], resolve);
    expect(report.results[0].verdict).toBe("unresolved");
    expect(report.unresolved).toBe(1);
  });

  it("fails closed when the resolver throws (treated as unresolved, never confirmed)", async () => {
    const resolve: LocatorResolver = async () => {
      throw new Error("fs blew up");
    };
    const report = await reverifyCitations([citation()], resolve);
    expect(report.results[0].verdict).toBe("unresolved");
    expect(report.allConfirmed).toBe(false);
  });

  it("aggregates mixed verdicts across citations", async () => {
    const resolve: LocatorResolver = async (l) => {
      const line = "line" in l ? (l as { line?: number }).line : undefined;
      if (line === 1) return { resolved: true, liveExcerpt: "keep A" };
      if (line === 2) return { resolved: true, liveExcerpt: "changed" };
      return { resolved: false, liveExcerpt: null };
    };
    const report = await reverifyCitations(
      [
        citation({ dimensionKey: "a", locator: loc(1), recordedExcerpt: "keep A" }),
        citation({ dimensionKey: "b", locator: loc(2), recordedExcerpt: "orig B" }),
        citation({ dimensionKey: "c", locator: loc(3), recordedExcerpt: "gone" }),
      ],
      resolve,
    );
    expect(report.confirmed).toBe(1);
    expect(report.degraded).toBe(1);
    expect(report.unresolved).toBe(1);
    expect(report.degrade).toHaveLength(2);
  });
});
