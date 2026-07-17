#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DOC_PATTERN = /(^docs\/|\.mdx?$)/;
const MOBILE_APP_PATTERN = /^apps\/mobile\//;
const MOBILE_SHARED_PATTERNS = [
  /^packages\/api-client\//,
  /^packages\/types\//,
  /^packages\/validators\//,
];

export function classifyChangedFiles(files) {
  const changedFiles = files.map((file) => file.trim()).filter(Boolean);

  if (changedFiles.length === 0) {
    return { heavy: true, mobile: true, docsOnly: false, mobileOnly: false };
  }

  const docsOnly = changedFiles.every((file) => DOC_PATTERN.test(file));
  if (docsOnly) {
    return { heavy: false, mobile: false, docsOnly: true, mobileOnly: false };
  }

  const mobileOnly = changedFiles.every((file) => DOC_PATTERN.test(file) || MOBILE_APP_PATTERN.test(file));
  const mobile = changedFiles.some(
    (file) => MOBILE_APP_PATTERN.test(file) || MOBILE_SHARED_PATTERNS.some((pattern) => pattern.test(file)),
  );

  return {
    heavy: !mobileOnly,
    mobile,
    docsOnly: false,
    mobileOnly,
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
