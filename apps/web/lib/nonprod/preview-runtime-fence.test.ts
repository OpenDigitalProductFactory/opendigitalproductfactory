import { expect, it, vi } from "vitest";
import type { LeaseRow } from "./environment-lease-result";
import { deterministicNonprodWaitTaskRunId } from "./durable-wait";
import { fenceEndedPreviewRuntimes } from "./preview-runtime-fence";

vi.mock("@dpf/db", () => ({ prisma: {} }));
const now = new Date("2026-11-14T04:40:00Z");
function fixture() {
  const id = "b".repeat(64), sha = "7".repeat(40), leaseId = "NPEL-FIXTURE123";
  const taskRunId = deterministicNonprodWaitTaskRunId("fixture-user", leaseId);
  const lease = {
    id: "row", leaseId, taskRunId, claimKey: "dev-portal:fixture", environmentKey: "local-integration-ci",
    status: "expired", activeKey: null, slotKey: "slot-0", ownerProvider: "codex", ownerSessionId: "fixture-owner",
    worktreePath: "/fixtures/source", branchName: "codex/fixture", buildId: null,
    purpose: `Contributor preview (:3001) bound to /fixtures/source @ codex/fixture (${sha})`,
    url: "http://localhost:3001", ports: [3001], ownerPid: null, ownerProcessIdentity: null,
    resourceClass: null, expectedMemoryBytes: null, slotManifestVersion: null,
    admittedAt: new Date(now.getTime() - 600_000), firstAdmittedAt: new Date(now.getTime() - 600_000),
    admissionHistoryVersion: 1, expiresAt: new Date(now.getTime() - 60_000), releasedAt: new Date(now.getTime() - 50_000),
    cleanupCommand: "never execute this arbitrary stored command",
  } as LeaseRow;
  const wait = {
    schemaVersion: 1, kind: "nonprod-lease-wait", state: "admitted", leaseId,
    claimKey: lease.claimKey, environmentKey: lease.environmentKey, ownerProvider: lease.ownerProvider,
    ownerSessionId: lease.ownerSessionId, worktreePath: lease.worktreePath, branchName: lease.branchName,
    queuePosition: null, waitDeadlineAt: now.toISOString(), lastTransitionAt: lease.admittedAt!.toISOString(),
    eventId: null, eventConsumed: true,
  };
  const task = { taskRunId, userId: "fixture-user", status: "completed", progressPayload: { nonprodLeaseWait: wait } };
  const container = {
    Id: id, Name: "/dpf-dev-portal-1", Config: { Labels: {
      "com.docker.compose.project": "dpf", "com.docker.compose.service": "dev-portal",
      "dpf.preview.lease": leaseId, "dpf.preview.sha": sha,
    }, Env: ["DPF_ENVIRONMENT_CLASS=development", `DPF_PREVIEW_SOURCE_SHA=${sha}`, `DPF_PREVIEW_LEASE_ID=${leaseId}`] },
    State: { Running: true }, Mounts: [{ Type: "bind", Source: "/fixtures/source", Destination: "/workspace" }],
    NetworkSettings: { Ports: { "3000/tcp": [{ HostIp: "127.0.0.1", HostPort: "3001" }] } },
  };
  const get = vi.fn(async (path: string): Promise<unknown> => {
    if (path === "/containers/self/json") return { Config: { Labels: { "com.docker.compose.project": "dpf" } } };
    if (path === "/info") return { OperatingSystem: "Docker Desktop" };
    if (path.startsWith("/containers/json?")) return [{ Id: id }];
    if (path === `/containers/${id}/json`) return structuredClone(container);
    throw new Error("unexpected request");
  });
  const stop = vi.fn(async (_id: string): Promise<void> => { container.State.Running = false; });
  const readLease = vi.fn(async () => structuredClone(lease));
  const readTask = vi.fn(async () => task);
  const readSource = vi.fn(async () => ({ headSha: sha, repositoryFullName: "owner/repo" }));
  const deps = { get, stop, readLease, readTask, readSource, selfHostname: "self", now };
  return { id, sha, lease, wait, task, container, get, stop, readLease, readTask, readSource, deps };
}

it("stops only a fully proven terminal preview by full ID and confirms the outcome", async () => {
  const f = fixture();
  const result = await fenceEndedPreviewRuntimes(f.deps);
  expect(result).toMatchObject({ checked: 1, stopped: 1, pending: 0, held: 0 });
  expect(f.stop).toHaveBeenCalledExactlyOnceWith(f.id);
  expect(f.get.mock.calls.every(([path]) => !path.includes(f.lease.cleanupCommand!))).toBe(true);
});

it.each(["active", "queued", "unknown"])("never stops a %s lease even with an expired clock", async status => {
  const f = fixture(); f.lease.status = status;
  expect((await fenceEndedPreviewRuntimes(f.deps)).held).toBe(1);
  expect(f.stop).not.toHaveBeenCalled();
});

it.each(["released", "cancelled"])("accepts a committed %s terminal decision", async status => {
  const f = fixture(); f.lease.status = status;
  expect((await fenceEndedPreviewRuntimes(f.deps)).stopped).toBe(1);
});

it.each([
  (f: ReturnType<typeof fixture>) => { f.lease.claimKey = "gate:can-revive"; },
  f => { f.lease.activeKey = "local-integration-ci:slot-0"; },
  f => { f.lease.admissionHistoryVersion = 0; },
  f => { f.lease.releasedAt = null; },
  f => { f.lease.ownerPid = 123; },
  f => { f.lease.ownerProcessIdentity = "foreign"; },
  f => { f.lease.buildId = "build"; },
  f => { f.lease.slotManifestVersion = 1; },
  f => { f.lease.purpose = "unproven source"; },
  f => { f.lease.url = "http://other-host:3001"; },
  f => { f.lease.ports = [3000]; },
  f => { f.wait.ownerSessionId = "another-owner"; },
  f => { f.task.status = "running"; },
  f => { f.task.userId = "another-user"; },
  f => { f.readSource.mockResolvedValue({ headSha: "a".repeat(40), repositoryFullName: "owner/repo" }); },
  f => { f.container.Config.Labels["com.docker.compose.service"] = "postgres"; },
  f => { f.container.Config.Labels["com.docker.compose.project"] = "foreign-project"; },
  f => { f.container.Config.Labels["dpf.preview.sha"] = "a".repeat(40); },
  f => { f.container.Config.Env[0] = "DPF_ENVIRONMENT_CLASS=production"; },
  f => { f.container.Mounts[0]!.Source = "/root-checkout"; },
  f => { f.container.NetworkSettings.Ports["3000/tcp"][0]!.HostIp = "0.0.0.0"; },
])("holds an unproven or foreign owner/binding (%#)", async change => {
  const f = fixture(); change(f);
  expect((await fenceEndedPreviewRuntimes(f.deps)).held).toBe(1);
  expect(f.stop).not.toHaveBeenCalled();
});

it("rechecks terminal authority after source and Task proof", async () => {
  const f = fixture();
  f.readLease.mockResolvedValueOnce(structuredClone(f.lease));
  f.lease.status = "active";
  expect((await fenceEndedPreviewRuntimes(f.deps)).outcomes[0]?.reason).toBe("lease-changed");
  expect(f.stop).not.toHaveBeenCalled();
});

it("never retargets a replacement container", async () => {
  const f = fixture(); f.container.Id = "c".repeat(64);
  expect((await fenceEndedPreviewRuntimes(f.deps)).held).toBe(1);
  expect(f.stop).not.toHaveBeenCalled();
});

it("a stop timeout can still be confirmed by exact-ID readback", async () => {
  const f = fixture();
  f.stop.mockImplementation(async () => { f.container.State.Running = false; throw new Error("socket timeout"); });
  expect((await fenceEndedPreviewRuntimes(f.deps)).stopped).toBe(1);
});

it("a stop timeout with a still-running preview remains pending", async () => {
  const f = fixture(); f.stop.mockRejectedValue(new Error("private engine error"));
  const result = await fenceEndedPreviewRuntimes(f.deps);
  expect(result).toMatchObject({ pending: 1, stopped: 0 });
  expect(JSON.stringify(result)).not.toContain("private");
});

it("an identity change after stop cannot be acknowledged as cleanup", async () => {
  const f = fixture();
  f.stop.mockImplementation(async () => { f.container.State.Running = false; f.container.Id = "c".repeat(64); });
  expect((await fenceEndedPreviewRuntimes(f.deps)).pending).toBe(1);
});

it("concurrent native fencers remain bound to the original ID", async () => {
  const f = fixture(); const results = await Promise.all([fenceEndedPreviewRuntimes(f.deps), fenceEndedPreviewRuntimes(f.deps)]);
  expect(results.every(result => result.stopped === 1)).toBe(true);
  expect(f.stop.mock.calls.every(args => args[0] === f.id)).toBe(true);
});

it("accepts a proven owned initializer without any published port", async () => {
  const f = fixture(); f.container.Config.Labels["com.docker.compose.service"] = "dev-init";
  f.container.Name = `/dpf-preview-init-${"a".repeat(24)}`;
  f.container.NetworkSettings.Ports = {} as typeof f.container.NetworkSettings.Ports;
  expect((await fenceEndedPreviewRuntimes(f.deps)).stopped).toBe(1);
});

it("allows Docker Desktop mount spelling only with actual daemon metadata", async () => {
  const f = fixture(); f.container.Mounts[0]!.Source = "/host_mnt/fixtures/source";
  expect((await fenceEndedPreviewRuntimes(f.deps)).stopped).toBe(1);
  const g = fixture(); g.container.Mounts[0]!.Source = "/host_mnt/fixtures/source";
  const original = g.get.getMockImplementation()!;
  g.get.mockImplementation(path => path === "/info" ? Promise.resolve({ OperatingSystem: "Linux" }) : original(path));
  expect((await fenceEndedPreviewRuntimes(g.deps)).held).toBe(1);
  expect(g.stop).not.toHaveBeenCalled();
});

it("bounds each pass and reports omitted candidates", async () => {
  const f = fixture(), original = f.get.getMockImplementation()!;
  f.get.mockImplementation(path => path.startsWith("/containers/json?")
    ? Promise.resolve(Array.from({ length: 1000 }, (_, index) => ({ Id: index.toString(16).padStart(64, '0') }))) : original(path));
  expect(await fenceEndedPreviewRuntimes(f.deps)).toMatchObject({ checked: 4, truncated: true });
  expect(f.stop.mock.calls.length).toBeLessThanOrEqual(4);
});

it("daemon or proof-reader failure remains pending without stopping anything", async () => {
  const f = fixture(); f.get.mockRejectedValue(new Error("private daemon details"));
  const result = await fenceEndedPreviewRuntimes(f.deps);
  expect(result).toMatchObject({ pending: 1, stopped: 0 });
  expect(JSON.stringify(result)).not.toContain("private");
  const g = fixture(); g.readSource.mockRejectedValue(new Error("private DB details"));
  expect((await fenceEndedPreviewRuntimes(g.deps)).pending).toBe(1);
  expect(g.stop).not.toHaveBeenCalled();
});

it('the admitted active-candidate owner proof remains required at terminal cleanup', async () => {
  const f = fixture(); f.lease.environmentKey = 'active-candidate'; f.wait.environmentKey = 'active-candidate';
  f.lease.cleanupCommand = null;
  Object.assign(f.task, { initiatingAgentId: 'fixture-agent' });
  Object.assign(f.task.progressPayload, { nonprodPreviewOwner: {
    schemaVersion: 1, userId: f.task.userId, agentId: 'fixture-agent',
    binding: Object.fromEntries(['leaseId','claimKey','environmentKey','ownerProvider','ownerSessionId',
      'worktreePath','branchName','buildId','url','ports'].map(key => [key, f.lease[key as keyof LeaseRow]])),
  } });
  expect((await fenceEndedPreviewRuntimes(f.deps)).stopped).toBe(1);
  f.container.State.Running = true;
  Object.assign(f.task, { initiatingAgentId: 'another-agent' });
  expect((await fenceEndedPreviewRuntimes(f.deps)).held).toBe(1);
  expect(f.stop).toHaveBeenCalledTimes(1);
});

it('absence of the exact previously proven container confirms cleanup without selecting a replacement', async () => {
  const f = fixture(); const original = f.get.getMockImplementation()!;
  f.get.mockImplementation(path => f.stop.mock.calls.length && path === `/containers/${f.id}/json`
    ? Promise.reject(new Error('docker_engine_http_404')) : original(path));
  expect((await fenceEndedPreviewRuntimes(f.deps)).outcomes[0]?.state).toBe('absent');
  expect(f.stop).toHaveBeenCalledExactlyOnceWith(f.id);
});

it('unavailable readback preserves pending even after a successful stop request', async () => {
  const f = fixture(); const original = f.get.getMockImplementation()!;
  f.get.mockImplementation(path => f.stop.mock.calls.length && path === `/containers/${f.id}/json`
    ? Promise.reject(new Error('docker_engine_timeout')) : original(path));
  expect((await fenceEndedPreviewRuntimes(f.deps)).pending).toBe(1);
});

it('bounded periodic passes eventually inspect an expired preview behind four held containers', async () => {
  const f = fixture(); const original = f.get.getMockImplementation()!;
  const heldIds = ['1', '2', '3', '4'].map(value => value.repeat(64));
  f.get.mockImplementation(path => {
    if (path.startsWith('/containers/json?')) return Promise.resolve([...heldIds, f.id].map(Id => ({ Id })));
    const held = heldIds.find(id => path === `/containers/${id}/json`);
    if (held) return Promise.resolve({ Id: held, Config: { Labels: {
      'com.docker.compose.project': 'dpf', 'com.docker.compose.service': 'dev-portal',
    } }, State: { Running: true } });
    return original(path);
  });
  const first = await fenceEndedPreviewRuntimes(f.deps);
  expect(first).toMatchObject({ checked: 4, held: 4, stopped: 0, truncated: true });
  const next = await fenceEndedPreviewRuntimes({ ...f.deps, now: new Date(now.getTime() + 300_000) });
  expect(next.checked).toBeLessThanOrEqual(4);
  expect(next.stopped).toBe(1);
  expect(f.stop).toHaveBeenCalledExactlyOnceWith(f.id);
});

it('existing :03/:08/:13 cadence covers a partial last window despite repeated capacity events', async () => {
  const f = fixture(); const original = f.get.getMockImplementation()!;
  const ids = Array.from({ length: 10 }, (_, index) => index.toString(16).padStart(64, '0'));
  f.get.mockImplementation(path => path.startsWith('/containers/json?')
    ? Promise.resolve([...ids].reverse().concat(ids[0]!).map(Id => ({ Id }))) : original(path));
  const covered = new Set<string>();
  for (const minute of [3, 8, 13]) {
    const at = new Date(`2026-11-14T04:${String(minute).padStart(2, '0')}:00Z`);
    const pass = await fenceEndedPreviewRuntimes({ ...f.deps, now: at });
    expect(pass.checked).toBeLessThanOrEqual(4);
    const selected = pass.outcomes.map(outcome => outcome.containerId);
    selected.forEach(id => covered.add(id));
    for (let event = 0; event < 3; event += 1) {
      const repeated = await fenceEndedPreviewRuntimes({ ...f.deps, now: at });
      expect(repeated.outcomes.map(outcome => outcome.containerId)).toEqual(selected);
    }
  }
  expect([...covered].sort()).toEqual(ids.sort());
  expect(f.stop).not.toHaveBeenCalled();
});

it('changing inventory and disappeared IDs never retarget held containers', async () => {
  const f = fixture(); const original = f.get.getMockImplementation()!;
  let listed = [f.id];
  f.get.mockImplementation(path => path.startsWith('/containers/json?')
    ? Promise.resolve(listed.map(Id => ({ Id }))) : original(path));
  expect((await fenceEndedPreviewRuntimes(f.deps)).stopped).toBe(1);
  listed = Array.from({ length: 6 }, (_, index) => index.toString(16).padStart(64, '0'));
  await fenceEndedPreviewRuntimes({ ...f.deps, now: new Date(now.getTime() + 300_000) });
  listed = [...listed, f.id];
  await fenceEndedPreviewRuntimes({ ...f.deps, now: new Date(now.getTime() + 600_000) });
  expect(f.stop).toHaveBeenCalledExactlyOnceWith(f.id);
});
