// Functional verification with a REAL LDAP client (EP-24741BBF · BI-F7317D65).
//
// The design makes this the acceptance bar, and deliberately so: a directory
// that satisfies its own unit tests but not a real client is worse than none,
// because every consumer discovers the gap in production. Structural
// verification is not functional verification.
//
// The certificate here is a throwaway TEST FIXTURE, not a product fallback —
// `loadLdapTlsMaterial` still refuses to start without organization PKI, which
// its own test asserts.

import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DirectoryProjection } from "../projection";
import { createLdapServer } from "./server";

const LDAPSEARCH = ["/usr/bin/ldapsearch", "/opt/homebrew/bin/ldapsearch"].find((p) =>
  existsSync(p),
);
const OPENSSL = ["/opt/homebrew/bin/openssl", "/usr/bin/openssl"].find((p) => existsSync(p));
const runnable = Boolean(LDAPSEARCH && OPENSSL);

const BASE = "dc=acme,dc=com";
const projection: DirectoryProjection = {
  baseDn: BASE,
  fingerprint: "fp",
  counts: { people: 2, agents: 1, services: 0, groups: 1 },
  entries: [
    { dn: `ou=people,${BASE}`, branch: "people", attributes: { objectClass: ["organizationalUnit"], ou: ["people"] } },
    {
      dn: `uid=prn-h,ou=people,${BASE}`,
      branch: "people",
      attributes: { objectClass: ["inetOrgPerson"], uid: ["prn-h"], cn: ["Dana Reed"], mail: ["dana@acme.com"] },
    },
    {
      dn: `uid=prn-a,ou=agents,${BASE}`,
      branch: "agents",
      attributes: { objectClass: ["inetOrgPerson", "dpfAgent"], uid: ["prn-a"], cn: ["HR Specialist"], dpfGaid: ["gaid:priv:dpf.internal:hr"] },
    },
    {
      dn: `cn=role-ceo,ou=groups,${BASE}`,
      branch: "groups",
      attributes: { objectClass: ["groupOfNames"], cn: ["role-ceo"], member: [`uid=prn-h,ou=people,${BASE}`] },
    },
  ],
};

let server: ReturnType<typeof createLdapServer> | null = null;
let port = 0;

// MUST be async. The listener runs in THIS process, so a synchronous spawn
// blocks the event loop and the server can never accept the connection the
// client is waiting on — the test deadlocks against itself.
function ldapsearch(args: string[]): Promise<{ stdout: string; status: number | null }> {
  return new Promise((resolve) => {
    execFile(
      LDAPSEARCH!,
      args,
      { encoding: "utf8", env: { ...process.env, LDAPTLS_REQCERT: "never" }, timeout: 15_000 },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: unknown }).code === "number"
            ? ((error as { code: number }).code)
            : error
              ? 1
              : 0;
        resolve({ stdout: `${stdout}${stderr}`, status: code });
      },
    );
  });
}

beforeAll(async () => {
  if (!runnable) return;
  const dir = mkdtempSync(join(tmpdir(), "dpf-ldap-fixture-"));
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");
  execFileSync(OPENSSL!, [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", keyPath, "-out", certPath, "-days", "1",
    "-subj", "/CN=127.0.0.1",
    "-addext", "subjectAltName=IP:127.0.0.1",
  ], { stdio: "ignore" });

  server = createLdapServer({
    tls: { key: readFileSync(keyPath), cert: readFileSync(certPath), ca: readFileSync(certPath) },
    loadProjection: async () => projection,
    verifyBind: async ({ bindDn, password }) =>
      password === "correct-horse" && bindDn.startsWith("uid=prn-h,")
        ? { bound: true, principalId: "prn-h" }
        : { bound: false, reason: "invalid credentials" },
  });

  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      port = (server!.address() as AddressInfo).port;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

describe.skipIf(!runnable)("ldapsearch against the real listener", () => {
  it("binds over TLS and returns the published tree", async () => {
    const { stdout } = await ldapsearch([
      "-H", `ldaps://127.0.0.1:${port}`, "-x",
      "-D", `uid=prn-h,ou=people,${BASE}`, "-w", "correct-horse",
      "-b", BASE, "-s", "sub", "(objectClass=*)",
    ]);
    expect(stdout).toContain(`dn: uid=prn-h,ou=people,${BASE}`);
    expect(stdout).toContain(`dn: uid=prn-a,ou=agents,${BASE}`);
    expect(stdout).toContain("Dana Reed");
  });

  it("returns a human, an agent and a group — three shapes of one spine", async () => {
    const { stdout } = await ldapsearch([
      "-H", `ldaps://127.0.0.1:${port}`, "-x",
      "-D", `uid=prn-h,ou=people,${BASE}`, "-w", "correct-horse",
      "-b", BASE, "-s", "sub", "(objectClass=*)",
    ]);
    expect(stdout).toContain("dpfAgent");
    expect(stdout).toContain("gaid:priv:dpf.internal:hr");
    expect(stdout).toContain("groupOfNames");
    expect(stdout).toContain(`member: uid=prn-h,ou=people,${BASE}`);
  });

  it("resolves group membership by filter", async () => {
    const { stdout } = await ldapsearch([
      "-H", `ldaps://127.0.0.1:${port}`, "-x",
      "-D", `uid=prn-h,ou=people,${BASE}`, "-w", "correct-horse",
      "-b", BASE, "-s", "sub", `(member=uid=prn-h,ou=people,${BASE})`,
    ]);
    expect(stdout).toContain("dn: cn=role-ceo");
  });

  it("REFUSES anonymous enumeration", async () => {
    const { stdout } = await ldapsearch([
      "-H", `ldaps://127.0.0.1:${port}`, "-x",
      "-b", BASE, "-s", "sub", "(objectClass=*)",
    ]);
    // Refused at the BIND layer — an anonymous simple bind never reaches
    // search, so the client sees "Invalid credentials (49)". The search-layer
    // guard (insufficientAccessRights, for a client that skips bind entirely)
    // is asserted separately in ldap.test.ts. Two independent refusals; the
    // substance is that NOTHING is disclosed.
    expect(stdout).not.toContain("dn: uid=prn-h");
    expect(stdout).not.toContain("dn: ou=people");
    expect(stdout).toMatch(/Invalid credentials|Insufficient access/i);
  });

  it("rejects a wrong password", async () => {
    const { stdout, status } = await ldapsearch([
      "-H", `ldaps://127.0.0.1:${port}`, "-x",
      "-D", `uid=prn-h,ou=people,${BASE}`, "-w", "wrong",
      "-b", BASE, "(objectClass=*)",
    ]);
    expect(status).not.toBe(0);
    expect(stdout).toMatch(/Invalid credentials/i);
  });

  it("does not disclose a withheld attribute even when asked for it directly", async () => {
    const { stdout } = await ldapsearch([
      "-H", `ldaps://127.0.0.1:${port}`, "-x",
      "-D", `uid=prn-h,ou=people,${BASE}`, "-w", "correct-horse",
      "-b", BASE, "-s", "sub", "(objectClass=*)", "sponsorPrincipalId", "passwordHash",
    ]);
    expect(stdout).not.toMatch(/sponsorPrincipalId:/);
    expect(stdout).not.toMatch(/passwordHash:/);
  });
});
