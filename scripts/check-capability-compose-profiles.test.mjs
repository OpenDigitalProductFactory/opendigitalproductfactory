import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  checkCapabilityComposeProfiles,
  loadCapabilityProfileFixture,
} from "./check-capability-compose-profiles.mjs";

test("rejects_default_started_optional_service", async () => {
  const compose = await readFile(new URL("../docker-compose.yml", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(new URL("./platform-substrate-manifest.json", import.meta.url), "utf8"));
  const optional = manifest.services.find((service) => service.capability === "runtime:build");
  const mutated = structuredClone(manifest);
  mutated.services.find((service) => service.service === optional.service).profiles = [];
  mutated.services.find((service) => service.service === optional.service).defaultRequired = true;

  const result = checkCapabilityComposeProfiles({ composeSource: compose, substrate: mutated });
  assert.ok(result.errors.includes(`default_started_optional_service:${optional.service}`));
});

test("resolves_each_fixture_dependency_closure", async () => {
  const compose = await readFile(new URL("../docker-compose.yml", import.meta.url), "utf8");
  const substrate = JSON.parse(await readFile(new URL("./platform-substrate-manifest.json", import.meta.url), "utf8"));
  const capabilities = JSON.parse(await readFile(new URL("../packages/db/data/platform-runtime-capabilities.json", import.meta.url), "utf8")).capabilities;
  const catalog = JSON.parse(await readFile(new URL("./capability-service-catalog.generated.json", import.meta.url), "utf8"));

  const result = checkCapabilityComposeProfiles({ composeSource: compose, substrate, capabilities, catalog });
  assert.equal(result.errors.length, 0, result.errors.join("\n"));

  for (const name of ["core", "build", "local-speech", "deep-observability", "external-ai"]) {
    const fixture = await loadCapabilityProfileFixture(new URL(`./fixtures/capability-profiles/${name}.env`, import.meta.url));
    const rendered = result.resolveFixture(fixture);
    assert.deepEqual(rendered.composeServices, rendered.projectedServices, `${name} service closure`);
    if (name === "deep-observability") {
      assert.ok(!rendered.projectedServices.includes("cadvisor"));
      assert.ok(!rendered.projectedServices.includes("node-exporter"));
      const linuxFixture = await loadCapabilityProfileFixture(new URL("./fixtures/capability-profiles/deep-observability-linux.env", import.meta.url));
      const linux = result.resolveFixture(linuxFixture);
      assert.ok(linux.projectedServices.includes("cadvisor"));
      assert.ok(linux.projectedServices.includes("node-exporter"));
      assert.deepEqual(linux.composeServices, linux.projectedServices, "Linux deep-observability closure");
    }
  }
});

test("rejects_core_dependency_on_optional_profile", async () => {
  const compose = await readFile(new URL("../docker-compose.yml", import.meta.url), "utf8");
  const substrate = JSON.parse(await readFile(new URL("./platform-substrate-manifest.json", import.meta.url), "utf8"));
  const mutated = compose.replace(
    "      portal-init:\n        condition: service_completed_successfully\n    healthcheck:",
    "      portal-init:\n        condition: service_completed_successfully\n      browser-use:\n        condition: service_healthy\n    healthcheck:",
  );
  assert.notEqual(mutated, compose, "portal dependency fixture must mutate Compose");
  const result = checkCapabilityComposeProfiles({ composeSource: mutated, substrate });
  assert.ok(result.errors.includes("core_dependency_on_optional_profile:portal:browser-use"));
});

test("preserves_special_profile_semantics", async () => {
  const compose = await readFile(new URL("../docker-compose.yml", import.meta.url), "utf8");
  const linuxOverlay = await readFile(new URL("../docker-compose.linux.yml", import.meta.url), "utf8");
  const macosOverlay = await readFile(new URL("../docker-compose.macos.yml", import.meta.url), "utf8");
  const substrate = JSON.parse(await readFile(new URL("./platform-substrate-manifest.json", import.meta.url), "utf8"));
  const result = checkCapabilityComposeProfiles({ composeSource: compose, substrate });

  assert.deepEqual(result.services.get("promoter").profiles, ["promote"]);
  assert.deepEqual(result.services.get("integration-test-harness").profiles, ["integration-test"]);
  assert.deepEqual(result.services.get("dev-portal").profiles, ["dev"]);
  assert.deepEqual(result.services.get("cadvisor").profiles, ["linux-monitoring"]);
  assert.deepEqual(result.services.get("node-exporter").profiles, ["linux-monitoring"]);
  assert.ok(result.services.get("grafana").profiles.includes("observability-ui"));
  assert.ok(result.services.get("dpf-tts").profiles.includes("tts"));
  assert.doesNotMatch(linuxOverlay, /profiles:\s*!reset\s*\[\]/, "Linux overlay must not default-start optional telemetry");
  assert.doesNotMatch(macosOverlay, /^\s{2}(cadvisor|node-exporter):/m, "macOS overlay must not activate Linux-only telemetry");

  const brokenAlias = compose.replace(
    'profiles: ["runtime-deep-observability", "observability-ui"]',
    'profiles: ["runtime-deep-observability"]',
  );
  const broken = checkCapabilityComposeProfiles({ composeSource: brokenAlias, substrate });
  assert.ok(broken.errors.includes("profile_dependency_unreachable:grafana:prometheus:observability-ui"));
});
