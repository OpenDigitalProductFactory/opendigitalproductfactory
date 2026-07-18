import assert from "node:assert/strict";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = resolve(new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const bashPath = (path) => resolve(path).replace(/^([A-Za-z]):\\/, (_, drive) => `/mnt/${drive.toLowerCase()}/`).replaceAll("\\", "/");
const runBash = (body, env = {}) => spawnSync("bash", [], { cwd: root, encoding: "utf8", input: body, env: { ...process.env, ...env } });

test("generated Windows start script executes the canonical adapter before Compose", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-win-start-"));
  try {
    const generated = join(dir, "dpf-start.ps1");
    const generation = spawnSync("pwsh", ["-NoProfile", "-Command", `. '${join(root, "install-dpf.ps1")}' -LibraryOnly; [IO.File]::WriteAllText('${generated}', (Get-DPFStartScriptContent), [Text.Encoding]::ASCII)`], { encoding: "utf8" });
    assert.equal(generation.status, 0, generation.stderr);
    const source = await readFile(generated, "ascii");
    assert.match(source, /Resolve-DpfCapabilityComposeProfiles/);
    assert.match(source, /COMPOSE_PROFILES/);
    assert.doesNotMatch(source, /Join-Path \$HOME "\.dpf\\install-state\.json"/);
    const installer = await readFile(join(root, "install-dpf.ps1"), "ascii");
    assert.match(installer, /Resolve-DpfCapabilityComposeProfiles -InstallDir \$DPF_DIR/);
    assert.match(installer, /dpf-start\.ps1" -Encoding ASCII/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("POSIX autostart resolves and executes the XDG state snapshot", async () => {
  const dir = await mkdtemp(join(root, ".task5-xdg-"));
  try {
    const xdg = join(dir, "xdg");
    const bin = join(dir, "bin");
    const trace = join(dir, "trace.txt");
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, "node"), `#!/bin/sh\nprintf 'node:%s\\n' "$*" >> '${bashPath(trace)}'\nprintf '%s\\n' '{"composeProfiles":["runtime-build"]}'\n`);
    await writeFile(join(bin, "docker"), `#!/bin/sh\nprintf 'docker:%s\\n' "$*" >> '${bashPath(trace)}'\n`);
    await chmod(join(bin, "node"), 0o755);
    await chmod(join(bin, "docker"), 0o755);
    const command = `unset DPF_LIB_AUTOSTART_LOADED DPF_LIB_LOGGING_LOADED DPF_LIB_PLATFORM_LOADED DPF_LIB_STATE_LOADED; export HOME='${bashPath(join(dir, "home"))}' XDG_STATE_HOME='${bashPath(xdg)}' PATH='${bashPath(bin)}:/usr/local/bin:/usr/bin:/bin'; source scripts/installer/lib/state.sh; source scripts/installer/lib/autostart.sh; launch=$(_dpf_autostart_write_launch_script '${bashPath(root)}' '-f docker-compose.yml'); "$launch"`;
    const result = runBash(command);
    assert.equal(result.status, 0, result.stderr);
    const lines = await readFile(trace, "utf8");
    assert.match(lines, new RegExp(`node:.*--state ${bashPath(join(xdg, "dpf", "install-state.json")).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(lines, /docker:compose -f docker-compose\.yml up -d/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("promotion refuses stale state before Docker", async () => {
  const dir = await mkdtemp(join(root, ".task5-promote-stale-"));
  try {
    const source = join(dir, "source");
    const state = join(dir, "state");
    const bin = join(dir, "bin");
    await mkdir(join(source, "scripts", "lib"), { recursive: true });
    await mkdir(state); await mkdir(bin);
    await writeFile(join(source, "scripts", "lib", "resolve-capability-compose-profiles.mjs"), "// fixture\n");
    await writeFile(join(state, "install-state.json"), "original\n");
    await writeFile(join(bin, "node"), "#!/bin/sh\nprintf 'capability_state_stale\\n' >&2\nexit 2\n");
    await writeFile(join(bin, "docker"), `#!/bin/sh\ntouch '${bashPath(join(dir, "docker-called"))}'\n`);
    await chmod(join(bin, "node"), 0o755); await chmod(join(bin, "docker"), 0o755);
    const result = runBash(`PATH='${bashPath(bin)}:/usr/local/bin:/usr/bin:/bin' DPF_STATE_DIR='${bashPath(state)}' PROMOTE_SOURCE='${bashPath(source)}' PROMOTE_TARGET_SHA=x PROMOTE_BACKUP_PATH='${bashPath(join(dir, "backup"))}' PROMOTE_HEALTH_URL=http://invalid bash scripts/promote.sh --self-upgrade`);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /capability_state_stale/);
    assert.equal(spawnSync("pwsh", ["-NoProfile", "-Command", `Test-Path '${join(dir, "docker-called")}'`], { encoding: "utf8" }).stdout.trim(), "False");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("promotion recovery snapshot is copied and restored after a simulated Docker failure", async () => {
  const dir = await mkdtemp(join(root, ".task5-promote-rollback-"));
  try {
    const source = join(dir, "source"); const state = join(dir, "state"); const bin = join(dir, "bin"); const backup = join(dir, "backup");
    await mkdir(join(source, "scripts", "lib"), { recursive: true }); await mkdir(state); await mkdir(bin);
    await writeFile(join(source, "scripts", "lib", "resolve-capability-compose-profiles.mjs"), "// fixture\n");
    await writeFile(join(state, "install-state.json"), "original-snapshot\n");
    spawnSync("git", ["init", "-q", source]); spawnSync("git", ["-C", source, "config", "user.email", "test@example.com"]); spawnSync("git", ["-C", source, "config", "user.name", "Test"]); spawnSync("git", ["-C", source, "add", "."]); spawnSync("git", ["-C", source, "commit", "-q", "-m", "fixture"]);
    const sha = spawnSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
    await writeFile(join(bin, "node"), "#!/bin/sh\nprintf '%s\\n' '{\"composeProfiles\":[],\"requiredServices\":[]}'\n");
    await writeFile(join(bin, "docker"), `#!/bin/sh\nprintf 'corrupted\\n' > '${bashPath(join(state, "install-state.json"))}'\n+exit 42\n`);
    await chmod(join(bin, "node"), 0o755); await chmod(join(bin, "docker"), 0o755);
    const result = runBash(`PATH='${bashPath(bin)}:/usr/local/bin:/usr/bin:/bin' DPF_STATE_DIR='${bashPath(state)}' PROMOTE_SOURCE='${bashPath(source)}' PROMOTE_TARGET_SHA='${sha}' PROMOTE_BACKUP_PATH='${bashPath(backup)}' PROMOTE_HEALTH_URL=http://invalid bash scripts/promote.sh --self-upgrade`);
    assert.notEqual(result.status, 0);
    assert.equal(await readFile(join(backup, "install-state.json"), "utf8"), "original-snapshot\n");
    assert.equal(await readFile(join(state, "install-state.json"), "utf8"), "original-snapshot\n");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("explicit optional-service gates execute from enabled and disabled projections", async () => {
  const dir = await mkdtemp(join(root, ".task5-service-gate-"));
  try {
    const bin = join(dir, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "node"), "#!/bin/sh\npayload=$(cat)\nprintf '%s' \"$payload\" | grep -q \"\\\"$3\\\"\"\n");
    await chmod(join(bin, "node"), 0o755);
    const command = `export PATH='${bashPath(bin)}:/usr/local/bin:/usr/bin:/bin'; DPF_LIB_PLATFORM_LOADED=1 DPF_LIB_STATE_LOADED=1; source scripts/installer/lib/compose.sh; DPF_CAPABILITY_PROJECTION='{\"requiredServices\":[\"dpf-tts\"]}'; dpf_capability_service_required dpf-tts; DPF_CAPABILITY_PROJECTION='{\"requiredServices\":[]}'; if dpf_capability_service_required dpf-tts; then exit 9; fi`;
    const result = runBash(command);
    assert.equal(result.status, 0, result.stderr);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("all touched PowerShell lifecycle files are ASCII and parse under PowerShell 5.1 grammar", () => {
  const files = ["install-dpf.ps1", "dpf-start.ps1", "scripts/dpf-start.ps1", "scripts/fresh-install.ps1", "scripts/installer/lib/state.ps1", "scripts/setup.ps1"];
  const command = `$errors=@(); ${files.map((file) => `$bytes=[IO.File]::ReadAllBytes('${join(root, file)}'); if($bytes | Where-Object {$_ -gt 127}){throw 'non_ascii:${file}'}; [void][Management.Automation.Language.Parser]::ParseFile('${join(root, file)}',[ref]$null,[ref]$errors)`).join("; ")}; if($errors.Count){throw ($errors -join ';')}`;
  const result = spawnSync("pwsh", ["-NoProfile", "-Command", command], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
