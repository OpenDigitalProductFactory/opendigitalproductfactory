// scripts/check-no-unresolved-prometheus-targets.test.mjs
//
// Unit coverage for the M1 (BI-47629B5B) Prometheus scrape-target referential
// integrity guard: every active scrape target must name a compose-defined
// service (or a listed non-compose host); a retired service left in a scrape
// job (the BI-31FDC859 "Memory offline" incident) is refused.

import test from "node:test";
import assert from "node:assert/strict";

import {
  NON_COMPOSE_HOSTS,
  parseScrapeTargets,
  parseComposeServiceNames,
  evaluatePrometheusTargets,
} from "./check-no-unresolved-prometheus-targets.mjs";

const GOOD_PROM = `
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: "postgres"
    static_configs:
      - targets: ["postgres-exporter:9187"]

  # A commented-out job must not count:
  # - job_name: "neo4j"
  #   static_configs:
  #     - targets: ["neo4j:2004"]

  - job_name: "sandbox"
    static_configs:
      - targets:
          - "sandbox:3000"
    metrics_path: /api/metrics

  - job_name: "windows-host"
    static_configs:
      - targets: ["host.docker.internal:9182"]
        labels:
          instance: "windows-host"

  - job_name: "prometheus"
    static_configs:
      - targets: ["localhost:9090"]
`;

const GOOD_COMPOSE = `
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: dpf
  postgres-exporter:
    image: prometheuscommunity/postgres-exporter
  sandbox:
    container_name: dpf-sandbox
    ports:
      - "3000:3000"
volumes:
  pgdata: {}
`;

test("parseScrapeTargets reads inline arrays, block lists, and skips comments", () => {
  const targets = parseScrapeTargets(GOOD_PROM);
  assert.deepEqual(
    targets.map((t) => `${t.job}=${t.target}`),
    [
      "postgres=postgres-exporter:9187",
      "sandbox=sandbox:3000",
      "windows-host=host.docker.internal:9182",
      "prometheus=localhost:9090",
    ],
  );
});

test("parseComposeServiceNames reads service keys and container_name, not nested keys", () => {
  const names = parseComposeServiceNames(GOOD_COMPOSE);
  assert.deepEqual(
    [...names].sort(),
    ["dpf-sandbox", "postgres", "postgres-exporter", "sandbox"],
  );
  // Nested keys (environment, ports) and non-service top-level keys must not leak in.
  assert.ok(!names.has("environment"));
  assert.ok(!names.has("pgdata"));
});

test("the clean shape passes", () => {
  const errors = evaluatePrometheusTargets({
    prometheusConfigs: [{ path: "monitoring/prometheus/prometheus.yml", source: GOOD_PROM }],
    composeSources: [GOOD_COMPOSE],
  });
  assert.deepEqual(errors, []);
});

test("RED: a scrape job for a retired service is refused (BI-31FDC859 shape)", () => {
  const withRetired =
    GOOD_PROM +
    `
  - job_name: "memory"
    static_configs:
      - targets: ["memory-service:9500"]
`;
  const errors = evaluatePrometheusTargets({
    prometheusConfigs: [{ path: "prometheus.yml", source: withRetired }],
    composeSources: [GOOD_COMPOSE],
  });
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes('job "memory"'));
  assert.ok(errors[0].includes("memory-service:9500"));
  assert.ok(errors[0].includes("BI-31FDC859"));
});

test("RED: a block-list target for an unknown service is refused too", () => {
  const errors = evaluatePrometheusTargets({
    prometheusConfigs: [
      {
        path: "prometheus.yml",
        source: GOOD_PROM.replace('- "sandbox:3000"', '- "ghost-sidecar:8080"'),
      },
    ],
    composeSources: [GOOD_COMPOSE],
  });
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes("ghost-sidecar"));
});

test("a container_name target resolves like a service name", () => {
  const errors = evaluatePrometheusTargets({
    prometheusConfigs: [
      {
        path: "prometheus.yml",
        source: GOOD_PROM.replace('- "sandbox:3000"', '- "dpf-sandbox:3000"'),
      },
    ],
    composeSources: [GOOD_COMPOSE],
  });
  assert.deepEqual(errors, []);
});

test("RED: a config whose targets all vanished is a parser/move failure, not a silent pass", () => {
  const errors = evaluatePrometheusTargets({
    prometheusConfigs: [{ path: "prometheus.yml", source: "global:\n  scrape_interval: 15s\n" }],
    composeSources: [GOOD_COMPOSE],
  });
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes("no active scrape targets"));
});

test("RED: empty compose parsing fails loudly instead of failing every target", () => {
  const errors = evaluatePrometheusTargets({
    prometheusConfigs: [{ path: "prometheus.yml", source: GOOD_PROM }],
    composeSources: ["volumes:\n  pgdata: {}\n"],
  });
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes("no compose service names found"));
});

test("the non-compose allowlist is exactly the two deliberate hosts", () => {
  assert.deepEqual([...NON_COMPOSE_HOSTS], ["localhost", "host.docker.internal"]);
});
