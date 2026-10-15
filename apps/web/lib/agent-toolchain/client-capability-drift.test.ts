import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ingestBacklogItem, type IngestBacklogStore } from "@/lib/operate/backlog-ingest";

import {
  _resetCapabilityDriftMemo,
  capabilityDriftFromObservations,
  clientCapabilityIntakeKey,
  fileCapabilityReverification,
  noteObservedClientVersion,
} from "./client-capability-drift";

// BI-64795FD0 (AC-CAPABILITY-DRIFT): a client version newer than the profile
// verified is flagged in the fleet view and filed once per client and version.

const row = (clientKind: string, clientInfoVersion: string | null, credentialRef = "token:a") => ({
  credentialRef,
  loadedDigest: "0123456789abcdef",
  clientKind,
  probableClient: null,
  loadedPackVersion: "0.3.0",
  authMode: "oauth" as const,
  clientInfoName: clientKind,
  clientInfoVersion,
  lastObservedAt: new Date("2026-10-13T00:00:00Z"),
});

describe("capabilityDriftFromObservations", () => {
  it("flags each client and version newer than verified, once", () => {
    const drift = capabilityDriftFromObservations([
      row("claude-code", "2.1.300", "token:a"),
      row("claude-code", "2.1.300", "token:b"),
      row("claude-code", "2.1.295"),
      row("codex", "0.142.5"),
      row("undeclared", "9.9.9"),
      row("grok", null),
    ]);
    expect(drift).toEqual([
      {
        clientKind: "claude-code",
        clientVersion: "2.1.300",
        verifiedVersion: "2.1.295",
        label: "capabilities unverified for 2.1.300",
        intakeKey: "client-capability:claude-code@2.1.300",
      },
    ]);
  });

  it("flags a client that was never verified on any version", () => {
    expect(capabilityDriftFromObservations([row("antigravity", "1.0.0")])).toEqual([
      expect.objectContaining({ clientKind: "antigravity", verifiedVersion: null, label: "capabilities unverified for 1.0.0" }),
    ]);
  });
});

describe("clientCapabilityIntakeKey", () => {
  it("is client-capability:<client>@<version>", () => {
    expect(clientCapabilityIntakeKey("codex", "0.160.0")).toBe("client-capability:codex@0.160.0");
  });
});

function fakeStore() {
  const items: Array<{ id: string; itemId: string; body: string | null; status: string; occurrenceCount: number }> = [];
  const activities: unknown[] = [];
  const store: IngestBacklogStore = {
    backlogItem: {
      findFirst: async (args) => {
        const marker = (args as { where: { body: { contains: string } } }).where.body.contains;
        return items.find((item) => item.body?.includes(marker) && item.status === "triaging") ?? null;
      },
      update: async (args) => {
        const { where } = args as { where: { id: string } };
        const item = items.find((candidate) => candidate.id === where.id)!;
        item.occurrenceCount += 1;
        return item;
      },
      create: async (args) => {
        const data = (args as { data: { itemId: string; body: string | null } }).data;
        const item = { id: `cuid-${items.length + 1}`, itemId: data.itemId, body: data.body, status: "triaging", occurrenceCount: 1 };
        items.push(item);
        return item;
      },
    },
    backlogItemActivity: { create: async (args) => activities.push(args) },
    epic: { findFirst: async () => null },
  };
  return { store, items, activities };
}

const ingestWith = (store: IngestBacklogStore) => (input: Parameters<typeof ingestBacklogItem>[0]) =>
  ingestBacklogItem(input, {
    store,
    indexKnowledge: () => {},
    listRepoFiles: async () => [],
    searchSimilarItems: async () => ({ status: "ok", results: [] }),
  });

describe("fileCapabilityReverification", () => {
  it("files one item per client and version through the intake dedupe", async () => {
    const { store, items } = fakeStore();
    const ingest = ingestWith(store);
    const drift = { clientKind: "claude-code", clientVersion: "2.1.300", verifiedVersion: "2.1.295" };
    const first = await fileCapabilityReverification(drift, { ingest });
    const second = await fileCapabilityReverification(drift, { ingest });
    expect(first.created).toBe(true);
    expect(second).toMatchObject({ created: false, itemId: first.itemId });
    expect(items).toHaveLength(1);
    expect(items[0]!.occurrenceCount).toBe(2);
    expect(items[0]!.body).toContain("[origin:client-capability:claude-code@2.1.300]");
    expect(items[0]!.body).toContain("2.1.295");

    await fileCapabilityReverification({ ...drift, clientVersion: "2.1.301" }, { ingest });
    expect(items).toHaveLength(2);
  });
});

describe("noteObservedClientVersion", () => {
  beforeEach(() => _resetCapabilityDriftMemo());

  it("files once per process for an unverified version and never for a verified one", async () => {
    const ingest = vi.fn(async () => ({ itemId: "BI-X", id: "c1", created: true }));
    await noteObservedClientVersion("claude-code", "2.1.300", { ingest });
    await noteObservedClientVersion("claude-code", "2.1.300", { ingest });
    await noteObservedClientVersion("claude-code", "2.1.295", { ingest });
    await noteObservedClientVersion("undeclared", "9.9.9", { ingest });
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({
      origin: { kind: "client-capability", id: "claude-code@2.1.300" },
      source: "automated-detection",
    }));
  });

  it("tries again after a failed filing", async () => {
    const ingest = vi.fn()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce({ itemId: "BI-X", id: "c1", created: true });
    await expect(noteObservedClientVersion("codex", "0.160.0", { ingest })).resolves.toBeNull();
    await noteObservedClientVersion("codex", "0.160.0", { ingest });
    expect(ingest).toHaveBeenCalledTimes(2);
  });
});
