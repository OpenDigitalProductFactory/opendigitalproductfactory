import { isIP } from "node:net";

import { describe, expect, it } from "vitest";

import {
  FEDERATION_PAIR_PATH,
  FEDERATION_PROTOCOL_VERSION,
  candidateFromAdvertisement,
  federationAdvertisementSchema,
  federationCandidateSchema,
  federationCandidateSnapshotSchema,
  ipLiteralVersion,
  isFederationScopedEndpoint,
} from "./federation-discovery";

const advertisement = {
  protocol: FEDERATION_PROTOCOL_VERSION,
  install: "yM4sS9VcH0rW2nQ8",
  caps: "8f31c9a2",
  pair: FEDERATION_PAIR_PATH,
} as const;

// The scope rule used to depend on `node:net`. It cannot any more (the package
// barrel reaches a client component), so the equivalence is asserted here — the
// one place a `node:` import is free — rather than assumed.
const IP_CORPUS = [
  "10.0.0.2",
  "192.168.1.43",
  "172.16.0.1",
  "172.32.0.1",
  "169.254.10.9",
  "255.255.255.255",
  "0.0.0.0",
  "1.2.3.4",
  "01.2.3.4",
  "1.2.3.4.5",
  "1.2.3",
  "256.1.1.1",
  "1.2.3.-1",
  "",
  " 1.2.3.4",
  "::1",
  "::",
  "fe80::1",
  "fd12::2",
  "fe90::2",
  "2001:db8::1",
  "1:2:3:4:5:6:7:8",
  "1:2:3:4:5:6:7:8:9",
  "1::2::3",
  "1:2:3:4:5:6:7::",
  "1:2:3:4:5:6:7:8::",
  "::ffff:192.168.1.1",
  "::ffff:192.168.1.256",
  ":1:2",
  "12345::1",
  "gggg::1",
  "localhost",
  "dpf-node.local",
];

describe("ipLiteralVersion", () => {
  it("agrees with node:net isIP across the corpus", () => {
    for (const host of IP_CORPUS) {
      expect([host, ipLiteralVersion(host)]).toEqual([host, isIP(host)]);
    }
  });

  it("refuses a scoped-literal zone id, where it deliberately differs from isIP", () => {
    // `net.isIP` accepts `fe80::1%eth0`; a URL hostname never carries a bare
    // `%`, and the percent-encoded form a URL does carry (`%25eth0`) was
    // already refused before this rule moved here. Matching isIP would widen
    // the scope rule rather than preserve it.
    expect(isIP("fe80::1%eth0")).toBe(6);
    expect(ipLiteralVersion("fe80::1%eth0")).toBe(0);
    expect(isFederationScopedEndpoint("https://[fe80::1%25eth0]")).toBe(false);
  });
});

describe("isFederationScopedEndpoint", () => {
  it("accepts private, link-local and .local origins", () => {
    expect(isFederationScopedEndpoint("http://dpf-node.local:3000")).toBe(true);
    expect(isFederationScopedEndpoint("http://192.168.1.43:3000")).toBe(true);
    expect(isFederationScopedEndpoint("https://10.0.0.2")).toBe(true);
    expect(isFederationScopedEndpoint("https://172.16.4.4:3000")).toBe(true);
    expect(isFederationScopedEndpoint("https://[fe90::2]:3443")).toBe(true);
    expect(isFederationScopedEndpoint("https://[fd12::2]:3443")).toBe(true);
  });

  it("refuses routable hosts, credentials, and anything past the origin", () => {
    expect(isFederationScopedEndpoint("https://fcloud.example")).toBe(false);
    expect(isFederationScopedEndpoint("https://172.32.0.1")).toBe(false);
    expect(isFederationScopedEndpoint("https://user:pass@10.0.0.2")).toBe(false);
    expect(isFederationScopedEndpoint("https://10.0.0.2/path?q=1")).toBe(false);
    expect(isFederationScopedEndpoint("https://10.0.0.2#frag")).toBe(false);
    expect(isFederationScopedEndpoint("ftp://10.0.0.2")).toBe(false);
    expect(isFederationScopedEndpoint("not-a-url")).toBe(false);
  });
});

describe("federationAdvertisementSchema", () => {
  it("accepts the closed field set, with or without an organization", () => {
    expect(federationAdvertisementSchema.safeParse(advertisement).success).toBe(true);
    expect(
      federationAdvertisementSchema.safeParse({ ...advertisement, organization: "North Wind" })
        .success,
    ).toBe(true);
  });

  it("refuses an unexpected key rather than ignoring it", () => {
    const result = federationAdvertisementSchema.safeParse({
      ...advertisement,
      hostname: "peer-01",
    });
    expect(result.success).toBe(false);
  });

  it("refuses another protocol generation, a short id, and a non-hex digest", () => {
    expect(federationAdvertisementSchema.safeParse({ ...advertisement, protocol: "2" }).success)
      .toBe(false);
    expect(federationAdvertisementSchema.safeParse({ ...advertisement, install: "tooshort" }).success)
      .toBe(false);
    expect(federationAdvertisementSchema.safeParse({ ...advertisement, caps: "ZZZZZZZZ" }).success)
      .toBe(false);
    expect(federationAdvertisementSchema.safeParse({ ...advertisement, pair: "/pair" }).success)
      .toBe(false);
  });
});

describe("candidateFromAdvertisement", () => {
  it("binds the candidate to the origin the scanner dialled", () => {
    const candidate = candidateFromAdvertisement(advertisement, "http://192.168.1.43:3000");
    expect(candidate).toMatchObject({
      discoveryId: advertisement.install,
      endpoint: "http://192.168.1.43:3000",
      capabilityDigest: advertisement.caps,
      pairPath: FEDERATION_PAIR_PATH,
    });
    expect(candidate?.organizationRef).toBeUndefined();
  });

  it("carries an advertised organization through", () => {
    const candidate = candidateFromAdvertisement(
      { ...advertisement, organization: "North Wind" },
      "https://10.0.0.2",
    );
    expect(candidate?.organizationRef).toBe("North Wind");
  });

  it("returns null for an out-of-scope origin", () => {
    expect(candidateFromAdvertisement(advertisement, "https://peer.example.com")).toBeNull();
  });
});

describe("federationCandidateSnapshotSchema", () => {
  it("accepts a snapshot of scoped candidates", () => {
    const result = federationCandidateSnapshotSchema.safeParse({
      observedAt: "2026-08-28T12:00:00.000Z",
      candidates: [candidateFromAdvertisement(advertisement, "http://192.168.1.43:3000")],
    });
    expect(result.success).toBe(true);
  });

  it("refuses more than fifty candidates", () => {
    const one = candidateFromAdvertisement(advertisement, "http://192.168.1.43:3000");
    const result = federationCandidateSnapshotSchema.safeParse({
      observedAt: "2026-08-28T12:00:00.000Z",
      candidates: Array.from({ length: 51 }, () => one),
    });
    expect(result.success).toBe(false);
  });

  it("refuses an endpoint outside the local segment", () => {
    const result = federationCandidateSchema.safeParse({
      discoveryId: advertisement.install,
      endpoint: "https://peer.example.com",
      protocol: FEDERATION_PROTOCOL_VERSION,
      capabilityDigest: advertisement.caps,
      pairPath: FEDERATION_PAIR_PATH,
    });
    expect(result.success).toBe(false);
  });
});
