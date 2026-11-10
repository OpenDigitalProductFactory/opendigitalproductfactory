// Qualified dependency-install evidence only. Never canonical CI or build permission.
import { createHash } from "node:crypto";
import { existsSync, globSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { gitTextOrNull } from "./git.mjs";
import { scrubGitRepoLocationEnv } from "./git-hook-env.mjs";
import { parseWorkspacePackageGlobs } from "./sandbox-freshness.mjs";
import { readGuardInputStamp } from "./pregate-preflight-receipt.mjs";
import { atomicWriteJson, createStageReceiptWriter, readStageReceipt, reusablePassedStage, stageIdentityMatches } from "./local-ci-stage-receipt.mjs";

const STAGE = "managed-dependency-install";
const PROOF_FILE = "dpf-managed-dependency-install.json";

function workspaceInputs(worktreePath) {
  const policy = readFileSync(join(worktreePath, "pnpm-workspace.yaml"), "utf8");
  // Reuse the dependency-freshness parser. Unsupported YAML shapes cannot qualify
  // retained proof. Excluded packages are deliberately a conservative superset.
  if (!/^packages:\s*(?:\[\s*\]|\r?\n)/m.test(policy)) return null;
  let inPackages = false;
  for (const line of policy.split(/\r?\n/)) {
    if (/^packages:\s*$/.test(line)) { inPackages = true; continue; }
    if (!inPackages || !line.trim() || /^\s*#/.test(line)) continue;
    if (/^\S/.test(line)) break;
    if (!/^\s+-\s+(?:"[^"\r\n]+"|'[^'\r\n]+'|[!A-Za-z0-9_./][A-Za-z0-9_./*{},?@!+-]*)(?:\s+#.*)?\s*$/.test(line)) return null;
  }
  const patterns = parseWorkspacePackageGlobs(policy);
  if (!patterns.length && !/^packages:\s*\[\s*\]/m.test(policy)) return null;
  const manifests = new Set();
  for (const pattern of patterns) {
    if (isAbsolute(pattern) || pattern.split(/[\\/]/).includes("..")) return null;
    for (const path of globSync(`${pattern.replace(/\/$/, "")}/package.json`, {
      cwd: worktreePath, exclude: ["**/node_modules/**", "**/.git/**"],
    })) {
      const resolved = realpathSync(join(worktreePath, path));
      const local = relative(realpathSync(worktreePath), resolved);
      if (isAbsolute(local) || local.startsWith("..")) return null;
      manifests.add(path.replaceAll("\\", "/"));
    }
  }
  return [...manifests].sort().map(path => readGuardInputStamp(join(worktreePath, path)));
}

function configurationInputs(worktreePath) {
  const paths = [join(homedir(), ".npmrc"), join(worktreePath, ".npmrc")];
  // Arbitrary external hooks/config and patches require the normal managed
  // install path; this small proof does not claim to discover their transitive inputs.
  if (Object.entries(process.env).some(([key, value]) => value && /^npm_config_(?:userconfig|globalconfig|.*pnpmfile)$/i.test(key))) return null;
  const policyPaths = [...paths, join(worktreePath, "pnpm-workspace.yaml"), join(worktreePath, "package.json")];
  if ([".pnpmfile.cjs", ".pnpmfile.mjs", ".pnpmfile.js"].some(path => existsSync(join(worktreePath, path)))) return null;
  if (policyPaths.some(path => existsSync(path) && /(?:global[-_]?pnpmfile|pnpmfile|patchedDependencies)\s*["']?\s*[:=]/i.test(readFileSync(path, "utf8")))) return null;
  return paths.map(path => readGuardInputStamp(path));
}

export function managedInstallProofPath(worktreePath) {
  const directory = gitTextOrNull(["rev-parse", "--absolute-git-dir"], {
    cwd: worktreePath, env: scrubGitRepoLocationEnv(), timeout: 5000,
  });
  return directory ? join(directory, PROOF_FILE) : null;
}

function inputs(worktreePath, packageManagerVersion) {
  try {
    if (!/^\d+\.\d+\.\d+/.test(packageManagerVersion ?? "")) return null;
    const files = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc", ".pnpmfile.cjs", ".pnpmfile.mjs", ".pnpmfile.js"]
      .map(path => readGuardInputStamp(join(worktreePath, path)));
    if (files.slice(0, 3).some(file => !file)) return null;
    const manifests = workspaceInputs(worktreePath);
    const configuration = configurationInputs(worktreePath);
    if (!manifests || !configuration || manifests.some(file => !file)) return null;
    const implementation = ["./bootstrap-worktree-deps.mjs", "./bootstrap-managed-install-proof.mjs", "./sandbox-freshness.mjs", "../check-build-script-policy.mjs", "./pinned-pnpm.mjs"]
      .map(path => readGuardInputStamp(fileURLToPath(new URL(path, import.meta.url))));
    if (implementation.some(file => !file)) return null;
    // Do not retain credentials or irrelevant per-command wrapper variables.
    const environment = createHash("sha256").update(JSON.stringify(Object.entries(process.env)
      .filter(([key]) => /^(npm_config_(?!user_agent$)|PNPM_HOME$|NODE_ENV$|CI$)/i.test(key))
      .sort(([a], [b]) => a.localeCompare(b)))).digest("hex");
    return { worktree: realpathSync(worktreePath), files, manifests, configuration, implementation, environment,
      packageManagerVersion, node: process.version, executable: process.execPath, platform: process.platform, arch: process.arch };
  } catch { return null; }
}

function identity(worktreePath, packageManagerVersion) {
  const source = inputs(worktreePath, packageManagerVersion);
  if (!source) return null;
  try {
    const modules = readGuardInputStamp(join(worktreePath, "node_modules/.modules.yaml"));
    if (!modules) return null;
    return { inputs: source, modules, installedLock: readGuardInputStamp(join(worktreePath, "node_modules/.pnpm/lock.yaml")) };
  } catch { return null; }
}

export function hasManagedInstallProof(worktreePath, packageManagerVersion) {
  const current = identity(worktreePath, packageManagerVersion);
  if (!current) return false;
  const path = managedInstallProofPath(worktreePath);
  return Boolean(path && reusablePassedStage({ receipt: readStageReceipt(path), stage: STAGE, identity: current })
    && stageIdentityMatches(current, identity(worktreePath, packageManagerVersion)));
}

export function beginManagedInstallProof(worktreePath, packageManagerVersion) {
  const path = managedInstallProofPath(worktreePath);
  // No Git metadata means no reusable proof; retain the existing one-call behavior.
  if (!path) return { path: null, inputs: null };
  const source = inputs(worktreePath, packageManagerVersion);
  // Invalidate before execution, including a failed forced install with unchanged files.
  atomicWriteJson(path, { schemaVersion: 1, stage: STAGE, status: "inconclusive", reason: "new-install-attempt" });
  return { path, inputs: source };
}

export function completeManagedInstallProof(attempt, worktreePath, packageManagerVersion) {
  if (!attempt?.path || !attempt.inputs) return false;
  const current = identity(worktreePath, packageManagerVersion);
  if (!current || !stageIdentityMatches(attempt.inputs, current.inputs)) return false;
  const writer = createStageReceiptWriter({ path: attempt.path, stage: STAGE, identity: current });
  writer.start();
  if (!stageIdentityMatches(current, identity(worktreePath, packageManagerVersion))) {
    writer.complete("inconclusive", { reason: "install-inputs-changed" });
    return false;
  }
  writer.complete("passed", { purpose: "dependency-install-only" });
  return true;
}
