#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function normalizePath(path, repoRoot) {
  const absoluteRoot = resolve(repoRoot || process.cwd());
  const value = String(path ?? "");
  const normalized = value.replaceAll("\\", "/");
  const root = absoluteRoot.replaceAll("\\", "/").replace(/\/+$/, "");
  if (normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
    return normalized.slice(root.length + 1);
  }
  if (/^(?:[A-Za-z]:\/|\/)/.test(normalized)) {
    return relative(absoluteRoot, value).replaceAll("\\", "/");
  }
  return normalized.replace(/^\.\//, "");
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function reportFiles(reports, repoRoot, status = null) {
  return uniqueSorted(
    reports.flatMap((report) =>
      (Array.isArray(report?.testResults) ? report.testResults : [])
        .filter((result) => status === null || result?.status === status)
        .map((result) => normalizePath(result?.name, repoRoot))),
  );
}

export function buildShadowSelection({
  repoRoot = process.cwd(),
  fullReports = [],
  selectedReport = null,
  changedFiles = [],
  unknownChangedFiles = [],
  escalatedToFull = false,
} = {}) {
  const allTestFiles = reportFiles(fullReports, repoRoot);
  return {
    changedFiles: uniqueSorted(changedFiles.map((file) => normalizePath(file, repoRoot))),
    allTestFiles,
    selectedTestFiles: escalatedToFull
      ? allTestFiles
      : reportFiles(selectedReport ? [selectedReport] : [], repoRoot),
    failedTestFiles: reportFiles(fullReports, repoRoot, "failed"),
    unknownChangedFiles: uniqueSorted(
      unknownChangedFiles.map((file) => normalizePath(file, repoRoot)),
    ),
    escalatedToFull: Boolean(escalatedToFull),
  };
}

function parseArgs(args) {
  const options = {
    repoRoot: process.cwd(),
    fullPaths: [],
    selectedPath: null,
    changedFilesPath: null,
    unknownFilesPath: null,
    escalatedToFull: false,
    outputPath: "artifacts/ci-observation/shadow-selection.json",
  };
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    if (flag === "--repo-root") options.repoRoot = value;
    else if (flag === "--full") options.fullPaths.push(value);
    else if (flag === "--selected") options.selectedPath = value;
    else if (flag === "--changed-files") options.changedFilesPath = value;
    else if (flag === "--unknown-files") options.unknownFilesPath = value;
    else if (flag === "--escalated") options.escalatedToFull = value === "true";
    else if (flag === "--output") options.outputPath = value;
    else throw new Error(`unknown argument: ${flag}`);
  }
  return options;
}

function readJson(path, fallback = null) {
  if (!path) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

function readLines(path) {
  if (!path) return [];
  return readFileSync(path, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = buildShadowSelection({
    repoRoot: options.repoRoot,
    fullReports: options.fullPaths.map((path) => readJson(path, {})),
    selectedReport: readJson(options.selectedPath),
    changedFiles: readLines(options.changedFilesPath),
    unknownChangedFiles: readLines(options.unknownFilesPath),
    escalatedToFull: options.escalatedToFull,
  });
  const outputPath = resolve(options.outputPath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(
    `[ci-shadow-selection] selected ${result.selectedTestFiles.length}/${result.allTestFiles.length}`
    + ` test files; escalated=${result.escalatedToFull}\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[ci-shadow-selection] ${error.message}\n`);
    process.exitCode = 1;
  }
}
