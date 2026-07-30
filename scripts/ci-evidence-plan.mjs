#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJson,
  createEvidencePlan,
  loadEvidencePolicy,
} from "./lib/ci-evidence-plan.mjs";

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      values[key] = true;
    } else {
      values[key] = value;
      index += 1;
    }
  }
  return values;
}

function git(args, cwd = process.cwd()) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function readOptionalJson(path, label, inputErrors) {
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    inputErrors.push(`${label}-invalid`);
    return null;
  }
}

function readPolicy(path, inputErrors) {
  if (!path) return loadEvidencePolicy();
  try {
    return loadEvidencePolicy(resolve(path));
  } catch {
    inputErrors.push("policy-invalid");
    return loadEvidencePolicy();
  }
}

function resolveRevision(ref, inputErrors, label) {
  try {
    return git(["rev-parse", "--verify", ref]);
  } catch {
    inputErrors.push(`${label}-revision-unresolved`);
    return ref;
  }
}

function resolveTree(ref, inputErrors, label) {
  try {
    return git(["rev-parse", "--verify", `${ref}^{tree}`]);
  } catch {
    inputErrors.push(`${label}-tree-unresolved`);
    return "unknown";
  }
}

function changedFiles(baseSha, headSha, inputErrors) {
  try {
    return git(["diff", "--name-only", baseSha, headSha])
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    inputErrors.push("git-diff-failed");
    return [];
  }
}

function knownTestsAt(headSha, policy, inputErrors) {
  try {
    const patterns = policy.patterns.tests.map((pattern) => new RegExp(pattern));
    return git(["ls-tree", "-r", "--name-only", headSha])
      .split(/\r?\n/)
      .filter((path) => path && patterns.some((pattern) => pattern.test(path)));
  } catch {
    inputErrors.push("test-inventory-failed");
    return [];
  }
}

function packageDependenciesAt(headSha, policy, inputErrors) {
  const rootsByPackage = new Map(
    Object.entries(policy.packageRoots).map(([root, packageName]) => [packageName, root]),
  );
  const result = {};
  for (const [packageName, root] of rootsByPackage) {
    try {
      const manifest = JSON.parse(git(["show", `${headSha}:${root}/package.json`]));
      const dependencyNames = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
      ]);
      result[packageName] = [...dependencyNames]
        .filter((dependency) => rootsByPackage.has(dependency))
        .sort((left, right) => left.localeCompare(right));
    } catch {
      // Some configured roots intentionally have no independent manifest.
      // Ownership still works; only malformed existing manifests are unsafe.
      try {
        git(["cat-file", "-e", `${headSha}:${root}/package.json`]);
        inputErrors.push(`package-manifest-invalid:${packageName}`);
      } catch {
        result[packageName] = [];
      }
    }
  }
  return result;
}

function writeText(path, contents) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, contents);
}

export function githubOutputsForPlan(plan) {
  // Keep the portal UX decision independent from the broader heavy-CI switch.
  // Today docs-only and app-mobile-only changes are the two scopes that cannot
  // alter the rendered web portal. Deriving the dedicated output from those
  // existing audited scope fields preserves the calibrated plan digest.
  const portalUxRequired = !plan.scope.docsOnly && !plan.scope.mobileOnly;
  return [
    `heavy=${plan.scope.heavy}`,
    `portal_ux_required=${portalUxRequired}`,
    `mobile=${plan.scope.mobile}`,
    `evidence_tier=${plan.evidenceTier}`,
    `evidence_plan_digest=${plan.digest}`,
    `evidence_selected_percentage=${plan.selection.selectedPercentage}`,
    "",
  ].join("\n");
}

function writeGitHubOutputs(path, plan) {
  if (!path) return;
  appendFileSync(path, githubOutputsForPlan(plan));
}

export function runEvidencePlannerCli(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const inputErrors = [];
  const eventName = String(options.event ?? process.env.GITHUB_EVENT_NAME ?? "local-ci");
  const baseRef = String(options.base ?? process.env.CI_EVIDENCE_BASE_SHA ?? "origin/main");
  const headRef = String(options.head ?? process.env.CI_EVIDENCE_HEAD_SHA ?? "HEAD");
  const baseSha = resolveRevision(baseRef, inputErrors, "base");
  const headSha = resolveRevision(headRef, inputErrors, "head");
  const policy = readPolicy(options.policy, inputErrors);
  const codeGraphAdvice = readOptionalJson(
    options["graph-advice"],
    "graph-advice",
    inputErrors,
  );
  const relatedTestsBySource = readOptionalJson(
    options["related-tests"],
    "related-tests",
    inputErrors,
  ) ?? {};
  const routeAdviceBySource = readOptionalJson(
    options["route-advice"],
    "route-advice",
    inputErrors,
  ) ?? {};
  const knownTests = options["known-tests"]
    ? readOptionalJson(options["known-tests"], "known-tests", inputErrors) ?? []
    : knownTestsAt(headSha, policy, inputErrors);
  const files = changedFiles(baseSha, headSha, inputErrors);
  const plan = createEvidencePlan({
    eventName,
    baseSha,
    headSha,
    baseTreeSha: resolveTree(baseSha, inputErrors, "base"),
    headTreeSha: resolveTree(headSha, inputErrors, "head"),
    changedFiles: files,
    knownTests,
    relatedTestsBySource,
    codeGraphAdvice,
    routeAdviceBySource,
    packageDependencies: packageDependenciesAt(headSha, policy, inputErrors),
    totalTestCount: knownTests.length,
    inputErrors,
    policy,
  });
  const json = canonicalJson(plan);
  if (options.output) writeText(options.output, json);
  else process.stdout.write(json);
  writeGitHubOutputs(options["github-output"], plan);
  process.stderr.write(
    `[ci-evidence-plan] ${plan.evidenceTier}; ${plan.affectedTests.length}/`
    + `${plan.selection.totalTestCount} tests recommended; digest=${plan.digest.slice(0, 12)}\n`,
  );
  return plan;
}

const thisFile = resolve(fileURLToPath(import.meta.url));
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  try {
    runEvidencePlannerCli();
  } catch (error) {
    console.error(
      `[ci-evidence-plan] fatal planner error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  }
}
