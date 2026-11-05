// scripts/check-ci-node-qualified.test.mjs (BI-2FAE2E5C, BI-827FA1C9)
// Node built-in test runner: node --test scripts/check-ci-node-qualified.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkCiNodeQualified, findDockerfileNodeMajors, findFloatingNodeVersions,
  parseEnginesRange, parseNodeVersionPin, rangeAdmitsPin,
} from "./check-ci-node-qualified.mjs";

const line = [{ path: "workroom.tgz", engines: ">=24.16.0 <25" }];
const exactList = [{ path: "workroom.tgz", engines: "24.16.0 || 24.22.0 || 24.22.1" }];
const reads = [{ path: ".github/workflows/x.yml", text: "          node-version-file: .node-version\n" }];

test("a pin is a major line or one exact release", () => {
  assert.deepEqual(parseNodeVersionPin("24\n"), { kind: "major", major: 24, text: "24" });
  assert.equal(parseNodeVersionPin("v24.22.1").text, "24.22.1");
  for (const text of ["24.x", "24.22", "lts/*", "", null]) assert.equal(parseNodeVersionPin(text), null, String(text));
});

test("the Node 24 line admits the newest patch and the major pin; an exact list admits neither", () => {
  const range = parseEnginesRange(line[0].engines);
  assert(rangeAdmitsPin(range, parseNodeVersionPin("24.22.2")));
  assert(rangeAdmitsPin(range, parseNodeVersionPin("24")));
  assert(!rangeAdmitsPin(range, parseNodeVersionPin("24.15.0")));
  assert(!rangeAdmitsPin(range, parseNodeVersionPin("26")));
  const list = parseEnginesRange(exactList[0].engines);
  assert(rangeAdmitsPin(list, parseNodeVersionPin("24.22.1")));
  assert(!rangeAdmitsPin(list, parseNodeVersionPin("24.22.2")), "the 24.22.2 break");
  assert(!rangeAdmitsPin(list, parseNodeVersionPin("24")));
  assert.equal(parseEnginesRange("^24.16.0"), null, "unsupported syntax is reported, never guessed");
});

test("refuses a major pin when an artifact still lists exact patches", () => {
  const result = checkCiNodeQualified({ pinText: "24", artifacts: exactList, workflows: reads });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /\.node-version 24 is outside workroom\.tgz/);
});

test("refuses an engines value the check cannot evaluate", () => {
  const result = checkCiNodeQualified({ pinText: "24", artifacts: [{ path: "a.tgz", engines: "^24" }], workflows: [] });
  assert.match(result.errors.join("\n"), /cannot evaluate/);
});

test("refuses a missing or malformed pin", () => {
  for (const pinText of [null, "24.x"]) {
    const result = checkCiNodeQualified({ pinText, artifacts: line, workflows: [] });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /\.node-version/);
  }
});

test("a literal setup-node version on the pinned major bypasses the single pin", () => {
  assert.deepEqual(findFloatingNodeVersions("          node-version: 24\n", 24), [{ line: 1, value: "24" }]);
  assert.deepEqual(findFloatingNodeVersions("          node-version: '24.22.1'\n", 24).map(f => f.value), ["24.22.1"]);
  assert.deepEqual(findFloatingNodeVersions("          node-version: 22\n", 24), [], "another major is a separate toolchain choice");
  const result = checkCiNodeQualified({ pinText: "24", artifacts: line,
    workflows: [{ path: ".github/workflows/x.yml", text: "          node-version: 24\n" }] });
  assert.match(result.errors.join("\n"), /x\.yml:1.*node-version-file: \.node-version/);
});

test("Dockerfiles stay on the pinned major", () => {
  assert.deepEqual(findDockerfileNodeMajors("FROM node:24-alpine AS base\nFROM node:26-alpine\n", 24), [{ line: 2, value: "26" }]);
  assert.deepEqual(findDockerfileNodeMajors("FROM --platform=linux/amd64 node:24-bookworm-slim@sha256:ab\n", 24), []);
  const result = checkCiNodeQualified({ pinText: "24", artifacts: line, workflows: reads,
    dockerfiles: [{ path: "Dockerfile", text: "FROM node:22-alpine\n" }] });
  assert.match(result.errors.join("\n"), /Dockerfile:1 uses node:22/);
});

test("accepts the major line when every artifact admits it", () => {
  const result = checkCiNodeQualified({ pinText: "24\n", artifacts: line, workflows: reads,
    dockerfiles: [{ path: "Dockerfile", text: "FROM node:24-alpine\n" }] });
  assert.deepEqual(result, { ok: true, pin: "24", errors: [] });
});

test("the repository pin is admitted by the engines inside every vendored tarball", async () => {
  const { loadRepositoryInputs } = await import("./check-ci-node-qualified.mjs");
  const inputs = await loadRepositoryInputs(new URL("..", import.meta.url));
  assert(inputs.artifacts.length > 0, "a vendored tarball declares engines.node");
  assert(inputs.dockerfiles.length > 0, "Dockerfiles are inspected");
  assert.deepEqual(checkCiNodeQualified(inputs).errors, []);
});
