import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const lib = dirname(fileURLToPath(import.meta.url));
const root = resolve(lib, "../../..");

// Source the real library, replacing every host-mutating command with a shell
// function. No test installs packages, writes /etc, or starts a Docker daemon.
function run({ distro = "ubuntu", existing = false, compose = "v2.38.2", fail = "", conflict = "", platform = "linux", caller = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "dpf-docker-test-"));
  try {
    const osRelease = join(dir, "os-release");
    const log = join(dir, "commands");
    writeFileSync(osRelease, `ID=${distro}\nVERSION_CODENAME=noble\nVERSION_ID=24.04\n`);
    writeFileSync(log, "");
    let action = existing ? "dpf_docker_ensure_installed" : 'dpf_docker_install_linux "$TEST_OS_RELEASE"';
    if (caller) {
      const installer = readFileSync(join(root, "install-dpf.sh"), "utf8");
      action = installer.slice(installer.indexOf('step "Docker Engine"'), installer.indexOf("# 6. Verify Node.js"));
    }
    const script = `
set -euo pipefail
. "$TEST_LIB/docker.sh"
dpf_platform() { DPF_PLATFORM="$TEST_PLATFORM"; }
dpf_docker_version() { if [ "$TEST_EXISTING" = 1 ]; then echo 28.0.4; fi; }
docker() {
  printf 'docker %s\\n' "$*" >> "$TEST_LOG"
  case "$1" in
    compose) [ "$TEST_COMPOSE" != missing ] || return 1; echo "$TEST_COMPOSE" ;;
    info) [ "$TEST_FAIL" != daemon ] ;;
    --version) echo 'Docker version 28.0.4, build fixture' ;;
    *) return 1 ;;
  esac
}
dpkg() { echo amd64; }
dpkg-query() {
  case "$*" in *"$TEST_CONFLICT"*) [ -n "$TEST_CONFLICT" ] || return 1; echo 'install ok installed';; *) return 1;; esac
}
rpm() { [ -n "$TEST_CONFLICT" ] && case "$*" in *"$TEST_CONFLICT"*) return 0;; *) return 1;; esac; }
curl() { [ "$TEST_FAIL" != repository ] || return 1; echo fixture-repository; }
sudo() {
  printf 'sudo %s\\n' "$*" >> "$TEST_LOG"
  case "$1" in
    apt-get|dnf|env)
      [ "$TEST_FAIL" != packages ] || return 1
      case "$*" in *docker-ce*) TEST_EXISTING=1;; esac ;;
    install|chmod) return 0 ;;
    curl) shift; curl "$@" ;;
    tee) cat >/dev/null ;;
    systemctl) [ "$TEST_FAIL" != service ] ;;
    usermod) [ "$TEST_FAIL" != group ] ;;
    docker) shift; docker "$@" ;;
    *) echo "Unexpected privileged command: $*" >&2; return 99 ;;
  esac
}
systemctl() { [ "$TEST_FAIL" != service ]; }
id() { case "$1" in -u) echo 1000;; -un) echo fixture-user;; *) echo fixture-user;; esac; }
if [ "$TEST_CALLER" = 1 ]; then dpf_docker_ensure_installed() { return 75; }; fi
${caller ? action : `if ${action}; then exit 0; else exit $?; fi`}
`;
    const result = spawnSync("bash", ["-c", script], {
      encoding: "utf8", timeout: 10000,
      env: { ...process.env, TEST_LIB: lib, TEST_OS_RELEASE: osRelease, TEST_LOG: log,
        TEST_EXISTING: existing ? "1" : "0", TEST_COMPOSE: compose, TEST_FAIL: fail,
        TEST_CONFLICT: conflict, TEST_PLATFORM: platform, TEST_CALLER: caller ? "1" : "0",
        USER: "fixture-user", SUDO_USER: "fixture-user" },
    });
    assert.ifError(result.error);
    return { ...result, commands: readFileSync(log, "utf8") };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

for (const platform of ["linux", "darwin"]) {
  test(`preserves working ${platform} Docker and Compose without package changes`, () => {
    const r = run({ existing: true, platform });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.commands, /docker compose version/);
    assert.doesNotMatch(r.commands, /sudo/);
  });
}

for (const compose of ["missing", "1.29.2", "invalid"]) {
  test(`refuses an existing Engine with unusable Compose (${compose})`, () => {
    const r = run({ existing: true, compose });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /[Cc]ompose/);
    assert.doesNotMatch(r.commands, /sudo/);
  });
}

for (const distro of ["ubuntu", "debian", "fedora"]) {
  test(`fresh ${distro} uses the official coherent package family then requests re-login`, () => {
    const r = run({ distro });
    assert.equal(r.status, 75, r.stderr);
    assert.match(r.commands, new RegExp(`download.docker.com/linux/${distro}`));
    assert.match(r.commands, /docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin/);
    assert.doesNotMatch(r.commands, /install.*(?:docker\.io|moby-engine)/);
    assert.match(r.commands, /docker compose version/);
    assert.match(r.commands, /systemctl enable --now docker/);
    assert.match(r.commands, /usermod -aG docker fixture-user/);
  });
}

for (const fail of ["repository", "packages", "service", "daemon", "group"]) {
  test(`fresh setup reports ${fail} failure instead of success or re-login`, () => {
    const r = run({ fail });
    assert.notEqual(r.status, 0);
    assert.notEqual(r.status, 75);
    assert.match(r.stderr, /FAIL|Failed|failed|not reachable/);
    assert.doesNotMatch(r.stdout, /Added 'fixture-user'/);
  });
}

test("fresh setup cannot proceed with missing Compose after package installation", () => {
  const r = run({ compose: "missing" });
  assert.notEqual(r.status, 0);
  assert.notEqual(r.status, 75);
  assert.match(r.stderr, /[Cc]ompose/);
  assert.doesNotMatch(r.commands, /usermod/);
});

test("conflicting packages are reported before privileged writes and never removed", () => {
  const r = run({ conflict: "containerd" });
  assert.notEqual(r.status, 0);
  assert.notEqual(r.status, 75);
  assert.match(r.stderr, /containerd/);
  assert.doesNotMatch(r.commands, /sudo/);
});

test("installer explains the re-login status under errexit", () => {
  const r = run({ caller: true });
  assert.equal(r.status, 75);
  assert.match(r.stdout, /Re-run install-dpf.sh after logging out/);
});
