import { describe, expect, it, vi } from "vitest";

import { createExecutionHostRegistry, type HostObservationInput } from "./execution-host-registry.server";

vi.mock("@dpf/db", () => ({ prisma: {} }));

const now = new Date("2026-11-25T18:00:00Z");
const identity = { installationRef: "install-local", hostRef: "host-a", receiverRef: "receiver-a" };
const routes = [{ kind: "loopback", endpointRef: "local-a" }, { kind: "https", endpointRef: "edge-a" }];
const input: HostObservationInput = { localInstallationRef: identity.installationRef,
  authenticated: { ...identity, source: "local-host-agent" },
  report: { hostRef: identity.hostRef, receiverRef: identity.receiverRef, routes } };
type Row = typeof identity & { id: string; registeredAt: Date; lastObservedAt: Date; lifecycle: "active" | "retired";
  loopbackEndpointRef: string | null; tailnetEndpointRef: string | null; httpsEndpointRef: string | null };

function store(initial?: Row, concurrentRegistration?: Row) {
  let row = initial;
  const executionHost = {
    findUnique: vi.fn(async () => row ?? null),
    createMany: vi.fn(async ({ data }: { data: Omit<Row, "id" | "lifecycle"> }) => {
      if (row) return { count: 0 };
      if (concurrentRegistration) { row = concurrentRegistration; return { count: 0 }; }
      row = { id: "registration-a", lifecycle: "active", ...data };
      return { count: 1 };
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { receiverRef: string; lifecycle: "active";
      lastObservedAt: { lte: Date } }; data: Partial<Row> }) => {
      if (!row || row.receiverRef !== where.receiverRef || row.lifecycle !== where.lifecycle || row.lastObservedAt > where.lastObservedAt.lte) return { count: 0 };
      row = { ...row, ...data };
      return { count: 1 };
    }),
  };
  const db = { executionHost,
    $transaction: async <T>(run: (tx: { executionHost: typeof executionHost }) => Promise<T>) => run({ executionHost }),
  };
  return { db, row: () => row };
}

describe("execution host registry persistence", () => {
  it("records an exact candidate once and never persists qualification", async () => {
    const { db, row } = store();
    const registry = createExecutionHostRegistry({ db, now: () => now });
    await expect(registry.observe(input)).resolves.toEqual({ ok: true, data: { registrationRef: "registration-a" } });
    await expect(registry.observe(input)).resolves.toEqual({ ok: true, data: { registrationRef: "registration-a" } });
    expect(db.executionHost.createMany).toHaveBeenCalledTimes(1);
    expect(row()).toEqual({ ...identity, id: "registration-a", registeredAt: now, lastObservedAt: now,
      lifecycle: "active", loopbackEndpointRef: "local-a", tailnetEndpointRef: null, httpsEndpointRef: "edge-a" });
    await expect(registry.findCandidate(identity)).resolves.toEqual({ ...identity, registrationRef: "registration-a", routes });
    expect(db.executionHost.findUnique).toHaveBeenLastCalledWith({ where: { installationRef_hostRef: {
      installationRef: identity.installationRef, hostRef: identity.hostRef } } });
  });

  it("a rotated identity cannot overwrite a registration, even with a matching report", async () => {
    const { db, row } = store();
    const registry = createExecutionHostRegistry({ db, now: () => now });
    await registry.observe(input);
    const rotated = { ...identity, receiverRef: "receiver-rotation" };
    await expect(registry.observe({ ...input, authenticated: { ...rotated, source: "local-host-agent" },
      report: { hostRef: identity.hostRef, receiverRef: rotated.receiverRef, routes } })).resolves.toEqual({ ok: false, error: "receiver-changed" });
    expect(row()?.receiverRef).toBe(identity.receiverRef);
    expect(db.executionHost.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a paired installation before DB access and never returns a retired registration", async () => {
    const { db } = store({ ...identity, id: "registration-a", registeredAt: now, lastObservedAt: now,
      lifecycle: "retired", loopbackEndpointRef: "local-a", tailnetEndpointRef: null, httpsEndpointRef: "edge-a" });
    const registry = createExecutionHostRegistry({ db, now: () => now });
    await expect(registry.observe({ ...input, authenticated: { ...identity, source: "paired-install" } }))
      .resolves.toEqual({ ok: false, error: "not-local-host-agent" });
    expect(db.executionHost.findUnique).not.toHaveBeenCalled();
    await expect(registry.observe(input)).resolves.toEqual({ ok: false, error: "registration-retired" });
    await expect(registry.findCandidate(identity)).resolves.toBeNull();
  });

  it("reads the uniquely registered identity again after a concurrent insert wins", async () => {
    const { db, row } = store(undefined, { ...identity, receiverRef: "winner", id: "registration-winner",
      registeredAt: now, lastObservedAt: now, lifecycle: "active", loopbackEndpointRef: "local-a", tailnetEndpointRef: null, httpsEndpointRef: "edge-a" });
    const registry = createExecutionHostRegistry({ db, now: () => now });
    await expect(registry.observe(input)).resolves.toEqual({ ok: false, error: "receiver-changed" });
    expect(db.executionHost.updateMany).not.toHaveBeenCalled();
    expect(row()?.receiverRef).toBe("winner");
  });
});
