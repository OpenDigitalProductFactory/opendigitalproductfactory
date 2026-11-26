import { describe, expect, it, vi } from "vitest";

import type { ProtectedExecutionBinding } from "./protected-execution-binding";
import { selectProtectedRoute, type ConnectProtectedReceiver, type ProtectedEndpoint } from "./protected-execution-transport.server";

const routes = [{ kind: "https" as const, endpointRef: "https-a" }, { kind: "loopback" as const, endpointRef: "local-a" },
  { kind: "tailnet" as const, endpointRef: "tail-a" }];
const binding: ProtectedExecutionBinding = { installationRef: "install-a", registrationRef: "registration-a", hostRef: "host-a", receiverRef: "receiver-a",
  roomRef: "WC-1", sessionRef: "session-a", stageAttemptRef: "stage-a", originRef: "origin-a", qualificationRef: "qual-a", qualificationEpoch: 4, routes,
  worktree: { worktreeRef: "worktree-a", repositoryFullName: "org/repo", sourceCommit: "a".repeat(40), sourceTree: "b".repeat(40) } };
const host = { installationRef: binding.installationRef, registrationRef: binding.registrationRef, hostRef: binding.hostRef, receiverRef: binding.receiverRef };
const resolveEndpoint = async (_binding: ProtectedExecutionBinding, route: typeof routes[number]): Promise<ProtectedEndpoint> => ({
  ...host, ...route, audienceRef: `protected:${route.endpointRef}`,
  network: route.kind === "https" ? "direct-https" : route.kind,
  url: route.kind === "loopback" ? "https://127.0.0.1:4005" : `https://${route.kind}.internal.test`,
});
const authenticate: ConnectProtectedReceiver<string> = async endpoint => ({ kind: "authenticated", channel: { ...endpoint, port: "port" } });

describe("pinned protected route selection", () => {
  it("uses loopback, tailnet, then HTTPS on the pinned receiver, only after positive pre-send unreachability", async () => {
    const connect = vi.fn<ConnectProtectedReceiver<string>>()
      .mockResolvedValueOnce({ kind: "unreachable-before-send" }).mockResolvedValueOnce({ kind: "unreachable-before-send" })
      .mockImplementation(authenticate);
    await expect(selectProtectedRoute(binding, { resolveEndpoint, connect })).resolves.toMatchObject({ kind: "selected", channel: { endpointRef: "https-a" } });
    expect(connect.mock.calls.map(([e]) => [e.kind, e.hostRef, e.receiverRef])).toEqual([
      ["loopback", "host-a", "receiver-a"], ["tailnet", "host-a", "receiver-a"], ["https", "host-a", "receiver-a"],
    ]);
  });

  it("makes refusal or an unverifiable transport result a hold, not a downgrade", async () => {
    const connect = vi.fn<ConnectProtectedReceiver<string>>().mockResolvedValueOnce({ kind: "refused" });
    await expect(selectProtectedRoute(binding, { resolveEndpoint, connect })).resolves.toEqual({ kind: "held", reason: "receiver-refused" });
    expect(connect).toHaveBeenCalledTimes(1);
    connect.mockReset().mockRejectedValueOnce(new Error("socket classification missing"));
    await expect(selectProtectedRoute(binding, { resolveEndpoint, connect })).resolves.toEqual({ kind: "held", reason: "transport-unverifiable" });
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("refuses a different registration, invalid loopback, or unapproved topology before ever connecting", async () => {
    const connect = vi.fn(authenticate);
    for (const override of [{ hostRef: "host-b" }, { registrationRef: "other-registration" }, { url: "https://0.0.0.0:4050" },
      { url: "http://127.0.0.1:4050" }, { network: "direct-https" as const }]) {
      await expect(selectProtectedRoute(binding, { connect, resolveEndpoint: async (b, route) => ({ ...await resolveEndpoint(b, route), ...override }) }))
        .resolves.toEqual({ kind: "held", reason: "endpoint-mismatch" });
    }
    expect(connect).not.toHaveBeenCalled();
  });

  it("rejects a channel that authenticates the wrong receiver, endpoint, or audience without trying another", async () => {
    for (const override of [{ receiverRef: "receiver-b" }, { endpointRef: "wrong-resource" }, { audienceRef: "workroom-room-token" }]) {
      const connect = vi.fn<ConnectProtectedReceiver<string>>(async endpoint => ({ kind: "authenticated", channel: { ...endpoint, ...override, port: "port" } }));
      await expect(selectProtectedRoute(binding, { resolveEndpoint, connect })).resolves.toEqual({ kind: "held", reason: "channel-mismatch" });
      expect(connect).toHaveBeenCalledTimes(1);
    }
  });
});
