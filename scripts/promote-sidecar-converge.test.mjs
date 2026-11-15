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
    "portal-tls": { labels: { "dpf.recreate-class": "stateless" },
      ports: [{ host_ip: "0.0.0.0", target: 443, published: "443", protocol: "tcp" }] },
    grafana: { labels: { "dpf.recreate-class": "stateless" },
      ports: [{ host_ip: "0.0.0.0", target: 3000, published: "3002", protocol: "tcp" }] },
    loki: { labels: { "dpf.recreate-class": "stateless" } },
    postgres: { labels: { "dpf.recreate-class": "data-owner" } },
    portal: { labels: { "dpf.recreate-class": "managed" } },
    mystery: {},
  },
};
const hash = (digit) => digit.repeat(64);
const DESIRED = { "portal-tls": hash("2"), grafana: hash("3"), loki: hash("7"), postgres: hash("5"), portal: hash("9"), mystery: hash("b") };
// service, container config-hash label, state, published ports (docker ps .Ports)
const RUNNING = [
  ["portal-tls", hash("1"), "running", "127.0.0.1:443->443/tcp"],
  ["grafana", hash("3"), "running", "0.0.0.0:3002->3000/tcp, [::]:3002->3000/tcp"],
  ["loki", hash("6"), "exited"],
  ["postgres", hash("4"), "running"],
  ["portal", hash("8"), "running"],
  ["mystery", hash("a"), "running"],
];

async function fixture({ configFails = false, running = RUNNING, desired = DESIRED } = {}) {
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
  await writeFile(join(dir, "hashes.txt"), Object.entries(desired).map(([s, h]) => `${s} ${h}`).join("\n") + "\n");
  await writeFile(join(dir, "running.tsv"), running.map((row, index) => [row[0], row[1], row[2], row[3] ?? "", row[4] ?? (index + 1).toString(16).padStart(64, "0")].join("\t")).join("\n") + "\n");
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
    assert.deepEqual(outcome.wouldRecreate, []);
    assert.deepEqual(outcome.unchanged, ["grafana"]);
    assert.deepEqual(outcome.skippedStopped, ["loki"]);
    assert.deepEqual(outcome.dataOwnerChanged, [{ service: "postgres", from: hash("4"), to: hash("5") }]);
    assert.equal(outcome.outcome, "would-recreate", "qualified data-owner drift must not be reported as current");
    assert.deepEqual(outcome.unclassified, ["mystery"]);
    assert.match(stdout, /step=sidecar-converge-shadow .*would-recreate=none/);
    assert.doesNotMatch(calls, / up /, "shadow mode must never run compose up");
    assert.doesNotMatch(calls, /\brm\b|restart|--force-recreate/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

// BI-94C4722B: the live shadow report (SUR-37F6FC92) showed 7e would recreate
// portal-tls on 0.0.0.0 although it was created on 127.0.0.1. A converge step
// must never widen (or narrow) a published port's exposure as a side effect:
// a host-IP difference is reported as bindDrift and never recreated.
test("a running service whose published host IP differs from the render is bindDrift, never would-recreate", async () => {
  const f = await fixture();
  try {
    const { stdout, outcome } = await promote(f);
    assert.deepEqual(outcome.bindDrift, [{ service: "portal-tls", port: "443", running: "127.0.0.1", rendered: "0.0.0.0" }]);
    assert.ok(!outcome.wouldRecreate.some((c) => c.service === "portal-tls"));
    assert.match(stdout, /bind-drift=portal-tls/);
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

// BI-BD708C80: project/service labels alone also matched a diagnostic postgres
// on the live install. The shadow report must not call that a canonical change.
for (const [name, running, desired] of [
  ["duplicate service owners", [["postgres", hash("5"), "running"], ["postgres", "", "running"]], DESIRED],
  ["missing observed hash", [["postgres", "", "running"]], DESIRED],
  ["invalid observed hash", [["postgres", "not-a-config-hash", "running"]], DESIRED],
  ["missing desired hash", [["postgres", hash("4"), "running"]], { ...DESIRED, postgres: "" }],
  ["invalid desired hash", [["postgres", hash("4"), "running"]], { ...DESIRED, postgres: "bad-hash" }],
  ["invalid container identity", [["postgres", hash("4"), "running", "", "short-id"]], DESIRED],
  ["missing container identity", [["postgres", hash("4"), "running", "", ""]], DESIRED],
]) test(`shadow inventory refuses ${name} without change candidates`, async () => {
  const f = await fixture({ running, desired });
  try {
    const { outcome, calls } = await promote(f);
    assert.equal(outcome.outcome, "degraded");
    assert.deepEqual(outcome.failed, ["postgres"]);
    assert.deepEqual(outcome.dataOwnerChanged, []);
    assert.deepEqual(outcome.wouldRecreate, []);
    assert.doesNotMatch(calls, /\b(?:up|rm|restart)\b|--force-recreate/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("one container ID cannot qualify two service observations", async () => {
  const id = hash("c");
  const f = await fixture({ running: [["postgres", hash("4"), "running", "", id], ["grafana", hash("3"), "running", "", id]] });
  try {
    const { outcome, calls } = await promote(f);
    assert.equal(outcome.outcome, "degraded");
    assert.deepEqual(outcome.failed, ["grafana", "postgres"]);
    assert.deepEqual(outcome.unchanged, []);
    assert.deepEqual(outcome.dataOwnerChanged, []);
    assert.deepEqual(outcome.wouldRecreate, []);
    assert.doesNotMatch(calls, /\b(?:up|rm|restart)\b|--force-recreate/);
    assert.match(calls, /ps -a --no-trunc/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("shadow inventory distinguishes stopped and unchanged data owners", async () => {
  for (const [state, current, skipped, unchanged] of [
    ["exited", hash("4"), ["postgres"], []],
    ["running", hash("5"), [], ["postgres"]],
  ]) {
    const f = await fixture({ running: [["postgres", current, state]] });
    try {
      const { outcome, calls } = await promote(f);
      assert.deepEqual(outcome.dataOwnerChanged, []);
      assert.deepEqual(outcome.skippedStopped, skipped);
      assert.deepEqual(outcome.unchanged, unchanged);
      assert.doesNotMatch(calls, /\b(?:up|rm|restart)\b|--force-recreate/);
    } finally { await rm(f.dir, { recursive: true, force: true }); }
  }
});
