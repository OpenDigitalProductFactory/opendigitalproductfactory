// BI-7371D444: the installer's .wslconfig writer must put each key in the
// section WSL reads it from. autoMemoryReclaim is an [experimental] key; under
// [wsl2] WSL ignores it and reclaim never happens.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const installer = join(root, "install-dpf.ps1");
const pwsh = ["pwsh", "powershell"].find(
  (shell) => spawnSync(shell, ["-NoProfile", "-Command", "exit 0"], { encoding: "utf8" }).status === 0,
);

function writeWslConfig(initial) {
  const path = join(mkdtempSync(join(tmpdir(), "dpf-wslconfig-")), ".wslconfig");
  if (initial !== null) writeFileSync(path, initial);
  const script = [
    `$env:DPF_INSTALLER_LIBRARY_ONLY = "1"`,
    `. '${installer.replaceAll("'", "''")}' -LibraryOnly`,
    `$p = '${path.replaceAll("'", "''")}'`,
    `Add-WslConfigKeysIfMissing -Path $p -Desired ([ordered]@{ "memory" = "24GB"; "processors" = "12" }) -Section "wsl2" | Out-Null`,
    `Move-WslConfigKeyToSection -Path $p -Key "autoMemoryReclaim" -FromSection "wsl2" -ToSection "experimental" | Out-Null`,
    `Add-WslConfigKeysIfMissing -Path $p -Desired ([ordered]@{ "autoMemoryReclaim" = "gradual" }) -Section "experimental" | Out-Null`,
  ].join("\n");
  const run = spawnSync(pwsh, ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

const keyLine = (key) => new RegExp(String.raw`^\s*${key}\s*=`);

function sectionOf(text, key) {
  let section = null;
  for (const line of text.split("\n")) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header) section = header[1];
    else if (keyLine(key).test(line)) return section;
  }
  return undefined;
}

const count = (text, key) => text.split("\n").filter((line) => keyLine(key).test(line)).length;

test("an absent .wslconfig gets ceilings under [wsl2] and reclaim under [experimental]", { skip: !pwsh && "no PowerShell" }, () => {
  const text = writeWslConfig(null);
  assert.equal(sectionOf(text, "memory"), "wsl2");
  assert.equal(sectionOf(text, "processors"), "wsl2");
  assert.equal(sectionOf(text, "autoMemoryReclaim"), "experimental");
});

test("a file with only [wsl2] gains an [experimental] section for reclaim", { skip: !pwsh && "no PowerShell" }, () => {
  const text = writeWslConfig("[wsl2]\ndnsTunneling=true\n");
  assert.equal(sectionOf(text, "dnsTunneling"), "wsl2");
  assert.equal(sectionOf(text, "memory"), "wsl2");
  assert.equal(sectionOf(text, "autoMemoryReclaim"), "experimental");
});

test("an operator-authored key in either section is never replaced or duplicated", { skip: !pwsh && "no PowerShell" }, () => {
  const underExperimental = writeWslConfig("[wsl2]\nmemory=8GB\n\n[experimental]\nautoMemoryReclaim=dropCache\n");
  assert.equal(count(underExperimental, "autoMemoryReclaim"), 1);
  assert.match(underExperimental, /autoMemoryReclaim=dropCache/);
  assert.equal(count(underExperimental, "memory"), 1);
  assert.match(underExperimental, /memory=8GB/);
});

test("a key an older installer left under [wsl2] moves to [experimental], keeping its value", { skip: !pwsh && "no PowerShell" }, () => {
  const text = writeWslConfig("[wsl2]\nmemory=16GB\nautoMemoryReclaim=dropCache\n");
  assert.equal(count(text, "autoMemoryReclaim"), 1);
  assert.equal(sectionOf(text, "autoMemoryReclaim"), "experimental");
  assert.match(text, /autoMemoryReclaim=dropCache/);
  assert.equal(sectionOf(text, "memory"), "wsl2");
});
