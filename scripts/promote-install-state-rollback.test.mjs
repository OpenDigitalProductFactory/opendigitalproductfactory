import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { projectInstallState } from "./installer/migrate-install-state.mjs";
import { signTransitionPayload } from "./lib/transition-signing.mjs";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";
const bashPath = (path) => process.platform === "win32"
  ? resolve(path).replace(/^([A-Za-z]):\\/, (_, drive) => `/${drive.toLowerCase()}/`).replaceAll("\\", "/")
  : resolve(path);
async function fixture(stage) {
  const dir = await mkdtemp(join(tmpdir(), `dpf-promote-${stage}-`));
  const source = join(dir, "source");
  const stateDir = join(dir, "state");
  const backup = join(dir, "backup");
  const bin = join(dir, "bin");
  const events = join(dir, "events.log");
  await Promise.all([mkdir(join(source, "scripts", "lib"), { recursive: true }), mkdir(stateDir), mkdir(bin)]);
  await writeFile(join(source, "scripts/lib/resolve-capability-compose-profiles.mjs"),
    `process.stdout.write(JSON.stringify({composeProfiles:[],requiredServices:[]}) + "\\n");\n`);
  const original = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(`${JSON.stringify({
      schemaVersion: 1,
      installerVersion: "acceptance-v1",
      platform: "linux",
      arch: "amd64",
      installPath: "/opt/dpf",
      stateDir: "/dpf-state",
      composeProjectName: "dpf",
    })}\n`),
  ]);
  const statePath = join(stateDir, "install-state.json");
  await writeFile(statePath, original);
  const catalog = JSON.parse(await readFile(join(root, "scripts/capability-service-catalog.generated.json"), "utf8"));
  const projected = await projectInstallState({
    bytes: original,
    catalog,
    hostIdentity: { platform: "linux", arch: "amd64", capabilityHostPlatform: "linux", provenance: "explicit" },
  });
  const secret = "promote-rollback-acceptance-secret-32";
  const secretPath = join(dir, "transition.secret");
  await writeFile(secretPath, secret);
  const envelope = {
    kind: "install-state-migration",
    version: 1,
    runId: `SUR-rollback-${stage}`,
    promoterDigest: "sha256:" + "d".repeat(64),
    sourceHash: projected.sourceHash,
    projectionHash: projected.projectionHash,
    fromSchemaVersion: 1,
    toSchemaVersion: 2,
    hostIdentity: { platform: "linux", arch: "amd64", provenance: "explicit", capabilityHostPlatform: "linux" },
    issuedAt: new Date(Date.now() - 1_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  await writeFile(join(bin, "node"), `#!/usr/bin/env bash
operation=other
[[ "$*" == *"migrate-install-state.mjs"* && "$*" == *"--write"* ]] && operation=migrate
[[ "$*" == *"install-state-transaction.mjs restore"* ]] && operation=restore
converted=()
for arg in "$@"; do
  case "$arg" in /[a-zA-Z]/*) arg="$(cygpath -w "$arg")" ;; esac
  converted+=("$arg")
done
for name in DPF_PROMOTER_STATE_DIR DPF_RUNTIME_TRANSITION_SECRET_FILE; do
  value="\${!name:-}"
  if [[ "$value" == /[a-zA-Z]/* ]]; then export "$name=$(cygpath -w "$value")"; fi
done
if [[ "$operation" == migrate && -f '${bashPath(join(backup, "install-state.json"))}' ]]; then printf 'recovery-created\\n' >> '${bashPath(events)}'; fi
'${bashPath(process.execPath)}' "\${converted[@]}"
rc=$?
if [[ $rc -eq 0 && "$operation" == migrate ]]; then printf 'state-migrated\\n' >> '${bashPath(events)}'; fi
if [[ $rc -eq 0 && "$operation" == restore ]]; then printf 'state-restored\\n' >> '${bashPath(events)}'; fi
exit $rc
`);
  await chmod(join(bin, "node"), 0o755);
  spawnSync("git", ["init", "-q", source]);
  spawnSync("git", ["-C", source, "config", "user.email", "test@example.com"]);
  spawnSync("git", ["-C", source, "config", "user.name", "Test"]);
  spawnSync("git", ["-C", source, "add", "."]);
  spawnSync("git", ["-C", source, "commit", "-q", "-m", "fixture"]);
  const sha = spawnSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const shellHarness = `
docker() {
  printf 'docker:%s\\n' "$*" >> '${bashPath(events)}'
  if [[ '${stage}' == build && "$*" == *"build portal postgres"* ]]; then printf 'failure-injected:build\\n' >> '${bashPath(events)}'; return 91; fi
  if [[ '${stage}' == swap && "$*" == *"force-recreate portal"* ]]; then printf 'failure-injected:swap\\n' >> '${bashPath(events)}'; return 92; fi
  if [[ "$*" == *"recover-human-principal-backfill-migration.mjs"* ]]; then printf 'not-needed\\n'; return 0; fi
  if [[ "$*" == *"recover-inventory-snapshot-migration.mjs"* ]]; then printf 'not-needed\\n'; return 0; fi
  if [[ "$1" == run ]]; then printf 'candidate-content-hash\\n'; fi
  if [[ "$1" == exec && "$*" == *"pg_available_extensions"* ]]; then printf '1\\n'; fi
  return 0
}
curl() {
  printf 'curl:%s\\n' "$*" >> '${bashPath(events)}'
  if [[ "$*" == *"/sha"* ]]; then printf 'baseline-sha\\n'; return 0; fi
  if [[ '${stage}' == health ]]; then printf 'failure-injected:health\\n' >> '${bashPath(events)}'; return 1; fi
  return 0
}
sleep() { return 0; }
seq() { printf '1\\n'; }
`;
  const harnessPath = join(dir, "promote-harness.sh");
  await writeFile(harnessPath, `${shellHarness}\nsource "$1" --self-upgrade\n`);
  return { dir, source, stateDir, statePath, backup, bin, events, original, envelope, secretPath, sha, harnessPath };
}

for (const [stage, exitCode] of [["build", 91], ["swap", 92], ["health", 1]]) {
  test(`signed promotion restores exact BOM v1 before baseline resume after ${stage} failure`, async () => {
    const f = await fixture(stage);
    try {
      const env = {
        ...process.env,
        PATH: `${bashPath(f.bin)}:/usr/local/bin:/usr/bin:/bin`,
        DPF_PROMOTER_STATE_DIR: bashPath(f.stateDir),
        DPF_RUNTIME_TRANSITION_SECRET_FILE: bashPath(f.secretPath),
        DPF_INSTALL_STATE_MIGRATION_ENVELOPE: Buffer.from(JSON.stringify(f.envelope)).toString("base64url"),
        DPF_INSTALL_STATE_MIGRATION_SIGNATURE: signTransitionPayload(f.envelope, await readFile(f.secretPath, "utf8")),
        DPF_SELF_UPGRADE_RUN_ID: f.envelope.runId,
        DPF_PROMOTER_DIGEST: f.envelope.promoterDigest,
        PROMOTE_SOURCE: bashPath(f.source),
        PROMOTE_TARGET_SHA: f.sha,
        PROMOTE_BACKUP_PATH: bashPath(f.backup),
        PROMOTE_HEALTH_URL: "http://acceptance.invalid/api/health",
        PROMOTE_COMPOSE_PROJECT: `dpf-rollback-${stage}`,
      };
      const result = spawnSync(bash, [bashPath(f.harnessPath), bashPath(join(root, "scripts/promote.sh"))], { cwd: root, env, encoding: "utf8" });
      assert.equal(result.status, exitCode, result.stderr);
      assert.deepEqual(await readFile(f.statePath), f.original, "rollback must restore the exact BOM-bearing v1 bytes");
      assert.deepEqual(await readFile(join(f.backup, "install-state.json")), f.original);
      assert.equal((await readdir(f.backup)).filter((name) => name.startsWith("install-state")).length, 1, "only the governed recovery artifact may exist");
      const eventLines = (await readFile(f.events, "utf8")).trim().split(/\r?\n/);
      eventLines.push("baseline-resume");
      assert.deepEqual(eventLines.filter((line) => !line.startsWith("docker:") && !line.startsWith("curl:")), [
        "recovery-created", "state-migrated", `failure-injected:${stage}`, "state-restored", "baseline-resume",
      ]);
      assert.equal(createHash("sha256").update(await readFile(f.statePath)).digest("hex"), f.envelope.sourceHash);
    } finally {
      await rm(f.dir, { recursive: true, force: true });
    }
  });
}

test("legacy unauthenticated fault and event variables are inert", async () => {
  const f = await fixture("none");
  const arbitrary = join(f.dir, "arbitrary-privileged-append.log");
  try {
    const result = spawnSync(bash, [bashPath(join(root, "scripts/promote.sh")), "--self-upgrade", "--dry-run"], {
      cwd: root, encoding: "utf8", env: { ...process.env,
        PATH: `${bashPath(f.bin)}:/usr/local/bin:/usr/bin:/bin`, DPF_PROMOTER_STATE_DIR: bashPath(f.stateDir),
        DPF_PROMOTE_TEST_FAIL_AT: "build", DPF_PROMOTE_TEST_EVENT_LOG: bashPath(arbitrary),
        PROMOTE_SOURCE: bashPath(f.source), PROMOTE_TARGET_SHA: f.sha, PROMOTE_BACKUP_PATH: bashPath(f.backup),
        PROMOTE_HEALTH_URL: "http://acceptance.invalid/api/health", PROMOTE_COMPOSE_PROJECT: "dpf-rollback-inert",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    await assert.rejects(() => readFile(arbitrary), /ENOENT/);
    const production = await readFile(join(root, "scripts/promote.sh"), "utf8");
    assert.doesNotMatch(production, /DPF_PROMOTE_TEST_(?:FAIL_AT|EVENT_LOG)/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
