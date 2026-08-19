// apps/web/lib/build/build-engine-readiness.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, probeEngineReadiness, persistEngineReadiness } = vi.hoisted(() => ({
  findMany: vi.fn(),
  probeEngineReadiness: vi.fn(),
  persistEngineReadiness: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: { buildEngine: { findMany } } }));
vi.mock("@/lib/routing/capability-probes/probe-engine-readiness", () => ({ probeEngineReadiness }));
vi.mock("@/lib/routing/persist-engine-readiness", () => ({ persistEngineReadiness }));

import { loadBuildEngineReadiness, probeBuildEngineReadiness } from "./build-engine-readiness";

const CLAUDE = {
  engineId: "claude",
  binary: "claude",
  verifyCommand: "claude --version",
  versionRegex: "([0-9.]+)",
  bakeInDefault: true,
};
const GROK = {
  engineId: "grok",
  binary: "grok",
  verifyCommand: "grok --version",
  versionRegex: "([0-9.]+)",
  bakeInDefault: false,
};

beforeEach(() => {
  findMany.mockReset();
  probeEngineReadiness.mockReset();
  persistEngineReadiness.mockReset();
  persistEngineReadiness.mockResolvedValue(undefined);
});

describe("loadBuildEngineReadiness", () => {
  it("maps last-known BuildEngineState with error: null and never probes", async () => {
    findMany.mockResolvedValue([
      { ...CLAUDE, state: { present: true, version: "1.2.3", lastProbedAt: new Date("2026-07-04T00:00:00Z") } },
      { ...GROK, state: null },
    ]);

    const rows = await loadBuildEngineReadiness();

    expect(probeEngineReadiness).not.toHaveBeenCalled();
    expect(rows).toEqual([
      { engineId: "claude", binary: "claude", bakeInDefault: true, present: true, version: "1.2.3", lastProbedAt: "2026-07-04T00:00:00.000Z", error: null },
      { engineId: "grok", binary: "grok", bakeInDefault: false, present: null, version: null, lastProbedAt: null, error: null },
    ]);
  });
});

describe("probeBuildEngineReadiness", () => {
  it("live-probes each engine, persists, and surfaces the failure reason", async () => {
    findMany.mockResolvedValue([
      { ...CLAUDE, state: null },
      { ...GROK, state: null },
    ]);
    probeEngineReadiness.mockImplementation(async (cfg: { engineId: string }) =>
      cfg.engineId === "claude"
        ? { engineId: "claude", present: true, version: "1.2.3", probedAt: "2026-07-05T00:00:00.000Z" }
        : { engineId: "grok", present: false, version: null, probedAt: "2026-07-05T00:00:00.000Z", error: "'grok --version' failed: not found" },
    );

    const rows = await probeBuildEngineReadiness();

    expect(persistEngineReadiness).toHaveBeenCalledTimes(2);
    expect(rows.find((r) => r.engineId === "claude")).toMatchObject({ present: true, version: "1.2.3", error: null });
    expect(rows.find((r) => r.engineId === "grok")).toMatchObject({ present: false, error: "'grok --version' failed: not found" });
  });

  it("scopes the query to the given engineIds", async () => {
    findMany.mockResolvedValue([{ ...GROK, state: null }]);
    probeEngineReadiness.mockResolvedValue({ engineId: "grok", present: false, version: null, probedAt: "2026-07-05T00:00:00.000Z", error: "x" });

    await probeBuildEngineReadiness({ engineIds: ["grok"] });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { engineId: { in: ["grok"] } } }));
  });

  it("probes all engines when engineIds is empty (no where filter)", async () => {
    findMany.mockResolvedValue([]);

    await probeBuildEngineReadiness({ engineIds: [] });

    expect(findMany).toHaveBeenCalledWith(expect.not.objectContaining({ where: expect.anything() }));
  });

  it("a persist failure never fails the probe", async () => {
    findMany.mockResolvedValue([{ ...CLAUDE, state: null }]);
    probeEngineReadiness.mockResolvedValue({ engineId: "claude", present: true, version: "1.2.3", probedAt: "2026-07-05T00:00:00.000Z" });
    persistEngineReadiness.mockRejectedValue(new Error("db down"));

    const rows = await probeBuildEngineReadiness();
    expect(rows[0]).toMatchObject({ engineId: "claude", present: true });
  });
});
