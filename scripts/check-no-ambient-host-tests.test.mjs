// Self-test for the ambient-host-state guard (BI-95A83B47).
//
// The guard's value depends on two properties that are easy to lose in a later
// edit: it must catch the shapes that actually escaped (BI-EFA383AA host-memory
// probe, BI-BFDCE0A9 ambient Postgres), and it must NOT fire on the house
// idioms that make those same dependencies hermetic — injected seams, mocked
// probe modules, and self-gating skips. Both directions are pinned here.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  findAmbientHostMarkers,
  findDuplicateBaselinePaths,
  isInScope,
  parseBaseline,
} from "./check-no-ambient-host-tests.mjs";

// --- red cases: the shapes that escaped -------------------------------------

test("flags a direct PrismaClient construction with no gating (BI-BFDCE0A9 shape)", () => {
  const src = `
    import { PrismaClient } from "@prisma/client";
    const prisma = new PrismaClient();
    it("reads rows", async () => { await prisma.epic.findMany(); });
  `;
  const findings = findAmbientHostMarkers(src);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, "db-client");
});

test("flags a hardcoded connection-string fallback", () => {
  // The exact escape: green in CI where Postgres listens, red in the DB-less
  // local gate — because the test connects to a guessed localhost URL.
  const src = `
    const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://dpf:dpf_dev@localhost:15432/dpf";
    it("migrates", async () => { await connect(DATABASE_URL); });
  `;
  const findings = findAmbientHostMarkers(src);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, "db-url");
});

test("flags a real os.freemem() call and names the injectable seam (BI-EFA383AA shape)", () => {
  const src = `
    import { freemem } from "node:os";
    it("defers under pressure", async () => {
      const available = freemem();
      expect(decide(available)).toBe("defer");
    });
  `;
  const findings = findAmbientHostMarkers(src);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, "host-probe");
  // The violation message must point at the seam the BI-EFA383AA fix added.
  assert.match(findings[0].fix, /readMeminfo|osFreeMemoryBytes/);
  assert.match(findings[0].fix, /host-memory-preflight/);
});

test("flags shelling out to docker from a unit test", () => {
  const src = `it("boots", () => { execSync("docker compose up -d db"); });`;
  const findings = findAmbientHostMarkers(src);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, "host-exec");
});

// --- green cases: the hermetic equivalents ----------------------------------

test("stays silent when the memory probe is fed through the injected seam", () => {
  // The injected-seam equivalent of the red case above — the actual shape of
  // apps/web/lib/self-upgrade/host-memory-preflight.test.ts after the fix.
  const src = `
    it("prefers /proc/meminfo MemAvailable over os.freemem()", async () => {
      const reading = await readHostAvailableMemory({
        readMeminfo: async () => meminfo({ memAvailableKb: 16000000 }),
        osFreeMemoryBytes: () => 999 * GiB,
      });
      expect(reading.source).toBe("meminfo");
    });
  `;
  assert.deepEqual(findAmbientHostMarkers(src), []);
});

test("stays silent when the probe module is mocked (the BI-EFA383AA fix itself)", () => {
  const src = `
    vi.mock("@/lib/self-upgrade/host-memory-preflight", async (importOriginal) => ({
      ...(await importOriginal()),
      evaluateHostMemoryGuard: mocks.evaluateHostMemoryGuard,
    }));
    it("skips the build", async () => { expect(freemem()).toBeUndefined(); });
  `;
  assert.deepEqual(findAmbientHostMarkers(src), []);
});

test("dep-property injection is not a probe call", () => {
  // packages/db/src/discovery-runner.test.ts passes totalmem as an injected
  // dependency; property syntax must never read as an ambient call.
  const src = `runDiscovery({ os: { totalmem: () => 1024 } });`;
  assert.deepEqual(findAmbientHostMarkers(src), []);
});

test("stays silent on the house DB-gating idioms", () => {
  const skipIf = `
    describe.skipIf(!process.env.DATABASE_URL)("persistence", () => {
      const prisma = new PrismaClient();
      it("writes", async () => { await prisma.$connect(); });
    });
  `;
  assert.deepEqual(findAmbientHostMarkers(skipIf), []);

  const describeDatabase = `
    const databaseUrl = process.env.DATABASE_URL;
    const describeDatabase = databaseUrl ? describe : describe.skip;
    describeDatabase("migration", () => { const prisma = new PrismaClient(); });
  `;
  assert.deepEqual(findAmbientHostMarkers(describeDatabase), []);

  const reachabilityProbe = `
    const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://dpf:dpf_dev@localhost:15432/dpf";
    it("repairs", async (ctx) => { if (!reachable) ctx.skip(); });
  `;
  assert.deepEqual(findAmbientHostMarkers(reachabilityProbe), []);
});

test("stays silent when child_process is mocked", () => {
  const src = `
    vi.mock("node:child_process");
    it("invokes docker", () => { execSync("docker ps"); });
  `;
  assert.deepEqual(findAmbientHostMarkers(src), []);
});

test("respects an explicit exemption marker, inline or preceding", () => {
  const inline = `const c = new PrismaClient(); // ambient-host-guard: allow dedicated DB-tier suite`;
  assert.deepEqual(findAmbientHostMarkers(inline), []);

  const preceding = `
    // ambient-host-guard: allow deliberate host smoke probe
    const available = freemem();
  `;
  assert.deepEqual(findAmbientHostMarkers(preceding), []);
});

test("comment lines never count as markers", () => {
  const src = `// BI-EFA383AA: override the guard (real impl reads os.freemem())`;
  assert.deepEqual(findAmbientHostMarkers(src), []);
});

// --- baseline mechanics (module-size idiom) ---------------------------------

test("parseBaseline keeps the smaller count on union-merge duplicates", () => {
  const text = "# owner: x\n# expiry: 2099-01-01\na.test.ts\t3\na.test.ts\t5\nb.test.ts\t1\n";
  assert.deepEqual(parseBaseline(text), { "a.test.ts": 3, "b.test.ts": 1 });
});

test("findDuplicateBaselinePaths reports each duplicated path once", () => {
  const text = "a.test.ts\t3\na.test.ts\t5\nb.test.ts\t1\n";
  assert.deepEqual(findDuplicateBaselinePaths(text), ["a.test.ts"]);
});

// --- scope ------------------------------------------------------------------

test("guard self-tests are out of scope (they hold red-case fixtures by design)", () => {
  assert.equal(isInScope("scripts/check-no-ambient-host-tests.test.mjs"), false);
  assert.equal(isInScope("scripts/check-test-clock-bombs.test.mjs"), false);
  assert.equal(isInScope("scripts/self-upgrade-sensitive-paths.test.mjs"), true);
  assert.equal(isInScope("apps/web/lib/queue/functions/self-upgrade.test.ts"), true);
  assert.equal(isInScope("packages/db/src/discovery-sync.postgres.test.ts"), true);
  assert.equal(isInScope("apps/web/lib/foo/bar.ts"), false);
});
