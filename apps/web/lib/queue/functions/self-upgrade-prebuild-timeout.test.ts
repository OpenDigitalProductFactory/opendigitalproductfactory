import { afterEach, describe, expect, it, vi } from "vitest";

import { prebuildPromoterParams } from "./self-upgrade-prebuild";

// SUR-CD779647 (2026-10-07): the prebuild's `next build` took 1326s on a loaded
// host and the promoter was killed at the 25-minute swap budget it inherited.
// The prebuild runs while the portal still serves, so nothing waits on it; it
// gets a budget sized for a slow build rather than for a held door.
const base = { runId: "SUR-1", containerName: "dpf-promoter-SUR-1", backupPath: "/backups/SUR-1", targetSha: "abc" } as never;

describe("prebuild promoter budget", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to 75 minutes, well past the 25-minute swap budget", () => {
    expect(prebuildPromoterParams(base, "SUR-1").timeoutMs).toBe(75 * 60 * 1000);
  });

  it("is operator-tunable through DPF_PROMOTER_PREBUILD_TIMEOUT_MS", () => {
    vi.stubEnv("DPF_PROMOTER_PREBUILD_TIMEOUT_MS", String(90 * 60 * 1000));
    expect(prebuildPromoterParams(base, "SUR-1").timeoutMs).toBe(90 * 60 * 1000);
  });

  it("never gives the prebuild less than the swap's own budget", () => {
    vi.stubEnv("DPF_PROMOTER_TIMEOUT_MS", String(120 * 60 * 1000));
    expect(prebuildPromoterParams(base, "SUR-1").timeoutMs).toBe(120 * 60 * 1000);
  });
});
