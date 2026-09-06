import { X509Certificate } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MEMBER_CERT_PEM, MEMBER_KEY_PKCS8_B64, ORG_ROOT_CERT_PEM } from "./membership-fixtures";
import {
  membershipMaterialDir,
  membershipPathCandidates,
  membershipPaths,
  parseMembershipFacts,
  readMembershipFacts,
  readMembershipMaterial,
  readPinnedRoot,
  writeMembershipMaterial,
} from "./membership-material";

const now = new Date("2026-09-04T12:00:00.000Z");
const rootFingerprint = new X509Certificate(ORG_ROOT_CERT_PEM).fingerprint256.replaceAll(":", "").toLowerCase();
const keyPem = `-----BEGIN PRIVATE KEY-----\n${MEMBER_KEY_PKCS8_B64}\n-----END PRIVATE KEY-----`;
const facts = { schemaVersion: 1 as const, caUrl: "https://192.168.0.152:9000", intendedPeer: "192.168.0.200", rootFingerprint, packageId: "a".repeat(32), joinedAt: now.toISOString() };

let stateDir: string;
let env: Record<string, string | undefined>;

beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "dpf-federation-"));
  env = { DPF_FEDERATION_STATE_DIR: stateDir };
});
afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true });
});

describe("membership paths", () => {
  it("prefers the portal home under the federation state directory and falls back to the script home", () => {
    expect(membershipMaterialDir(env)).toBe(join(stateDir, "pki"));
    const [portal, legacy] = membershipPathCandidates(env);
    expect(portal!.cert).toBe(join(stateDir, "pki", "authority.crt"));
    expect(legacy).toEqual(membershipPaths(env));
    expect(legacy!.root).toBe("/dpf-state/pki/root_ca.crt");
    expect(membershipPaths({ DPF_PKI_CERT_PATH: "/x/c.crt" }).cert).toBe("/x/c.crt");
  });
});

describe("writeMembershipMaterial / readMembershipMaterial", () => {
  it("writes the set atomically into <state dir>/pki and reads it back verified against the root", async () => {
    const written = await writeMembershipMaterial({ rootPem: ORG_ROOT_CERT_PEM, certPem: MEMBER_CERT_PEM, keyPem, facts }, { env });
    expect(written).toEqual({ written: true, dir: join(stateDir, "pki") });
    expect((await stat(join(stateDir, "pki", "authority.key"))).isFile()).toBe(true);
    expect(JSON.parse(await readFile(join(stateDir, "pki", "membership.json"), "utf8"))).toEqual(facts);

    const material = await readMembershipMaterial({ env, now });
    expect(material?.rootFingerprint).toBe(rootFingerprint);
    expect(material?.certPem).toBe(MEMBER_CERT_PEM);
    expect(material?.keyPem).toBe(keyPem);
    expect(await readPinnedRoot({ env, now })).toEqual({ rootPem: ORG_ROOT_CERT_PEM, rootFingerprint });
    expect(await readMembershipFacts({ env })).toEqual(facts);
  });

  it("reports an unmounted federation state directory instead of throwing", async () => {
    const result = await writeMembershipMaterial({ rootPem: ORG_ROOT_CERT_PEM, certPem: MEMBER_CERT_PEM, keyPem, facts }, { env: { DPF_FEDERATION_STATE_DIR: join(stateDir, "missing") } });
    expect(result).toEqual({ written: false, reason: "federation state directory is not mounted" });
  });

  it("falls through to the script home when the portal home is empty, and to null when neither holds a valid set", async () => {
    const reads: string[] = [];
    const readText = async (path: string) => {
      reads.push(path);
      if (path.startsWith("/dpf-state/pki/")) {
        if (path.endsWith("root_ca.crt")) return ORG_ROOT_CERT_PEM;
        if (path.endsWith("authority.crt")) return MEMBER_CERT_PEM;
        return keyPem;
      }
      throw new Error("ENOENT");
    };
    const material = await readMembershipMaterial({ env, readText, now });
    expect(material?.rootFingerprint).toBe(rootFingerprint);
    expect(reads[0]).toBe(join(stateDir, "pki", "root_ca.crt"));

    expect(await readMembershipMaterial({ env, readText: async () => { throw new Error("ENOENT"); }, now })).toBeNull();
    expect(await readPinnedRoot({ env, readText: async () => "not a certificate", now })).toBeNull();
  });
});

describe("parseMembershipFacts", () => {
  it("accepts only the v1 shape with a full fingerprint", () => {
    expect(parseMembershipFacts(facts)).toEqual(facts);
    expect(parseMembershipFacts({ ...facts, rootFingerprint: "abc" })).toBeNull();
    expect(parseMembershipFacts({ ...facts, schemaVersion: 2 })).toBeNull();
    expect(parseMembershipFacts(null)).toBeNull();
  });
});
