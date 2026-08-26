// scripts/lib/pregate-console.mjs
//
// BI-B1065D41 Phase 1 — make the local-CI gate READABLE.
//
// The gate used to mirror every byte its child produced onto pregate's stdout:
// ~28,000 lines for one run. Nobody reads 28,000 lines, so operators piped the
// gate to `head`/`grep` — and that pipe SIGPIPEs a 20-minute run dead mid-install.
// The pipe was never the defect; unreadable output was. The full transcript has
// always been persisted to the slot's `dpf-local-ci-output.log`, so mirroring it
// bought nothing that the log path does not buy in one line.
//
// This module supplies the three pieces that fix the cause rather than the habit:
//
//   1. tolerateBrokenPipe   — a stray pipe DEGRADES instead of killing the run.
//   2. createGateOutputRelay — the child's transcript goes to the log; stdout gets
//      a throttled heartbeat so a long run still proves liveness in a few lines.
//   3. createRepeatNotice / formatGateSummary — the gate's own waiting lines stop
//      repeating verbatim, and the run ends in a bounded, stable verdict block.
//
// The final line of a passing run is still the literal `gate passed`. That anchor
// is the documented verdict (docs/testing/pre-pr-gate.md) precisely because the
// exit code lies in two directions, and Phase 2's `pnpm run pregate:status` reads
// the record rather than this text. Nothing here may move that line.
//
// Everything is pure aside from injected `write`/`now`, so it unit-tests without
// a gate run.

/** Full mirroring is opt-in: the escape hatch for debugging the gate itself. */
export function isVerboseGateConsole(env = process.env) {
  return env.DPF_PREGATE_VERBOSE === "1";
}

/**
 * Make a stream survive its reader going away.
 *
 * `pregate | head -5` closes the pipe once head has its five lines. Node then
 * raises EPIPE as an 'error' event on the stream; unhandled, that is an uncaught
 * exception and the gate dies mid-install holding a lease. Swallowing EPIPE turns
 * the same situation into "the rest of the output goes nowhere", which is exactly
 * what the operator asked for by piping to head.
 *
 * Non-EPIPE errors are still surfaced, so a genuinely broken stdout is not hidden.
 * @param {NodeJS.WritableStream & { on: Function }} stream
 * @param {(error: Error) => void} [onOther]
 */
export function tolerateBrokenPipe(stream, onOther = () => {}) {
  if (!stream || typeof stream.on !== "function") return false;
  stream.on("error", (error) => {
    const code = error && typeof error === "object" ? error.code : "";
    if (code === "EPIPE" || code === "ERR_STREAM_DESTROYED" || code === "ERR_STREAM_WRITE_AFTER_END") return;
    onOther(error);
  });
  return true;
}

/** Apply broken-pipe tolerance to both standard streams of a process. */
export function installBrokenPipeTolerance(proc = process) {
  tolerateBrokenPipe(proc.stdout);
  tolerateBrokenPipe(proc.stderr);
}

/**
 * Collapse a status line to its invariant shape so re-prints of the same waiting
 * state can be suppressed. `queued at position 3; observing again in 12.4s` and
 * `... in 9.8s` share a key; `position 1` does not.
 * @param {string} text
 */
export function noticeKey(text) {
  return String(text)
    // Every waiting line carries a jittered retry delay ("in 12.4s"). That is the
    // one field guaranteed to differ between two otherwise identical polls, so it
    // is normalized away; the queue position deliberately is NOT.
    .replace(/\b\d+(?:\.\d+)?s\b/g, "<delay>")
    .replace(/\d+\.\d+/g, "#")
    .trim();
}

/**
 * A printer for the gate's own "still waiting" lines.
 *
 * Admission polling emitted one line per poll — ~40 identical lines for a single
 * queued run, which is a meaningful slice of the readable budget for no added
 * information. This prints a line when its SHAPE changes (queue position moved,
 * a different blocker appeared) and otherwise at most once per `minRepeatMs`, so
 * liveness is still visible on a long wait.
 *
 * @param {{ write: (text: string) => void, now?: () => number, minRepeatMs?: number }} opts
 */
export function createRepeatNotice({ write, now = () => Date.now(), minRepeatMs = 120_000 }) {
  let lastKey = null;
  let lastAt = 0;
  let suppressed = 0;
  return {
    notice(text) {
      const key = noticeKey(text);
      const at = now();
      if (key === lastKey && at - lastAt < minRepeatMs) {
        suppressed += 1;
        return false;
      }
      const repeat = key === lastKey && suppressed > 0 ? ` (still; ${suppressed + 1} polls)` : "";
      lastKey = key;
      lastAt = at;
      suppressed = 0;
      write(`${String(text).replace(/\n+$/, "")}${repeat}\n`);
      return true;
    },
    suppressedCount: () => suppressed,
  };
}

function formatElapsed(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Last line with real content, trimmed to a single readable fragment. */
export function lastMeaningfulLine(lines, maxChars = 110) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = String(lines[i]).replace(/\r/g, "").trim();
    if (!line) continue;
    // Progress bars and spinner frames carry no information once truncated.
    if (/^[\s.\-=#>|/\\*]+$/.test(line)) continue;
    return line.length > maxChars ? `${line.slice(0, maxChars - 1)}…` : line;
  }
  return "";
}

/**
 * Route the gate child's transcript to the log, and a heartbeat to stdout.
 *
 * `absorb` is called with each raw chunk; the caller is responsible for writing
 * the same chunk to the full log file (this relay never touches the filesystem).
 * In verbose mode chunks pass straight through, preserving the pre-BI-B1065D41
 * behaviour for anyone debugging the gate itself.
 *
 * @param {{
 *   write: (text: string) => void,
 *   now?: () => number,
 *   heartbeatMs?: number,
 *   verbose?: boolean,
 *   label?: string,
 * }} opts
 */
export function createGateOutputRelay({
  write,
  now = () => Date.now(),
  heartbeatMs = 60_000,
  verbose = false,
  label = "local-CI",
}) {
  const startedAt = now();
  let pending = "";
  let lines = 0;
  let bytes = 0;
  let lastBeatAt = startedAt;
  let recent = [];

  function beat(force = false) {
    const at = now();
    if (!force && at - lastBeatAt < heartbeatMs) return false;
    if (lines === 0) return false;
    lastBeatAt = at;
    // `recent` is a rolling window, not a drain: a heartbeat that arrives during
    // a quiet stretch should still name the last thing that actually happened.
    const tail = lastMeaningfulLine(recent);
    write(
      `  ${label} running · ${formatElapsed(at - startedAt)} · ${lines} log lines`
      + (tail ? ` · ${tail}` : "")
      + "\n",
    );
    return true;
  }

  return {
    absorb(chunk) {
      const text = String(chunk);
      bytes += text.length;
      if (verbose) {
        write(text);
        return;
      }
      pending += text;
      const parts = pending.split(/\r?\n/);
      pending = parts.pop() ?? "";
      if (parts.length > 0) {
        lines += parts.length;
        // Only the tail can ever be shown, so only the tail is retained.
        recent = recent.concat(parts).slice(-40);
      }
      beat();
    },
    /** Emit a final heartbeat if anything at all was absorbed. */
    finish() {
      if (verbose) return;
      if (pending.trim()) {
        lines += 1;
        recent.push(pending);
        pending = "";
      }
      if (lines > 0) beat(true);
    },
    stats: () => ({ lines, bytes, elapsedMs: now() - startedAt }),
  };
}

/**
 * The bounded verdict block that ends every run.
 *
 * Ordering is load-bearing: the verdict is the LAST line so `tail -1` and the
 * documented `^gate passed` anchor agree, and every supporting fact sits above
 * it. `verdictLine` is passed in verbatim rather than composed here because a
 * passing run must emit exactly `gate passed` and nothing decorative.
 *
 * @param {{
 *   verdictLine: string,
 *   branch?: string,
 *   sha?: string,
 *   logFile?: string,
 *   logLines?: number,
 *   elapsedMs?: number,
 *   metadataFile?: string,
 *   candidateSha?: string,
 *   evidenceId?: string,
 *   failureSummary?: string,
 *   maxLines?: number,
 * }} input
 * @returns {string[]}
 */
/**
 * Render a failure summary as text (BI-F22B4EEE).
 *
 * `summarizeLocalCiOutput` returns a STRUCTURED record
 * ({ failedTests, failedChecks, omittedFailureLineCount, … }), and this
 * function used to do `String(input.failureSummary)` — which prints
 * `[object Object]`. That was the single line an operator reads on a failed
 * gate, so five consecutive failures on one branch produced no usable signal
 * anywhere: not in the console, not in the record.
 *
 * Strings still pass through, because some callers hand a plain message.
 */
export function failureSummaryLines(summary) {
  if (!summary) return [];
  if (typeof summary === "string") {
    return summary.split(/\r?\n/).filter(Boolean);
  }
  const lines = [];
  for (const entry of summary.failedTests ?? []) {
    lines.push(typeof entry === "string" ? entry : entry?.text ?? JSON.stringify(entry));
  }
  for (const entry of summary.failedChecks ?? []) {
    lines.push(typeof entry === "string" ? entry : entry?.text ?? JSON.stringify(entry));
  }
  if (lines.length === 0) {
    // A failed gate with nothing to attribute is itself the finding — say so
    // rather than printing an empty line or an object.
    lines.push(
      "no failing test or check was captured in the log — the run may have been killed rather than failing; check the recorded signal and host pressure",
    );
  }
  if (summary.omittedFailureLineCount > 0) {
    lines.push(`… ${summary.omittedFailureLineCount} more failure line(s) omitted`);
  }
  return lines;
}

export function formatGateSummary(input) {
  const maxLines = input.maxLines ?? 24;
  const out = [];
  out.push("──── local-CI gate ────");
  if (input.branch || input.sha) {
    out.push(`  branch      ${input.branch || "(unknown)"} @ ${(input.sha || "").slice(0, 12) || "(unknown)"}`);
  }
  if (Number.isFinite(input.elapsedMs)) {
    out.push(`  ran for     ${formatElapsed(input.elapsedMs)}${
      Number.isFinite(input.logLines) ? ` (${input.logLines} log lines)` : ""
    }`);
  }
  if (input.candidateSha) {
    out.push(`  gated sha   ${String(input.candidateSha).slice(0, 12)}`);
  }
  if (input.evidenceId) out.push(`  evidence    ${input.evidenceId}`);
  if (input.metadataFile) out.push(`  record      ${input.metadataFile}`);
  if (input.logFile) out.push(`  full log    ${input.logFile}`);
  for (const line of failureSummaryLines(input.failureSummary).slice(0, 8)) {
    out.push(`  ! ${line.length > 110 ? `${line.slice(0, 109)}…` : line}`);
  }
  out.push("  verdict     pnpm run pregate:status  (reads the record, not this text)");
  const trimmed = out.slice(0, Math.max(1, maxLines - 1));
  // An empty verdictLine means the caller owns the terminal line itself (the
  // failure paths keep their existing, separately-asserted wording).
  if (input.verdictLine) trimmed.push(input.verdictLine);
  return trimmed;
}
