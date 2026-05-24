// apps/web/lib/build/ideate-build-resolution.test.ts
//
// Regression coverage for BI-F4A30FCB (Dale dogfood 2026-05-24).
//
// Two Build Studio tools (start_ideate_research, start_scout_research) used
// to silently mis-target whichever ideate-phase build had the highest
// updatedAt — meaning when multiple builds were in ideate concurrently, the
// user's research request would land on an unrelated build. Bug hid behind
// success:true responses. These tests pin the resolveIdeateBuildForToolPure
// helper's behavior so the same class of bug can't reintroduce.

import { describe, expect, it, vi } from "vitest";

import {
  resolveIdeateBuildForToolPure,
  type IdeateBuildResolverDeps,
} from "./ideate-build-resolution";

function makeDeps(overrides: Partial<IdeateBuildResolverDeps> = {}): IdeateBuildResolverDeps {
  return {
    findUniqueBuild: vi.fn().mockResolvedValue(null),
    findIdeateBuilds: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("resolveIdeateBuildForToolPure (BI-F4A30FCB regression)", () => {
  describe("explicit contextBuildId path", () => {
    it("returns the explicit build when it exists and is in ideate", async () => {
      const findUniqueBuild = vi.fn().mockResolvedValue({
        buildId: "FB-DALE",
        phase: "ideate",
      });
      const findIdeateBuilds = vi.fn();

      const result = await resolveIdeateBuildForToolPure(
        { contextBuildId: "FB-DALE", toolName: "start_ideate_research" },
        makeDeps({ findUniqueBuild, findIdeateBuilds }),
      );

      expect(result.build).toEqual({ buildId: "FB-DALE" });
      expect(findUniqueBuild).toHaveBeenCalledWith("FB-DALE");
      // Critical: should NOT have fallen through to the findMany path.
      expect(findIdeateBuilds).not.toHaveBeenCalled();
    });

    it("refuses when the explicit build doesn't exist", async () => {
      const findUniqueBuild = vi.fn().mockResolvedValue(null);
      const findIdeateBuilds = vi.fn();

      const result = await resolveIdeateBuildForToolPure(
        { contextBuildId: "FB-DOES-NOT-EXIST", toolName: "start_ideate_research" },
        makeDeps({ findUniqueBuild, findIdeateBuilds }),
      );

      expect(result.build).toBe(null);
      expect(result.refusal?.success).toBe(false);
      expect(result.refusal?.message).toContain("Couldn't find that build");
      expect(findIdeateBuilds).not.toHaveBeenCalled();
    });

    it("refuses when the explicit build is past ideate (plan/build/review/ship)", async () => {
      const findUniqueBuild = vi.fn().mockResolvedValue({
        buildId: "FB-IN-PLAN",
        phase: "plan",
      });
      const findIdeateBuilds = vi.fn();

      const result = await resolveIdeateBuildForToolPure(
        { contextBuildId: "FB-IN-PLAN", toolName: "start_ideate_research" },
        makeDeps({ findUniqueBuild, findIdeateBuilds }),
      );

      expect(result.build).toBe(null);
      expect(result.refusal?.success).toBe(false);
      expect(result.refusal?.message).toContain("plan");
      expect(findIdeateBuilds).not.toHaveBeenCalled();
    });
  });

  describe("implicit fallback path (no contextBuildId)", () => {
    it("accepts the single ideate build when exactly one exists", async () => {
      const findUniqueBuild = vi.fn();
      const findIdeateBuilds = vi.fn().mockResolvedValue([{ buildId: "FB-ONLY-ONE" }]);

      const result = await resolveIdeateBuildForToolPure(
        { toolName: "start_ideate_research" },
        makeDeps({ findUniqueBuild, findIdeateBuilds }),
      );

      expect(result.build).toEqual({ buildId: "FB-ONLY-ONE" });
      // Sanity: findUnique should not have been called when no contextBuildId.
      expect(findUniqueBuild).not.toHaveBeenCalled();
    });

    it("refuses when zero ideate builds exist", async () => {
      const findIdeateBuilds = vi.fn().mockResolvedValue([]);

      const result = await resolveIdeateBuildForToolPure(
        { toolName: "start_ideate_research" },
        makeDeps({ findIdeateBuilds }),
      );

      expect(result.build).toBe(null);
      expect(result.refusal?.success).toBe(false);
      expect(result.refusal?.message).toContain("planning conversation");
    });

    it("REFUSES when 2+ ideate builds exist — the exact bug this regression test guards against", async () => {
      // The bug: pre-fix, this case silently picked the most-recently-
      // updated build, cross-contaminating its state. The new behavior is
      // to refuse so the failure is loud rather than silent.
      const findIdeateBuilds = vi.fn().mockResolvedValue([
        { buildId: "FB-NEWER" },
        { buildId: "FB-OLDER" },
      ]);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await resolveIdeateBuildForToolPure(
        { toolName: "start_ideate_research" },
        makeDeps({ findIdeateBuilds }),
      );

      expect(result.build).toBe(null);
      expect(result.refusal?.success).toBe(false);
      // User-facing message must be plain English (rule #13 — no schema names,
      // no build IDs leaked).
      expect(result.refusal?.message).not.toContain("FB-NEWER");
      expect(result.refusal?.message).not.toContain("FB-OLDER");
      expect(result.refusal?.message).not.toContain("featureBuildId");
      // The engineering hint must be logged for the operator to find.
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("context.featureBuildId"),
      );

      warnSpy.mockRestore();
    });
  });

  describe("cross-contamination scenario (the exact Dale dogfood repro)", () => {
    it("targets the user's build FB-DALE when contextBuildId=FB-DALE, even when FB-OTHER has a newer updatedAt", async () => {
      // Repro: two builds in ideate; FB-OTHER updated more recently. Pre-fix,
      // the tool's `findFirst orderBy updatedAt desc` would have grabbed
      // FB-OTHER. Post-fix, the explicit contextBuildId wins and findMany
      // never runs.
      const findUniqueBuild = vi.fn().mockResolvedValue({
        buildId: "FB-DALE",
        phase: "ideate",
      });
      const findIdeateBuilds = vi.fn();

      const result = await resolveIdeateBuildForToolPure(
        { contextBuildId: "FB-DALE", toolName: "start_ideate_research" },
        makeDeps({ findUniqueBuild, findIdeateBuilds }),
      );

      expect(result.build).toEqual({ buildId: "FB-DALE" });
      // findMany must never run when explicit buildId is honored — the
      // bug lives in the fallback path; explicit-buildId must short-circuit.
      expect(findIdeateBuilds).not.toHaveBeenCalled();
    });
  });
});
