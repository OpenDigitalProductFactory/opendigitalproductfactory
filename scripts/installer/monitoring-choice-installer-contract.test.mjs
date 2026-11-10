// BI-31F11C37 (slice D3 of BI-83260BB3): both installers ask the monitoring
// question, accept a flag that answers it, and record the answer BEFORE the
// capability profiles resolve — otherwise the first `compose up` ignores it.
//
// Source-text contract: running the real installers is what is being guarded.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(repoRoot, p), "utf8");
const ps = read("install-dpf.ps1");
const sh = read("install-dpf.sh");
const statePs = read("scripts/installer/lib/state.ps1");
const stateSh = read("scripts/installer/lib/state.sh");
const dockerfile = read("Dockerfile");

test("install-dpf.ps1 declares -Monitoring On|Off and documents it in -Help", () => {
  assert.match(ps, /\[ValidateSet\("On",\s*"Off"\)\]\[string\]\$Monitoring\b/);
  const usage = ps.slice(ps.indexOf("function Show-DPFInstallerUsage"), ps.indexOf("if ($Help)"));
  assert.match(usage, /-Monitoring <On\|Off>/);
  assert.match(usage, /-Headless without\s+this flag leaves monitoring off and undecided/);
});

test("install-dpf.sh accepts --monitoring on|off, rejects other values and documents it", () => {
  assert.match(sh, /--monitoring\)\s+shift; DPF_MONITORING=/);
  assert.match(sh, /--monitoring=\*\)\s+DPF_MONITORING=/);
  assert.match(sh, /""\|on\|off\) ;;/);
  const usage = sh.slice(sh.indexOf("usage() {"), sh.indexOf("DPF_DRY_RUN=0"));
  assert.match(usage, /--monitoring <on\|off>/);
});

test("install-dpf.ps1 records the choice after state init and before profiles resolve", () => {
  const step = ps.slice(ps.indexOf('Write-Step 7 10 "Starting the platform..."'));
  const init = step.indexOf("Initialize-DpfState");
  const apply = step.indexOf("Set-DpfMonitoringChoice");
  const resolve = step.indexOf("Resolve-DpfCapabilityComposeProfiles");
  const up = step.search(/docker compose @coreComposeArgs/);
  assert.ok(init >= 0 && apply > init, "the choice needs an initialized install-state");
  assert.ok(resolve > apply, "the choice must be recorded before the capability profiles resolve");
  assert.ok(up > resolve, "compose runs on the resolved profiles");
  const block = step.slice(step.indexOf("Test-DpfMonitoringPromptNeeded"), apply);
  assert.match(block, /installer-flag/);
  assert.match(block, /elseif \(\$Headless\)[\s\S]*"none"[\s\S]*"headless-default"/, "-Headless without the flag must not prompt");
  assert.match(block, /Get-DpfMonitoringCost/);
  assert.match(block, /Read-DPFInstallerInput "  Turn monitoring on\? \[y\/N\]"/, "prompts route through the headless-aware helper");
  assert.match(block, /installer-prompt/);
});

test("install-dpf.sh records the choice after the mode prompt and before the compose chain", () => {
  const mode = sh.indexOf("read -r mode_choice");
  const asked = sh.indexOf("dpf_monitoring_prompt_needed");
  const apply = sh.indexOf("dpf_monitoring_choice_apply");
  const chain = sh.indexOf('dpf_compose_files "$DPF_MODE"');
  assert.ok(mode >= 0 && asked > mode, "the question follows the mode choice");
  assert.ok(chain > apply && apply > asked, "dpf_compose_files resolves profiles, so the choice must be recorded first");
  const block = sh.slice(asked, chain);
  assert.match(block, /installer-flag/);
  assert.match(block, /DPF_HEADLESS:-0\}" = "1"[\s\S]*monitoring_choice="none"; monitoring_source="headless-default"/);
  assert.match(block, /dpf_monitoring_cost_text/);
  assert.match(block, /Turn monitoring on\? \[y\/N\]/);
  assert.match(block, /installer-prompt/);
});

test("neither installer hard-codes the monitoring cost", () => {
  for (const [name, text] of [["install-dpf.ps1", ps], ["install-dpf.sh", sh]]) {
    const prompt = text.slice(text.indexOf("Monitoring (Prometheus + Grafana) watches"), text.indexOf("Turn monitoring on?"));
    assert.doesNotMatch(prompt, /\d(?:\.\d+)?\s*GB|\d(?:\.\d+)?\s*CPU/, `${name} must read the cost from config/install-resource-budgets.json`);
  }
});

test("the state libraries delegate to the one Node helper", () => {
  assert.match(statePs, /scripts\\installer\\monitoring-choice\.mjs/);
  assert.match(statePs, /cost --text/);
  assert.match(statePs, /needs-prompt --state/);
  assert.match(statePs, /apply --state/);
  assert.match(stateSh, /scripts\/installer\/monitoring-choice\.mjs" cost --text/);
  assert.match(stateSh, /needs-prompt --state/);
  assert.match(stateSh, /apply --state/);
});

// The consumer install has no git checkout: the helper, every module it imports
// and the budget it reads must ship in /dpf-release-assets (see
// scripts/check-release-asset-contract.test.mjs for the history).
// Static imports everywhere, plus the entry's own dynamic imports (apply loads
// the install-state transaction lazily). A dependency's dynamic import inside
// its own CLI main() is not reached by the helper and is not followed.
function importClosure(entry, seen = new Set(), isEntry = true) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  if (!entry.endsWith(".mjs")) return seen;
  const source = read(entry);
  const pattern = isEntry ? /(?:from\s+|import\()\s*["'](\.{1,2}\/[^"']+)["']/g : /from\s+["'](\.{1,2}\/[^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    importClosure(posix.normalize(posix.join(posix.dirname(entry), match[1])), seen, false);
  }
  return seen;
}

test("the helper, its imports and the budget file ship in the release bundle", () => {
  const start = dockerfile.lastIndexOf("RUN ", dockerfile.indexOf("/dpf-release-assets"));
  const block = dockerfile.slice(start, dockerfile.indexOf("SHA256SUMS", dockerfile.indexOf("find .", start)));
  const initStage = dockerfile.slice(dockerfile.indexOf("FROM deps AS init"), start);
  const required = [...importClosure("scripts/installer/monitoring-choice.mjs"), "config/install-resource-budgets.json"];
  for (const path of required) {
    assert.ok(existsSync(join(repoRoot, path)), `${path} is imported but absent`);
    assert.ok(block.includes(path), `${path} must be cp'd into /dpf-release-assets`);
    const staged = path.startsWith("config/") ? /^COPY config\/ \.\/config\/$/m.test(initStage) : initStage.includes(`COPY ${path} `) || initStage.includes(` ${path} `);
    assert.ok(staged, `${path} must be COPYed into the init stage before it can be cp'd`);
  }
  assert.ok(block.includes("/dpf-release-assets/config/"), "the budget lands where the helper looks for it");
});
