// The discovery sweep persists in ONE interactive transaction. At Prisma's
// default 5 s budget a sweep on a loaded host outran it (DEV, 2026-11-13:
// "timeout was 5000 ms, however 5214 ms passed", P2028). The expired
// transaction rolled the DiscoveryRun back, the next write failed with P2025
// ("No 'DiscoveryRun' record ... for a nested connect"), Inngest retried the
// whole sweep, and the overlapping retries exhausted the portal heap: the
// portal restarted 11 times in 30 minutes.
import { describe, expect, it } from "vitest";

import { DISCOVERY_PERSIST_TRANSACTION_OPTIONS, persistBootstrapDiscoveryRun } from "./discovery-sync";

describe("persistBootstrapDiscoveryRun transaction budget", () => {
  it("runs the sweep's transaction with an explicit budget sized for a sweep, not Prisma's 5 s default", async () => {
    let received: unknown;
    const db = {
      $transaction: async (_fn: unknown, options?: unknown) => {
        received = options;
        throw new Error("stop after capturing options");
      },
    };
    await expect(
      persistBootstrapDiscoveryRun(db as never, { discoveredItems: [] } as never, { sourceSlug: "test" } as never),
    ).rejects.toThrow("stop after capturing options");
    expect(received).toEqual(DISCOVERY_PERSIST_TRANSACTION_OPTIONS);
    expect(DISCOVERY_PERSIST_TRANSACTION_OPTIONS.timeout).toBeGreaterThanOrEqual(60_000);
  });
});
