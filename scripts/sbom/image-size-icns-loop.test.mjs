#!/usr/bin/env node
// scripts/sbom/image-size-icns-loop.test.mjs
//
// Regression test for the LOCAL PATCH of image-size (see pnpm-workspace.yaml
// `patchedDependencies` + patches/image-size@1.2.1.patch).
//
// CVE-2025-71330 / GHSA-w3rx-r6r6-pgpr (Dependabot #151): the ICNS parser walks
// image entries with `imageOffset += imageHeader[1]`, where imageHeader[1] is an
// attacker-controlled UInt32BE entry length. A length of 0 never advances the
// offset, so the while-loop spins forever and blocks the Node event loop.
//
// image-size is ARCHIVED upstream on both GitHub and Codeberg with no patched
// release, and metro (our only consumer) closed its own Dependabot issue as
// "not planned" — so we own this fix. This test is the proof the patch is
// applied and stays applied: it fails (times out) against stock 1.2.1.
//
// Runs the parser in a worker with a hard deadline; a hang fails the test rather
// than wedging the runner.

import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const DEADLINE_MS = 5000;

/** Build a minimal ICNS buffer whose single entry declares length 0. */
function zeroLengthEntryIcns() {
  const buf = new Uint8Array(64);
  const view = new DataView(buf.buffer);
  buf.set([0x69, 0x63, 0x6e, 0x73], 0); // 'icns' magic
  view.setUint32(4, 64); // file length
  buf.set([0x69, 0x63, 0x30, 0x39], 8); // 'ic09' entry type
  view.setUint32(12, 0); // entry length = 0 -> the payload
  return buf;
}

/** Run ICNS.calculate in a worker, resolving 'ok' | 'threw' or rejecting on hang. */
function calculateUnderDeadline(bytes) {
  const entry = require.resolve("image-size");
  const src = `
    const { parentPort, workerData } = require("node:worker_threads");
    const mod = require(${JSON.stringify(entry)});
    const imageSize = mod.imageSize ?? mod.default ?? mod;
    try {
      imageSize(Buffer.from(workerData));
      parentPort.postMessage("ok");
    } catch {
      // A malformed-image throw is a perfectly good outcome; the bug is the HANG.
      parentPort.postMessage("threw");
    }
  `;
  return new Promise((resolve, reject) => {
    const worker = new Worker(src, { eval: true, workerData: bytes });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error(`ICNS parse did not terminate within ${DEADLINE_MS}ms — the infinite-loop patch is missing`));
    }, DEADLINE_MS);
    worker.on("message", (m) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(m);
    });
    worker.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

test("image-size ICNS parser terminates on a zero-length entry (CVE-2025-71330)", async () => {
  const outcome = await calculateUnderDeadline(zeroLengthEntryIcns());
  assert.ok(
    outcome === "ok" || outcome === "threw",
    `expected the parser to return or throw, got ${outcome}`,
  );
});

// The patch must stop the loop on MALFORMED entries only. These two guard against
// a fix that terminates by breaking valid parsing — which would silently corrupt
// metro's asset dimensions instead of hanging.

test("ICNS with multiple valid entries still parses through the patched loop", () => {
  const { imageSize } = require("image-size");
  const buf = new Uint8Array(40);
  const view = new DataView(buf.buffer);
  buf.set([0x69, 0x63, 0x6e, 0x73], 0); // 'icns'
  view.setUint32(4, 40); // file length covers both entries
  buf.set([0x69, 0x63, 0x30, 0x39], 8); // entry 1: 'ic09' => 512
  view.setUint32(12, 16); //   length 16 (header + 8 bytes data)
  buf.set([0x69, 0x63, 0x31, 0x30], 24); // entry 2: 'ic10' => 1024
  view.setUint32(28, 16); //   length 16

  const out = imageSize(Buffer.from(buf));
  assert.equal(out.width, 512, "first entry should still drive the reported width");
  assert.equal(out.height, 512);
  assert.deepEqual(
    out.images?.map((i) => i.width),
    [512, 1024],
    "the loop must still walk to the second entry",
  );
});

test("a normal PNG still reports its dimensions (public API intact)", () => {
  const { imageSize } = require("image-size");
  // 1x1 PNG.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const out = imageSize(png);
  assert.equal(out.width, 1);
  assert.equal(out.height, 1);
  assert.equal(out.type, "png");
});
