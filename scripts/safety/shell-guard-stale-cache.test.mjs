// The guard caches an absolute path to each real binary at install time and, before
// this test existed, never revalidated it. That is fine until a tool moves -- and
// tools move on every upgrade.
//
// Observed on a real install: Docker Desktop relocated its CLI out of
//   C:\Program Files\Docker\Docker\resources\bin\docker.exe
// into a per-user %LOCALAPPDATA%\Programs\DockerDesktop path within hours, leaving
// the directory behind but the exe gone. Because install-dpf prepends safety-bin to
// the *user* PATH, every `docker` call for the whole account then failed with
//   [dpf-shell-guard] cannot find real docker (set DPF_REAL_DOCKER or reinstall)
// i.e. DPF told the operator to reinstall DPF because Docker updated itself. Docker
// Desktop auto-updates, so this reaches every install eventually, and DPF's entire
// stack is Docker.
//
// This drives the REAL POSIX guard under bash rather than asserting on source text:
// the behaviour under test is "stale cache -> still runs the right binary", which
// source matching cannot demonstrate.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const guardSrc = join(repoRoot, "scripts", "safety", "dpf-shell-guard.sh");

/** Git Bash on Windows, /bin/bash elsewhere. Skip cleanly if neither is usable. */
function bashOrSkip(t) {
  for (const candidate of ["bash", "C:/Program Files/Git/bin/bash.exe"]) {
    try {
      execFileSync(candidate, ["-c", "true"], { stdio: "ignore" });
      return candidate;
    } catch {
      /* try next */
    }
  }
  t.skip("no usable bash on this host");
  return null;
}

/**
 * Build an isolated safety-bin with a deliberately stale cached path.
 * `provideReal: false` omits the on-PATH binary, so the tool is genuinely absent.
 */
function stageGuard({ cached, tool = "dpftool", provideReal = true }) {
  const dir = mkdtempSync(join(tmpdir(), "dpf-guard-"));
  const guardDir = join(dir, "safety-bin");
  const realDir = join(dir, "realbin");
  mkdirSync(guardDir);
  mkdirSync(realDir);

  // The installer symlinks the guard under the tool's own name and the guard reads
  // BIN_NAME from basename "$0" -- so it must be staged as the tool name, not as
  // dpf-shell-guard.sh, or it looks up DPF_REAL_DPF-SHELL-GUARD.SH instead.
  const shim = join(guardDir, tool);
  copyFileSync(guardSrc, shim);
  chmodSync(shim, 0o755);

  if (provideReal) {
    // The genuine tool, reachable only via PATH -- never via the cache.
    const real = join(realDir, tool);
    writeFileSync(real, "#!/bin/sh\necho REAL_TOOL_RAN \"$@\"\n");
    chmodSync(real, 0o755);
  }

  // Mirror the guard exactly: DPF_REAL_$(echo "$BIN_NAME" | tr a-z A-Z), no other
  // munging. Keep test tool names hyphen-free so the derived name stays a legal
  // shell variable.
  const varName = `DPF_REAL_${tool.toUpperCase()}`;
  writeFileSync(join(guardDir, "real-binaries.env"), `${varName}=${cached}\n`);
  return { dir, guardDir, realDir, tool, envFile: join(guardDir, "real-binaries.env") };
}

/**
 * PATH separator seen by the guard. Git Bash on Windows runs a POSIX shell, so the
 * shell splits PATH on ':' even though the host is win32.
 */
const PATH_SEP = ":";

function runGuard(bash, { guardDir, realDir }, args = ["--version"]) {
  return execFileSync(
    bash,
    [join(guardDir, "dpftool").replace(/\\/g, "/"), ...args],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${realDir.replace(/\\/g, "/")}${PATH_SEP}${process.env.PATH}`,
        // Stub the kernel gate so the test never needs a running portal.
        DPF_GATE_CMD: `echo '{"verdict":"allow"}'`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

test("a stale cached path re-resolves from PATH instead of exiting 127", (t) => {
  const bash = bashOrSkip(t);
  if (!bash) return;

  const staged = stageGuard({ cached: "/nonexistent/moved/by/an/upgrade/dpftool" });
  t.after(() => rmSync(staged.dir, { recursive: true, force: true }));

  let out;
  try {
    out = runGuard(bash, staged);
  } catch (err) {
    assert.fail(
      "guard exited non-zero on a stale cached path -- it should re-resolve from PATH. " +
        `status=${err.status} stderr=${String(err.stderr).trim()}`,
    );
  }

  assert.match(
    out,
    /REAL_TOOL_RAN/,
    "the guard must actually execute the re-resolved binary, not merely survive",
  );
});

test("the repaired path is written back so the next call is a plain lookup", (t) => {
  const bash = bashOrSkip(t);
  if (!bash) return;

  const staged = stageGuard({ cached: "/nonexistent/moved/by/an/upgrade/dpftool" });
  t.after(() => rmSync(staged.dir, { recursive: true, force: true }));

  runGuard(bash, staged);

  const env = readFileSync(staged.envFile, "utf8");
  assert.doesNotMatch(env, /nonexistent/, "the stale entry must be removed, not merely appended past");
  assert.match(env, /DPF_REAL_DPFTOOL=.*dpftool/, "the re-resolved path must be cached back");
  assert.equal(
    env.split(/\r?\n/).filter((l) => l.startsWith("DPF_REAL_DPFTOOL=")).length,
    1,
    "self-heal must replace the entry, not accumulate duplicates across upgrades",
  );
});

test("a genuinely absent binary still fails, and says so without blaming DPF", (t) => {
  const bash = bashOrSkip(t);
  if (!bash) return;

  // Use a tool that exists nowhere rather than emptying PATH: the guard's own
  // re-resolution needs tr/grep/paste, so a stripped PATH would test the wrong
  // failure. Absence must be the tool's, not the shell's.
  const staged = stageGuard({
    cached: "/nonexistent/dpfabsent",
    tool: "dpfabsent",
    provideReal: false,
  });
  t.after(() => rmSync(staged.dir, { recursive: true, force: true }));

  assert.throws(
    () =>
      execFileSync(bash, [join(staged.guardDir, "dpfabsent").replace(/\\/g, "/"), "--version"], {
        encoding: "utf8",
        env: { ...process.env, DPF_GATE_CMD: `echo '{"verdict":"allow"}'` },
        stdio: ["ignore", "pipe", "pipe"],
      }),
    (err) => {
      assert.equal(err.status, 127, "a truly missing binary must still exit 127");
      assert.match(
        String(err.stderr),
        /on PATH or at the cached path/,
        "the message should describe what was searched, not tell the operator to reinstall DPF",
      );
      return true;
    },
  );
});
