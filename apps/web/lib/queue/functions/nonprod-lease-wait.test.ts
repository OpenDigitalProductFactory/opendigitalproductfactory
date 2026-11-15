import { beforeEach, expect, it, vi } from "vitest";
import { deterministicNonprodWaitTaskRunId } from "@/lib/nonprod/durable-wait";

const f = vi.hoisted(() => ({
  id: "b".repeat(64), sha: "7".repeat(40), stopped: false,
  lease: {} as Record<string, unknown>, task: {} as Record<string, unknown>,
  stop: vi.fn(), gate: true, reaped: false,
}));

vi.mock("@dpf/db", () => ({ prisma: {
  nonProductionEnvironmentLease: {
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(async () => f.lease),
  },
  taskRun: { findUnique: vi.fn(async () => f.task) },
  runtimeTarget: { updateMany: vi.fn(async () => ({ count: 0 })) },
  workroom: { findFirst: vi.fn(async () => ({
    headSha: f.sha, headBranch: "codex/fixture", worktreePath: "/fixtures/source",
    executorRef: "fixture-owner", leaseHolderPrincipalId: "fixture-principal",
    repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  })) },
} }));
vi.mock("@/lib/jobs", () => ({ jobs: {
  createFunction: (config: unknown, handler: unknown) => ({ config, handler }),
} }));
vi.mock("@/lib/jobs/triggers", () => ({ cron: (value: string) => value }));
vi.mock("../quiescence-gates", () => ({ gateAtEntry: async () => ({ proceed: f.gate, reason: "fixture-quiescence" }) }));
vi.mock("@/lib/nonprod/environment-lease", () => ({
  reapExpiredNonprodEnvironmentLeases: vi.fn(async () => { f.reaped = true; return { reaped: 1 }; }),
}));
vi.mock("@/lib/platform-runtime/docker-socket.mjs", () => ({
  dockerSocketGet: vi.fn(async (path: string) => {
    const labels = {
      "com.docker.compose.project": "dpf",
      "com.docker.compose.service": "dev-portal",
      "dpf.preview.lease": "NPEL-FIXTURE123",
      "dpf.preview.sha": f.sha,
    };
    if (path === "/info") return { OperatingSystem: "Docker Desktop" };
    if (path.startsWith("/containers/json")) return [{
      Id: f.id, Names: ["/dpf-dev-portal-1"], State: "running", Labels: labels,
    }];
    if (path === `/containers/${f.id}/json`) return {
      Id: f.id, Config: { Labels: labels, Env: [
        "DPF_ENVIRONMENT_CLASS=development", `DPF_PREVIEW_SOURCE_SHA=${f.sha}`,
        "DPF_PREVIEW_LEASE_ID=NPEL-FIXTURE123",
      ] },
      State: { Running: !f.stopped },
      Mounts: [{ Type: "bind", Source: "/fixtures/source", Destination: "/workspace" }],
      NetworkSettings: { Ports: { "3000/tcp": [{ HostIp: "127.0.0.1", HostPort: "3001" }] } },
    };
    if (path.startsWith("/containers/") && path.endsWith("/json")) {
      return { Config: { Labels: { "com.docker.compose.project": "dpf" } } };
    }
    throw new Error("Unexpected fixture Docker request");
  }),
  dockerSocketStop: f.stop,
}));

beforeEach(() => {
  f.stopped = false;
  f.gate = true; f.reaped = false;
  f.stop.mockReset().mockImplementation(async () => { expect(f.reaped).toBe(true); f.stopped = true; });
  const now = Date.now();
  const leaseId = "NPEL-FIXTURE123";
  const taskRunId = deterministicNonprodWaitTaskRunId("fixture-user", leaseId);
  f.lease = {
    id: "fixture-row", leaseId, taskRunId, claimKey: "dev-portal:fixture",
    environmentKey: "local-integration-ci", status: "expired", activeKey: null, slotKey: "slot-0",
    ownerProvider: "codex", ownerSessionId: "fixture-owner",
    worktreePath: "/fixtures/source", branchName: "codex/fixture", buildId: null,
    purpose: `Contributor preview (:3001) bound to /fixtures/source @ codex/fixture (${f.sha})`,
    url: "http://localhost:3001", ports: [3001], ownerPid: null, ownerProcessIdentity: null,
    resourceClass: null, expectedMemoryBytes: null, slotManifestVersion: null,
    admittedAt: new Date(now - 600_000), firstAdmittedAt: new Date(now - 600_000),
    admissionHistoryVersion: 1, expiresAt: new Date(now - 60_000), releasedAt: new Date(now - 50_000),
    cleanupCommand: "this stored string must never be executed",
  };
  f.task = { taskRunId, userId: "fixture-user", status: "completed", progressPayload: {
    nonprodLeaseWait: {
      schemaVersion: 1, kind: "nonprod-lease-wait", state: "admitted", leaseId,
      claimKey: f.lease.claimKey, environmentKey: f.lease.environmentKey,
      ownerProvider: f.lease.ownerProvider, ownerSessionId: f.lease.ownerSessionId,
      worktreePath: f.lease.worktreePath, branchName: f.lease.branchName,
      queuePosition: null, waitDeadlineAt: new Date(now + 60_000).toISOString(),
      lastTransitionAt: new Date(now - 600_000).toISOString(), eventId: null, eventConsumed: true,
    },
  } };
});

it("the existing periodic owner honors quiescence before runtime effects", async () => {
  f.gate = false;
  const { nonprodLeaseWaitReconciliation } = await import("./nonprod-lease-wait");
  const handler = (nonprodLeaseWaitReconciliation as unknown as { handler: (input: unknown) => Promise<unknown> }).handler;
  expect(await handler({ step: { run: async (_id: string, fn: () => unknown) => fn() } })).toMatchObject({ skipped: true });
  expect(f.reaped).toBe(false);
  expect(f.stop).not.toHaveBeenCalled();
});

it.each([true, false])("the hourly owner expires coordination but gates runtime fencing (proceed=%s)", async proceed => {
  f.gate = proceed;
  const { runtimeTargetJanitor } = await import("./runtime-target-janitor");
  const handler = (runtimeTargetJanitor as unknown as { handler: (input: unknown) => Promise<unknown> }).handler;
  await handler({ step: { run: async (_id: string, fn: () => unknown) => fn() } });
  expect(f.reaped).toBe(true);
  expect(f.stop).toHaveBeenCalledTimes(proceed ? 1 : 0);
});

it("the existing periodic native owner fences a provably expired preview without its client", async () => {
  const { nonprodLeaseWaitReconciliation } = await import("./nonprod-lease-wait");
  const handler = (nonprodLeaseWaitReconciliation as unknown as {
    handler: (input: { step: { run: (id: string, fn: () => unknown) => Promise<unknown> } }) => Promise<unknown>;
  }).handler;
  await handler({ step: { run: async (_id, fn) => fn() } });
  expect(f.stop).toHaveBeenCalledExactlyOnceWith(f.id);
  expect(f.stopped).toBe(true);
});

it('the registered periodic trigger advances the stateless fence window every five minutes', async () => {
  const { nonprodLeaseWaitReconciliation } = await import('./nonprod-lease-wait');
  const config = (nonprodLeaseWaitReconciliation as unknown as { config: { triggers: string[] } }).config;
  expect(config.triggers).toEqual(['3,8,13,18,23,28,33,38,43,48,53,58 * * * *']);
});
