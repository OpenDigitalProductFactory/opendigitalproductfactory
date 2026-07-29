import { createHash } from "node:crypto";

import { isRecord } from "@/lib/shared/coerce";

export const WORK_PATTERN_FIXTURE_PART_TYPE =
  "work-pattern-experiment-fixture";

export type HermeticBuildReplayFixture = {
  schemaVersion: 1;
  kind: "build-replay-v1";
  objective: string;
  targetFile: string;
  testFiles: string[];
  methodInstructions: Record<string, string>;
};

const SAFE_LIBRARY_TARGET =
  /^(?:apps\/web\/lib|packages\/[a-zA-Z0-9._-]+\/src)\/[a-zA-Z0-9._/-]+\.ts$/;
const SAFE_TEST_PATH =
  /^(?:apps\/web\/lib|packages\/[a-zA-Z0-9._-]+\/src)\/[a-zA-Z0-9._/-]+\.(?:test|spec)\.ts$/;

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function safeRepoPath(value: unknown, pattern: RegExp): value is string {
  return nonEmptyString(value)
    && pattern.test(value)
    && !value.includes("..")
    && !value.includes("//");
}

function fixtureData(value: unknown): unknown {
  if (!Array.isArray(value) || value.length !== 1) return value;
  const part = value[0];
  return isRecord(part)
      && part.type === WORK_PATTERN_FIXTURE_PART_TYPE
      && part.mimeType === "application/json"
    ? part.data
    : value;
}

export function parseHermeticBuildReplayFixture(
  value: unknown,
): HermeticBuildReplayFixture | null {
  const data = fixtureData(value);
  if (
    !isRecord(data)
    || data.schemaVersion !== 1
    || data.kind !== "build-replay-v1"
    || !nonEmptyString(data.objective)
    || !safeRepoPath(data.targetFile, SAFE_LIBRARY_TARGET)
    || /\.(?:test|spec)\.ts$/.test(data.targetFile)
    || !Array.isArray(data.testFiles)
    || data.testFiles.length === 0
    || data.testFiles.length > 4
    || data.testFiles.some((path) => !safeRepoPath(path, SAFE_TEST_PATH))
    || !isRecord(data.methodInstructions)
  ) {
    return null;
  }
  const methodInstructions: Record<string, string> = {};
  for (const [digest, instruction] of Object.entries(data.methodInstructions)) {
    if (!nonEmptyString(digest) || !nonEmptyString(instruction)) return null;
    methodInstructions[digest] = instruction;
  }
  if (Object.keys(methodInstructions).length === 0) return null;
  return {
    schemaVersion: 1,
    kind: "build-replay-v1",
    objective: data.objective,
    targetFile: data.targetFile,
    testFiles: [...data.testFiles] as string[],
    methodInstructions,
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function workPatternFixtureDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function workPatternFixtureArtifactId(
  definitionKey: string,
  logicalFixtureKey: string,
): string {
  const digest = createHash("sha256")
    .update(`${definitionKey}\n${logicalFixtureKey}`)
    .digest("hex")
    .slice(0, 32);
  return `ta_wpf_${digest}`;
}

export function buildWorkPatternFixtureArtifactParts(
  fixture: HermeticBuildReplayFixture,
): Array<{ type: string; mimeType: "application/json"; data: HermeticBuildReplayFixture }> {
  return [{
    type: WORK_PATTERN_FIXTURE_PART_TYPE,
    mimeType: "application/json",
    data: fixture,
  }];
}
