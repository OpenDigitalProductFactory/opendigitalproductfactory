#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_MANIFEST = resolve(ROOT, "config/merge-readiness-policy.json");
const TERMINAL_SUCCESS = new Set(["success", "skipped"]);

export function evaluateDependencyResults(needs) {
  const failures = [];
  for (const [jobId, value] of Object.entries(needs ?? {})) {
    const result = typeof value === "string" ? value : value?.result;
    if (!TERMINAL_SUCCESS.has(result)) failures.push({ jobId, result: result ?? "missing" });
  }
  return { ok: failures.length === 0, failures };
}

export function parseWorkflowJobIds(source) {
  const lines = source.split(/\r?\n/);
  const jobsIndex = lines.findIndex((line) => line === "jobs:");
  if (jobsIndex < 0) return [];
  return lines
    .slice(jobsIndex + 1)
    .map((line) => line.match(/^  ([a-z0-9-]+):\s*$/)?.[1])
    .filter(Boolean);
}

export function workflowHasMergeGroup(source) {
  const beforeJobs = source.split(/\r?\n/).slice(0, source.split(/\r?\n/).findIndex((line) => line === "jobs:"));
  return beforeJobs.some((line) => /^  merge_group:\s*(?:\{\})?$/.test(line));
}

export function parseAggregate(source, aggregateJobId) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${aggregateJobId}:`);
  if (start < 0) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [a-z0-9-]+:\s*$/.test(lines[index])) {
      end = index;
      break;
    }
  }
  const block = lines.slice(start, end);
  const name = block.find((line) => /^    name:\s*/.test(line))?.replace(/^    name:\s*/, "").trim();
  const needsStart = block.findIndex((line) => line === "    needs:");
  const needs = needsStart < 0
    ? []
    : block.slice(needsStart + 1).map((line) => line.match(/^      - ([a-z0-9-]+)\s*$/)?.[1]).filter(Boolean);
  return { name, needs };
}

export function validateWorkflowConformance({ manifest, ciSource, uxSource }) {
  const errors = [];
  if (!workflowHasMergeGroup(ciSource)) errors.push(`${manifest.workflows.ci} must handle merge_group`);
  if (!workflowHasMergeGroup(uxSource)) errors.push(`${manifest.workflows.ux} must handle merge_group`);

  const jobs = parseWorkflowJobIds(ciSource);
  const aggregate = parseAggregate(ciSource, manifest.aggregateJobId);
  if (!aggregate) {
    errors.push(`missing aggregate job ${manifest.aggregateJobId}`);
    return errors;
  }
  if (aggregate.name !== manifest.aggregateJobName) {
    errors.push(`aggregate name must be ${manifest.aggregateJobName}`);
  }
  const uxJob = parseAggregate(uxSource, manifest.uxJobId);
  if (!uxJob) {
    errors.push(`missing UX job ${manifest.uxJobId}`);
  } else if (uxJob.name !== manifest.uxJobName) {
    errors.push(`UX job name must be ${manifest.uxJobName}`);
  }
  const expected = jobs.filter((jobId) => jobId !== manifest.aggregateJobId).sort();
  const actual = [...aggregate.needs].sort();
  const missing = expected.filter((jobId) => !actual.includes(jobId));
  const unknown = actual.filter((jobId) => !expected.includes(jobId));
  if (missing.length) errors.push(`aggregate is missing CI jobs: ${missing.join(", ")}`);
  if (unknown.length) errors.push(`aggregate references unknown CI jobs: ${unknown.join(", ")}`);
  return errors;
}

export function normalizeContexts(payload) {
  const names = [
    ...(payload?.contexts ?? []),
    ...(payload?.checks ?? []).map((check) => check.context),
  ];
  return [...new Set(names.filter(Boolean))].sort();
}

export function compareProtection(manifest, payload) {
  const expected = [...manifest.requiredContexts].sort();
  const actual = normalizeContexts(payload);
  return {
    ok: payload?.strict === manifest.strict &&
      JSON.stringify(actual) === JSON.stringify(expected),
    expected,
    actual,
    expectedStrict: manifest.strict,
    actualStrict: payload?.strict,
  };
}

function loadManifest(path = DEFAULT_MANIFEST) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function inferRepository() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const remote = execFileSync("git", ["remote", "get-url", "origin"], { cwd: ROOT, encoding: "utf8" }).trim();
  const match = remote.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (!match) throw new Error(`cannot infer GitHub repository from ${remote}`);
  return `${match[1]}/${match[2]}`;
}

function ghApi(args, input) {
  return JSON.parse(execFileSync("gh", ["api", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    input: input ? `${JSON.stringify(input)}\n` : undefined,
  }));
}

export function runLocalAudit(manifest = loadManifest()) {
  const ciSource = readFileSync(resolve(ROOT, manifest.workflows.ci), "utf8");
  const uxSource = readFileSync(resolve(ROOT, manifest.workflows.ux), "utf8");
  return validateWorkflowConformance({ manifest, ciSource, uxSource });
}

function runRemote(mode) {
  const manifest = loadManifest();
  const repository = inferRepository();
  const endpoint = `repos/${repository}/branches/${manifest.branch}/protection/required_status_checks`;
  if (mode === "apply") {
    ghApi(["--method", "PATCH", endpoint, "--input", "-"], {
      strict: manifest.strict,
      contexts: manifest.requiredContexts,
    });
  }
  const comparison = compareProtection(manifest, ghApi([endpoint]));
  process.stdout.write(`${JSON.stringify({ repository, branch: manifest.branch, ...comparison }, null, 2)}\n`);
  if (!comparison.ok) process.exitCode = 1;
}

function main() {
  const command = process.argv[2] ?? "check";
  if (command === "evaluate-needs") {
    const result = evaluateDependencyResults(JSON.parse(process.env.NEEDS_JSON ?? "{}"));
    if (!result.ok) {
      for (const failure of result.failures) console.error(`::error::${failure.jobId} concluded ${failure.result}`);
      process.exitCode = 1;
    }
    return;
  }
  if (command === "check") {
    const errors = runLocalAudit();
    if (errors.length) {
      for (const error of errors) console.error(`[merge-readiness] ${error}`);
      process.exitCode = 1;
    } else {
      console.log("[merge-readiness] manifest and workflows conform");
    }
    return;
  }
  if (command === "audit" || command === "apply") return runRemote(command);
  throw new Error(`unknown command: ${command}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
