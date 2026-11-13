// BI-52934B3E — the published toolchain: one digest definition, a byte-stable
// archive, and a manifest signed by the installation identity.
import { createHash, createPrivateKey, createPublicKey, verify } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { clientCapabilityRow } from "@dpf/integration-shared/client-capability-profile";

import { generateInstanceSigningKeypair, deriveDeviceId } from "@/lib/federation/instance-identity";

import { buildPackArchive } from "./pack-archive";
import { deliveredDigest, listDeliveredFiles, listPackFiles } from "./pack-digest";
import { _resetServedToolchainCache, getInstallationDeviceId, getServedToolchain } from "./served-toolchain";
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

// BI-4F9E3221: the updater stamps `<packVersion>+c.<digest12>` into client
// manifests, so their version value is hashed blank and every other byte counts.
// The same constant is asserted by packages/dpf-skill-pack/scripts/delivered_version_test.py.
const STAMPED_FIXTURE = join(__dirname, "__fixtures__", "pack-digest-stamped");
const STAMPED_FIXTURE_DIGEST = "6075905951582b21a22696782683fe5d9b4829f53f913a8612b083bab57237a3";

describe("stamped client manifests", () => {
  function tree(version: string, description = "x"): string {
    const root = mkdtempSync(join(tmpdir(), "dpf-stamped-"));
    mkdirSync(join(root, ".claude-plugin"));
    writeFileSync(join(root, ".claude-plugin", "plugin.json"), `{\n  "name": "dpf-platform",\n  "version": "${version}",\n  "description": "${description}"\n}\n`);
    writeFileSync(join(root, "toolchain-version.json"), JSON.stringify({ packVersion: "0.2.18", floor: { minPackVersion: null, graceStartsAt: null } }));
    return root;
  }

  it("matches the Python delivered_digest for the stamped fixture", () => {
    expect(deliveredDigest(STAMPED_FIXTURE)).toBe(STAMPED_FIXTURE_DIGEST);
  });

  it("ignores the stamped version value but not the rest of the manifest", () => {
    expect(deliveredDigest(tree("0.2.18"))).toBe(deliveredDigest(tree("0.2.18+c.abcdefabcdef")));
    expect(deliveredDigest(tree("0.2.18"))).not.toBe(deliveredDigest(tree("0.2.18", "y")));
  });

  it("publishes the delivered version a delivery stamps", () => {
    const root = tree("0.2.18");
    const { manifest } = buildToolchainRelease({ packRoot: root, releaseId: null, mcpEndpoint: "https://dpf.example/api/mcp/v1" });
    expect(manifest.deliveredVersion).toBe(`0.2.18+c.${deliveredDigest(root).slice(0, 12)}`);
  });
});

// BI-04A16AB8: an updater from before the stamp (v2026.10.27-dev-recovery.149
// and earlier) verifies the served archive with its own delivered_digest, which
// hashes a client manifest's version as written. It cannot be changed in place,
// so the archive must satisfy it. This is that verifier, frozen.
function legacyDeliveredDigest(entries: ReadonlyMap<string, Buffer>): string {
  const digest = createHash("sha256");
  const delivered = [...entries.keys()]
    .map((relative) => relative.split("/"))
    .filter((segments) => segments[0] !== ".in_use")
    .filter((segments) => !(segments.length === 2 && segments[0] === ".codex-plugin" && segments[1] === "plugin.json"))
    .filter((segments) => !(segments.length === 1 && segments[0]!.endsWith(".mcp.json")))
    .sort((left, right) => {
      for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
        if (left[index] !== right[index]) return left[index]! < right[index]! ? -1 : 1;
      }
      return left.length - right.length;
    })
    .map((segments) => segments.join("/"));
  for (const relative of delivered) {
    digest.update(Buffer.concat([Buffer.from(relative, "utf8"), Buffer.from([0])]));
    digest.update(createHash("sha256").update(entries.get(relative)!).digest());
  }
  return digest.digest("hex");
}

function readArchive(archive: Buffer): Map<string, Buffer> {
  const tar = gunzipSync(archive);
  const entries = new Map<string, Buffer>();
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start: number, length: number) => header.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
    const name = field(0, 100);
    const prefix = field(345, 155);
    const size = parseInt(field(124, 12).trim(), 8);
    entries.set(prefix ? `${prefix}/${name}` : name, Buffer.from(tar.subarray(offset + 512, offset + 512 + size)));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

describe("updaters from before the stamp", () => {
  function release() {
    const packRoot = mkdtempSync(join(tmpdir(), "dpf-legacy-"));
    cpSync(STAMPED_FIXTURE, packRoot, { recursive: true });
    writeFileSync(join(packRoot, "toolchain-version.json"), JSON.stringify({ packVersion: "0.2.18", floor: { minPackVersion: null, graceStartsAt: null } }));
    return buildToolchainRelease({ packRoot, releaseId: null, mcpEndpoint: "https://dpf.example/api/mcp/v1" });
  }

  it("accept the served archive: their digest of it equals the published packDigest", () => {
    const { manifest, archive } = release();
    expect(legacyDeliveredDigest(readArchive(archive))).toBe(manifest.packDigest);
  });

  it("serve stamped manifests with a blank version and every other byte intact", () => {
    const { archive } = release();
    const entries = readArchive(archive);
    for (const client of [".claude-plugin", ".grok-plugin"]) {
      const source = readFileSync(join(STAMPED_FIXTURE, client, "plugin.json"));
      const served = entries.get(`${client}/plugin.json`)!;
      expect(JSON.parse(served.toString("utf8")).version).toBe("");
      expect(served.toString("utf8")).toBe(source.toString("utf8").replace(/("version"\s*:\s*")[^"]*(")/, "$1$2"));
    }
    expect(entries.get("skills/hello/SKILL.md")!.equals(readFileSync(join(STAMPED_FIXTURE, "skills", "hello", "SKILL.md")))).toBe(true);
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

  // BI-DE1E6485: the Python updater verifies this same fixture
  // (packages/dpf-skill-pack/scripts/portal_source_test.py), so the two
  // canonical forms cannot drift. The key is RFC 8032 test 1, never a real one.
  it("signs the shared fixture byte-for-byte as the Python updater verifies it", () => {
    const fixture = JSON.parse(
      readFileSync(join(__dirname, "__fixtures__", "signed-toolchain-manifest.json"), "utf8"),
    ) as Record<string, unknown>;
    const { deviceId, signingPublicKey, signature, ...unsigned } = fixture;
    const rfc8032Test1Seed = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
    const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(rfc8032Test1Seed, "hex")]);
    const publicKey = createPublicKey(createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" }))
      .export({ type: "spki", format: "der" })
      .toString("base64");
    const signed = signToolchainManifest(unsigned as never, {
      deviceId: deriveDeviceId(publicKey),
      signingPublicKey: publicKey,
      signingPrivateKey: pkcs8.toString("base64"),
    });
    expect(signed.deviceId).toBe(deviceId);
    expect(signed.signingPublicKey).toBe(signingPublicKey);
    expect(signed.signature).toBe(signature);
  });

  it("names each client's declaration carrier", () => {
    const shapes = clientShapes("https://dpf.example/api/mcp/v1");
    expect(shapes["claude-code"]!.declarationCarrier).toBe("header");
    expect(shapes.codex!.declarationCarrier).toBe("header");
    expect(shapes.antigravity!.declarationCarrier).toBe("header");
    expect(shapes.grok!.declarationCarrier).toBe("query");
  });

  it("derives each client's auth mode from the canonical credential policy", () => {
    const https = clientShapes("https://dpf.example/api/mcp/v1");
    expect(https["claude-code"]!.authMode).toBe("oauth");
    expect(https.grok!.authMode).toBe("bearer");
    const loopback = clientShapes("http://127.0.0.1:3000/api/mcp/v1");
    expect(loopback.codex!.authMode).toBe("oauth");
    expect(loopback["claude-code"]!.authMode).toBe("bearer");
  });

  // BI-64795FD0: the profile ships inside the clients map, and the carrier
  // fields come from it rather than from a constant.
  it("carries each client's capability profile row", () => {
    const shapes = clientShapes("https://dpf.example/api/mcp/v1");
    for (const kind of ["claude-code", "codex", "grok", "antigravity"]) {
      expect(shapes[kind]!.capabilities).toEqual(clientCapabilityRow(kind));
      expect(shapes[kind]!.declarationCarrier).toBe(clientCapabilityRow(kind)!.capabilities.declarationCarrier.value);
      expect(shapes[kind]!.carrierVerified).toBe(clientCapabilityRow(kind)!.capabilities.declarationCarrier.status === "verified");
    }
    expect(shapes.grok!.capabilities!.capabilities.hookPlane.cli.denyEnvelope).toBe("dual");
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

describe("getInstallationDeviceId", () => {
  it("returns the signer's full device id once, and retries after a failure", async () => {
    _resetServedToolchainCache();
    const failing = vi.fn(async () => {
      throw new Error("identity unavailable");
    });
    expect(await getInstallationDeviceId(failing as never)).toBeNull();
    const did = `did_${"c3".repeat(32)}`;
    const working = vi.fn(async () => ({ deviceId: did, signingPublicKey: "", signingPrivateKey: "" }));
    expect(await getInstallationDeviceId(working)).toBe(did);
    expect(await getInstallationDeviceId(working)).toBe(did);
    expect(working).toHaveBeenCalledTimes(1);
    _resetServedToolchainCache();
  });
});
