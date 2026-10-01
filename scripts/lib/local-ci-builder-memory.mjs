// BI-D3BF53A9: what the bounded builder actually used, measured from its own
// cgroup, so the admission reserve can come from evidence instead of a guess.
//
// Before this, the only builder number in a gate record was
// `builderMemoryUsageBytes`, sampled at ADMISSION, before any build ran. It was
// [0, 0] on every record, so the reserve (the builder's whole 16 GiB ceiling)
// could never be checked against a real peak.
//
// The builder is a docker-container BuildKit daemon with a private cgroup
// namespace, so `/sys/fs/cgroup` inside it IS the builder's cgroup, and every
// build step runs in a child of it. Two readings matter:
//
// - `memory.peak`: the kernel's own high-water for the cgroup since the builder
//   container started. It counts page cache charged to the builder as well as
//   process memory, so it is an upper bound on what the build needed.
// - `anon` from `memory.stat`, and the RSS of the node and next-* processes: memory the
//   build cannot give back under pressure. Sampled, so a short spike between
//   samples can be missed; that is why both are recorded.
//
// Reads only. Nothing here writes to the cgroup or the VM.

const GiB = 1024 ** 3;

/** One shell line, run inside the builder container, that prints one sample. */
export const BUILDER_MEMORY_SAMPLE_SCRIPT = [
  "cat /sys/fs/cgroup/memory.current",
  "cat /sys/fs/cgroup/memory.peak",
  "grep -E '^(anon|file) ' /sys/fs/cgroup/memory.stat",
  "grep -E '^oom_kill ' /sys/fs/cgroup/memory.events",
  "echo NODE",
  "ps -o rss,args | grep -E '[n]ode|[n]ext-' || true",
].join("; ");

export function builderMemorySampleArgs(container) {
  return ["exec", container, "sh", "-c", BUILDER_MEMORY_SAMPLE_SCRIPT];
}

const RSS_UNITS = { "": 1024, k: 1024, m: 1024 ** 2, g: GiB };

/** busybox `ps -o rss` prints KiB, or a suffixed figure such as `1.5g`. */
export function parseRssBytes(text) {
  const match = /^(\d+(?:\.\d+)?)([kmg]?)$/i.exec(String(text || "").trim());
  if (!match) return null;
  return Math.round(Number(match[1]) * RSS_UNITS[match[2].toLowerCase()]);
}

/** Parse one sample's stdout. Returns null when the cgroup lines are absent. */
export function parseBuilderMemorySample(stdout, at = Date.now()) {
  const lines = String(stdout || "").split(/\r?\n/);
  const current = Number(lines[0]);
  const peak = Number(lines[1]);
  if (!Number.isFinite(current) || !Number.isFinite(peak) || lines[0] === "") {
    return null;
  }
  const sample = { at, currentBytes: current, peakBytes: peak };
  for (const line of lines.slice(2)) {
    const match = /^(anon|file|oom_kill) (\d+)$/.exec(line.trim());
    if (match) {
      const key = { anon: "anonBytes", file: "fileBytes", oom_kill: "oomKills" }[match[1]];
      sample[key] = Number(match[2]);
    }
  }
  const nodeAt = lines.indexOf("NODE");
  const rss = nodeAt < 0 ? [] : lines.slice(nodeAt + 1)
    .map((line) => /^\s*(\S+)\s+/.exec(line))
    .filter(Boolean)
    .map((match) => parseRssBytes(match[1]))
    .filter((value) => Number.isFinite(value));
  sample.nodeRssTotalBytes = rss.reduce((sum, value) => sum + value, 0);
  sample.nodeRssMaxBytes = rss.reduce((max, value) => Math.max(max, value), 0);
  sample.nodeProcessCount = rss.length;
  return sample;
}

function maxOf(samples, key) {
  const values = samples
    .map((sample) => sample?.[key])
    .filter((value) => Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
}

/**
 * The record a gate carries. `peakBytes` is the admission-relevant figure; it
 * is null, with a reason, when the builder could not be read at all, and a
 * record never reports 0 as though it were a measurement.
 */
export function summarizeBuilderMemory({
  samples = [],
  finalSample = null,
  containerStartedAt = null,
  buildStartedAt = null,
  memoryLimitBytes = null,
  observedWorkers = null,
} = {}) {
  const all = [...samples, finalSample].filter(Boolean);
  const peakBytes = finalSample?.peakBytes ?? maxOf(all, "peakBytes");
  const measured = Number.isFinite(peakBytes) && peakBytes > 0;
  // A builder left running from an earlier build (cool-down disabled) reports
  // a lifetime peak that may belong to that build. Say so rather than hide it.
  const startedMs = Date.parse(containerStartedAt ?? "");
  const buildMs = Date.parse(buildStartedAt ?? "");
  const peakScope = Number.isFinite(startedMs) && Number.isFinite(buildMs)
    ? (startedMs >= buildMs - 60_000 ? "this-build" : "container-lifetime")
    : "unknown";
  return {
    bi: "BI-D3BF53A9",
    status: measured ? "measured" : "unmeasured",
    ...(measured ? {} : { reason: all.length ? "cgroup-peak-unreadable" : "builder-unreadable" }),
    peakBytes: measured ? peakBytes : null,
    peakScope,
    memoryLimitBytes,
    sampledMaxCurrentBytes: maxOf(all, "currentBytes"),
    sampledMaxAnonBytes: maxOf(all, "anonBytes"),
    sampledMaxFileBytes: maxOf(all, "fileBytes"),
    sampledMaxNodeRssTotalBytes: maxOf(all, "nodeRssTotalBytes"),
    sampledMaxNodeRssBytes: maxOf(all, "nodeRssMaxBytes"),
    oomKills: maxOf(all, "oomKills"),
    observedWorkers,
    sampleCount: all.length,
    containerStartedAt,
  };
}

/**
 * Admission reserve from a measured high-water plus a documented margin, the
 * same shape as `hostStagePolicy.admissionCalibration`. The hard ceiling still
 * bounds it: evidence can make admission tighter than the ceiling, never looser.
 */
export function calibratedBuilderReserveBytes({
  observedHighWaterBytes,
  safetyMarginBytes,
  hardCeilingBytes,
}) {
  if (
    !Number.isFinite(observedHighWaterBytes) || observedHighWaterBytes <= 0
    || !Number.isFinite(safetyMarginBytes) || safetyMarginBytes < 0
  ) {
    return hardCeilingBytes;
  }
  return Math.min(hardCeilingBytes, observedHighWaterBytes + safetyMarginBytes);
}
