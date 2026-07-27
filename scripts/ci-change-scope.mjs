#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createEvidencePlan,
  loadEvidencePolicy,
} from "./lib/ci-evidence-plan.mjs";

const policy = loadEvidencePolicy();

export function classifyChangedFiles(files) {
  const changedFiles = files.map((file) => file.trim()).filter(Boolean);

  if (changedFiles.length === 0) {
    return { heavy: true, mobile: true, docsOnly: false, mobileOnly: false };
  }
  const plan = createEvidencePlan({
    eventName: "pull_request",
    baseSha: "scope-adapter-base",
    headSha: "scope-adapter-head",
    baseTreeSha: "scope-adapter-base-tree",
    headTreeSha: "scope-adapter-head-tree",
    changedFiles,
    knownTests: [],
    relatedTestsBySource: {},
    routeAdviceBySource: {},
    codeGraphAdvice: null,
    totalTestCount: 0,
    policy,
  });
  return {
    heavy: plan.scope.heavy,
    mobile: plan.scope.mobile,
    docsOnly: plan.scope.docsOnly,
    mobileOnly: plan.scope.mobileOnly,
  };
}

function parseArgs(args) {
  const outputPathIndex = args.indexOf("--github-output");
  return {
    githubOutputPath: outputPathIndex >= 0 ? args[outputPathIndex + 1] : undefined,
  };
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function writeGitHubOutput(path, result) {
  if (!path) {
    return;
  }

  appendFileSync(path, `heavy=${result.heavy}\n`);
  appendFileSync(path, `mobile=${result.mobile}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { githubOutputPath } = parseArgs(process.argv.slice(2));
  const files = readStdin().split(/\r?\n/);
  const result = classifyChangedFiles(files);
  const scope = result.docsOnly ? "docs-only" : result.mobileOnly ? "mobile-only" : "full";

  console.log(`-> ${scope} change: heavy=${result.heavy}, mobile=${result.mobile}`);
  writeGitHubOutput(githubOutputPath, result);
}
