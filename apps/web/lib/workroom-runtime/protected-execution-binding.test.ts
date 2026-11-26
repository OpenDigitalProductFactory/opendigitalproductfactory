import { describe, expect, it } from "vitest";

import { decideProtectedExecutionBinding, readProtectedExecutionBindings } from "./protected-execution-binding";

const installationRef = "install-local";
const host = { registrationRef: "registration-a", installationRef, hostRef: "host-a", receiverRef: "receiver-a" };
const worktree = { worktreeRef: "worktree-a", repositoryFullName: "org/repo", sourceCommit: "a".repeat(40), sourceTree: "b".repeat(40) };
const target = { installationRef, roomRef: "WC-1", sessionRef: "session-a", stageAttemptRef: "stage-1", originRef: "origin-a", worktree };
const routes = [{ kind: "loopback" as const, endpointRef: "local-a" }, { kind: "https" as const, endpointRef: "edge-a" }];
const now = new Date("2026-11-25T11:00:00Z");
const qualification = { ...host, qualificationRef: "qualification-a", revision: 4, status: "active" as const,
  worktreeRef: worktree.worktreeRef, expiresAt: now.getTime() + 60_000, allowedRoutes: [routes[1]!] };

function decide(overrides: Partial<Parameters<typeof decideProtectedExecutionBinding>[0]> = {}) {
  return decideProtectedExecutionBinding({ localInstallationRef: installationRef, target, now, workspaceState: {},
    owners: [{ host, worktree }], candidate: { ...host, routes }, qualification, ...overrides });
}

describe("protected execution binding", () => {
  it("pins the qualified exact owner and narrows candidate routes without copying credentials or paths", () => {
    expect(decide()).toMatchObject({ ok: true, created: true, binding: { ...target, ...host,
      qualificationRef: "qualification-a", qualificationEpoch: 4, routes: [routes[1]] } });
  });

  it("holds ambiguous ownership even when only one host is qualified", () => {
    expect(decide({ owners: [{ host, worktree }, { host: { ...host, hostRef: "host-b" }, worktree }] })).toMatchObject({ ok: false, reason: "ambiguous-owner" });
    expect(decide({ owners: [{ host, worktree: { ...worktree, sourceTree: "c".repeat(40) } }] })).toMatchObject({ ok: false });
    expect(decide({ owners: [{ host: { ...host, installationRef: "paired-dev" }, worktree }] })).toMatchObject({ ok: false });
  });

  it("never turns observation into authority or allows stale or revoked proof", () => {
    expect(decide({ qualification: null })).toMatchObject({ ok: false, reason: "unqualified-host" });
    expect(decide({ qualification: { ...qualification, expiresAt: now.getTime() } })).toMatchObject({ ok: false, reason: "unqualified-host" });
    expect(decide({ qualification: { ...qualification, status: "revoked" } })).toMatchObject({ ok: false, reason: "unqualified-host" });
    expect(decide({ qualification: { ...qualification, allowedRoutes: [{ kind: "https", endpointRef: "new-edge" }] } })).toMatchObject({ ok: false, reason: "no-qualified-route" });
  });

  it("a rotated receiver or replacement registration cannot inherit the old proof", () => {
    const rotated = { ...host, registrationRef: "registration-b", receiverRef: "receiver-b" };
    expect(decide({ owners: [{ host: rotated, worktree }], candidate: { ...rotated, routes } })).toMatchObject({ ok: false, reason: "unqualified-host" });
  });

  it("replays one pin exactly, refuses changed origin or epoch, and does not edit local supervision", () => {
    const first = decide();
    if (!first.ok) throw new Error("fixture never bound");
    const localSession = { status: "supervised", hostId: "portal" };
    const workspaceState = { runtimeSession: localSession, protectedExecution: first.record };
    expect(decide({ workspaceState })).toMatchObject({ ok: true, created: false, binding: first.binding });
    expect(decide({ workspaceState, target: { ...target, originRef: "different-origin" } })).toMatchObject({ ok: false, reason: "binding-conflict" });
    expect(decide({ workspaceState, qualification: { ...qualification, revision: 5 } })).toMatchObject({ ok: false, reason: "binding-conflict" });
    expect(workspaceState.runtimeSession).toBe(localSession);
    expect(readProtectedExecutionBindings(workspaceState)).toEqual(first.record);
    expect(readProtectedExecutionBindings({ protectedExecution: { version: 100 } })).toBeNull();
  });
});
