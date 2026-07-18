#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const valueAfter = (flag) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
const stateDir = resolve(valueAfter("--state-dir") ?? process.env.DPF_PROMOTER_STATE_DIR ?? process.env.DPF_STATE_DIR ?? join(process.env.HOME ?? process.env.USERPROFILE ?? ".", ".dpf"));
const initialize = args.includes("--initialize");
const rotate = args.includes("--rotate");
if (initialize === rotate) { process.stderr.write("choose_exactly_one_of_initialize_or_rotate\n"); process.exit(64); }

const secretPath = join(stateDir, "runtime-transition.secret");
const transitionsPath = join(stateDir, "runtime-capability-transitions");
const lockPath = join(stateDir, ".runtime-transition-secret.lock");
const applyLockPath = join(stateDir, ".runtime-transition-apply.lock");
const authorityPath = join(stateDir, "runtime-transition-authority.json");
const secure = async (path) => {
  await chmod(path, 0o600);
  if (process.platform === "win32") {
    const user = process.env.USERNAME;
    if (!user) throw new Error("windows_identity_unavailable");
    const result = spawnSync("icacls.exe", [path, "/inheritance:r", "/grant:r", `${user}:(F)`], { encoding: "utf8" });
    if (result.status !== 0) throw new Error("windows_acl_failed");
  }
};
const createTemporarySecret = async () => {
  const path = join(stateDir, `.runtime-transition.secret.${process.pid}.tmp`);
  await writeFile(path, `${randomBytes(32).toString("hex")}\n`, { flag: "wx", mode: 0o600 });
  await secure(path);
  return path;
};

await mkdir(stateDir, { recursive: true, mode: 0o700 });
try { await mkdir(lockPath); } catch { process.stderr.write("secret_rotation_in_progress\n"); process.exit(75); }
let temporary;
try {
  try {
    await stat(authorityPath);
    const error = new Error("transition_in_progress"); error.code = "DPF_TRANSITION_IN_PROGRESS"; throw error;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  try {
    await stat(applyLockPath);
    let expiresAt;
    try { expiresAt = Date.parse((await readFile(join(applyLockPath, "expires-at"), "utf8")).trim()); } catch {}
    if (!Number.isFinite(expiresAt) || expiresAt >= Date.now()) { const error = new Error("transition_in_progress"); error.code = "DPF_TRANSITION_IN_PROGRESS"; throw error; }
    await rm(applyLockPath, { recursive: true, force: true });
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  try {
    const existing = (await readFile(secretPath, "utf8")).trim();
    if (!/^[a-f0-9]{64}$/.test(existing)) throw new Error("invalid_existing_transition_secret");
    await secure(secretPath);
    if (initialize) { process.stdout.write(JSON.stringify({ status: "existing", secretPath }) + "\n"); process.exitCode = 0; }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    temporary = await createTemporarySecret();
    await rename(temporary, secretPath); temporary = undefined;
    process.stdout.write(JSON.stringify({ status: "initialized", secretPath }) + "\n");
    process.exitCode = 0;
  }
  if (rotate && process.exitCode === undefined) {
    try {
      const entries = await (await import("node:fs/promises")).readdir(transitionsPath, { withFileTypes: true });
      if (entries.some((entry) => entry.name.endsWith(".claim") || entry.name.endsWith(".tmp"))) {
        process.stderr.write("transition_in_progress\n"); process.exitCode = 75;
      }
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (process.exitCode === undefined) {
      temporary = await createTemporarySecret();
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const archiveDir = join(stateDir, "runtime-transition-key-archive", `${stamp}-${randomBytes(4).toString("hex")}`);
      await mkdir(archiveDir, { recursive: true, mode: 0o700 });
      await copyFile(secretPath, join(archiveDir, "runtime-transition.secret"));
      await secure(join(archiveDir, "runtime-transition.secret"));
      try { await rename(transitionsPath, join(archiveDir, "runtime-capability-transitions")); } catch (error) { if (error.code !== "ENOENT") throw error; }
      await rename(secretPath, join(archiveDir, "runtime-transition.secret.replaced"));
      await rename(temporary, secretPath); temporary = undefined;
      process.stdout.write(JSON.stringify({ status: "rotated", secretPath, archiveDir }) + "\n");
      process.exitCode = 0;
    }
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`); process.exitCode = error.code === "DPF_TRANSITION_IN_PROGRESS" ? 75 : 78;
} finally {
  if (temporary) await rm(temporary, { force: true });
  await rm(lockPath, { recursive: true, force: true });
}
