import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));

function drive({ platform = 'Darwin', headless = false, allow = false, answer = 'no', helperCode = 75 } = {}) {
  return spawnSync('bash', ['-c', `
    set -euo pipefail
    . scripts/installer/lib/prompts.sh
    . scripts/installer/lib/macos-memory.sh
    REPO_ROOT="$PWD"
    DPF_HEADLESS=${headless ? 1 : 0}
    DPF_ALLOW_DOCKER_RESTART=${allow ? 1 : 0}
    uname() { echo '${platform}'; }
    warn() { echo "WARN:$*"; }
    node() {
      echo "HELPER:$*"
      case "$*" in *--allow-docker-restart*) return 0 ;; esac
      return ${helperCode}
    }
    dpf_converge_macos_memory
  `], { cwd: root, encoding: 'utf8', input: `${answer}\n` });
}

test('headless refuses interruption without explicit consent', () => {
  const r = drive({ headless: true });
  assert.equal(r.status, 75);
  assert.ok(!r.stdout.includes('--allow-docker-restart'));
});
test('interactive acceptance retries with explicit restart permission', () => {
  const r = drive({ answer: 'yes' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.match(/HELPER:/g).length, 2);
  assert.ok(r.stdout.includes('--allow-docker-restart'));
});
test('decline stops setup, while explicit flag permits unattended interruption', () => {
  assert.equal(drive().status, 75);
  const r = drive({ headless: true, allow: true });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.match(/HELPER:/g).length, 1);
});
test('Linux skips macOS helper and unrelated errors never request consent', () => {
  assert.equal(drive({ platform: 'Linux' }).stdout, '');
  const r = drive({ helperCode: 1 });
  assert.equal(r.status, 1);
  assert.ok(!r.stdout.includes('Restart Docker Desktop now?'));
});
