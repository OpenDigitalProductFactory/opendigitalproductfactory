// Regression test: dpf_state_cleanup_temps must never abort a `set -e` installer.
//
// install-dpf.sh runs under `set -euo pipefail` (line 34) and calls
// dpf_state_cleanup_temps bare, inside dpf_state_init. The loop
//
//   for temp in "$directory/.${base}.tmp-"*; do [ -f "$temp" ] && rm -f "$temp"; done
//
// has no nullglob, so on a FRESH install -- no leftover temp files, i.e. the normal
// case -- the glob stays literal, `[ -f ]` is false, and that false test is the
// loop's last command, so the function returned 1. Every fresh Linux/macOS install
// therefore died immediately after
//
//   -> Install state
//      -  No prior install state; initializing ~/.dpf/install-state.json
//   ##[error]Process completed with exit code 1
//
// with no error message at all. It also silently disabled the publish workflow's
// "E2E install verification (release mode)" job -- the check meant to catch exactly
// this class of breakage.
//
// These tests drive real bash, because the bug is a shell-semantics bug: asserting
// on the source text would not have caught it.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const libDir = dirname(fileURLToPath(import.meta.url));
const statePath = join(libDir, "state.sh").replace(/\\/g, "/");

/** Run a bash snippet with state.sh sourced. Returns {status, stdout, stderr}. */
function bash(snippet, { strict = true } = {}) {
  const script = `${strict ? "set -euo pipefail" : ""}\n. '${statePath}'\n${snippet}\n`;
  try {
    const stdout = execFileSync("bash", ["-c", script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "dpf-state-cleanup-"));
  try { return fn(dir.replace(/\\/g, "/")); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("returns 0 when there are NO temp files — the fresh-install case that broke", () => {
  withTempDir((dir) => {
    const r = bash(`dpf_state_cleanup_temps '${dir}/install-state.json'\necho SURVIVED`);
    assert.equal(r.status, 0, `aborted under set -e: ${r.stderr}`);
    assert.match(r.stdout, /SURVIVED/, "the caller must continue past cleanup on a fresh install");
  });
});

test("does not abort the caller when invoked bare under set -e", () => {
  // Exactly how dpf_state_init calls it: no `|| rc=$?`, which would mask set -e.
  withTempDir((dir) => {
    const r = bash(`dpf_state_cleanup_temps '${dir}/install-state.json'\necho AFTER=$?`);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /AFTER=0/);
  });
});

test("still removes leftover temp files when they exist", () => {
  withTempDir((dir) => {
    const a = join(dir, ".install-state.json.tmp-1-111-222");
    const b = join(dir, ".install-state.json.tmp-9-999-999");
    writeFileSync(a, "stale");
    writeFileSync(b, "stale");
    const r = bash(`dpf_state_cleanup_temps '${dir}/install-state.json'\necho CLEANED`);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /CLEANED/);
    assert.equal(existsSync(a), false, "leftover temp must be removed");
    assert.equal(existsSync(b), false, "leftover temp must be removed");
  });
});

test("leaves unrelated files in the state directory alone", () => {
  withTempDir((dir) => {
    const keep = join(dir, "install-state.json");
    const alsoKeep = join(dir, ".install-state.json.lock");
    writeFileSync(keep, "{}");
    writeFileSync(alsoKeep, "lock");
    const r = bash(`dpf_state_cleanup_temps '${dir}/install-state.json'`);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(keep), true, "the state file itself must survive");
    assert.equal(existsSync(alsoKeep), true, "the lock file must survive");
  });
});

test("dpf_state_init completes under set -e on a pristine state dir", () => {
  // The end-to-end shape of the outage: dpf_state_init calls cleanup_temps bare.
  withTempDir((dir) => {
    const r = bash(
      `export DPF_STATE_DIR='${dir}'\n` +
      `dpf_state_init 'test-installer' '${dir}'\n` +
      `echo INIT_OK`,
    );
    // DPF_STATE_DIR is honoured by dpf_state_dir(), so this stays hermetic and
    // never touches the operator's real ~/.dpf.
    assert.doesNotMatch(
      r.stderr,
      /line \d+: .*cleanup_temps/,
      `cleanup must not be the abort site: ${r.stderr}`,
    );
    assert.equal(r.status, 0, `dpf_state_init aborted under set -e: ${r.stderr}`);
    assert.match(r.stdout, /INIT_OK/);
  });
});
