import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  mergeReproducibleBaselines,
  type BaselineFile,
} from "../lib/ux-budget/ratchet";

function requiredArg(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing required --${name} argument.`);
  return resolve(value);
}

const firstPath = requiredArg("first");
const secondPath = requiredArg("second");
const outputPath = requiredArg("output");
const first = JSON.parse(readFileSync(firstPath, "utf8")) as BaselineFile;
const second = JSON.parse(readFileSync(secondPath, "utf8")) as BaselineFile;

if (!first.bootstrapped || !second.bootstrapped) {
  throw new Error("Both calibration artifacts must be measured baselines.");
}

const merged = mergeReproducibleBaselines(first, second);
writeFileSync(outputPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
console.log(
  `[ux-sweep] merged ${Object.keys(merged.routes).length} reproducible routes into ${outputPath}`,
);
