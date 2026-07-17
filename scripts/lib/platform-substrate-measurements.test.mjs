import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  enumerateExternalRuntimes,
  parseComposeServices,
  SUPPORTED_MANIFEST_VERSION,
  validateSubstrateManifest,
} from "./platform-substrate-measurements.mjs";

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
