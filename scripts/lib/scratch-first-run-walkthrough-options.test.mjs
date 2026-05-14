import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildDefaultEmail,
  parseWalkthroughArgs,
} from "./scratch-first-run-walkthrough-options.mjs";

test("buildDefaultEmail creates a deterministic scratch-local address", () => {
  assert.equal(
    buildDefaultEmail(new Date("2026-05-14T07:08:09.000Z")),
    "scratch-admin+20260514T070809Z@dpf.local",
  );
});

test("parseWalkthroughArgs normalizes explicit first-run settings", () => {
  const config = parseWalkthroughArgs(
    [
      "--portal-url",
      "http://localhost:50700/",
      "--evidence-path",
      "C:/tmp/dpf-evidence",
      "--org-name",
      "Digital Product Factory Scratch",
      "--email",
      "scratch-admin@dpf.local",
      "--password",
      "ScratchPassw0rd!",
      "--headed",
      "--timeout-ms",
      "90000",
    ],
    { now: new Date("2026-05-14T07:08:09.000Z"), cwd: "D:/DPF" },
  );

  assert.equal(config.portalUrl, "http://localhost:50700");
  assert.equal(config.evidencePath, "C:\\tmp\\dpf-evidence");
  assert.equal(config.orgName, "Digital Product Factory Scratch");
  assert.equal(config.email, "scratch-admin@dpf.local");
  assert.equal(config.password, "ScratchPassw0rd!");
  assert.equal(config.headed, true);
  assert.equal(config.timeoutMs, 90_000);
});

test("parseWalkthroughArgs fills safe scratch defaults", () => {
  const config = parseWalkthroughArgs([], {
    now: new Date("2026-05-14T07:08:09.000Z"),
    cwd: "D:/DPF",
  });

  assert.equal(config.portalUrl, "http://localhost:3000");
  assert.equal(config.evidencePath, "D:\\DPF\\scratch-first-run-evidence");
  assert.equal(config.orgName, "Digital Product Factory Scratch");
  assert.equal(config.email, "scratch-admin+20260514T070809Z@dpf.local");
  assert.equal(config.password, "ScratchPassw0rd!");
  assert.equal(config.headed, false);
  assert.equal(config.timeoutMs, 45_000);
});

test("parseWalkthroughArgs rejects unknown or incomplete flags", () => {
  assert.throws(
    () => parseWalkthroughArgs(["--portal-url"], { cwd: "D:/DPF" }),
    /requires a value/,
  );
  assert.throws(
    () => parseWalkthroughArgs(["--unknown"], { cwd: "D:/DPF" }),
    /Unknown argument/,
  );
  assert.throws(
    () => parseWalkthroughArgs(["--timeout-ms", "0"], { cwd: "D:/DPF" }),
    /positive integer/,
  );
});
