// Regression test: BOTH deadline paths in dpf_state_lock_acquire must report.
//
// dpf_state_lock_acquire gives up after a fixed budget in two places, and they
// mean the same thing -- we stopped waiting for the install-state lock:
//
//   the reclaim-race path  -- another install is mid-reclaim of the lock
//   the lock-file path     -- another install holds the lock file
//
// The lock-file path always emitted `install_state_lock_timeout`. The reclaim
// path returned 1 bare. dpf_state_init consumes it as `... || return 1` and
// install-dpf.sh called dpf_state_init bare under `set -euo pipefail`, so
// losing that particular race aborted the install with a naked exit 1 and no
// message -- the same undiagnosable shape #4367 fixed on the neighbouring
// cleanup path, one function away.
//
// These drive real bash: the bug was that a branch printed nothing, which only
// running it can show.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const libDir = dirname(fileURLToPath(import.meta.url));
const statePath = join(libDir, "state.sh").split(sep).join("/");

/** Run a bash snippet with state.sh sourced, under the installer's own flags. */
function bash(snippet, env = {}) {
  // spawnSync, not execFileSync: these assertions are ABOUT stderr, and
  // execFileSync only hands stderr back on a non-zero exit. Several cases here
  // deliberately end 0 (`|| echo RC=$?`), which would silently discard the very
  // output under test and let the assertions pass vacuously.
  const script = `set -euo pipefail
. '${statePath}'
${snippet}
`;
  const r = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "dpf-state-lock-"));
  try { return fn(dir.split(sep).join("/")); } finally { rmSync(dir, { recursive: true, force: true }); }
}

/**
 * Park an unexpired reclaim ticket against the lock so dpf_state_active_reclaim_first
 * keeps reporting "a reclaim is in progress", which is the branch under test.
 */
function parkReclaimTicket(dir) {
  const path = [dir, "install-state.json"].join("/");
  const lock = `${path}.lock`;
  const owner = "1-999-parked";
  const farFuture = Math.floor(Date.now() / 1000) + 3600;
  writeFileSync(lock, `{"protocolVersion":1,"ownerId":"${owner}","runId":"${owner}","pid":1,"hostname":"parked","acquiredAt":"x","expiresAt":"x","expiresAtEpoch":${farFuture}}\n`);
  writeFileSync(`${lock}.reclaim-parked`, `{"protocolVersion":1,"ownerId":"other","runId":"other","targetOwnerId":"${owner}","pid":1,"hostname":"parked","acquiredAt":"x","expiresAt":"x","expiresAtEpoch":${farFuture}}\n`);
  return path;
}

test("the reclaim-race deadline reports instead of returning 1 in silence", () => {
  withTempDir((dir) => {
    const path = parkReclaimTicket(dir);
    const r = bash(`dpf_state_lock_acquire '${path}' || echo "RC=$?"`, {
      DPF_STATE_LOCK_TIMEOUT_SECONDS: "1",
    });
    assert.match(r.stdout, /RC=1/, "the deadline must still fail the acquisition");
    assert.match(
      r.stderr,
      /install_state_lock_timeout/,
      `the reclaim deadline must say why it gave up; got stderr: ${JSON.stringify(r.stderr)}`,
    );
  });
});

test("the two deadline paths are distinguishable in the log", () => {
  withTempDir((dir) => {
    const path = parkReclaimTicket(dir);
    const r = bash(`dpf_state_lock_acquire '${path}' || true`, {
      DPF_STATE_LOCK_TIMEOUT_SECONDS: "1",
    });
    assert.match(r.stderr, /reclaim in progress/, "reclaim-race timeout must name the reclaim race");
  });
});

test("the wait budget is overridable so a timeout is reachable without a 30s wall clock", () => {
  withTempDir((dir) => {
    const path = parkReclaimTicket(dir);
    const started = Date.now();
    bash(`dpf_state_lock_acquire '${path}' || true`, { DPF_STATE_LOCK_TIMEOUT_SECONDS: "1" });
    assert.ok(Date.now() - started < 15000, "a 1s budget must not wait the default 30s");
  });
});

test("an uncontended lock is still acquired, and says nothing", () => {
  withTempDir((dir) => {
    const path = [dir, "install-state.json"].join("/");
    const r = bash(`dpf_state_lock_acquire '${path}'\necho ACQUIRED`);
    assert.equal(r.status, 0, `uncontended acquire must succeed: ${r.stderr}`);
    assert.match(r.stdout, /ACQUIRED/);
    assert.doesNotMatch(r.stderr, /install_state_lock_timeout/, "the happy path must stay quiet");
  });
});
