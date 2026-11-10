// The Edge Node carries a runtime copy of the federation discovery contract
// because `@dpf/validators` cannot be require()d from the shipped container
// (see src/lib/federation-contract.ts for why). Two copies of a rule that
// decides what the scanner DIALS and what the Authority ACCEPTS is a drift
// hazard: if they disagree, the scanner either skips peers the Authority would
// have taken, or submits batches it rejects wholesale — losing the good
// candidates in them too.
//
// So the agreement is asserted, not assumed. This test imports BOTH and runs
// them over one corpus. It runs under vitest, which compiles TypeScript, so it
// can import the canonical package that the container cannot.

import { describe, expect, it } from "vitest";

import * as canonical from "@dpf/validators";
import * as local from "../lib/federation-contract";

const ENDPOINTS = [
  "http://192.168.1.43:3000",
  "https://10.0.0.2",
  "https://172.16.4.4:3000",
  "https://172.32.0.1",
  "http://dpf-node.local:3000",
  "https://[fe90::2]:3443",
  "https://[fd12::2]:3443",
  "https://[::1]",
  "http://169.254.10.9",
  "https://peer.example.com",
  "https://user:pass@10.0.0.2",
  "https://10.0.0.2/path?q=1",
  "https://10.0.0.2#frag",
  "ftp://10.0.0.2",
  "http://8.8.8.8",
  "not-a-url",
  "",
];

const ADVERTISEMENTS: unknown[] = [
  { protocol: "1", install: "yM4sS9VcH0rW2nQ8", caps: "8f31c9a2", pair: "/connect/pair" },
  {
    protocol: "1",
    install: "yM4sS9VcH0rW2nQ8",
    caps: "8f31c9a2",
    pair: "/connect/pair",
    organization: "North Wind",
  },
  { protocol: "2", install: "yM4sS9VcH0rW2nQ8", caps: "8f31c9a2", pair: "/connect/pair" },
  { protocol: "1", install: "tooshort", caps: "8f31c9a2", pair: "/connect/pair" },
  { protocol: "1", install: "yM4sS9VcH0rW2nQ8", caps: "ZZZZZZZZ", pair: "/connect/pair" },
  { protocol: "1", install: "yM4sS9VcH0rW2nQ8", caps: "8f31c9a2", pair: "/pair" },
  // An extra key must be refused by both: the field set IS the privacy boundary.
  {
    protocol: "1",
    install: "yM4sS9VcH0rW2nQ8",
    caps: "8f31c9a2",
    pair: "/connect/pair",
    hostname: "peer-01",
  },
  { hello: "world" },
  null,
  42,
];

describe("edge-node federation contract parity with @dpf/validators", () => {
  it("agrees on which endpoints are in scope", () => {
    for (const endpoint of ENDPOINTS) {
      expect([endpoint, local.isFederationScopedEndpoint(endpoint)]).toEqual([
        endpoint,
        canonical.isFederationScopedEndpoint(endpoint),
      ]);
    }
  });

  it("agrees on which advertisements are well formed", () => {
    for (const advertisement of ADVERTISEMENTS) {
      const mine = local.federationAdvertisementSchema.safeParse(advertisement);
      const theirs = canonical.federationAdvertisementSchema.safeParse(advertisement);
      expect([advertisement, mine.success]).toEqual([advertisement, theirs.success]);
      if (mine.success && theirs.success) expect(mine.data).toEqual(theirs.data);
    }
  });

  it("agrees on the candidate a descriptor produces for an origin", () => {
    const advertisement = {
      protocol: "1" as const,
      install: "yM4sS9VcH0rW2nQ8",
      caps: "8f31c9a2",
      pair: "/connect/pair" as const,
      organization: "North Wind",
    };
    for (const endpoint of ENDPOINTS) {
      expect([endpoint, local.candidateFromAdvertisement(advertisement, endpoint)]).toEqual([
        endpoint,
        canonical.candidateFromAdvertisement(advertisement, endpoint),
      ]);
    }
  });

  it("agrees on the constants the wire format is built from", () => {
    expect(local.FEDERATION_PROTOCOL_VERSION).toBe(canonical.FEDERATION_PROTOCOL_VERSION);
    expect(local.FEDERATION_PAIR_PATH).toBe(canonical.FEDERATION_PAIR_PATH);
    expect(local.FEDERATION_ADVERTISEMENT_PATH).toBe(canonical.FEDERATION_ADVERTISEMENT_PATH);
    expect(local.FEDERATION_CAPABILITY_VERSION).toBe(canonical.FEDERATION_CAPABILITY_VERSION);
    expect(local.FEDERATION_CANDIDATE_SNAPSHOT_MAX).toBe(
      canonical.FEDERATION_CANDIDATE_SNAPSHOT_MAX,
    );
  });
});

describe("the shipped Edge Node never require()s @dpf/validators", () => {
  it("keeps every remaining validators import type-only", async () => {
    // The container cannot type-strip that package from node_modules, so a value
    // import crashes it at module load. Tests are exempt: vitest compiles them
    // and they never ship inside the image.
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    // Resolve from THIS file, never process.cwd(): vitest may run with
    // `--root <package>`, which points the cwd outside the repository.
    // `__dirname` rather than `import.meta`: this package compiles to CommonJS.
    const srcDir = join(__dirname, "..");
    const offenders: string[] = [];

    // `withFileTypes` rather than a separate statSync: one readdir answers both
    // "what is it" and "what is it called", so there is no window between the
    // check and the read for the entry to change (CodeQL js/file-system-race).
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__") walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        for (const line of readFileSync(full, "utf8").split("\n")) {
          if (!line.includes('from "@dpf/validators"')) continue;
          if (!/^\s*import\s+type\s/.test(line)) offenders.push(`${full}: ${line.trim()}`);
        }
      }
    };
    walk(srcDir);

    expect(offenders).toEqual([]);
  });
});
