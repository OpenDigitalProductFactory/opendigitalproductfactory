import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("PowerShell redeploy helper builds and recreates portal services together", () => {
  const body = read("scripts/redeploy-portal.ps1");

  assert.match(body, /\$env:DPF_VERSION\s*=\s*\$sha/);
  assert.match(body, /\$buildArgs\s*=\s*@\("compose", "build"\)/);
  assert.match(body, /\$buildArgs\s*\+=\s*@\("portal", "portal-init"\)/);
  assert.match(body, /"up", "-d", "--no-build", "--force-recreate", "portal-init", "portal"/);
  assert.match(body, /docker inspect -f '{{\.Image}}'/);
  assert.match(body, /\$portalImage\s*-ne\s*\$portalInitImage/);
});

test("shell redeploy helper builds and recreates portal services together", () => {
  const body = read("scripts/redeploy-portal.sh");

  assert.match(body, /export DPF_VERSION="\$sha"/);
  assert.match(body, /docker compose build "\$\{build_flags\[@\]\}" portal portal-init/);
  assert.match(body, /docker compose up -d --no-build --force-recreate portal-init portal/);
  assert.match(body, /docker inspect -f '{{\.Image}}'/);
  assert.match(body, /\[ "\$portal_image" != "\$portal_init_image" \]/);
});

test("version-check drift guidance points to redeploy helper", () => {
  assert.match(read("scripts/portal-version-check.ps1"), /scripts\\redeploy-portal\.ps1/);
  assert.match(read("scripts/portal-version-check.sh"), /scripts\/redeploy-portal\.sh/);
});
