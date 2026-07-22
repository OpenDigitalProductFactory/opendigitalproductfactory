import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import SelfUpgradeJobEngineHealthAlert, {
  shouldPollForJobEngineRecovery,
} from "./SelfUpgradeJobEngineHealthAlert";

describe("SelfUpgradeJobEngineHealthAlert", () => {
  it("explains degraded job-engine health with automatic recovery guidance", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeJobEngineHealthAlert
        jobEngine={{
          status: "degraded",
          detail: "Inngest re-sync failed: fetch failed",
          checkedAt: "2026-07-20T05:23:47.866Z",
          watchdog: null,
        }}
      />,
    );

    expect(html).toContain("Background jobs need attention");
    expect(html).toContain("The portal retries Inngest registration automatically every 5 minutes");
    expect(html).toContain("Last check");
    expect(html).toContain("Current signal");
    expect(html).toContain("Inngest re-sync failed: fetch failed");
    expect(html).not.toContain("Restart the");
  });

  it("shows the last watchdog recovery attempt when present", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeJobEngineHealthAlert
        jobEngine={{
          status: "degraded",
          detail: "No /api/inngest POST execution has been observed for 20 minute(s).",
          checkedAt: "2026-07-20T05:23:47.866Z",
          watchdog: {
            status: "degraded",
            detail: "No /api/inngest POST execution has been observed for 20 minute(s).",
            lastInvocationAt: "2026-07-20T05:03:47.866Z",
            lastGatewayHitAt: "2026-07-20T05:03:47.866Z",
            lastRecoveryAttemptAt: "2026-07-20T05:20:00.000Z",
            lastRecoverySummary: "retention sweep ran, orphansReaped=0, historyTrimmed=3, errors=0",
          },
        }}
      />,
    );

    expect(html).toContain("Last recovery attempt");
    expect(html).toContain("retention sweep ran");
  });
});

describe("shouldPollForJobEngineRecovery", () => {
  it("polls only while the job engine is degraded", () => {
    expect(shouldPollForJobEngineRecovery(undefined)).toBe(false);
    expect(shouldPollForJobEngineRecovery({ status: "healthy", detail: null, checkedAt: null })).toBe(false);
    expect(shouldPollForJobEngineRecovery({ status: "unknown", detail: null, checkedAt: null })).toBe(false);
    expect(
      shouldPollForJobEngineRecovery({
        status: "degraded",
        detail: "Inngest re-sync failed: fetch failed",
        checkedAt: "2026-07-20T05:23:47.866Z",
      }),
    ).toBe(true);
  });
});
