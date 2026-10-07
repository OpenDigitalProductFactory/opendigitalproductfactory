// BI-00F7D2E3 (D3 of BI-C54E691E): step 7e reports which running services
// compose would recreate because their config changed. It ships in shadow mode
// (WWMD DI-C04ABC76BBF4): nothing is recreated until one live upgrade shows the
// report lists only services that really changed. It is read-only, so it also
// runs under --dry-run, which is how this harness drives it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";
const bashPath = (path) => process.platform === "win32"
  ? resolve(path).replace(/^([A-Za-z]):\\/, (_, drive) => `/${drive.toLowerCase()}/`).replaceAll("\\", "/")
  : resolve(path);

// The rendered config: classes come from the dpf.recreate-class label.
const RENDERED = {
  services: {
    "portal-tls": { labels: { "dpf.recreate-class": "stateless" } },
    grafana: { labels: { "dpf.recreate-class": "stateless" } },
    loki: { labels: { "dpf.recreate-class": "stateless" } },
    postgres: { labels: { "dpf.recreate-class": "data-owner" } },
    portal: { labels: { "dpf.recreate-class": "managed" } },
    mystery: {},
  },
};
const DESIRED = { "portal-tls": "new-tls", grafana: "same-graf", loki: "new-loki", postgres: "new-pg", portal: "new-portal", mystery: "m2" };
// service, container config-hash label, state
const RUNNING = [
  ["portal-tls", "old-tls", "running"],
  ["grafana", "same-graf", "running"],
  ["loki", "old-loki", "exited"],
  ["postgres", "old-pg", "running"],
  ["portal", "old-portal", "running"],
  ["mystery", "m1", "running"],
];

async function fixture({ configFails = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "dpf-promote-converge-"));
  const source = join(dir, "source");
  const stateDir = join(dir, "state");
  const bin = join(dir, "bin");
  await Promise.all([mkdir(join(source, "scripts", "lib"), { recursive: true }), mkdir(stateDir), mkdir(bin)]);
  await writeFile(join(source, "scripts/lib/resolve-capability-compose-profiles.mjs"),
    `process.stdout.write(JSON.stringify({composeProfiles:[],requiredServices:[]}) + "\\n");\n`);
  await writeFile(join(source, "docker-compose.yml"), "services: {}\n");
  await writeFile(join(stateDir, "install-state.json"), `${JSON.stringify({
    schemaVersion: 1, installerVersion: "acceptance-v1", platform: "linux", arch: "amd64",
    installPath: "/opt/dpf", stateDir: "/dpf-state", composeProjectName: "dpf",
  })}\n`);
  await writeFile(join(dir, "rendered.json"), JSON.stringify(RENDERED));
  await writeFile(join(dir, "hashes.txt"), Object.entries(DESIRED).map(([s, h]) => `${s} ${h}`).join("\n") + "\n");
  await writeFile(join(dir, "running.tsv"), RUNNING.map((row) => row.join("\t")).join("\n") + "\n");
  // A fake docker that answers only the read-only calls step 7e makes and
  // records every invocation, so the test can prove nothing was recreated.
  await writeFile(join(bin, "docker"), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> '${bashPath(join(dir, "docker-calls.log"))}'
args=" $* "
if [[ "$args" == *" config "* && "$args" == *" --format json "* ]]; then ${configFails ? "exit 1" : `cat '${bashPath(join(dir, "rendered.json"))}'`}; exit 0; fi
if [[ "$args" == *" config "* && "$args" == *" --hash "* ]]; then cat '${bashPath(join(dir, "hashes.txt"))}'; exit 0; fi
if [[ "$1" == "ps" ]]; then cat '${bashPath(join(dir, "running.tsv"))}'; exit 0; fi
exit 0
`);
  await chmod(join(bin, "docker"), 0o755);
  spawnSync("git", ["init", "-q", source]);
  spawnSync("git", ["-C", source, "config", "user.email", "test@example.com"]);
  spawnSync("git", ["-C", source, "config", "user.name", "Test"]);
  spawnSync("git", ["-C", source, "add", "."]);
  spawnSync("git", ["-C", source, "commit", "-q", "-m", "fixture"]);
  const sha = spawnSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  return { dir, source, stateDir, bin, sha };
}

async function promote(f) {
  const env = {
    ...process.env,
    PATH: `${bashPath(f.bin)}:${process.env.PATH}`,
    DPF_PROMOTER_STATE_DIR: bashPath(f.stateDir),
    PROMOTE_SOURCE: bashPath(f.source),
    PROMOTE_TARGET_SHA: f.sha,
    PROMOTE_BACKUP_PATH: bashPath(join(f.dir, "backup")),
    PROMOTE_HEALTH_URL: "http://acceptance.invalid/api/health",
    PROMOTE_COMPOSE_PROJECT: "dpf",
  };
  const result = spawnSync(bash, [bashPath(join(root, "scripts/promote.sh")), "--self-upgrade", "--dry-run"], { cwd: root, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const outcome = JSON.parse(await readFile(join(f.stateDir, "service-converge-outcome.json"), "utf8"));
  const calls = await readFile(join(f.dir, "docker-calls.log"), "utf8").catch(() => "");
  return { stdout: result.stdout, outcome, calls };
}

test("shadow 7e reports the changed running stateless services and recreates nothing", async () => {
  const f = await fixture();
  try {
    const { stdout, outcome, calls } = await promote(f);
    assert.equal(outcome.mode, "shadow");
    assert.equal(outcome.targetSha, f.sha);
    assert.deepEqual(outcome.wouldRecreate, [{ service: "portal-tls", from: "old-tls", to: "new-tls" }]);
    assert.deepEqual(outcome.unchanged, ["grafana"]);
    assert.deepEqual(outcome.skippedStopped, ["loki"]);
    assert.deepEqual(outcome.dataOwnerChanged, [{ service: "postgres", from: "old-pg", to: "new-pg" }]);
    assert.deepEqual(outcome.unclassified, ["mystery"]);
    assert.match(stdout, /step=sidecar-converge-shadow .*would-recreate=portal-tls/);
    assert.doesNotMatch(calls, / up /, "shadow mode must never run compose up");
    assert.doesNotMatch(calls, /\brm\b|restart|--force-recreate/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("a render failure is recorded as degraded and never fails the promotion", async () => {
  const f = await fixture({ configFails: true });
  try {
    const { outcome } = await promote(f);
    assert.equal(outcome.mode, "shadow");
    assert.equal(outcome.outcome, "degraded");
    assert.deepEqual(outcome.wouldRecreate, []);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
