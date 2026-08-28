import { describe, expect, it, vi } from "vitest";

import type { DirectoryProjection } from "../projection";
import {
  APP,
  BerReader,
  TAG,
  berElement,
  berInteger,
  berSequence,
  berString,
  frameMessages,
} from "./ber";
import { decodeFilter, matchesFilter } from "./filter";
import {
  MAX_SEARCH_RESULTS,
  RESULT,
  SCOPE,
  decodeRequest,
  executeSearch,
} from "./protocol";
import { handleMessage } from "./server";
import { loadLdapTlsMaterial } from "./tls";
import { createBindVerifier, principalIdFromBindDn } from "./bind";

// ── request builders (the client side of the wire) ───────────────────────────
function bindRequest(messageId: number, dn: string, password: string, version = 3) {
  return berSequence(
    berInteger(messageId),
    berElement(
      APP.BIND_REQUEST,
      Buffer.concat([berInteger(version), berString(dn), berString(password, 0x80)]),
    ),
  );
}
function searchRequest(
  messageId: number,
  base: string,
  scope: number,
  filter: Buffer,
  attributes: string[] = [],
  sizeLimit = 0,
) {
  return berSequence(
    berInteger(messageId),
    berElement(
      APP.SEARCH_REQUEST,
      Buffer.concat([
        berString(base),
        berInteger(scope, TAG.ENUMERATED),
        berInteger(0, TAG.ENUMERATED),
        berInteger(sizeLimit),
        berInteger(0),
        berElement(TAG.BOOLEAN, Buffer.from([0])),
        filter,
        berSequence(...attributes.map((a) => berString(a))),
      ]),
    ),
  );
}
const equalityFilter = (attr: string, value: string) =>
  berElement(0xa3, Buffer.concat([berString(attr), berString(value)]));
const presentFilter = (attr: string) => berString(attr, 0x87);

const BASE = "dc=acme,dc=com";
const projection: DirectoryProjection = {
  baseDn: BASE,
  fingerprint: "fp",
  counts: { people: 2, agents: 1, services: 1, groups: 1 },
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
      attributes: { objectClass: ["inetOrgPerson", "dpfAgent"], uid: ["prn-a"], cn: ["HR Specialist"] },
    },
    {
      dn: `cn=role-ceo,ou=groups,${BASE}`,
      branch: "groups",
      attributes: { objectClass: ["groupOfNames"], cn: ["role-ceo"], member: [`uid=prn-h,ou=people,${BASE}`] },
    },
  ],
};
const bound = { boundDn: `uid=prn-h,ou=people,${BASE}` };

describe("BER", () => {
  it("round-trips integers, strings and sequences", () => {
    const buf = berSequence(berInteger(7), berString("hello"));
    const reader = new BerReader(buf).readConstructed(TAG.SEQUENCE);
    expect(reader.readInteger()).toBe(7);
    expect(reader.readString()).toBe("hello");
  });

  it("encodes and decodes a long-form length past 127 bytes", () => {
    const long = "x".repeat(300);
    const reader = new BerReader(berString(long));
    expect(reader.readString()).toBe(long);
  });

  it("refuses an element whose declared length exceeds the ceiling", () => {
    // 0x04 = OCTET STRING, 0x84 = 4 length bytes, then 16MB.
    const hostile = Buffer.from([0x04, 0x84, 0x01, 0x00, 0x00, 0x00]);
    expect(() => new BerReader(hostile).readElement()).toThrow(/exceeds/i);
  });

  it("refuses indefinite-length encoding", () => {
    expect(() => new BerReader(Buffer.from([0x30, 0x80])).readElement()).toThrow(/length/i);
  });
});

describe("frameMessages — TCP does not respect message boundaries", () => {
  it("splits two messages arriving in one chunk", () => {
    const stream = Buffer.concat([bindRequest(1, "a", "b"), bindRequest(2, "c", "d")]);
    const { messages, rest } = frameMessages(stream);
    expect(messages).toHaveLength(2);
    expect(rest).toHaveLength(0);
  });

  it("holds back a message split across chunks instead of misparsing it", () => {
    const whole = bindRequest(1, "somebody", "secret");
    const first = frameMessages(whole.subarray(0, 6));
    expect(first.messages).toHaveLength(0);
    const second = frameMessages(Buffer.concat([first.rest, whole.subarray(6)]));
    expect(second.messages).toHaveLength(1);
    expect(decodeRequest(second.messages[0]!)).toMatchObject({ type: "bind", messageId: 1 });
  });
});

describe("request decoding", () => {
  it("decodes a simple bind", () => {
    expect(decodeRequest(bindRequest(9, "uid=x,dc=a", "pw"))).toEqual({
      type: "bind", messageId: 9, version: 3, name: "uid=x,dc=a", password: "pw",
    });
  });

  it("decodes a search with filter and requested attributes", () => {
    const req = decodeRequest(
      searchRequest(3, BASE, SCOPE.SUBTREE, equalityFilter("uid", "prn-h"), ["cn", "mail"]),
    );
    expect(req).toMatchObject({ type: "search", messageId: 3, baseObject: BASE, scope: SCOPE.SUBTREE });
    expect((req as { attributes: string[] }).attributes).toEqual(["cn", "mail"]);
  });

  it("decodes unbind", () => {
    const unbind = berSequence(berInteger(4), berElement(APP.UNBIND_REQUEST, Buffer.alloc(0)));
    expect(decodeRequest(unbind)).toEqual({ type: "unbind", messageId: 4 });
  });
});

describe("filters", () => {
  const attrs = { cn: ["Dana Reed"], uid: ["prn-h"], mail: ["dana@acme.com"] };

  it("matches equality case-insensitively", () => {
    expect(matchesFilter(decodeFilter(new BerReader(equalityFilter("CN", "dana reed"))), attrs)).toBe(true);
  });

  it("matches presence, and reports absence for an attribute that is not published", () => {
    expect(matchesFilter(decodeFilter(new BerReader(presentFilter("mail"))), attrs)).toBe(true);
    expect(matchesFilter(decodeFilter(new BerReader(presentFilter("passwordHash"))), attrs)).toBe(false);
  });

  it("evaluates and / or / not", () => {
    const and = berElement(0xa0, Buffer.concat([equalityFilter("uid", "prn-h"), presentFilter("mail")]));
    expect(matchesFilter(decodeFilter(new BerReader(and)), attrs)).toBe(true);
    const or = berElement(0xa1, Buffer.concat([equalityFilter("uid", "nope"), presentFilter("mail")]));
    expect(matchesFilter(decodeFilter(new BerReader(or)), attrs)).toBe(true);
    const not = berElement(0xa2, equalityFilter("uid", "nope"));
    expect(matchesFilter(decodeFilter(new BerReader(not)), attrs)).toBe(true);
  });

  it("evaluates substrings with initial, any and final", () => {
    const substrings = berElement(
      0xa4,
      Buffer.concat([
        berString("mail"),
        berSequence(berString("dana", 0x80), berString("acme", 0x81), berString(".com", 0x82)),
      ]),
    );
    expect(matchesFilter(decodeFilter(new BerReader(substrings)), attrs)).toBe(true);
  });

  it("treats an unsupported filter as NO match, never a wider one", () => {
    const approx = berElement(0xa8, Buffer.concat([berString("cn"), berString("Dana Reed")]));
    const decoded = decodeFilter(new BerReader(approx));
    expect(decoded.type).toBe("unsupported");
    expect(matchesFilter(decoded, attrs)).toBe(false);
  });
});

describe("executeSearch — authorization is not optional", () => {
  it("refuses anonymous enumeration of the tree", () => {
    const request = decodeRequest(searchRequest(1, BASE, SCOPE.SUBTREE, presentFilter("objectClass")));
    const outcome = executeSearch(request as never, projection, { boundDn: null });
    expect(outcome).toMatchObject({ searched: false, resultCode: RESULT.INSUFFICIENT_ACCESS });
  });

  it("refuses a base object outside the published namespace", () => {
    const request = decodeRequest(searchRequest(1, "dc=evil,dc=com", SCOPE.SUBTREE, presentFilter("objectClass")));
    const outcome = executeSearch(request as never, projection, bound);
    expect(outcome).toMatchObject({ searched: false, resultCode: RESULT.NO_SUCH_OBJECT });
  });

  it("honours base, one-level and subtree scope", () => {
    const run = (scope: number, base = BASE) =>
      executeSearch(
        decodeRequest(searchRequest(1, base, scope, presentFilter("objectClass"))) as never,
        projection,
        bound,
      );
    const baseScope = run(SCOPE.BASE, `ou=people,${BASE}`);
    expect(baseScope.searched && baseScope.entries.map((e) => e.dn)).toEqual([`ou=people,${BASE}`]);

    const oneLevel = run(SCOPE.ONE_LEVEL, `ou=people,${BASE}`);
    expect(oneLevel.searched && oneLevel.entries.map((e) => e.dn)).toEqual([`uid=prn-h,ou=people,${BASE}`]);

    const subtree = run(SCOPE.SUBTREE);
    expect(subtree.searched && subtree.entries.length).toBe(4);
  });

  it("returns only the requested attributes", () => {
    const request = decodeRequest(
      searchRequest(1, BASE, SCOPE.SUBTREE, equalityFilter("uid", "prn-h"), ["cn"]),
    );
    const outcome = executeSearch(request as never, projection, bound);
    expect(outcome.searched && outcome.entries[0]!.attributes).toEqual({ cn: ["Dana Reed"] });
  });

  it("caps an unbounded search rather than serving the whole tree", () => {
    const big: DirectoryProjection = {
      ...projection,
      entries: Array.from({ length: MAX_SEARCH_RESULTS + 25 }, (_, i) => ({
        dn: `uid=p${i},ou=people,${BASE}`,
        branch: "people" as const,
        attributes: { objectClass: ["inetOrgPerson"], uid: [`p${i}`] },
      })),
    };
    const request = decodeRequest(searchRequest(1, BASE, SCOPE.SUBTREE, presentFilter("objectClass")));
    const outcome = executeSearch(request as never, big, bound);
    expect(outcome.searched && outcome.entries.length).toBe(MAX_SEARCH_RESULTS);
    expect(outcome.searched && outcome.resultCode).toBe(RESULT.SIZE_LIMIT_EXCEEDED);
  });

  it("cannot be used to confirm a withheld attribute", () => {
    const request = decodeRequest(searchRequest(1, BASE, SCOPE.SUBTREE, presentFilter("sponsorPrincipalId")));
    const outcome = executeSearch(request as never, projection, bound);
    expect(outcome.searched && outcome.entries).toEqual([]);
  });
});

describe("handleMessage — the read-only contract", () => {
  const options = {
    loadProjection: async () => projection,
    verifyBind: vi.fn(async ({ password }: { password: string }) =>
      password === "right" ? { bound: true, principalId: "prn-h" } : { bound: false, reason: "invalid credentials" },
    ),
  };

  it("binds, then permits a search that was refused before the bind", async () => {
    const session = { boundDn: null as string | null, principalId: null as string | null };
    const before = await handleMessage(
      searchRequest(1, BASE, SCOPE.SUBTREE, presentFilter("objectClass")), session, options, null,
    );
    expect(before.response!.includes(Buffer.from([RESULT.INSUFFICIENT_ACCESS]))).toBe(true);

    await handleMessage(bindRequest(2, `uid=prn-h,ou=people,${BASE}`, "right"), session, options, null);
    expect(session.boundDn).toBe(`uid=prn-h,ou=people,${BASE}`);

    const after = await handleMessage(
      searchRequest(3, BASE, SCOPE.SUBTREE, presentFilter("objectClass")), session, options, null,
    );
    expect(after.response!.length).toBeGreaterThan(before.response!.length);
  });

  it("clears the session on a failed bind so a bad password cannot inherit a prior bind", async () => {
    const session = { boundDn: "stale" as string | null, principalId: "stale" as string | null };
    await handleMessage(bindRequest(1, "uid=x,dc=a", "wrong"), session, options, null);
    expect(session.boundDn).toBeNull();
  });

  it("refuses LDAPv2", async () => {
    const session = { boundDn: null, principalId: null };
    const out = await handleMessage(bindRequest(1, "uid=x,dc=a", "right", 2), session, options, null);
    expect(out.response!.includes(Buffer.from([RESULT.PROTOCOL_ERROR]))).toBe(true);
  });

  it("refuses a write operation rather than ignoring it", async () => {
    const session = { boundDn: `uid=prn-h,ou=people,${BASE}`, principalId: "prn-h" };
    const addRequest = berSequence(berInteger(1), berElement(0x68, Buffer.alloc(0)));
    const out = await handleMessage(addRequest, session, options, null);
    expect(out.response!.includes(Buffer.from([RESULT.UNWILLING_TO_PERFORM]))).toBe(true);
  });

  it("closes on unbind and on a malformed PDU", async () => {
    const session = { boundDn: null, principalId: null };
    const unbind = berSequence(berInteger(1), berElement(APP.UNBIND_REQUEST, Buffer.alloc(0)));
    expect((await handleMessage(unbind, session, options, null)).close).toBe(true);
    expect((await handleMessage(Buffer.from([0x30, 0x02, 0xff]), session, options, null)).close).toBe(true);
  });
});

describe("TLS material — no self-signed fallback", () => {
  it("refuses to start when the org PKI paths are unset", () => {
    expect(() => loadLdapTlsMaterial({}, () => Buffer.alloc(0))).toThrow(/organization PKI/i);
  });

  it("loads the org key, cert and CA when configured", () => {
    const material = loadLdapTlsMaterial(
      { keyPath: "/k", certPath: "/c", caPath: "/ca" },
      (path) => Buffer.from(path),
    );
    expect(material.ca.toString()).toBe("/ca");
  });
});

describe("bind verification resolves through the spine", () => {
  const HUMAN = {
    principalId: "prn-h", kind: "human", status: "active",
    aliases: [{ aliasType: "user", aliasValue: "user-1" }],
  };
  const makeDb = (principal: unknown) => ({
    principal: { findUnique: vi.fn(async () => principal) },
    principalAlias: { findFirst: vi.fn() },
    user: { findUnique: vi.fn(async () => ({ id: "user-1", passwordHash: "hash" })) },
  });

  it("parses the principal out of a bind DN, unescaping RFC 4514", () => {
    expect(principalIdFromBindDn("uid=prn-h,ou=people,dc=acme,dc=com")).toBe("prn-h");
    expect(principalIdFromBindDn("uid=browser-svc\\:x,ou=services,dc=a")).toBe("browser-svc:x");
    expect(principalIdFromBindDn("cn=nope,dc=a")).toBeNull();
  });

  it("accepts a human password bind that the spine also authorizes", async () => {
    const db = makeDb(HUMAN);
    const verifier = createBindVerifier(db as never, {
      verify: (async () => ({ valid: true, needsRehash: false })) as never,
      authorize: (async () => ({ authorized: true, principalId: "prn-h" })) as never,
    });
    await expect(
      verifier({ bindDn: "uid=prn-h,ou=people,dc=a", password: "pw", clientCertificateSubject: null }),
    ).resolves.toMatchObject({ bound: true, principalId: "prn-h" });
  });

  it("refuses when the credential is right but the SPINE says no", async () => {
    const db = makeDb(HUMAN);
    const verifier = createBindVerifier(db as never, {
      verify: (async () => ({ valid: true, needsRehash: false })) as never,
      authorize: (async () => ({ authorized: false, reason: "principal-inactive", detail: "" })) as never,
    });
    await expect(
      verifier({ bindDn: "uid=prn-h,ou=people,dc=a", password: "pw", clientCertificateSubject: null }),
    ).resolves.toMatchObject({ bound: false });
  });

  it("refuses an inactive principal before touching the credential", async () => {
    const db = makeDb({ ...HUMAN, status: "inactive" });
    const verify = vi.fn();
    const verifier = createBindVerifier(db as never, { verify: verify as never });
    await expect(
      verifier({ bindDn: "uid=prn-h,ou=people,dc=a", password: "pw", clientCertificateSubject: null }),
    ).resolves.toMatchObject({ bound: false });
    expect(verify).not.toHaveBeenCalled();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("refuses a password bind for a non-human principal — they have no password by design", async () => {
    const db = makeDb({ principalId: "svc", kind: "service", status: "active", aliases: [] });
    const verifier = createBindVerifier(db as never);
    await expect(
      verifier({ bindDn: "uid=svc,ou=services,dc=a", password: "pw", clientCertificateSubject: null }),
    ).resolves.toMatchObject({ bound: false, reason: expect.stringMatching(/client certificate/i) });
  });

  it("accepts an mTLS bind whose certificate names the same principal, and rejects a mismatch", async () => {
    const db = makeDb({ principalId: "svc", kind: "service", status: "active", aliases: [] });
    const verifier = createBindVerifier(db as never);
    await expect(
      verifier({ bindDn: "uid=svc,ou=services,dc=a", password: "", clientCertificateSubject: "svc" }),
    ).resolves.toMatchObject({ bound: true, principalId: "svc" });
    await expect(
      verifier({ bindDn: "uid=svc,ou=services,dc=a", password: "", clientCertificateSubject: "other" }),
    ).resolves.toMatchObject({ bound: false });
  });
});
