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

test("installed runtime passes through every autonomous Build Studio rollout control", () => {
  assert.match(
    compose,
    /DPF_BUILD_AUTONOMOUS_PLAYBOOK_MODE:\s*\$\{DPF_BUILD_AUTONOMOUS_PLAYBOOK_MODE:-off\}/,
  );
  assert.match(
    compose,
    /DPF_BUILD_PR_DELIVERY_RECONCILER_MODE:\s*\$\{DPF_BUILD_PR_DELIVERY_RECONCILER_MODE:-off\}/,
  );
  assert.match(
    compose,
    /DPF_AUTO_COMPLETE_VERIFIED_BUILDS:\s*\$\{DPF_AUTO_COMPLETE_VERIFIED_BUILDS:-0\}/,
  );

  assert.match(envExample, /DPF_BUILD_AUTONOMOUS_PLAYBOOK_MODE=/);
  assert.match(envExample, /DPF_BUILD_PR_DELIVERY_RECONCILER_MODE=/);
  assert.match(envExample, /DPF_AUTO_COMPLETE_VERIFIED_BUILDS=/);
});

test("portal runtime exposes the host source mount as the git repo root for live-readiness ancestry checks", () => {
  assert.match(
    compose,
    /portal:[\s\S]*- \${DPF_HOST_INSTALL_PATH:-\.}:\/host-dpf[\s\S]*environment:[\s\S]*DPF_REPO_ROOT:\s*\/host-dpf/,
    "portal must set DPF_REPO_ROOT=/host-dpf so verify_live_install_readiness can compute ancestry without assuming process.cwd() is a git repo",
  );
});

test("portal runtime receives the release image tag for install-host classification", () => {
  assert.match(
    compose,
    /portal:[\s\S]*environment:[\s\S]*DPF_IMAGE_TAG:\s*\$\{DPF_IMAGE_TAG:-\}/,
    "consumer containers need the resolved release tag even when the host has no .install-mode marker",
  );
});

test("postgres exporter starts with an explicit config through the installer's compose chain", () => {
  assert.equal(existsSync(postgresExporterConfigUrl), true);
  assert.match(readFileSync(postgresExporterConfigUrl, "utf8"), /^auth_modules:\s*\{\}\s*$/m);

  assert.match(compose, /postgres-exporter:[\s\S]*command:\s*\["--config\.file=\/postgres_exporter\.yml"\]/);
  assert.match(
    compose,
    /postgres-exporter:[\s\S]*\.\/monitoring\/postgres-exporter\/postgres_exporter\.yml:\/postgres_exporter\.yml:ro/,
  );

  assert.match(
    installer,
    /Import-DPFComposeChain -InstallDir \$DPF_DIR[\s\S]*Get-DPFComposeArgs -InstallDir \$DPF_DIR/,
    "the installer must launch the shipped base compose contract rather than duplicate its YAML",
  );
});
