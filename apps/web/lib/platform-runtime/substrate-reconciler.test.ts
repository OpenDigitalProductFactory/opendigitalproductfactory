import { describe, expect, it, vi } from "vitest";

import { err, ok } from "@/lib/shared/action-result";

import {
  DOCKER_VM_WEDGED_ISSUE_KEY,
  parseEtimeSeconds,
  reconcileSubstrate,
  substrateRestartIssueKey,
  type SubstrateContainer,
  type SubstrateDeps,
} from "./substrate-reconciler";
import { LOCAL_CI_POOL_STALLED_ISSUE_KEY } from "@/lib/nonprod/local-ci-pool-liveness";

const NOW = new Date("2026-09-26T14:00:00.000Z");

function container(over: Partial<SubstrateContainer>): SubstrateContainer {
  return {
    id: "c-portal",
    name: "dpf-portal-1",
    service: "portal",
    state: "running",
    restartPolicy: "unless-stopped",
    inProject: true,
    ...over,
  };
}

function deps(over: Partial<SubstrateDeps> = {}): SubstrateDeps & {
  opened: Array<{ issueKey: string; severity: string; summary: string; details: unknown }>;
  resolved: string[];
  started: string[];
} {
  const opened: Array<{ issueKey: string; severity: string; summary: string; details: unknown }> = [];
  const resolved: string[] = [];
  const started: string[] = [];
  return {
    opened,
    resolved,
    started,
    listContainers: async () => [container({})],
    requiredServices: async () => new Set(["portal", "sandbox"]),
    startContainer: async (c) => { started.push(c.name); return ok(); },
    topProcesses: async () => [],
    openIssue: async (issue) => { opened.push(issue); },
    resolveIssue: async (key) => { resolved.push(key); },
    now: () => NOW,
    ...over,
  };
}

describe("parseEtimeSeconds", () => {
  it.each([
    ["05:07", 307],
    ["01:02:03", 3723],
    ["2-01:00:00", 2 * 86400 + 3600],
    ["bogus", null],
  ])("%s -> %s", (text, seconds) => {
    expect(parseEtimeSeconds(text)).toBe(seconds);
  });
});

describe("reconcileSubstrate: stopped required services", () => {
  it("restarts a required service that was stopped despite its restart policy, and tells the operator", async () => {
    const d = deps({
      listContainers: async () => [
        container({}),
        container({ id: "c-sandbox", name: "dpf-sandbox-1", service: "sandbox", state: "exited" }),
      ],
    });
    const result = await reconcileSubstrate(d);
    expect(d.started).toEqual(["dpf-sandbox-1"]);
    expect(result.restarted).toEqual(["sandbox"]);
    expect(d.opened).toEqual([expect.objectContaining({
      issueKey: substrateRestartIssueKey("sandbox"),
      severity: "warn",
      summary: expect.stringMatching(/sandbox.*stopped.*restarted/i),
    })]);
  });

  it("never touches a one-shot container, an optional service, or a service with no restart policy", async () => {
    const d = deps({
      listContainers: async () => [
        container({ id: "c-init", name: "dpf-portal-init-1", service: "portal-init", state: "exited", restartPolicy: "no" }),
        container({ id: "c-dev", name: "dpf-dev-portal-1", service: "dev-portal", state: "exited" }),
        container({ id: "c-sbx", name: "dpf-sandbox-1", service: "sandbox", state: "exited", restartPolicy: "no" }),
      ],
    });
    await reconcileSubstrate(d);
    expect(d.started).toEqual([]);
  });

  it("does not restart anything when the required set cannot be read (fails closed)", async () => {
    const d = deps({
      requiredServices: async () => null,
      listContainers: async () => [container({ id: "c-sandbox", name: "dpf-sandbox-1", service: "sandbox", state: "exited" })],
    });
    const result = await reconcileSubstrate(d);
    expect(d.started).toEqual([]);
    expect(result.restartSkippedReason).toMatch(/required services/i);
  });

  it("raises an error-severity issue when the restart itself fails", async () => {
    const d = deps({
      listContainers: async () => [container({ id: "c-sandbox", name: "dpf-sandbox-1", service: "sandbox", state: "exited" })],
      startContainer: async () => err("no such container"),
    });
    await reconcileSubstrate(d);
    expect(d.opened).toEqual([expect.objectContaining({
      issueKey: substrateRestartIssueKey("sandbox"),
      severity: "error",
      summary: expect.stringMatching(/could not restart/i),
    })]);
  });

  it("resolves the restart issue once the service is running again", async () => {
    const d = deps({
      listContainers: async () => [container({ id: "c-sandbox", name: "dpf-sandbox-1", service: "sandbox", state: "running" })],
    });
    await reconcileSubstrate(d);
    expect(d.resolved).toContain(substrateRestartIssueKey("sandbox"));
  });
});

describe("reconcileSubstrate: wedged Docker VM", () => {
  const stuckRow = { pid: "2152", stat: "D", etime: "33:02:10", wchan: "reques", comm: "sync" };

  it("raises one condition naming the stuck processes and the restart impact", async () => {
    const d = deps({
      listContainers: async () => [
        container({}),
        container({ id: "c-alpine", name: "happy_agnesi", service: null, inProject: false, restartPolicy: "no" }),
      ],
      topProcesses: async (c) => (c.id === "c-alpine" ? [stuckRow] : [{ pid: "1", stat: "Ssl", etime: "02:00:00", wchan: "do_epo", comm: "next-server" }]),
    });
    const result = await reconcileSubstrate(d);
    expect(result.wedged).toBe(1);
    const issue = d.opened.find((i) => i.issueKey === DOCKER_VM_WEDGED_ISSUE_KEY);
    expect(issue).toMatchObject({ severity: "error" });
    expect(issue?.summary).toMatch(/1 process/);
    expect(issue?.summary).toMatch(/VM restart/i);
    expect(issue?.details).toMatchObject({
      source: "substrate-reconciler",
      stuck: [expect.objectContaining({ container: "happy_agnesi", comm: "sync", stat: "D" })],
    });
  });

  it("ignores short D-state waits (ordinary disk I/O) and resolves the condition when clear", async () => {
    const d = deps({
      topProcesses: async () => [{ pid: "9", stat: "D", etime: "00:04", wchan: "io_sch", comm: "postgres" }],
    });
    const result = await reconcileSubstrate(d);
    expect(result.wedged).toBe(0);
    expect(d.resolved).toContain(DOCKER_VM_WEDGED_ISSUE_KEY);
  });

  it("a container whose top cannot be read is skipped, not treated as healthy or wedged", async () => {
    const d = deps({ topProcesses: vi.fn().mockRejectedValue(new Error("container is not running")) });
    const result = await reconcileSubstrate(d);
    expect(result.wedged).toBe(0);
    expect(result.topUnreadable).toBe(1);
  });
});

describe("reconcileSubstrate: evidence for who stops a required service (BI-547B788D)", () => {
  it("records when the stopped container exited and with what code, so the stopper can be correlated", async () => {
    const d = deps({
      listContainers: async () => [container({
        id: "c-sandbox", name: "dpf-sandbox-1", service: "sandbox", state: "exited",
        stoppedAt: "2026-09-26T07:12:01.000Z", exitCode: 137,
      })],
    });
    await reconcileSubstrate(d);
    expect(d.opened[0]?.details).toMatchObject({ stoppedAt: "2026-09-26T07:12:01.000Z", exitCode: 137 });
    expect(d.opened[0]?.summary).toMatch(/exited 137 at 2026-09-26T07:12:01/);
  });
});

describe("reconcileSubstrate: local-CI pool liveness (BI-277ECBDB C)", () => {
  const stalled = (n: number) => ({
    leaseId: `NPEL-${n}`,
    admittedAt: new Date(NOW.getTime() - n * 10 * 60_000),
    releasedAt: new Date(NOW.getTime() - n * 10 * 60_000 + 60_000),
    evidenceRecordId: null,
    status: "released",
  });

  it("raises one condition when admissions keep ending without a result", async () => {
    const d = deps({ localCiLeases: async () => [1, 2, 3, 4].map(stalled) });
    const result = await reconcileSubstrate(d);
    expect(result.localCiPoolDegraded).toBe(true);
    expect(d.opened).toEqual([expect.objectContaining({
      issueKey: LOCAL_CI_POOL_STALLED_ISSUE_KEY,
      severity: "error",
      summary: expect.stringMatching(/4 local-CI admissions/),
    })]);
  });

  it("resolves the condition once a run records a result", async () => {
    const d = deps({ localCiLeases: async () => [...[1, 2, 3].map(stalled), { ...stalled(4), evidenceRecordId: "ev-1" }] });
    await reconcileSubstrate(d);
    expect(d.resolved).toContain(LOCAL_CI_POOL_STALLED_ISSUE_KEY);
  });

  it("an unreadable lease table neither raises nor clears the condition", async () => {
    const d = deps({ localCiLeases: async () => { throw new Error("db down"); } });
    const result = await reconcileSubstrate(d);
    expect(result.localCiPoolDegraded).toBeNull();
    expect(d.resolved).not.toContain(LOCAL_CI_POOL_STALLED_ISSUE_KEY);
  });
});
