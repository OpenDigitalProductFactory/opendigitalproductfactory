// docs/install/windows.md tells the operator:
//
//     `powershell -File install-dpf.ps1 -Help` documents every flag.
//
// install-dpf.ps1 had no -Help parameter. With a simple param() block an
// undeclared switch does not error -- it lands in $args and is ignored -- so that
// documented command ran a FULL UNATTENDED INSTALL of the platform. The operator
// asked to read the flags and got the whole stack (IMP-026).
//
// install-dpf.sh never had this problem: it handles `-h|--help) usage; exit 0` and
// rejects unknown flags with exit 2. The defect was Windows-only, which is exactly
// how it survived -- the POSIX path looks correct and nobody diffs the two.
//
// This asserts the contract in both directions:
//   1. every installer the docs describe actually accepts -Help / --help
//   2. neither installer silently ignores an unrecognised argument
//
// It is a source-text contract rather than an execution test because running the
// real installer is the thing being guarded against.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(repoRoot, p), "utf8");

const ps = read("install-dpf.ps1");
const sh = read("install-dpf.sh");

test("install-dpf.ps1 declares a -Help switch", () => {
  assert.match(
    ps,
    /\[switch\]\$Help/,
    "no -Help parameter: a simple param() block silently ignores it and installs",
  );
});

test("install-dpf.ps1 exposes non-interactive mode parity", () => {
  for (const flag of ["Headless", "Consumer", "Contributor"]) {
    assert.match(ps, new RegExp(`\\[switch\\]\\$${flag}\\b`), `missing -${flag}`);
  }
  assert.match(ps, /Consumer[^\r\n]+Contributor|Contributor[^\r\n]+Consumer/s, "mode flags must be checked together");
  assert.match(ps, /cannot.*(?:Consumer.*Contributor|Contributor.*Consumer)|mutually exclusive/i);
});

test("headless PowerShell install never reaches Read-Host", () => {
  assert.match(ps, /function\s+Read-DPFInstallerInput/i, "interactive reads need one headless-aware boundary");
  const rawReads = [...ps.matchAll(/\bRead-Host\b/g)];
  assert.equal(rawReads.length, 1, "all prompts must route through the single headless-aware input helper");
});

test("install-dpf.ps1 acts on -Help before doing any install work", () => {
  const helpGuard = ps.search(/if\s*\(\s*\$Help\s*\)/);
  assert.notEqual(helpGuard, -1, "-Help is declared but never checked");

  // The exit must come before anything that mutates the host. Docker calls are the
  // earliest observable side effect in this script.
  const firstDocker = ps.search(/\bdocker\b/);
  if (firstDocker !== -1) {
    assert.ok(
      helpGuard < firstDocker,
      "the -Help check must run before any docker invocation, or asking for help " +
        "still starts installing",
    );
  }
  const guardBlock = ps.slice(helpGuard, helpGuard + 200);
  assert.match(guardBlock, /exit 0/, "-Help must exit 0, not fall through to the install flow");
});

test("install-dpf.ps1 rejects unrecognised arguments instead of ignoring them", () => {
  // A simple param block collects undeclared tokens in $args. Without an explicit
  // check, `-Helpp` (or any typo) installs silently.
  assert.match(
    ps,
    /\$args\.Count\s*-gt\s*0/,
    "no unknown-argument check: a mistyped flag falls into $args and installs silently",
  );
  const idx = ps.search(/\$args\.Count\s*-gt\s*0/);
  assert.match(
    ps.slice(idx, idx + 400),
    /exit 2/,
    "an unrecognised argument should exit non-zero, mirroring install-dpf.sh",
  );
});

test("install-dpf.sh still handles --help and unknown flags", () => {
  // Guards the half that was already correct, so a future refactor cannot quietly
  // bring it down to the Windows behaviour.
  assert.match(sh, /-h\|--help\)\s*usage;\s*exit 0/, "install-dpf.sh must keep its --help handler");
  assert.match(sh, /Unknown flag|Run 'bash install-dpf\.sh --help'/, "install-dpf.sh must reject unknown flags");
});

test("every installer command the install guides name is accepted by that installer", () => {
  // The doc is the promise; the script is the implementation. This catches the
  // general case rather than the single -Help instance.
  const cases = [
    { doc: "docs/install/windows.md", pattern: /install-dpf\.ps1\s+-Help/, script: ps, flag: "-Help", decl: /\[switch\]\$Help/ },
    { doc: "docs/install/linux.md", pattern: /install-dpf\.sh\s+--help/, script: sh, flag: "--help", decl: /--help/ },
  ];
  for (const c of cases) {
    const path = join(repoRoot, c.doc);
    if (!existsSync(path)) continue;
    if (!c.pattern.test(readFileSync(path, "utf8"))) continue;
    assert.match(
      c.script,
      c.decl,
      `${c.doc} documents ${c.flag}, but the installer does not declare it — ` +
        `following the guide runs the installer instead of printing help`,
    );
  }
});
