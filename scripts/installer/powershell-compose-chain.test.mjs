import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const helperPath = join(root, "scripts/installer/lib/compose-chain.ps1");
const read = (path) => readFileSync(join(root, path), "utf8");

test("PowerShell lifecycle commands share one complete compose-chain resolver", () => {
  assert.ok(existsSync(helperPath), "missing shared PowerShell compose-chain helper");
  const helper = readFileSync(helperPath, "utf8");
  for (const overlay of [
    "docker-compose.release.yml",
    "docker-compose.override.yml",
    "docker-compose.edge.yml",
    "docker-compose.edge-actions.yml",
    "docker-compose.organization-trust.yml",
    "docker-compose.pki.yml",
    "docker-compose.tls.yml",
  ]) {
    assert.match(helper, new RegExp(overlay.replaceAll(".", "\\.")), `resolver omits ${overlay}`);
  }
  for (const caller of ["dpf-start.ps1", "dpf-stop.ps1", "uninstall-dpf.ps1", "install-dpf.ps1"]) {
    assert.match(read(caller), /compose-chain\.ps1/, `${caller} does not use the shared resolver`);
  }
});

test("ordinary stop preserves volumes while uninstall makes purge explicit", () => {
  assert.doesNotMatch(read("dpf-stop.ps1"), /\s-(?:v|volumes)\b/i);
  assert.match(read("uninstall-dpf.ps1"), /\[switch\]\$Purge/);
  assert.match(read("uninstall-dpf.ps1"), /\[switch\]\$Yes/);
});
