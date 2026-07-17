import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  buildStaticRatchetMetrics,
  compareRatchetMetrics,
  enumerateExternalRuntimes,
  collectRepositoryMeasurements,
  parseComposeServices,
  stableSerialize,
  SUPPORTED_MANIFEST_VERSION,
  validateSubstrateManifest,
} from "./platform-substrate-measurements.mjs";

const ratchetMeasurements = {
  services: { total: 10, defaultRequired: 3, byClass: {} },
  prismaModelCount: 20,
  directInngestImports: ["one", "two"],
  integrationConnectRoutes: ["one", "two", "three"],
  providerConnectionStateProjectors: ["one"],
  productionModulesAboveSoftCeiling: [{ path: "large.ts", lines: 900 }],
  lineCounts: { prismaSchema: 100, seedCoordinator: 50 },
};

test("every static metric declares an explicit ratchet direction", () => {
  const metrics = buildStaticRatchetMetrics(ratchetMeasurements);
  assert.deepEqual(
    Object.fromEntries(Object.entries(metrics).map(([name, metric]) => [name, metric.direction])),
    {
      defaultRequiredServiceCount: "non-increasing",
      directInngestImportCount: "non-increasing",
      integrationConnectRouteCount: "non-increasing",
      prismaModelCount: "non-increasing",
      prismaSchemaLines: "informational",
      productionModuleHotspotCount: "non-increasing",
      providerConnectionStateProjectorCount: "non-increasing",
      seedCoordinatorLines: "informational",
      serviceCount: "non-increasing",
    },
  );
});

test("non-increasing metrics fail above baseline, pass unchanged, and advise when improved", () => {
  const baseline = buildStaticRatchetMetrics(ratchetMeasurements);
  for (const name of [
    "serviceCount",
    "defaultRequiredServiceCount",
    "directInngestImportCount",
    "integrationConnectRouteCount",
    "providerConnectionStateProjectorCount",
    "prismaModelCount",
    "productionModuleHotspotCount",
  ]) {
    const increased = structuredClone(baseline);
    increased[name].value += 1;
    const regression = compareRatchetMetrics({ baseline, current: increased });
    assert.equal(regression.passed, false, `${name} increase must fail`);
    assert.deepEqual(regression.regressions.map(({ metric }) => metric), [name]);

    const unchanged = compareRatchetMetrics({ baseline, current: structuredClone(baseline) });
    assert.equal(unchanged.passed, true, `${name} unchanged must pass`);
    assert.deepEqual(unchanged.regressions, []);

    const decreased = structuredClone(baseline);
    decreased[name].value -= 1;
    const improvement = compareRatchetMetrics({ baseline, current: decreased });
    assert.equal(improvement.passed, true, `${name} decrease must pass`);
    assert.deepEqual(improvement.advisories.map(({ metric }) => metric), [name]);
  }
});

test("informational metrics never fail or create stale-baseline advisories", () => {
  const baseline = buildStaticRatchetMetrics(ratchetMeasurements);
  for (const name of ["prismaSchemaLines", "seedCoordinatorLines"]) {
    for (const delta of [-1, 0, 1]) {
      const current = structuredClone(baseline);
      current[name].value += delta;
      const comparison = compareRatchetMetrics({ baseline, current });
      assert.equal(comparison.passed, true);
      assert.deepEqual(comparison.regressions, []);
      assert.deepEqual(comparison.advisories, []);
    }
  }
});

test("comparison rejects missing or unsupported explicit baseline directions", () => {
  const current = { serviceCount: { value: 10, direction: "non-increasing" } };
  assert.throws(
    () => compareRatchetMetrics({ baseline: { serviceCount: { value: 10 } }, current }),
    /serviceCount.*direction/i,
  );
  assert.throws(
    () => compareRatchetMetrics({ baseline: { serviceCount: { value: 10, direction: "decreasing" } }, current }),
    /serviceCount.*direction/i,
  );
});

test("comparison follows declared policy rather than inferring it from metric names", () => {
  const comparison = compareRatchetMetrics({
    baseline: {
      serviceCount: { value: 1, direction: "informational" },
      harmlessLabel: { value: 1, direction: "non-increasing" },
    },
    current: {
      serviceCount: { value: 999, direction: "informational" },
      harmlessLabel: { value: 2, direction: "non-increasing" },
    },
  });
  assert.equal(comparison.passed, false);
  assert.deepEqual(comparison.regressions.map(({ metric }) => metric), ["harmlessLabel"]);
});

test("comparison fails closed for empty metric inventories", () => {
  assert.throws(
    () => compareRatchetMetrics({ baseline: {}, current: {} }),
    /non-empty/i,
  );
});

test("comparison rejects canonical metrics omitted from the baseline", () => {
  const current = buildStaticRatchetMetrics(ratchetMeasurements);
  const baseline = structuredClone(current);
  delete baseline.serviceCount;
  assert.throws(
    () => compareRatchetMetrics({ baseline, current }),
    /metric inventories.*serviceCount/i,
  );
});

test("comparison rejects newly introduced current metrics absent from the baseline", () => {
  const baseline = buildStaticRatchetMetrics(ratchetMeasurements);
  const current = {
    ...structuredClone(baseline),
    newlyMeasuredMovingPart: { value: 1, direction: "non-increasing" },
  };
  assert.throws(
    () => compareRatchetMetrics({ baseline, current }),
    /metric inventories.*newlyMeasuredMovingPart/i,
  );
});

test("comparison rejects current metrics missing from the measured result", () => {
  const baseline = buildStaticRatchetMetrics(ratchetMeasurements);
  const current = structuredClone(baseline);
  delete current.prismaModelCount;
  assert.throws(
    () => compareRatchetMetrics({ baseline, current }),
    /metric inventories.*prismaModelCount/i,
  );
});

async function withFixture(files, run) {
  const root = await mkdtemp(join(tmpdir(), "substrate-measurements-"));
  try {
    for (const [path, content] of Object.entries(files)) {
      const target = join(root, ...path.split("/"));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const measurementManifest = {
  services: [
    { service: "portal", class: "universal-core", defaultRequired: true },
    { service: "worker", class: "capability-activated", defaultRequired: false },
    { service: "postgres", class: "universal-core", defaultRequired: true },
  ],
};

const measurementFiles = {
  "packages/db/prisma/schema.prisma": "model User {\n  id String @id\n}\n\nmodel Team {\n  id String @id\n}\n",
  "packages/db/src/seed.ts": "export async function seed() {\n  return true;\n}\n",
  "apps/web/lib/domain/publish.ts": 'import { inngest } from "@/lib/queue/inngest-client";\n',
  "apps/web/lib/domain/multiline.ts": 'import {\n  inngest\n} from "@/lib/queue/inngest-client";\n',
  "apps/web/lib/domain/reexport.ts": 'export { inngest } from "@/lib/queue/inngest-client";\n',
  "apps/web/lib/domain/near-miss.ts": 'import { retention } from "@/lib/operate/inngest-retention/constants";\n',
  "apps/web/lib/execution/adapters/inngest.ts": 'import { Inngest } from "inngest";\n',
  "apps/web/app/api/inngest/route.ts": 'import { serve } from "inngest/next";\n',
  "apps/web/app/api/integrations/slack/connect/route.ts": "export function GET() {}\n",
  "apps/web/app/api/integrations/microsoft/teams/connect/route.ts": "export function GET() {}\n",
  "apps/web/app/api/integrations/github/callback/route.ts": "export function GET() {}\n",
  "apps/web/lib/integrate/slack/connection-state.ts": "export const state = {};\n",
  "apps/web/lib/domain/large.ts": `${Array.from({ length: 801 }, (_, index) => `export const n${index} = ${index};`).join("\n")}\n`,
  "apps/web/lib/domain/small.ts": "export const small = true;\n",
  "apps/web/lib/domain/large.test.ts": `${"test();\n".repeat(900)}`,
  "apps/web/lib/domain/__snapshots__/large.ts": `${"snapshot();\n".repeat(900)}`,
  "scripts/check-module-size.mjs": "const SOFT_CEILING = 800;\n",
  "assets/binary.dat": Buffer.from([0, 255, 0, 255]),
};

test("collects deterministic repository complexity measurements", async () => {
  await withFixture(measurementFiles, async (repoRoot) => {
    const inputs = {
      repoRoot,
      manifest: measurementManifest,
      generatedAt: "2026-07-17T00:00:00.000Z",
      gitSha: "abc123",
    };
    const first = await collectRepositoryMeasurements(inputs);
    const second = await collectRepositoryMeasurements({
      ...inputs,
      generatedAt: "2026-07-17T00:01:00.000Z",
      gitSha: "def456",
    });

    assert.deepEqual(first.services, {
      total: 3,
      defaultRequired: 2,
      byClass: { "capability-activated": 1, "universal-core": 2 },
    });
    assert.equal(first.prismaModelCount, 2);
    assert.deepEqual(first.directInngestImports, [
      "apps/web/lib/domain/multiline.ts",
      "apps/web/lib/domain/publish.ts",
      "apps/web/lib/domain/reexport.ts",
    ]);
    assert.deepEqual(first.integrationConnectRoutes, [
      "apps/web/app/api/integrations/microsoft/teams/connect/route.ts",
      "apps/web/app/api/integrations/slack/connect/route.ts",
    ]);
    assert.deepEqual(first.providerConnectionStateProjectors, ["apps/web/lib/integrate/slack/connection-state.ts"]);
    assert.deepEqual(first.productionModulesAboveSoftCeiling, [
      { lines: 901, path: "apps/web/lib/domain/large.test.ts" },
      { lines: 802, path: "apps/web/lib/domain/large.ts" },
    ]);
    assert.deepEqual(first.lineCounts, { prismaSchema: 8, seedCoordinator: 4 });

    const withoutProvenance = ({ generatedAt: _generatedAt, gitSha: _gitSha, ...value }) => value;
    assert.equal(
      stableSerialize(withoutProvenance(first)),
      stableSerialize(withoutProvenance(second)),
    );
  });
});

test("requires the canonical schema and seed coordinator", async () => {
  await withFixture({ "scripts/check-module-size.mjs": "const SOFT_CEILING = 800;\n" }, async (repoRoot) => {
    await assert.rejects(
      collectRepositoryMeasurements({ repoRoot, manifest: measurementManifest }),
      /packages\/db\/prisma\/schema\.prisma/,
    );
  });
  await withFixture({
    "scripts/check-module-size.mjs": "const SOFT_CEILING = 800;\n",
    "packages/db/prisma/schema.prisma": "model User { id String @id }\n",
  }, async (repoRoot) => {
    await assert.rejects(
      collectRepositoryMeasurements({ repoRoot, manifest: measurementManifest }),
      /packages\/db\/src\/seed\.ts/,
    );
  });
});

const validService = {
  service: "portal",
  class: "universal-core",
  capability: "portal",
  boundaryReason: "Canonical application and API runtime.",
  defaultRequired: true,
  profiles: [],
  ports: ["3000:3000"],
  volumes: ["pgdata:/data"],
  dependsOn: ["postgres"],
  canonicalDataOwner: "postgres",
  backupPolicy: "included",
  healthSemantics: "compose-healthcheck",
  hostPlatforms: ["windows", "macos", "linux"],
  targetClassification: "universal-core",
};

const compose = `services:\n  portal:\n    ports:\n      - "3000:3000"\n    volumes:\n      - pgdata:/data\n    depends_on:\n      postgres:\n        condition: service_healthy\n`;

const manifest = (overrides = {}) => ({
  version: 1,
  services: [{ ...validService }],
  externalRuntimes: [],
  ...overrides,
});

function errorsFor(candidate, inputs = {}) {
  return validateSubstrateManifest(candidate, {
    composeText: compose,
    providers: [],
    ...inputs,
  });
}

test("rejects duplicate service records", () => {
  assert.match(errorsFor(manifest({ services: [validService, validService] })).join("\n"), /duplicate service.*portal/i);
});

test("requires the single supported positive integer manifest version", () => {
  assert.equal(SUPPORTED_MANIFEST_VERSION, 1);
  for (const version of [undefined, 0, 1.5, 2]) {
    const candidate = manifest();
    if (version === undefined) delete candidate.version;
    else candidate.version = version;
    assert.match(errorsFor(candidate).join("\n"), /manifest version/i);
  }
});

test("rejects an unknown substrate class", () => {
  const candidate = manifest();
  candidate.services[0].class = "mystery";
  assert.match(errorsFor(candidate).join("\n"), /unknown class.*mystery/i);
});

test("requires a boundary reason for specialist services", () => {
  const candidate = manifest();
  candidate.services[0].class = "capability-activated";
  candidate.services[0].boundaryReason = "";
  assert.match(errorsFor(candidate).join("\n"), /portal.*boundaryReason/i);
});

test("rejects Compose services absent from the manifest", () => {
  assert.match(errorsFor(manifest({ services: [] })).join("\n"), /Compose service.*portal.*absent/i);
});

for (const [field, badValue, expected] of [
  ["profiles", ["dev"], /portal.*profiles/i],
  ["ports", [], /portal.*ports/i],
  ["volumes", [], /portal.*volumes/i],
  ["dependsOn", [], /portal.*dependsOn/i],
  ["canonicalDataOwner", "", /portal.*canonicalDataOwner/i],
  ["backupPolicy", "", /portal.*backupPolicy/i],
  ["healthSemantics", "", /portal.*healthSemantics/i],
  ["hostPlatforms", [], /portal.*hostPlatforms/i],
  ["targetClassification", "", /portal.*targetClassification/i],
]) {
  test(`rejects missing or incorrect ${field}`, () => {
    const candidate = manifest();
    candidate.services[0][field] = badValue;
    assert.match(errorsFor(candidate).join("\n"), expected);
  });
}

test("requires every configured provider and declared Compose AI runtime", () => {
  const providers = [{ providerId: "openai" }, { providerId: "local", baseUrl: "http://model-runner.docker.internal/v1" }];
  const errors = errorsFor(manifest(), {
    providers,
    composeText: `${compose}    environment:\n      LLM_BASE_URL: \${LLM_BASE_URL:-http://model-runner.docker.internal/v1}\n`,
  });
  assert.match(errors.join("\n"), /external runtime.*openai/i);
  assert.match(errors.join("\n"), /external runtime.*local/i);
  assert.match(errors.join("\n"), /external runtime.*model-runner/i);
});

test("rejects non-empty invalid metadata values", () => {
  for (const [field, value] of [
    ["canonicalDataOwner", "nobody"],
    ["backupPolicy", "toaster"],
    ["healthSemantics", "mystery"],
    ["hostPlatforms", ["plan9"]],
    ["targetClassification", "mystery"],
  ]) {
    const candidate = manifest();
    candidate.services[0][field] = value;
    assert.match(errorsFor(candidate).join("\n"), new RegExp(`portal.*${field}`, "i"));
  }
});

test("rejects external runtime records absent from provider and Compose inventories", () => {
  const candidate = manifest({
    externalRuntimes: [{
      runtimeKey: "phantom",
      kind: "ai-runtime",
      activation: "provider-configuration",
      canonicalDataOwner: "postgres",
      healthSemantics: "provider-health-reconciliation",
      hostPlatforms: ["windows"],
      boundaryReason: "External inference boundary.",
    }],
  });
  assert.match(errorsFor(candidate).join("\n"), /manifest external runtime.*phantom.*absent/i);
});

test("rejects invalid non-empty external runtime kind and activation values", () => {
  const runtime = {
    runtimeKey: "openai",
    kind: "ai-runtime",
    activation: "provider-configuration",
    canonicalDataOwner: "postgres",
    healthSemantics: "provider-health-reconciliation",
    hostPlatforms: ["windows"],
    boundaryReason: "External inference boundary.",
  };
  for (const [field, value] of [["kind", "toaster"], ["activation", "mystery"]]) {
    const candidate = manifest({ externalRuntimes: [{ ...runtime, [field]: value }] });
    assert.match(errorsFor(candidate, { providers: [{ providerId: "openai" }] }).join("\n"), new RegExp(`openai.*${field}`, "i"));
  }
});

test("Compose comments do not declare external runtimes", () => {
  assert.deepEqual(enumerateExternalRuntimes({
    providers: [],
    composeText: "services:\n  portal:\n    # http://model-runner.docker.internal/v1\n    image: portal\n",
  }), []);
});

test("structurally parses supported Compose runtime environment declarations", () => {
  assert.deepEqual(enumerateExternalRuntimes({
    providers: [],
    composeText: "services:\n  portal:\n    environment:\n      LLM_BASE_URL: ${LLM_BASE_URL:-http://model-runner.docker.internal/v1}\n",
  }), ["model-runner.docker.internal"]);
});

test("fails clearly for unsupported configured runtime declaration forms", () => {
  assert.throws(() => enumerateExternalRuntimes({
    providers: [],
    composeText: "services:\n  portal:\n    environment: { LLM_BASE_URL: http://model-runner.docker.internal/v1 }\n",
  }), /unsupported Compose portal\.environment/i);
});

test("fails clearly on unsupported Compose service structure", () => {
  assert.throws(() => parseComposeServices("services:\n  portal: []\n"), /unsupported Compose service structure.*portal/i);
});

test("the checked-in manifest validates against docker-compose.yml and provider inventory", async () => {
  const [composeText, manifestText, providersText] = await Promise.all([
    readFile(new URL("../../docker-compose.yml", import.meta.url), "utf8"),
    readFile(new URL("../platform-substrate-manifest.json", import.meta.url), "utf8"),
    readFile(new URL("../../packages/db/data/providers-registry.json", import.meta.url), "utf8"),
  ]);
  assert.deepEqual(
    validateSubstrateManifest(JSON.parse(manifestText), {
      composeText,
      providers: JSON.parse(providersText),
    }),
    [],
  );
});

test("checked-in stateful and stateless records describe truthful ownership, backup, and health semantics", async () => {
  const checkedIn = JSON.parse(await readFile(new URL("../platform-substrate-manifest.json", import.meta.url), "utf8"));
  const byService = new Map(checkedIn.services.map((record) => [record.service, record]));
  assert.deepEqual(
    {
      owner: byService.get("postgres").canonicalDataOwner,
      backup: byService.get("postgres").backupPolicy,
      health: byService.get("postgres").healthSemantics,
    },
    { owner: "postgres", backup: "included", health: "compose-healthcheck" },
  );
  assert.deepEqual(
    {
      owner: byService.get("redis").canonicalDataOwner,
      backup: byService.get("redis").backupPolicy,
      health: byService.get("redis").healthSemantics,
    },
    { owner: "redis", backup: "separate-required", health: "compose-healthcheck" },
  );
  assert.deepEqual(
    {
      owner: byService.get("postgres-exporter").canonicalDataOwner,
      backup: byService.get("postgres-exporter").backupPolicy,
      health: byService.get("postgres-exporter").healthSemantics,
    },
    { owner: "none", backup: "excluded-stateless", health: "consumer-observed" },
  );
  assert.equal(byService.get("loki").canonicalDataOwner, "loki");
  assert.equal(byService.get("prometheus").canonicalDataOwner, "prometheus");
  assert.equal(byService.get("grafana").canonicalDataOwner, "grafana");
});

test("checked-in manifest uses deterministic two-space JSON formatting with a trailing LF", async () => {
  const text = await readFile(new URL("../platform-substrate-manifest.json", import.meta.url), "utf8");
  assert.equal(text, `${JSON.stringify(JSON.parse(text), null, 2)}\n`);
});
