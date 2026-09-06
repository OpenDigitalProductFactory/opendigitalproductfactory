import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFileFederationStore, parseDurableIdentity, parseDurableLedger } from "./durable-state";

const identity = {
  schemaVersion: 1 as const,
  installationId: `inst_${"a".repeat(32)}`,
  projectionSecret: "b".repeat(64),
  deviceId: `did_${"c".repeat(64)}`,
  signingPublicKey: "pub",
  signingPrivateKey: "priv",
  writtenAt: "2026-09-02T10:00:00.000Z",
};

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("file federation store", () => {
  it("round-trips identity and ledger through private files in the mounted directory", async () => {
    const base = await mkdtemp(join(tmpdir(), "dpf-fed-"));
    dirs.push(base);
    const dir = join(base, "federation");
    // The compose mount provides the directory; the store never creates one.
    const missing = createFileFederationStore(dir);
    expect(await missing.available()).toBe(false);
    expect(await missing.writeIdentity(identity)).toBe(false);
    await mkdir(dir);
    const store = createFileFederationStore(dir);
    expect(await store.readIdentity()).toBeNull();
    expect(await store.writeIdentity(identity)).toBe(true);
    expect(await store.readIdentity()).toEqual(identity);
    expect(JSON.parse(await readFile(join(dir, "identity.json"), "utf8")).installationId).toBe(identity.installationId);

    const ledger = { schemaVersion: 1 as const, writtenAt: identity.writtenAt, links: [] };
    expect(await store.writeLedger(ledger)).toBe(true);
    expect(await store.readLedger()).toEqual(ledger);
    expect(await store.available()).toBe(true);
  });

  it("reports an unusable directory as unavailable instead of throwing", async () => {
    const base = await mkdtemp(join(tmpdir(), "dpf-fed-"));
    dirs.push(base);
    // A file where the directory should be: mkdir fails, reads yield null, writes false.
    const blocked = join(base, "blocked");
    await (await import("node:fs/promises")).writeFile(blocked, "x");
    const store = createFileFederationStore(join(blocked, "federation"));
    expect(await store.readIdentity()).toBeNull();
    expect(await store.writeIdentity(identity)).toBe(false);
    expect(await store.available()).toBe(false);
  });
});

describe("parsers", () => {
  it("refuse a malformed identity and tolerate partial ledger rows", () => {
    expect(parseDurableIdentity({ ...identity, installationId: "nope" })).toBeNull();
    expect(parseDurableIdentity({ ...identity, schemaVersion: 2 })).toBeNull();
    const ledger = parseDurableLedger({ schemaVersion: 1, links: [{ linkId: "l", role: "same-org-peer", peerAuthorityUrl: "http://x" }, { bad: true }] });
    expect(ledger?.links).toHaveLength(1);
    expect(ledger?.links[0]).toMatchObject({ linkId: "l", peerToken: null, displayName: "l" });
  });
});
