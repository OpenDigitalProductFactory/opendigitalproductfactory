import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const compose = readFileSync(new URL("../../docker-compose.yml", import.meta.url), "utf8");
const envExample = readFileSync(new URL("../../.env.docker.example", import.meta.url), "utf8");
const installer = readFileSync(new URL("../../install-dpf.ps1", import.meta.url), "utf8");
const postgresExporterConfigUrl = new URL(
  "../../monitoring/postgres-exporter/postgres_exporter.yml",
  import.meta.url,
);

test("installed compose runtime enables background job registration by default", () => {
  assert.match(
    compose,
    /DPF_INNGEST_SELF_SYNC_ON_BOOT_ENABLED:\s*\$\{DPF_INNGEST_SELF_SYNC_ON_BOOT_ENABLED:-1\}/,
  );
  assert.match(
    compose,
    /DPF_SCHEDULED_INNGEST_FUNCTIONS_ENABLED:\s*\$\{DPF_SCHEDULED_INNGEST_FUNCTIONS_ENABLED:-1\}/,
  );
  assert.match(
    compose,
    /DPF_OPTIONAL_STARTUP_TASKS_ENABLED:\s*\$\{DPF_OPTIONAL_STARTUP_TASKS_ENABLED:-1\}/,
  );
});

test("example compose env documents background job override flags", () => {
  assert.match(envExample, /DPF_INNGEST_SELF_SYNC_ON_BOOT_ENABLED=/);
  assert.match(envExample, /DPF_SCHEDULED_INNGEST_FUNCTIONS_ENABLED=/);
  assert.match(envExample, /DPF_OPTIONAL_STARTUP_TASKS_ENABLED=/);
});

test("postgres exporter starts with an explicit config file in compose and installer output", () => {
  assert.equal(existsSync(postgresExporterConfigUrl), true);
  assert.match(readFileSync(postgresExporterConfigUrl, "utf8"), /^auth_modules:\s*\{\}\s*$/m);

  assert.match(compose, /postgres-exporter:[\s\S]*command:\s*\["--config\.file=\/postgres_exporter\.yml"\]/);
  assert.match(
    compose,
    /postgres-exporter:[\s\S]*\.\/monitoring\/postgres-exporter\/postgres_exporter\.yml:\/postgres_exporter\.yml:ro/,
  );

  assert.match(installer, /postgres-exporter:[\s\S]*command:\s*\["--config\.file=\/postgres_exporter\.yml"\]/);
  assert.match(
    installer,
    /postgres-exporter:[\s\S]*\.\/monitoring\/postgres-exporter\/postgres_exporter\.yml:\/postgres_exporter\.yml:ro/,
  );
  assert.match(installer, /postgres-exporter\\postgres_exporter\.yml/);
});
