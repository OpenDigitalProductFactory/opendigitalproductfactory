// apps/web/lib/routing/persist-engine-readiness.test.ts
//
// Test-first spec for persisting engine readiness to BuildEngineState.
// Spec: docs/superpowers/specs/2026-06-06-build-engine-provisioning-design.md (Phase 1a, slice B)

import { describe, expect, it, vi } from "vitest";

// Importing the module pulls in @dpf/db for the default client; stub it so the
// test never touches a real Prisma client (we pass a mock client explicitly).
vi.mock("@dpf/db", () => ({ prisma: {} }));

import { persistEngineReadiness } from "./persist-engine-readiness";
import type { EngineReadiness } from "./capability-probes/probe-engine-readiness";

const probedAt = "2026-06-08T00:00:00.000Z";

describe("persistEngineReadiness", () => {
  it("upserts present=true with the version and lastProbedAt", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const readiness: EngineReadiness = {
      engineId: "grok",
      present: true,
      version: "1.2.3",
      probedAt,
    };

    await persistEngineReadiness(readiness, { buildEngineState: { upsert } });

    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0]?.[0];
    expect(arg.where).toEqual({ engineId: "grok" });
    expect(arg.create.present).toBe(true);
    expect(arg.create.version).toBe("1.2.3");
    expect(arg.create.lastProbedAt).toEqual(new Date(probedAt));
    expect(arg.update.present).toBe(true);
  });

  it("upserts present=false with a null version when the engine is absent", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const readiness: EngineReadiness = {
      engineId: "grok",
      present: false,
      version: null,
      probedAt,
      error: "not found",
    };

    await persistEngineReadiness(readiness, { buildEngineState: { upsert } });

    const arg = upsert.mock.calls[0]?.[0];
    expect(arg.create.present).toBe(false);
    expect(arg.create.version).toBeNull();
    expect(arg.update.version).toBeNull();
  });
});
