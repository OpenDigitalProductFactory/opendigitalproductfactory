// apps/web/lib/build/build-engine-readiness.ts
//
// Build-Engine Provisioning (EP-2D477458) — shared readiness sweep.
//
// One place that answers "which build engines are actually installed in the
// sandbox right now?" for every caller: the /platform/ai/build-studio config
// page (proactive probe on load + one-click "Probe all"), the
// get_build_engine_readiness MCP tool (refresh:true), and any future surface.
//
// Two modes:
//   - loadBuildEngineReadiness(): cheap DB read of the last persisted probe
//     (BuildEngineState). No docker exec. Feeds the first server render so the
//     page paints instantly with last-known state.
//   - probeBuildEngineReadiness(): live `docker exec … --version` per engine,
//     persisted, returning the FAILURE REASON so a "not installed" badge can
//     say WHY (missing binary vs docker error vs unparseable output). Never
//     throws — probeEngineReadiness catches every failure per engine.
//
// The failure reason (`error`) is only ever populated by a live probe;
// BuildEngineState does not persist it, so DB-loaded rows carry error: null.

import { prisma } from "@dpf/db";

import {
  probeEngineReadiness,
  type EngineProbeConfig,
} from "@/lib/routing/capability-probes/probe-engine-readiness";
import { persistEngineReadiness } from "@/lib/routing/persist-engine-readiness";

/**
 * One engine's readiness for a UX badge or the MCP surface. `present === null`
 * means "never probed"; `error` is the last live-probe failure reason (only
 * populated when present === false and only from a live probe, never from the
 * DB-loaded last-known state).
 */
export type BuildEngineReadinessRow = {
  engineId: string;
  binary: string;
  bakeInDefault: boolean;
  present: boolean | null;
  version: string | null;
  lastProbedAt: string | null;
  error: string | null;
};

const ENGINE_SELECT = {
  engineId: true,
  binary: true,
  verifyCommand: true,
  versionRegex: true,
  bakeInDefault: true,
  state: { select: { present: true, version: true, lastProbedAt: true } },
} as const;

/**
 * Last-known readiness for every registered engine, straight from
 * BuildEngineState — no docker exec. Ordered by engineId for a stable render.
 */
export async function loadBuildEngineReadiness(): Promise<BuildEngineReadinessRow[]> {
  const engines = await prisma.buildEngine.findMany({
    select: ENGINE_SELECT,
    orderBy: { engineId: "asc" },
  });
  return engines.map((e) => ({
    engineId: e.engineId,
    binary: e.binary,
    bakeInDefault: e.bakeInDefault,
    present: e.state?.present ?? null,
    version: e.state?.version ?? null,
    lastProbedAt: e.state?.lastProbedAt ? e.state.lastProbedAt.toISOString() : null,
    error: null,
  }));
}

/**
 * Live-probe the sandbox for the given engines (or all when `engineIds` is
 * omitted/empty), persist each result, and return fresh rows including the
 * failure reason. Best-effort persistence: a persist failure never fails the
 * probe (the badge still shows truth). Probes run in parallel; each engine's
 * probe is independently non-throwing.
 */
export async function probeBuildEngineReadiness(
  opts: { engineIds?: string[] } = {},
): Promise<BuildEngineReadinessRow[]> {
  const where =
    opts.engineIds && opts.engineIds.length > 0
      ? { engineId: { in: opts.engineIds } }
      : undefined;
  const engines = await prisma.buildEngine.findMany({
    where,
    select: ENGINE_SELECT,
    orderBy: { engineId: "asc" },
  });

  return Promise.all(
    engines.map(async (e): Promise<BuildEngineReadinessRow> => {
      const probeConfig: EngineProbeConfig = {
        engineId: e.engineId,
        binary: e.binary,
        verifyCommand: e.verifyCommand,
        versionRegex: e.versionRegex,
      };
      const r = await probeEngineReadiness(probeConfig);
      await persistEngineReadiness(r).catch(() => undefined);
      return {
        engineId: e.engineId,
        binary: e.binary,
        bakeInDefault: e.bakeInDefault,
        present: r.present,
        version: r.version,
        lastProbedAt: r.probedAt,
        error: r.error ?? null,
      };
    }),
  );
}
