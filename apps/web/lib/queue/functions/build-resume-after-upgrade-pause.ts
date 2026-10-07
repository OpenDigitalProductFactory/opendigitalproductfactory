// BI-E9DAA23F — resume builds the moment an upgrade pause clears.
//
// While an upgrade drains, a build's next phase is refused and the build waits
// (admitPhaseTransition). Before this subscriber, the only thing that picked it
// up again was the 10-minute stranded-build tick in instrumentation.ts, so with
// upgrades this frequent (16 on 2026-10-02) builds spent much of the day parked.
//
// platform.quiescence-cleared is emitted on every way a pause ends: the
// coordinator's succeeded / deferred / aborted / failed paths, the boot
// reconciler, and the watchdog's stuck-coordinator recovery. The level is
// already back to normal when it fires. The 10-minute tick stays as the
// backstop for a missed event.

import { jobs } from "@/lib/jobs";

export const buildResumeAfterUpgradePause = jobs.createFunction(
  {
    id: "build/resume-after-upgrade-pause",
    retries: 2,
    // One pass at a time: two clears close together must not resume a build twice.
    concurrency: [{ limit: 1 }],
    triggers: [{ event: "platform.quiescence-cleared" }],
  },
  async ({ step }) => {
    const found = (await step.run("find-held-builds", async () => {
      const { getQuiescenceLevel } = await import("@/lib/self-upgrade/quiescence");
      const level = await getQuiescenceLevel();
      // A new pause already began; its own clear will wake these builds.
      if (level !== "normal") return { level, held: [] as string[] };
      const { findBuildsHeldByUpgradePause } = await import("@/lib/build/upgrade-pause-hold");
      const held = await findBuildsHeldByUpgradePause();
      return { level, held: held.map((b) => b.buildId) };
    })) as { level: string; held: string[] };

    if (found.level !== "normal") {
      return { held: 0, resumed: 0, skipped: `platform still paused (${found.level})` };
    }

    let resumed = 0;
    for (const buildId of found.held) {
      const outcome = (await step.run(`resume-${buildId}`, async () => {
        const { resumeBuildHeldByUpgradePause } = await import("@/lib/build/upgrade-pause-hold");
        return resumeBuildHeldByUpgradePause({ buildId });
      })) as string;
      if (outcome === "resumed") resumed++;
    }
    return { held: found.held.length, resumed };
  },
);
