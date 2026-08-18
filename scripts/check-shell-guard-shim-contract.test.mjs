// Contract test for the Windows safety-bin shim + dpf-shell-guard.ps1 parameter
// binding.
//
// Why this exists: the installer prepends $DPF_DIR\safety-bin to the USER PATH in
// the registry and puts git.cmd / docker.cmd / prisma.cmd there. If the guard those
// shims call cannot bind its arguments, git, docker and prisma break for the whole
// user account, in every terminal, persistently — and the installer itself fails at
// "Step 7: Starting the platform", which calls `git -C "$DPF_DIR" rev-parse HEAD`.
//
// That shipped twice, from two separate PowerShell binding rules:
//
//   1. `-BinName $tool -- %*` in the generated shim. Under `pwsh -File`, `--` parses
//      as a parameter prefix with an EMPTY name:
//        "Parameter cannot be processed because the parameter name '' is ambiguous"
//   2. An ADVANCED param block (any [Parameter()] attribute or [CmdletBinding()])
//      adds the common parameters and enables prefix matching, so forwarded
//      third-party flags bind to the script's own parameters:
//        docker compose up -d       -> '-d' prefix-matches -Debug
//        docker compose -f file.yml -> '-f' prefix-matches -ForwardedArgs
//      and a parameter literally named $Args also collides with the automatic $args.
//
// These are static, cross-platform assertions on purpose: the round-trip behaviour
// only reproduces on Windows with pwsh, but the *shape* that causes it is greppable,
// so this guard runs on Linux CI where the rest of the source profile runs.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const installerPath = join(repoRoot, "install-dpf.ps1");
const guardPath = join(repoRoot, "scripts", "safety", "dpf-shell-guard.ps1");

const installer = readFileSync(installerPath, "utf8");
const guard = readFileSync(guardPath, "utf8");

/** The `param( ... )` block at the top of the guard script. */
function guardParamBlock(source) {
  const start = source.search(/^param\s*\(/m);
  assert.notEqual(start, -1, "dpf-shell-guard.ps1 must declare a param() block");
  let depth = 0;
  for (let i = source.indexOf("(", start); i < source.length; i += 1) {
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error("unterminated param() block in dpf-shell-guard.ps1");
}

/** The generated shim line(s) in the installer. */
function shimTemplateLines(source) {
  return source
    .split(/\r?\n/)
    .filter((line) => line.includes("dpf-shell-guard.ps1") && line.includes("-BinName"));
}

test("the generated .cmd shims do not pass a `--` separator", () => {
  const lines = shimTemplateLines(installer);
  assert.ok(
    lines.length > 0,
    "install-dpf.ps1 must still generate safety-bin shims that invoke dpf-shell-guard.ps1",
  );
  for (const line of lines) {
    assert.doesNotMatch(
      line,
      /-BinName\s+\$?\w+\s+--\s/,
      "shim passes `-- %*`; pwsh -File parses `--` as a parameter with an empty name " +
        "and every guarded command dies with \"the parameter name '' is ambiguous\". " +
        `Offending line: ${line.trim()}`,
    );
  }
});

test("the generated .cmd shims still forward %*", () => {
  for (const line of shimTemplateLines(installer)) {
    assert.match(
      line,
      /%\*/,
      `shim must forward %* to the guard. Offending line: ${line.trim()}`,
    );
  }
});

test("dpf-shell-guard.ps1 stays a SIMPLE script (no advanced-binding attributes)", () => {
  const block = guardParamBlock(guard);
  assert.doesNotMatch(
    block,
    /\[Parameter\s*\(/i,
    "param() declares a [Parameter()] attribute, which makes this an advanced script: " +
      "common parameters appear and forwarded flags like -d/-f prefix-match them",
  );
  assert.doesNotMatch(
    guard,
    /^\s*\[CmdletBinding\s*\(/im,
    "[CmdletBinding()] makes this an advanced script; forwarded flags then bind to " +
      "-Debug/-Verbose/-ErrorAction instead of passing through",
  );
});

test("dpf-shell-guard.ps1 does not declare a parameter named $Args", () => {
  const block = guardParamBlock(guard);
  assert.doesNotMatch(
    block,
    /\$Args\b/i,
    "a parameter named $Args collides with PowerShell's automatic $args variable",
  );
});

test("dpf-shell-guard.ps1 declares -BinName and reads pass-through args from $args", () => {
  const block = guardParamBlock(guard);
  assert.match(block, /\$BinName\b/, "guard must still accept -BinName");
  assert.match(
    guard,
    /\$args\b/,
    "guard must read forwarded arguments from the automatic $args",
  );
});

test("dpf-shell-guard.ps1 tolerates a legacy `--` from an already-installed shim", () => {
  // An install upgraded in place still has the old safety-bin\*.cmd on disk until
  // the installer regenerates it, so the guard must strip a leading `--` itself.
  assert.match(
    guard,
    /-eq\s*'--'/,
    "guard must strip a leading `--` so installs with a pre-fix shim keep working",
  );
});
