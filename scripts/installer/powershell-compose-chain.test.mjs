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

test("Windows start publishes a host GPU snapshot for local admission", () => {
  const publisher = read("scripts/publish-host-gpu.ps1");
  assert.match(publisher, /nvidia-smi/);
  assert.match(publisher, /host-gpu\.json/);
  assert.doesNotMatch(publisher, /[^\x00-\x7F]/);
  for (const caller of ["dpf-start.ps1", "scripts/dpf-start.ps1", "install-dpf.ps1"]) {
    assert.match(read(caller), /publish-host-gpu\.ps1/, `${caller} does not start the GPU publisher`);
  }
});

test("ordinary stop preserves volumes while uninstall makes purge explicit", () => {
  assert.doesNotMatch(read("dpf-stop.ps1"), /\s-(?:v|volumes)\b/i);
  assert.match(read("uninstall-dpf.ps1"), /\[switch\]\$Purge/);
  assert.match(read("uninstall-dpf.ps1"), /\[switch\]\$Yes/);
});

test("the Windows start chain adds exactly the overlays the shared activation table names (BI-B422ED03)", () => {
  // compose.sh and promote.sh read scripts/installer/lib/activation-overlays.txt
  // directly; the PowerShell resolver keeps its own branches, so pin them to the
  // same table: each marker's Start branch adds that marker's overlays.
  const table = read("scripts/installer/lib/activation-overlays.txt")
    .split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(/\s+/));
  assert.ok(table.length > 0, "activation table is empty");
  const helper = readFileSync(helperPath, "utf8");
  const startPath = helper.slice(helper.indexOf("if ($IncludeRelease)"));
  for (const [marker, ...overlays] of table) {
    const branch = new RegExp(`if \\(Test-DPFEnvFlag -InstallDir \\$InstallDir -Name "${marker}"\\) \\{([\\s\\S]*?)\\n    \\}`).exec(startPath);
    assert.ok(branch, `PowerShell start chain has no branch for ${marker}`);
    const added = [...branch[1].matchAll(/-Name "([^"]+)"/g)].map((match) => match[1]).sort();
    assert.deepEqual(added, [...overlays].sort(), `${marker} adds different overlays in PowerShell than in the activation table`);
  }
});
