import { describe, expect, it } from "vitest";

import { decideExecutionHostRegistration, readExecutionHostObservation } from "./execution-host-registry";

const local = { installationRef: "install-local", hostRef: "host-a", receiverRef: "receiver-a" };
const routes = [{ kind: "https", endpointRef: "edge-a" }, { kind: "loopback", endpointRef: "local-a" }];
const observedAt = new Date("2026-11-25T11:00:00Z");

function decide(overrides: Partial<Parameters<typeof decideExecutionHostRegistration>[0]> = {}) {
  return decideExecutionHostRegistration({
    localInstallationRef: local.installationRef,
    authenticated: { ...local, source: "local-host-agent" },
    report: { hostRef: local.hostRef, receiverRef: local.receiverRef, routes },
    existing: null,
    observedAt,
    ...overrides,
  });
}

describe("execution-host candidate registration", () => {
  it("records an authenticated candidate without qualification and normalizes observation order", () => {
    expect(decide()).toEqual({ ok: true, data: { action: "register", identity: local, observedAt, routes: [routes[1], routes[0]] } });
  });

  it("does not register a peer install even when it asserts the local host ref", () => {
    expect(decide({ authenticated: { ...local, source: "paired-install" } })).toEqual({ ok: false, error: "not-local-host-agent" });
    expect(decide({ authenticated: { ...local, installationRef: "paired-dev", source: "local-host-agent" } })).toEqual({ ok: false, error: "not-local-host-agent" });
  });

  it("never changes the bound receiver on an existing registration", () => {
    const rotated = { ...local, receiverRef: "receiver-new" };
    expect(decide({ authenticated: { ...rotated, source: "local-host-agent" },
      report: { hostRef: rotated.hostRef, receiverRef: rotated.receiverRef, routes }, existing: local })).toEqual({ ok: false, error: "receiver-changed" });
    expect(decide({ existing: local })).toMatchObject({ ok: true, data: { action: "observe" } });
  });

  it("requires bounded exact route refs and rejects qualification assertions in observations", () => {
    expect(readExecutionHostObservation([{ kind: "https", endpointRef: "https://untrusted.example" }])).toBeNull();
    expect(readExecutionHostObservation([...routes, routes[0]])).toBeNull();
    expect(decide({ report: { ...local, routes, qualified: true, epoch: 9 } })).toEqual({ ok: false, error: "invalid-report" });
    expect(decide({ report: { hostRef: "other-host", receiverRef: local.receiverRef, routes } })).toEqual({ ok: false, error: "identity-mismatch" });
  });
});
