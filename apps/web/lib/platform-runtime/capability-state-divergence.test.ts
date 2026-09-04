// BI-5ACBAC50 — naming the capability drift.
//
// The fixture is not invented. It is what a live installation reported on
// 2026-08-26: install-state listing only `runtime:core`, the database reporting
// six further capabilities active, and `runtime:development` disabled while its
// services were running.

import { describe, expect, it } from "vitest";

import { projectCapabilityServices } from "./capability-service-projection";
import {
  diagnoseCapabilityStateDivergence,
  isCapabilityStateStaleError,
} from "./capability-state-divergence";

/** Verbatim from `install-state.json` on the drifted install. */
const LIVE_ENABLED = ["runtime:core"];

/** Verbatim from `select "capabilityId", state from "PlatformCapability"`. */
const LIVE_DB_STATE = [
  { capabilityId: "runtime:adp-integration", state: "disabled" as const },
  { capabilityId: "runtime:browser-automation", state: "active" as const },
  { capabilityId: "runtime:build", state: "active" as const },
  { capabilityId: "runtime:core", state: "active" as const },
  { capabilityId: "runtime:deep-observability", state: "active" as const },
  { capabilityId: "runtime:development", state: "disabled" as const },
  { capabilityId: "runtime:durable-automation", state: "active" as const },
  { capabilityId: "runtime:external-ai", state: "active" as const },
  { capabilityId: "runtime:local-speech", state: "active" as const },
];

describe("the existing projection already fails closed", () => {
  // Establishes the premise: detection is not the missing piece. A projection
  // that guessed which authority to believe would hand backup and readiness a
  // topology neither source claims.
  it("throws capability_state_stale rather than guessing which authority wins", () => {
    let thrown: unknown;
    try {
      projectCapabilityServices({
        enabledRuntimeCapabilities: LIVE_ENABLED,
        capabilityStates: LIVE_DB_STATE,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/^capability_state_stale:/);
    expect(isCapabilityStateStaleError(thrown)).toBe(true);
  });

  it("recognises the other stale-identity errors too", () => {
    expect(isCapabilityStateStaleError(new Error("install_capability_state_stale"))).toBe(true);
    expect(isCapabilityStateStaleError(new Error("install_catalog_stale"))).toBe(true);
    expect(isCapabilityStateStaleError(new Error("something else"))).toBe(false);
    expect(isCapabilityStateStaleError(null)).toBe(false);
  });
});

describe("diagnoseCapabilityStateDivergence on the live drift", () => {
  const report = diagnoseCapabilityStateDivergence({
    enabledRuntimeCapabilities: LIVE_ENABLED,
    capabilityStates: LIVE_DB_STATE,
  });

  it("reports drift", () => {
    expect(report.diverged).toBe(true);
  });

  // The projection names only the FIRST mismatch it hits. An operator needs all
  // of them, because repairing one leaves the rest.
  it("names every drifted capability, not just the first", () => {
    const ids = report.divergences.map((entry) => entry.capabilityId).sort();
    expect(ids).toEqual([
      "runtime:browser-automation",
      "runtime:build",
      "runtime:deep-observability",
      "runtime:durable-automation",
      "runtime:external-ai",
      "runtime:local-speech",
    ]);
  });

  it("classifies them as active-in-database but never enabled here", () => {
    for (const entry of report.divergences) {
      expect(entry.kind).toBe("live-active-not-enabled");
      expect(entry.liveState).toBe("active");
      expect(entry.enabledInInstallState).toBe(false);
    }
  });

  // The one that made this matter: capability state read `active` while nothing
  // was collecting, so every metric-backed surface had no source and the state
  // that would have revealed it said everything was fine.
  it("includes deep-observability, the case that hid an absent metrics stack", () => {
    const ids = report.divergences.map((entry) => entry.capabilityId);
    expect(ids).toContain("runtime:deep-observability");
  });

  it("does NOT flag capabilities the two authorities agree on", () => {
    const ids = report.divergences.map((entry) => entry.capabilityId);
    expect(ids).not.toContain("runtime:core");
    expect(ids).not.toContain("runtime:adp-integration");
    expect(ids).not.toContain("runtime:development");
  });

  it("summarises in words an operator can act on", () => {
    expect(report.summary).toContain("drifted from the installation snapshot");
    expect(report.summary).toContain("runtime:deep-observability");
    expect(report.summary).toContain("never enabled them");
  });
});

describe("the other directions", () => {
  it("flags a capability the install enabled but the database calls disabled", () => {
    const report = diagnoseCapabilityStateDivergence({
      enabledRuntimeCapabilities: ["runtime:core", "runtime:build"],
      capabilityStates: LIVE_DB_STATE.map((entry) =>
        entry.capabilityId === "runtime:build"
          ? { ...entry, state: "disabled" as const }
          : entry,
      ),
    });
    const build = report.divergences.find((e) => e.capabilityId === "runtime:build");
    expect(build?.kind).toBe("enabled-not-live-active");
    expect(report.summary).toContain("the database reports them disabled");
  });

  it("flags a capability with no database row at all", () => {
    const report = diagnoseCapabilityStateDivergence({
      enabledRuntimeCapabilities: LIVE_ENABLED,
      capabilityStates: LIVE_DB_STATE.filter(
        (entry) => entry.capabilityId !== "runtime:local-speech",
      ),
    });
    const missing = report.divergences.find(
      (e) => e.capabilityId === "runtime:local-speech",
    );
    expect(missing?.kind).toBe("missing-live-state");
    expect(missing?.liveState).toBeNull();
    expect(report.summary).toContain("no capability record exists");
  });
});

describe("a converged installation", () => {
  const converged = LIVE_DB_STATE.map((entry) => ({
    ...entry,
    state: entry.capabilityId === "runtime:core" ? ("active" as const) : ("disabled" as const),
  }));

  it("reports no drift when both authorities agree", () => {
    const report = diagnoseCapabilityStateDivergence({
      enabledRuntimeCapabilities: ["runtime:core"],
      capabilityStates: converged,
    });
    expect(report.diverged).toBe(false);
    expect(report.divergences).toEqual([]);
    expect(report.summary).toContain("agrees with the installation snapshot");
  });

  it("and the projection then succeeds, proving the fixture is realistic", () => {
    expect(() =>
      projectCapabilityServices({
        enabledRuntimeCapabilities: ["runtime:core"],
        capabilityStates: converged,
      }),
    ).not.toThrow();
  });
});

describe("purity", () => {
  it("is deterministic", () => {
    const once = diagnoseCapabilityStateDivergence({
      enabledRuntimeCapabilities: LIVE_ENABLED,
      capabilityStates: LIVE_DB_STATE,
    });
    const twice = diagnoseCapabilityStateDivergence({
      enabledRuntimeCapabilities: LIVE_ENABLED,
      capabilityStates: LIVE_DB_STATE,
    });
    expect(once).toEqual(twice);
  });

  it("tolerates an unrecognised state value rather than throwing", () => {
    const report = diagnoseCapabilityStateDivergence({
      enabledRuntimeCapabilities: LIVE_ENABLED,
      capabilityStates: [
        ...LIVE_DB_STATE.filter((e) => e.capabilityId !== "runtime:build"),
        { capabilityId: "runtime:build", state: "quarantined" as never },
      ],
    });
    const build = report.divergences.find((e) => e.capabilityId === "runtime:build");
    expect(build?.kind).toBe("missing-live-state");
  });
});

describe("createOperationalCapabilityState surfaces the whole diagnosis", () => {
  // The loader is what runtime-health and backup-readiness call, so this is
  // where an operator's error message comes from.
  it("re-raises the stale error with every drifted capability named", async () => {
    const { createOperationalCapabilityState } = await import("./operational-state");
    let thrown: unknown;
    try {
      createOperationalCapabilityState({
        installSnapshot: {
          enabledRuntimeCapabilities: LIVE_ENABLED,
          capabilityCatalogHash: "f".repeat(64),
          capabilityStateVersion: "e".repeat(64),
        },
        capabilityStates: LIVE_DB_STATE,
        observedServices: {},
        observedProviders: {},
      });
    } catch (error) {
      thrown = error;
    }
    const message = (thrown as Error).message;
    // The original identifier survives, so existing matching still works.
    expect(message).toMatch(/^capability_state_stale:/);
    // ...and the rest of the drift is now in the same message.
    expect(message).toContain("runtime:deep-observability");
    expect(message).toContain("runtime:local-speech");
    expect(message).toContain("never enabled them");
    // Machine-readable, so a surface does not re-derive it from prose.
    const report = (thrown as Error & { divergence?: { divergences: unknown[] } }).divergence;
    expect(report?.divergences).toHaveLength(6);
    expect((thrown as Error).cause).toBeInstanceOf(Error);
  });
});
