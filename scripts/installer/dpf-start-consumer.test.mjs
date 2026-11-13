// BI-3E2F87FA — the sign-in autostart must start the platform under launchd's
// minimal PATH, wait for Docker Desktop, and record the host posture.
//
// On 2026-11-09 the LaunchAgent ran during a 24-hour outage and died with
// "dpf-start.consumer.sh: line 30: node: command not found": launchd starts
// agents with PATH=/usr/bin:/bin:/usr/sbin:/sbin, and node and docker live in
// /opt/homebrew/bin and /usr/local/bin. These tests drive the real script with
// that PATH and stub tools in a directory the script must find on its own.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile, cp } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectHostPosture,
  parseDockerAutoStart,
  parsePmsetAcSleep,
  parsePmsetBattery,
  writeHostPosture,
  HOST_POSTURE_RELATIVE_PATH,
} from "./host-posture.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const posix = process.platform !== "win32";
const MINIMAL_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

const PMSET_CUSTOM = `Battery Power:
 Sleep On Power Button 1
 sleep                1
 displaysleep         2
AC Power:
 Sleep On Power Button 1
 powernap             1
 sleep                0
 displaysleep         10
`;
const PMSET_BATT_ON_BATTERY = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t64%; discharging; 4:10 remaining present: true\n";

test("pmset and Docker settings parse to the snapshot fields", () => {
  assert.deepEqual(parsePmsetBattery(PMSET_BATT_ON_BATTERY), { powerSource: "battery", hasBattery: true });
  assert.deepEqual(parsePmsetBattery("Now drawing from 'AC Power'\n"), { powerSource: "ac", hasBattery: false });
  assert.deepEqual(parsePmsetBattery(""), { powerSource: null, hasBattery: null });
  assert.equal(parsePmsetAcSleep(PMSET_CUSTOM), 0, "reads the AC section, not the battery one");
  assert.equal(parsePmsetAcSleep(PMSET_CUSTOM.replace(" sleep                0", " sleep                10")), 10);
  assert.equal(parsePmsetAcSleep(" sleep 0\n displaysleep 10\n"), 0, "a Mac without a battery prints one profile");
  assert.equal(parsePmsetAcSleep("Battery Power:\n sleep 1\n"), null, "no AC section, no answer");
  assert.equal(parseDockerAutoStart('{"AutoStart": true}'), true);
  assert.equal(parseDockerAutoStart('{"AutoStart": false}'), false);
  assert.equal(parseDockerAutoStart("not json"), null);
});

test("collectHostPosture reads the Mac and writes the snapshot the portal expects", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-host-posture-"));
  try {
    const snapshot = collectHostPosture({
      platform: "darwin",
      now: () => new Date("2026-11-09T01:46:30.000Z"),
      home: "/Users/ops",
      run: (command, args) => (args.includes("batt") ? PMSET_BATT_ON_BATTERY : PMSET_CUSTOM),
      readText: (path) => (path.endsWith("settings-store.json") ? '{"AutoStart": true}' : ""),
    });
    assert.deepEqual(snapshot, {
      schemaVersion: 1,
      observedAt: "2026-11-09T01:46:30.000Z",
      platform: "macos",
      hasBattery: true,
      powerSource: "battery",
      acSleepMinutes: 0,
      dockerStartsAtLogin: true,
    });
    const written = writeHostPosture(dir, snapshot);
    assert.equal(written, join(dir, HOST_POSTURE_RELATIVE_PATH));
    assert.deepEqual(JSON.parse(await readFile(written, "utf8")), snapshot);
    assert.equal(collectHostPosture({ platform: "linux" }).platform, "linux");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function startFixture({ dockerUpAfter = 0 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "dpf-start-consumer-"));
  const install = join(dir, "install");
  const tools = join(dir, "tools");
  // Host commands (uname, pmset, open, curl, docker) are shadowed ahead of the
  // system ones so the test never touches the real host; node exists ONLY in
  // the tool directory the script has to add itself.
  const shadow = join(dir, "shadow");
  const home = join(dir, "home");
  const trace = join(dir, "trace");
  await mkdir(join(install, "scripts", "installer"), { recursive: true });
  await mkdir(join(install, "scripts", "lib"), { recursive: true });
  await mkdir(tools, { recursive: true });
  await mkdir(shadow, { recursive: true });
  await mkdir(join(home, "Library", "Group Containers", "group.com.docker"), { recursive: true });
  await cp(join(root, "scripts", "installer", "dpf-start.consumer.sh"), join(install, "scripts", "installer", "dpf-start.consumer.sh"));
  await cp(join(root, "scripts", "installer", "host-posture.mjs"), join(install, "scripts", "installer", "host-posture.mjs"));
  await cp(join(root, "scripts", "lib", "script-argv.mjs"), join(install, "scripts", "lib", "script-argv.mjs"));
  await writeFile(join(home, "Library", "Group Containers", "group.com.docker", "settings-store.json"), '{"AutoStart": false}');
  const stubIn = (where) => async (name, body) => {
    await writeFile(join(where, name), `#!/bin/sh\n${body}\n`);
    spawnSync("chmod", ["0755", join(where, name)]);
  };
  const stub = stubIn(tools);
  const hostStub = stubIn(shadow);
  // The real node, reachable ONLY through the tool directory, like Homebrew's.
  await stub("node", `case "$1" in scripts/lib/resolve-capability-compose-profiles.mjs) echo '{"composeProfiles":[]}' ;; *) exec '${process.execPath}' "$@" ;; esac`);
  await hostStub("uname", "echo Darwin");
  await writeFile(join(dir, "pmset-batt.txt"), PMSET_BATT_ON_BATTERY);
  await writeFile(join(dir, "pmset-custom.txt"), PMSET_CUSTOM);
  await hostStub("pmset", `case "$2" in batt) cat '${dir}/pmset-batt.txt' ;; *) cat '${dir}/pmset-custom.txt' ;; esac`);
  await hostStub("open", `echo "open $*" >> '${trace}'`);
  await hostStub("curl", "exit 0");
  // docker is shadowed too: a CI runner has a real one in /usr/bin. The proof
  // that the tool directory is added rests on node, which no minimal PATH has.
  await hostStub("docker", [
    `count_file='${dir}/docker-info-count'`,
    'if [ "$1" = "info" ]; then',
    '  n=$(cat "$count_file" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$count_file"',
    `  [ "$n" -gt ${dockerUpAfter} ] && exit 0 || exit 1`,
    "fi",
    `echo "docker $*" >> '${trace}'`,
  ].join("\n"));
  const run = (env = {}) => spawnSync("/bin/bash", [join(install, "scripts", "installer", "dpf-start.consumer.sh"), install, join(dir, "install-state.json"), "-f", "docker-compose.yml"], {
    encoding: "utf8",
    env: {
      PATH: `${shadow}:${MINIMAL_PATH}`,
      HOME: home,
      DPF_HOST_TOOL_DIRS: tools,
      DPF_HEALTH_WAIT_ATTEMPTS: "1",
      DPF_DOCKER_WAIT_INTERVAL: "0",
      DPF_DOCKER_WAIT_ATTEMPTS: "3",
      ...env,
    },
  });
  const traceText = async () => (await readFile(trace, "utf8").catch(() => ""));
  return { dir, install, run, traceText };
}

test("starts the platform under launchd's minimal PATH", { skip: !posix && "POSIX host only" }, async () => {
  const fx = await startFixture();
  try {
    const result = fx.run();
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /command not found/);
    assert.match(await fx.traceText(), /docker compose -f docker-compose\.yml up -d/);
    const posture = JSON.parse(await readFile(join(fx.install, HOST_POSTURE_RELATIVE_PATH), "utf8"));
    assert.equal(posture.platform, "macos");
    assert.equal(posture.powerSource, "battery");
    assert.equal(posture.acSleepMinutes, 0);
    assert.equal(posture.dockerStartsAtLogin, false);
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test("starts Docker Desktop and waits for it before bringing the stack up", { skip: !posix && "POSIX host only" }, async () => {
  const fx = await startFixture({ dockerUpAfter: 2 });
  try {
    const result = fx.run();
    assert.equal(result.status, 0, result.stderr);
    const trace = await fx.traceText();
    assert.match(trace, /open -g -a Docker/);
    assert.ok(trace.indexOf("open -g -a Docker") < trace.indexOf("docker compose"), "Docker is opened before compose runs");
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test("gives up after a bounded wait when Docker never starts, without running compose", { skip: !posix && "POSIX host only" }, async () => {
  const fx = await startFixture({ dockerUpAfter: 99 });
  try {
    const result = fx.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Docker did not start in time/);
    assert.doesNotMatch(await fx.traceText(), /docker compose/);
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});
