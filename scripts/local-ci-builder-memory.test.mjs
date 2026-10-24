// BI-D3BF53A9 — the builder's measured peak, not an admission-time [0, 0].

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BUILDER_MEMORY_SAMPLE_SCRIPT,
  builderMemorySampleArgs,
  calibratedBuilderReserveBytes,
  parseBuilderMemorySample,
  parseRssBytes,
  summarizeBuilderMemory,
} from "./lib/local-ci-builder-memory.mjs";

const GiB = 1024 ** 3;

// Captured from the measurement builder on 2026-09-25 during the Turbopack
// compile; the compiler renames itself `next-build`, so a filter on "node"
// alone missed the one process that mattered.
const LIVE_STDOUT = [
  "13727969280",
  "14762520576",
  "anon 12550782976",
  "file 1177182208",
  "oom_kill 0",
  "NODE",
  "107m {MainThread} node /usr/local/bin/pnpm --filter web exec next build",
  " 11g next-build (v16.3.3)",
  "197m {MainThread} node /app/apps/web/.next/build/chunks/pool_entry.js 42537",
  "",
].join("\n");

test("the sample reads the builder's own cgroup and never writes to it", () => {
  assert.match(BUILDER_MEMORY_SAMPLE_SCRIPT, /memory\.peak/);
  assert.match(BUILDER_MEMORY_SAMPLE_SCRIPT, /\[n\]ext-/);
  assert.doesNotMatch(BUILDER_MEMORY_SAMPLE_SCRIPT, /drop_caches|\bsync\b|>/);
  assert.deepEqual(builderMemorySampleArgs("buildx_buildkit_x0").slice(0, 3), [
    "exec", "buildx_buildkit_x0", "sh",
  ]);
});

test("busybox RSS figures parse in KiB and suffixed units", () => {
  assert.equal(parseRssBytes("512"), 512 * 1024);
  assert.equal(parseRssBytes("107m"), 107 * 1024 ** 2);
  assert.equal(parseRssBytes("1.5g"), 1.5 * GiB);
  assert.equal(parseRssBytes("n/a"), null);
});

test("a live sample yields the cgroup peak, anon and the compiler's RSS", () => {
  const sample = parseBuilderMemorySample(LIVE_STDOUT, 1);
  assert.equal(sample.peakBytes, 14762520576);
  assert.equal(sample.currentBytes, 13727969280);
  assert.equal(sample.anonBytes, 12550782976);
  assert.equal(sample.fileBytes, 1177182208);
  assert.equal(sample.oomKills, 0);
  assert.equal(sample.nodeProcessCount, 3);
  assert.equal(sample.nodeRssMaxBytes, 11 * GiB);
});

test("an unreadable builder is no sample, not a zero", () => {
  assert.equal(parseBuilderMemorySample(""), null);
  assert.equal(parseBuilderMemorySample("Error: No such container"), null);
});

test("the summary carries the final memory.peak as a non-zero measurement", () => {
  const first = parseBuilderMemorySample(LIVE_STDOUT, 1);
  const final = { ...first, peakBytes: 14853529600, anonBytes: 96571392 };
  const summary = summarizeBuilderMemory({
    samples: [first],
    finalSample: final,
    containerStartedAt: "2026-09-25T19:40:00Z",
    buildStartedAt: "2026-09-25T19:40:30Z",
    memoryLimitBytes: 16 * GiB,
    observedWorkers: 2,
  });
  assert.equal(summary.status, "measured");
  assert.equal(summary.peakBytes, 14853529600);
  assert.equal(summary.peakScope, "this-build");
  assert.equal(summary.sampledMaxAnonBytes, 12550782976);
  assert.equal(summary.sampledMaxNodeRssBytes, 11 * GiB);
  assert.equal(summary.observedWorkers, 2);
  assert.equal(summary.sampleCount, 2);
});

test("a builder left running from an earlier build reports a lifetime peak", () => {
  const summary = summarizeBuilderMemory({
    finalSample: parseBuilderMemorySample(LIVE_STDOUT),
    containerStartedAt: "2026-09-25T10:00:00Z",
    buildStartedAt: "2026-09-25T19:40:00Z",
  });
  assert.equal(summary.peakScope, "container-lifetime");
});

test("with no readable sample the record says unmeasured with a reason", () => {
  const summary = summarizeBuilderMemory({ samples: [], finalSample: null });
  assert.equal(summary.status, "unmeasured");
  assert.equal(summary.peakBytes, null);
  assert.equal(summary.reason, "builder-unreadable");
});

test("the calibrated reserve is high-water plus margin, bounded by the ceiling", () => {
  assert.equal(calibratedBuilderReserveBytes({
    observedHighWaterBytes: 14 * GiB,
    safetyMarginBytes: 1 * GiB,
    hardCeilingBytes: 16 * GiB,
  }), 15 * GiB);
  assert.equal(calibratedBuilderReserveBytes({
    observedHighWaterBytes: 15.5 * GiB,
    safetyMarginBytes: 2 * GiB,
    hardCeilingBytes: 16 * GiB,
  }), 16 * GiB);
  assert.equal(calibratedBuilderReserveBytes({
    observedHighWaterBytes: 0,
    safetyMarginBytes: 1 * GiB,
    hardCeilingBytes: 16 * GiB,
  }), 16 * GiB);
});
