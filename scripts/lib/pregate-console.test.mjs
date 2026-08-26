import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";

import {
  createGateOutputRelay,
  createRepeatNotice,
  formatGateSummary,
  isVerboseGateConsole,
  lastMeaningfulLine,
  noticeKey,
  tolerateBrokenPipe,
} from "./pregate-console.mjs";

function collector() {
  const chunks = [];
  return { write: (t) => chunks.push(t), text: () => chunks.join(""), lines: () => chunks.join("").split("\n").filter(Boolean) };
}

test("tolerateBrokenPipe swallows EPIPE and re-surfaces anything else", () => {
  const stream = new EventEmitter();
  const other = [];
  assert.equal(tolerateBrokenPipe(stream, (e) => other.push(e)), true);
  stream.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
  stream.emit("error", Object.assign(new Error("gone"), { code: "ERR_STREAM_DESTROYED" }));
  assert.deepEqual(other, []);
  stream.emit("error", Object.assign(new Error("disk"), { code: "ENOSPC" }));
  assert.equal(other.length, 1);
});

test("isVerboseGateConsole is opt-in", () => {
  assert.equal(isVerboseGateConsole({}), false);
  assert.equal(isVerboseGateConsole({ DPF_PREGATE_VERBOSE: "0" }), false);
  assert.equal(isVerboseGateConsole({ DPF_PREGATE_VERBOSE: "1" }), true);
});

test("noticeKey collapses the varying delay but not the queue position", () => {
  assert.equal(
    noticeKey("local-CI admission queued at position 3; observing again in 12.4s..."),
    noticeKey("local-CI admission queued at position 3; observing again in 9.8s..."),
  );
  assert.notEqual(
    noticeKey("local-CI admission queued at position 3; observing again in 12.4s..."),
    noticeKey("local-CI admission queued at position 1; observing again in 12.4s..."),
  );
});

test("repeat notice prints once per shape, then only after the repeat window", () => {
  const out = collector();
  let clock = 0;
  const notice = createRepeatNotice({ write: out.write, now: () => clock, minRepeatMs: 100 });

  for (let i = 0; i < 40; i += 1) {
    clock += 1;
    notice.notice(`local-CI admission queued at position 3; observing again in ${10 + i / 10}s...`);
  }
  assert.equal(out.lines().length, 1, "40 identical polls collapse to one line");

  clock += 200;
  notice.notice("local-CI admission queued at position 3; observing again in 11.0s...");
  const lines = out.lines();
  assert.equal(lines.length, 2);
  assert.match(lines[1], /still; 40 polls/);

  notice.notice("local-CI admission queued at position 1; observing again in 11.0s...");
  assert.equal(out.lines().length, 3, "a changed position prints immediately");
});

test("lastMeaningfulLine skips blanks and pure progress noise", () => {
  assert.equal(lastMeaningfulLine(["real line", "", "   ", "====="]), "real line");
  assert.equal(lastMeaningfulLine([]), "");
  assert.equal(lastMeaningfulLine(["x".repeat(400)]).length, 110);
});

test("relay keeps 28k child lines off stdout and heartbeats instead", () => {
  const out = collector();
  let clock = 0;
  const relay = createGateOutputRelay({ write: out.write, now: () => clock, heartbeatMs: 1000 });

  for (let i = 0; i < 28_000; i += 1) {
    clock += 1; // 28s of wall clock over the whole run
    relay.absorb(`webpack compiled module ${i}\n`);
  }
  relay.finish();

  const lines = out.lines();
  assert.equal(relay.stats().lines, 28_000);
  assert.ok(lines.length <= 30, `expected a bounded heartbeat, got ${lines.length} lines`);
  assert.ok(lines.length >= 2, "a long run must still prove liveness");
  assert.match(lines.at(-1), /local-CI running · .* · 28000 log lines · webpack compiled module 27999/);
  assert.ok(!out.text().includes("module 100\n"), "child transcript must not reach stdout");
});

test("relay reassembles lines split across chunk boundaries", () => {
  const out = collector();
  const relay = createGateOutputRelay({ write: out.write, now: () => 0, heartbeatMs: 60_000 });
  relay.absorb("alpha be");
  relay.absorb("ta\ngam");
  relay.absorb("ma\n");
  relay.finish();
  assert.equal(relay.stats().lines, 2, "a line split across chunks counts once");
  assert.equal(out.lines().length, 1, "only the closing heartbeat reaches stdout");
  assert.match(out.text(), /gamma/, "the heartbeat names the newest line");
});

test("relay in verbose mode mirrors everything verbatim", () => {
  const out = collector();
  const relay = createGateOutputRelay({ write: out.write, now: () => 0, verbose: true });
  relay.absorb("one\ntwo\n");
  relay.finish();
  assert.equal(out.text(), "one\ntwo\n");
});

test("relay stays silent when the child produced nothing", () => {
  const out = collector();
  const relay = createGateOutputRelay({ write: out.write, now: () => 0 });
  relay.finish();
  assert.equal(out.text(), "");
});

test("gate summary is bounded and ends in the verbatim verdict line", () => {
  const lines = formatGateSummary({
    verdictLine: "gate passed",
    branch: "claude/topic",
    sha: "0123456789abcdef0123456789abcdef01234567",
    logFile: "D:/DPF/.git/worktrees/wt/dpf-local-ci-output.log",
    logLines: 28_412,
    elapsedMs: 22 * 60_000,
    metadataFile: "D:/DPF/.git/worktrees/wt/dpf-local-ci-metadata.json",
    candidateSha: "0123456789abcdef0123456789abcdef01234567",
    evidenceId: "EV-1",
  });
  assert.ok(lines.length <= 24, `summary must stay bounded, got ${lines.length}`);
  assert.equal(lines.at(-1), "gate passed", "the documented ^gate passed anchor must be the last line");
  assert.ok(lines.some((l) => l.includes("dpf-local-ci-output.log")), "the log path must be one command away");
  assert.ok(lines.some((l) => l.includes("pregate:status")), "the authoritative verdict command must be named");
});

test("gate summary truncates a runaway failure summary rather than replaying the log", () => {
  const lines = formatGateSummary({
    verdictLine: "gate failed",
    failureSummary: Array.from({ length: 500 }, (_, i) => `failure line ${i}`).join("\n"),
  });
  assert.ok(lines.length <= 24, `summary must stay bounded, got ${lines.length}`);
  assert.equal(lines.at(-1), "gate failed");
});

// BI-F22B4EEE. summarizeLocalCiOutput returns a STRUCTURED record, and the
// summary did `String(input.failureSummary)` — printing `[object Object]` as the
// one line an operator reads on a failed gate.
test("formatGateSummary renders a structured failure summary as text", () => {
  const lines = formatGateSummary({
    branch: "fix/x",
    sha: "abcdef1234567890",
    verdictLine: "",
    failureSummary: {
      schema: "dpf-local-ci-failure-summary/v1",
      failedTests: ["FAIL lib/a.test.ts > does the thing"],
      failedChecks: ["Prose Lint Guard"],
      omittedFailureLineCount: 0,
    },
  }).join("\n");

  assert.match(lines, /FAIL lib\/a\.test\.ts/);
  assert.match(lines, /Prose Lint Guard/);
  assert.doesNotMatch(lines, /\[object Object\]/);
});

test("formatGateSummary says so when a failed gate captured nothing", () => {
  // The live shape: the child was killed, so no test or check ever failed. An
  // empty summary must not render as a blank line or an object.
  const lines = formatGateSummary({
    verdictLine: "",
    failureSummary: {
      schema: "dpf-local-ci-failure-summary/v1",
      failedTests: [],
      failedChecks: [],
      omittedFailureLineCount: 0,
    },
  }).join("\n");

  assert.match(lines, /no failing test or check was captured/);
  assert.doesNotMatch(lines, /\[object Object\]/);
});

test("formatGateSummary still accepts a plain string summary", () => {
  const lines = formatGateSummary({ verdictLine: "", failureSummary: "one plain line" }).join("\n");

  assert.match(lines, /! one plain line/);
});

test("formatGateSummary reports omitted failure lines", () => {
  const lines = formatGateSummary({
    verdictLine: "",
    failureSummary: { failedTests: ["FAIL a"], failedChecks: [], omittedFailureLineCount: 4 },
  }).join("\n");

  assert.match(lines, /4 more failure line\(s\) omitted/);
});
