// BI-52934B3E — the published toolchain: one digest definition, a byte-stable
// archive, and a manifest signed by the installation identity.
import { createHash, createPublicKey, verify } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { canonicalJson } from "@dpf/integration-shared/canonical-json";

import { generateInstanceSigningKeypair, deriveDeviceId } from "@/lib/federation/instance-identity";

import { buildPackArchive } from "./pack-archive";
import { deliveredDigest, listDeliveredFiles, listPackFiles } from "./pack-digest";
import { _resetServedToolchainCache, getServedToolchain } from "./served-toolchain";
import { buildToolchainRelease, clientShapes, signToolchainManifest } from "./toolchain-manifest";

const FIXTURE = join(__dirname, "__fixtures__", "pack-digest");
// The same constant is asserted by packages/dpf-skill-pack/scripts/installed_copy_freshness_test.py.
const FIXTURE_DIGEST = "ca4afe3a58a8f22b62ae1f6e5be4e5ad976ed59a5abd0a89c0460519af10c28f";

function signer() {
  const keypair = generateInstanceSigningKeypair();
  return { ...keypair, deviceId: deriveDeviceId(keypair.signingPublicKey) };
}

describe("delivered digest", () => {
  it("matches the Python delivered_digest for the shared fixture", () => {
    expect(deliveredDigest(FIXTURE)).toBe(FIXTURE_DIGEST);
  });

  it("orders by case-sensitive path segments, not by joined string", () => {
    // "a/b.txt" sorts before "a-c.txt" by segment ("a" < "a-c"), although "/" > "-" as a string;
    // "README.md" sorts before "assets/…" case-sensitively ("R" < "a").
    const files = listPackFiles(FIXTURE);
    expect(files.indexOf("a/b.txt")).toBeLessThan(files.indexOf("a-c.txt"));
    expect(files.indexOf("README.md")).toBeLessThan(files.indexOf("assets/a.txt"));
  });

  it("excludes per-install files and build debris from the identity", () => {
    const delivered = listDeliveredFiles(FIXTURE);
    expect(delivered).not.toContain(".codex-plugin/plugin.json");
    expect(delivered).not.toContain("claude.mcp.json");
    const root = mkdtempSync(join(tmpdir(), "pack-debris-"));
    mkdirSync(join(root, "scripts", "__pycache__"), { recursive: true });
    writeFileSync(join(root, "scripts", "tool.py"), "x\n");
    writeFileSync(join(root, "scripts", "__pycache__", "tool.cpython-312.pyc"), "junk");
    writeFileSync(join(root, ".DS_Store"), "junk");
    expect(listPackFiles(root)).toEqual(["scripts/tool.py"]);
  });
});

describe("pack archive", () => {
  it("is byte-identical across builds and carries every pack file", () => {
    const files = listPackFiles(FIXTURE);
    const first = buildPackArchive(FIXTURE, files);
    const second = buildPackArchive(FIXTURE, files);
    expect(first.equals(second)).toBe(true);
    expect(first.readUInt32LE(4)).toBe(0); // gzip mtime
    expect(first[9]).toBe(0xff); // fixed OS byte
    const tar = gunzipSync(first).toString("latin1");
    for (const file of files) expect(tar).toContain(file.split("/").at(-1));
  });
});

describe("toolchain manifest", () => {
  it("binds version, digest and archive hash, and signs canonical bytes with the installation key", () => {
    const { manifest, archive } = buildToolchainRelease({
      packRoot: FIXTURE,
      releaseId: "abc123",
      mcpEndpoint: "https://dpf.example/api/mcp/v1",
    });
    expect(manifest.packVersion).toBe("0.0.1");
    expect(manifest.packDigest).toBe(FIXTURE_DIGEST);
    expect(manifest.archiveSha256).toBe(createHash("sha256").update(archive).digest("hex"));

    const key = signer();
    const signed = signToolchainManifest(manifest, key);
    expect(signed.deviceId).toBe(key.deviceId);
    expect(deriveDeviceId(signed.signingPublicKey)).toBe(signed.deviceId);
    const { deviceId: _d, signingPublicKey, signature, ...unsigned } = signed;
    const publicKey = createPublicKey({ key: Buffer.from(signingPublicKey, "base64"), format: "der", type: "spki" });
    expect(verify(null, Buffer.from(canonicalJson(unsigned)), publicKey, Buffer.from(signature, "base64"))).toBe(true);
    const tampered = { ...unsigned, packDigest: "0".repeat(64) };
    expect(verify(null, Buffer.from(canonicalJson(tampered)), publicKey, Buffer.from(signature, "base64"))).toBe(false);
  });

  it("derives each client's auth mode from the canonical credential policy", () => {
    const https = clientShapes("https://dpf.example/api/mcp/v1");
    expect(https["claude-code"]!.authMode).toBe("oauth");
    expect(https.grok!.authMode).toBe("bearer");
    const loopback = clientShapes("http://127.0.0.1:3000/api/mcp/v1");
    expect(loopback.codex!.authMode).toBe("oauth");
    expect(loopback["claude-code"]!.authMode).toBe("bearer");
  });
});

describe("served toolchain", () => {
  it("computes once per endpoint and refuses rather than serving unsigned when the key is missing", async () => {
    _resetServedToolchainCache();
    const releaseId = vi.fn(async () => "r1");
    const deps = { packRoot: () => FIXTURE, releaseId, signer: async () => signer() };
    const first = await getServedToolchain("https://a/api/mcp/v1", deps);
    const again = await getServedToolchain("https://a/api/mcp/v1", deps);
    expect(again).toBe(first);
    expect(releaseId).toHaveBeenCalledTimes(1);

    _resetServedToolchainCache();
    await expect(
      getServedToolchain("https://a/api/mcp/v1", { ...deps, signer: async () => { throw new Error("no key"); } }),
    ).rejects.toThrow("no key");
    // Not cached: a later call with a key succeeds.
    await expect(getServedToolchain("https://a/api/mcp/v1", deps)).resolves.toBeTruthy();
  });

  it("refuses when the image has no pack", async () => {
    _resetServedToolchainCache();
    await expect(
      getServedToolchain("https://b/api/mcp/v1", { packRoot: () => null, releaseId: async () => null, signer: async () => signer() }),
    ).rejects.toThrow(/not present/);
  });
});
