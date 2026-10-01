#!/usr/bin/env node

import { parseArgs as utilParseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { evaluateLocalCiPilot } from "./lib/local-ci-pilot-report.mjs";

function inputPath(argv) {
  // strict: false keeps the old tolerance: flags this script does not read are ignored.
  const { values } = utilParseArgs({ args: argv, strict: false, allowPositionals: true, options: { input: { type: "string" } } });
  if (typeof values.input !== "string" || !values.input) {
    throw new Error("usage: node scripts/local-ci-pilot-report.mjs --input <evidence.json>");
  }
  return resolve(values.input);
}

async function main() {
  const path = inputPath(process.argv.slice(2));
  const input = JSON.parse(await readFile(path, "utf8"));
  const report = evaluateLocalCiPilot(input);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.recommendation === "retain"
    ? 0
    : report.recommendation === "tune"
      ? 1
      : 2;
}

main().catch((error) => {
  process.stderr.write(`local-CI pilot report failed: ${error.message}\n`);
  process.exitCode = 2;
});
