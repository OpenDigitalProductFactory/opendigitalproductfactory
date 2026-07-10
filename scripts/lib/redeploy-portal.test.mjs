import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("PowerShell redeploy helper builds and recreates portal services together", () => {
  const body = read("scripts/redeploy-portal.ps1");

  assert.match(body, /DPF_COMPOSE_ENV_FILE/);
  assert.match(body, /D:\\DPF\\\.env/);
  assert.match(body, /\$composeArgs\s*\+=\s*@\("--env-file", \$composeEnvFile\)/);
  assert.match(body, /\$env:DPF_VERSION\s*=\s*\$sha/);
  assert.match(body, /\$buildArgs\s*=\s*\$composeArgs\s*\+\s*@\("build"\)/);
  assert.match(body, /\$buildArgs\s*\+=\s*@\("portal", "portal-init"\)/);
  assert.match(body, /"up", "-d", "--no-build", "--no-deps", "--force-recreate", "portal-init", "portal"/);
  assert.match(body, /\$composeArgs\s*\+\s*@\("ps", "-a", "-q", \$Service\)/);
  assert.match(body, /\/app\/\.dpf-image-version/);
  assert.match(body, /docker cp/);
  assert.match(body, /\$portalVersion\s*-ne\s*\$sha/);
  assert.match(body, /\$portalInitVersion\s*-ne\s*\$sha/);
});

test("PowerShell redeploy helper refuses to race an active self-upgrade", () => {
  const body = read("scripts/redeploy-portal.ps1");

  assert.match(body, /DPF_ALLOW_REDEPLOY_DURING_SELF_UPGRADE/);
  assert.match(body, /SelfUpgradeRun/);
  assert.match(body, /queued','pending','running','completing/);
  assert.match(body, /Active self-upgrade run\(s\) detected/);
  assert.match(body, /docker exec .* psql/s);
});

test("shell redeploy helper builds and recreates portal services together", () => {
  const body = read("scripts/redeploy-portal.sh");

  assert.match(body, /DPF_COMPOSE_ENV_FILE/);
  assert.match(body, /\$HOME\/dpf\/\.env/);
  assert.match(body, /compose_args\+=\(--env-file "\$compose_env_file"\)/);
  assert.match(body, /export DPF_VERSION="\$sha"/);
  assert.match(body, /docker compose \$\{compose_args\[@\]\+".*build \$\{build_flags\[@\]\+".*portal portal-init/);
  assert.match(body, /docker compose \$\{compose_args\[@\]\+".*up -d --no-build --no-deps --force-recreate portal-init portal/);
  assert.match(body, /docker compose \$\{compose_args\[@\]\+".*ps -a -q portal-init/);
  assert.match(body, /\/app\/\.dpf-image-version/);
  assert.match(body, /docker cp/);
  assert.match(body, /\[ "\$portal_version" != "\$sha" \]/);
  assert.match(body, /\[ "\$portal_init_version" != "\$sha" \]/);
});

test("shell redeploy helper refuses to race an active self-upgrade", () => {
  const body = read("scripts/redeploy-portal.sh");

  assert.match(body, /DPF_ALLOW_REDEPLOY_DURING_SELF_UPGRADE/);
  assert.match(body, /SelfUpgradeRun/);
  assert.match(body, /queued','pending','running','completing/);
  assert.match(body, /Active self-upgrade run\(s\) detected/);
  assert.match(body, /docker exec "\$postgres_container" psql/);
});

test("version-check drift guidance points to governed self-upgrade", () => {
  assert.match(read("scripts/portal-version-check.ps1"), /governed self-upgrade path/);
  assert.match(read("scripts/portal-version-check.ps1"), /Direct redeploy-portal\/compose rebuilds are reserved for install\/bootstrap\/recovery/);
  assert.match(read("scripts/portal-version-check.sh"), /governed self-upgrade path/);
  assert.match(read("scripts/portal-version-check.sh"), /Direct redeploy-portal\/compose rebuilds are reserved for install\/bootstrap\/recovery/);
});
