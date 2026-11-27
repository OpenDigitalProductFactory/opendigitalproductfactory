import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { dispatchProtectedExecution, type ProtectedDispatchDeps, type ProtectedLaunchPort } from "./protected-execution-dispatch.server";
import type { ProtectedExecutionBinding } from "./protected-execution-binding";
import type { ConnectProtectedReceiver } from "./protected-execution-transport.server";

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: vi.fn() }));
vi.mock("@/lib/work-capsules/activity-events", () => ({ publishRecordedWorkCapsuleActivity: vi.fn() }));

const binding: ProtectedExecutionBinding = { installationRef: "install-a", registrationRef: "registration-a", hostRef: "host-a", receiverRef: "receiver-a",
  roomRef: "WC-1", sessionRef: "session-a", stageAttemptRef: "stage-a", originRef: "origin-a", qualificationRef: "qual-a", qualificationEpoch: 4,
  routes: [{ kind: "loopback", endpointRef: "local-a" }, { kind: "https", endpointRef: "https-a" }],
  worktree: { worktreeRef: "worktree-a", repositoryFullName: "org/repo", sourceCommit: "a".repeat(40), sourceTree: "b".repeat(40) } };
const projection = new TextEncoder().encode('{"unchanged":  [1, 2]}'); // opaque fixture bytes, not an S5 codec
const input = { binding, signal: new AbortController().signal };

function fixture() {
  let reserved = false;
  const launch = vi.fn<ProtectedLaunchPort["launch"]>(async ({ key }) => ({ kind: "accepted", key }));
  const connect = vi.fn<ConnectProtectedReceiver<ProtectedLaunchPort>>(async endpoint => ({ kind: "authenticated", channel: { ...endpoint, port: { launch } } }));
  const readAuthority = vi.fn<ProtectedDispatchDeps["readAuthority"]>(async ({ binding: admitted }) => ({ binding: admitted, projection }));
  const reserveOnce = vi.fn<ProtectedDispatchDeps["reserveOnce"]>(async () => {
    if (reserved) return "readback-only";
    reserved = true;
    return "reserved";
  });
  const deps: ProtectedDispatchDeps = { transport: { connect, resolveEndpoint: async (b, route) => ({
    ...route, registrationRef: b.registrationRef, installationRef: b.installationRef, hostRef: b.hostRef, receiverRef: b.receiverRef,
    url: route.kind === "loopback" ? "https://127.0.0.1:4005" : "https://control.internal.test",
    network: route.kind === "https" ? "direct-https" : route.kind, audienceRef: `protected:${route.endpointRef}`,
  }) }, readAuthority, reserveOnce };
  return { launch, connect, readAuthority, reserveOnce, deps };
}

describe("protected launch dispatch", () => {
  it("requires independent admission before transport and preserves exact admitted projection bytes", async () => {
    const f = fixture();
    f.readAuthority.mockResolvedValueOnce(null).mockResolvedValueOnce({ binding: { ...binding, qualificationEpoch: 5 }, projection });
    await expect(dispatchProtectedExecution(input, f.deps)).resolves.toMatchObject({ outcome: "held", reason: "authority-unverifiable" });
    await expect(dispatchProtectedExecution(input, f.deps)).resolves.toMatchObject({ outcome: "held", reason: "authority-unverifiable" });
    expect(f.connect).not.toHaveBeenCalled();
    await expect(dispatchProtectedExecution(input, f.deps)).resolves.toEqual({ outcome: "accepted" });
    expect(f.reserveOnce).toHaveBeenCalledWith(expect.objectContaining({ projectionDigest: createHash("sha256").update(projection).digest("hex") }));
    expect(f.reserveOnce.mock.invocationCallOrder[0]!).toBeLessThan(f.launch.mock.invocationCallOrder[0]!);
    expect(f.launch).toHaveBeenCalledWith({ key: { installationRef: "install-a", hostRef: "host-a", sessionRef: "session-a", stageAttemptRef: "stage-a", originRef: "origin-a" }, projection, signal: input.signal });
  });

  it("a lost launch response and a retried effect never send launch again, even using another transport", async () => {
    const f = fixture();
    f.launch.mockRejectedValueOnce(new Error("lost after send"));
    await expect(dispatchProtectedExecution(input, f.deps)).resolves.toEqual({ outcome: "readback-only" });
    expect(f.connect).toHaveBeenCalledTimes(1);
    f.connect.mockResolvedValueOnce({ kind: "unreachable-before-send" });
    await expect(dispatchProtectedExecution(input, f.deps)).resolves.toEqual({ outcome: "readback-only" });
    expect(f.launch).toHaveBeenCalledTimes(1);
  });

  it("a mismatched or ambiguous receiver reply is readback-only, never a reported outcome", async () => {
    const f = fixture();
    f.launch.mockImplementationOnce(async ({ key }) => ({ kind: "refused", key: { ...key, stageAttemptRef: "another-attempt" } }));
    await expect(dispatchProtectedExecution(input, f.deps)).resolves.toEqual({ outcome: "readback-only" });
    expect(f.launch).toHaveBeenCalledTimes(1);
  });

  it("holds when the live authority changes at reservation or the worker budget expires", async () => {
    const f = fixture();
    f.reserveOnce.mockResolvedValueOnce("held");
    await expect(dispatchProtectedExecution(input, f.deps)).resolves.toMatchObject({ outcome: "held", reason: "authority-unverifiable" });
    const timeout = new AbortController();
    f.reserveOnce.mockImplementationOnce(async () => { timeout.abort(); return "reserved"; });
    await expect(dispatchProtectedExecution({ ...input, signal: timeout.signal }, f.deps)).resolves.toEqual({ outcome: "readback-only" });
    expect(f.launch).not.toHaveBeenCalled();
  });
});
