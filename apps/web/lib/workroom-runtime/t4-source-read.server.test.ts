import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readT4GitPage } from "./t4-source-read-git.server";
import { createT4SourceReadWire, type T4ReadPorts } from "./t4-source-read-wire.server";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function repo(bytes: string | Buffer = "alpha\né\ngamma\n") {
  const root = mkdtempSync(join(tmpdir(), "t4-source-"));
  roots.push(root);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  git("init", "--quiet");
  writeFileSync(join(root, "source.txt"), bytes);
  git("add", "--", "source.txt");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "--no-gpg-sign", "-m", "fixture");
  const target = { repositoryFullName: "Owner/Repo", commitSha: git("rev-parse", "HEAD"), path: "source.txt",
    expectedBlobId: git("rev-parse", "HEAD:source.txt") };
  return { repositoryFullName: target.repositoryFullName, gitDir: join(root, ".git"), target, git, root };
}
const window = { startLine: 1, maxLines: 2, maxBytes: 9 };

describe("T4 installed Git object read", () => {
  it("returns the exact 9 and 6 byte pages from a committed object, not the worktree", async () => {
    const fixture = repo();
    writeFileSync(join(fixture.root, "source.txt"), "different uncommitted bytes");
    expect(await readT4GitPage(fixture, fixture.target, window)).toEqual({
      kind: "page", startLine: 1, endLine: 2, content: "alpha\né\n", utf8Bytes: 9, nextLine: 3,
    });
    expect(await readT4GitPage(fixture, fixture.target, { startLine: 3, maxLines: 1, maxBytes: 6 })).toEqual({
      kind: "page", startLine: 3, endLine: 3, content: "gamma\n", utf8Bytes: 6, nextLine: null,
    });
  });

  it.each(["commitSha", "path", "expectedBlobId", "repositoryFullName"] as const)("holds a wrong %s locally", async key => {
    const fixture = repo();
    const wrong = { ...fixture.target, [key]: key === "path" ? "missing" :
      key === "repositoryFullName" ? "Other/Repo" : "1".repeat(40) };
    expect(await readT4GitPage(fixture, wrong, window)).toEqual({ kind: "refused", code: "source-unavailable" });
  });

  it("does not fetch a missing promisor object", async () => {
    const fixture = repo();
    const marker = join(fixture.root, "provider-called");
    const remote = join(fixture.root, "fake-upload-pack");
    writeFileSync(remote, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, { mode: 0o700 });
    fixture.git("config", "remote.origin.url", fixture.root);
    fixture.git("config", "remote.origin.promisor", "true");
    fixture.git("config", "remote.origin.uploadpack", remote);
    const oid = fixture.target.expectedBlobId;
    rmSync(join(fixture.gitDir, "objects", oid.slice(0, 2), oid.slice(2)));
    expect(await readT4GitPage(fixture, fixture.target, window)).toEqual({ kind: "refused", code: "source-unavailable" });
    const { existsSync } = await import("node:fs");
    expect(existsSync(marker)).toBe(false);
  });

  it("refuses a malformed UTF-8 blob and a non-fitting line", async () => {
    const invalid = repo(Buffer.from([0x61, 0xc3, 0x28, 0x0a]));
    expect(await readT4GitPage(invalid, invalid.target, window)).toEqual({ kind: "refused", code: "source-unavailable" });
    const fixture = repo();
    expect(await readT4GitPage(fixture, fixture.target, { ...window, maxBytes: 5 })).toEqual({
      kind: "refused", code: "window-unavailable",
    });
  });
});

const identity = { issuer: "control", audience: "dpf", hostRef: "host-1" };
const scope = { workroomId: "WC-1", sessionRef: "session-1", stageKey: "coding", stageAttemptRef: "stage-1" };
const correlation = { sessionAdmissionRef: "admit-code-1", attemptRef: "attempt-code-1", invocationId: "read-01",
  operationId: "room-operation:00000000-0000-4000-8000-000000000001" };
const profile = "t4-control-source-read.v1";

function wire() {
  const fixture = repo();
  const peer = generateKeyPairSync("ed25519");
  const server = generateKeyPairSync("ed25519");
  const call = { profile, kind: "source-read", ...identity, ...scope, correlation, target: fixture.target, window,
    reservation: { reservationId: correlation.operationId, reads: 1, bytes: 9, expiresAt: 2000 } };
  const admission = { ...scope, correlation: { sessionAdmissionRef: correlation.sessionAdmissionRef, attemptRef: correlation.attemptRef },
    operationKeys: ["read_source_at_version"], target: fixture.target, store: fixture, expiresAt: 3000,
    mode: "bounded-coding" as const };
  const consumed = new Set<string>();
  const read = vi.fn(readT4GitPage);
  const ports = { now: () => 1000, readCurrent: vi.fn(async () => admission),
    consumeOnce: vi.fn(async ({ correlation: c }) => {
      if (consumed.has(c.operationId)) return false;
      consumed.add(c.operationId);
      return true;
    }), authenticate: vi.fn(async () => ({ ...identity, profile, peerPublicKey: peer.publicKey, replyPrivateKey: server.privateKey })),
    read } satisfies T4ReadPorts;
  const send = (handler = createT4SourceReadWire(ports), raw = Buffer.from(canonicalJson(call)), signingKey = peer.privateKey) =>
    handler(new Request("https://dpf/api/internal/t4-source-read", { method: "POST", body: new Uint8Array(raw),
      headers: { "content-type": "application/json", "x-dpf-t4-signature": sign(null, raw, signingKey).toString("base64url") } }));
  return { call, admission, ports, send, server, peer, read };
}

describe("T4 protected read boundary", () => {
  it("returns only the signed, exact request-bound page", async () => {
    const f = wire();
    const response = await f.send();
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(verify(null, bytes, f.server.publicKey, Buffer.from(response.headers.get("x-dpf-t4-signature")!, "base64url"))).toBe(true);
    expect(JSON.parse(bytes.toString())).toMatchObject({ issuer: "dpf", audience: "control", correlation,
      requestDigest: createHash("sha256").update(canonicalJson(f.call)).digest("hex"), target: f.call.target,
      result: { kind: "page", content: "alpha\né\n", utf8Bytes: 9, nextLine: 3 } });
  });

  it.each(["wrong peer", "wrong reservation", "sibling", "wrong target", "expired", "cursor", "wrong operation", "duplicate", "invalid UTF-8"] as const)
    ("refuses %s before consumption or Git content", async scenario => {
      const f = wire();
      const call = structuredClone(f.call);
      if (scenario === "wrong peer") call.issuer = "foreign-peer";
      if (scenario === "wrong reservation") call.reservation.bytes = 8;
      if (scenario === "sibling") call.correlation.attemptRef = "attempt-coord";
      if (scenario === "wrong target") call.target.path = "elsewhere.txt";
      if (scenario === "expired") call.reservation.expiresAt = 999;
      if (scenario === "cursor") Object.assign(call.window, { cursor: "tampered" });
      if (scenario === "wrong operation") f.admission.operationKeys = ["post_room_message"];
      let bytes = Buffer.from(canonicalJson(call));
      if (scenario === "duplicate") bytes = Buffer.from(bytes.toString().replace('"reads":1', '"reads":1,"reads":1'));
      if (scenario === "invalid UTF-8") bytes[bytes.indexOf("source.txt")] = 0xff;
      expect((await f.send(undefined, bytes)).status).not.toBe(200);
      expect(f.ports.consumeOnce).not.toHaveBeenCalled();
      expect(f.read).not.toHaveBeenCalled();
    });

  it("rejects a signature not made with the installed peer key", async () => {
    const f = wire();
    const other = generateKeyPairSync("ed25519").privateKey;
    expect((await f.send(undefined, undefined, other)).status).not.toBe(200);
    expect(f.ports.readCurrent).not.toHaveBeenCalled();
  });

  it("consumes once across concurrent calls and a newly opened handler", async () => {
    const f = wire();
    const handler = createT4SourceReadWire(f.ports);
    const results = await Promise.all([f.send(handler), f.send(handler)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    const reopened = await f.send(createT4SourceReadWire(f.ports));
    expect(reopened.status).toBe(409);
    expect(await reopened.text()).not.toContain("alpha");
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(f.ports.consumeOnce.mock.calls[0]?.[0]).toEqual({
      ...identity, ...scope, correlation, reservation: f.call.reservation,
      requestDigest: createHash("sha256").update(canonicalJson(f.call)).digest("hex"),
    });
  });

  it("refuses a revoked attempt before consulting reservation state", async () => {
    const f = wire();
    const handler = createT4SourceReadWire({
      ...f.ports, readCurrent: async () => null,
    });
    const response = await f.send(handler);
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("");
    expect(f.ports.consumeOnce).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
  });

  it("holds when the reservation owner cannot prove consumption", async () => {
    const f = wire();
    f.ports.consumeOnce.mockRejectedValueOnce(new Error("ledger unavailable"));
    expect((await f.send()).status).toBe(503);
    expect(f.read).not.toHaveBeenCalled();
  });

  it("withholds a read when admission becomes stale before disclosure", async () => {
    const f = wire();
    f.read.mockImplementationOnce(async (...args) => {
      f.admission.expiresAt = 999;
      return readT4GitPage(...args);
    });
    const response = await f.send();
    expect(await response.text()).not.toContain("alpha");
    expect(f.read).toHaveBeenCalledTimes(1);
    expect((await f.send()).status).not.toBe(200);
    expect(f.read).toHaveBeenCalledTimes(1);
  });
});
