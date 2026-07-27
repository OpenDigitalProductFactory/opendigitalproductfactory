// scripts/lib/ci-observation.mjs
//
// BI-2F60FDCE — CI evidence observation schema + pure aggregators.
// Measurement only: no suite selection, no required-check changes, no silent
// green from flakes. Used by scripts/ci-observation.mjs and calibration CI.

export const CI_OBSERVATION_SCHEMA_VERSION = 1;

const SHA40_RE = /^[0-9a-f]{40}$/i;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function metricSlice(raw) {
  const total = Number(raw?.total ?? 0);
  const covered = Number(raw?.covered ?? 0);
  const pct =
    raw?.pct != null && Number.isFinite(Number(raw.pct))
      ? Number(raw.pct)
      : total === 0
        ? 100
        : Math.round((covered / total) * 10000) / 100;
  return { total, covered, pct };
}

function normalizeRepoRelative(filePath, repoRoot = "") {
  let p = String(filePath ?? "").replace(/\\/g, "/");
  const root = String(repoRoot ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (root && p.toLowerCase().startsWith(root.toLowerCase() + "/")) {
    p = p.slice(root.length + 1);
  }
  // Strip leading drive if still absolute Windows form without repoRoot match.
  p = p.replace(/^[A-Za-z]:\//, "");
  return p.replace(/^\.\//, "");
}

function normalizeTestHistory(samples = [], maximumRuns = 30) {
  const normalized = [];
  const seen = new Set();
  for (const sample of samples) {
    const testId = String(sample?.testId ?? "").trim();
    const runId = String(sample?.runId ?? "").trim();
    const outcome = String(sample?.outcome ?? "").toLowerCase();
    if (!testId || !runId || !["passed", "failed"].includes(outcome)) continue;
    const key = `${testId}\0${runId}\0${outcome}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      testId,
      file: normalizeRepoRelative(sample.file),
      title: String(sample.title ?? ""),
      outcome,
      durationMs: Number(sample.durationMs ?? 0),
      runId,
      treeSha: String(sample.treeSha ?? ""),
    });
  }
  const retainedRunIds = new Set(
    [...new Set(normalized.map((sample) => sample.runId))].sort().slice(-maximumRuns),
  );
  return normalized
    .filter((sample) => retainedRunIds.has(sample.runId))
    .sort((left, right) =>
      left.runId.localeCompare(right.runId)
      || left.testId.localeCompare(right.testId)
      || left.outcome.localeCompare(right.outcome));
}

function nearestRank(sortedAsc, p) {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, rank - 1));
  return sortedAsc[idx];
}

/**
 * @param {object} input
 * @returns {object} versioned observation document
 */
export function buildCiObservation(input = {}) {
  const treeSha = String(input.treeSha ?? "");
  if (!SHA40_RE.test(treeSha)) {
    throw new Error("treeSha must be a 40-character Git SHA (immutable tree identity)");
  }
  const runId = String(input.runId ?? "");
  if (!runId) throw new Error("runId is required");
  const runAttempt = Number(input.runAttempt ?? 1);
  if (!Number.isFinite(runAttempt) || runAttempt < 1) {
    throw new Error("runAttempt must be a positive number");
  }
  const eventName = String(input.eventName ?? "");
  if (!eventName) throw new Error("eventName is required");
  const createdAt = String(input.createdAt ?? "");
  if (!createdAt) throw new Error("createdAt is required");
  const repository = String(input.repository ?? "");
  if (!repository) throw new Error("repository is required");

  const coverage = Array.isArray(input.coverage) ? input.coverage : [];
  const testRuns = Array.isArray(input.testRuns) ? input.testRuns : [];
  const cacheSamples = Array.isArray(input.cacheSamples) ? input.cacheSamples : [];
  const shadowSelection = input.shadowSelection ?? null;
  const currentFlakeSamples = Array.isArray(input.flakeSamples)
    ? input.flakeSamples
    : testRuns.flatMap((run) => (Array.isArray(run.tests) ? run.tests : []));
  const historicalTestObservations = Array.isArray(input.historicalTestObservations)
    ? input.historicalTestObservations
    : [];
  const testHistory = normalizeTestHistory([
    ...historicalTestObservations,
    ...currentFlakeSamples,
  ]);

  const timingSamples = [
    ...(Array.isArray(input.timingSamples) ? input.timingSamples : []),
    ...testRuns.flatMap((run) => {
        if (Array.isArray(run.timings)) return run.timings;
        if (run.durationMs != null) {
          return [{ phase: run.phase ?? "test", durationMs: run.durationMs }];
        }
        return [];
      }),
  ];

  return {
    schemaVersion: CI_OBSERVATION_SCHEMA_VERSION,
    createdAt,
    identity: {
      repository,
      treeSha: treeSha.toLowerCase(),
      eventName,
      runId,
      runAttempt,
    },
    coverage,
    timings: summarizeTimings(timingSamples),
    shadowSelection,
    testHistory,
    flakeHistory: classifyFlakeHistory(testHistory),
    cacheEconomics: calculateCacheEconomics(cacheSamples),
  };
}

/**
 * @param {{ packageName: string, ownedFiles: string[], coverageSummary: object }} input
 */
export function summarizeCoverage(input = {}) {
  const packageName = String(input.packageName ?? "");
  const repoRoot = String(input.repoRoot ?? "");
  const ownedFiles = [...new Set(
    (input.ownedFiles ?? []).map((f) => normalizeRepoRelative(f, repoRoot)),
  )].sort();
  const coverageSummary = isPlainObject(input.coverageSummary) ? input.coverageSummary : {};
  const total = coverageSummary.total ?? {};

  const reportedPaths = Object.keys(coverageSummary)
    .filter((k) => k !== "total")
    .map((k) => normalizeRepoRelative(k, repoRoot))
    .sort();
  const reportedSet = new Set(reportedPaths);

  const unloadedOwnedFiles = ownedFiles.filter((f) => {
    if (!reportedSet.has(f)) return false;
    const entry = coverageSummary[f] ?? coverageSummary[
      Object.keys(coverageSummary).find((k) => normalizeRepoRelative(k, repoRoot) === f)
    ];
    if (!entry) return false;
    const lines = entry.lines ?? {};
    return Number(lines.covered ?? 0) === 0 && Number(lines.total ?? 0) > 0;
  });

  const missingOwnedFiles = ownedFiles.filter((f) => !reportedSet.has(f));

  return {
    packageName,
    metrics: {
      statements: metricSlice(total.statements),
      branches: metricSlice(total.branches),
      functions: metricSlice(total.functions),
      lines: metricSlice(total.lines),
    },
    ownedFileCount: ownedFiles.length,
    reportedOwnedFileCount: ownedFiles.filter((f) => reportedSet.has(f)).length,
    unloadedOwnedFiles,
    missingOwnedFiles,
    completeOwnedFileInventory: missingOwnedFiles.length === 0,
  };
}

/**
 * @param {object} input
 */
export function calculateSelectionRecall(input = {}) {
  const allTestFiles = [...new Set(input.allTestFiles ?? [])].sort();
  const selectedTestFiles = [...new Set(input.selectedTestFiles ?? [])].sort();
  const failedTestFiles = [...new Set(input.failedTestFiles ?? [])].sort();
  const unknownChangedFiles = [...new Set(input.unknownChangedFiles ?? [])].sort();
  const escalatedToFull = input.escalatedToFull === true;

  const selectedSet = new Set(selectedTestFiles);
  const selectedPercentage =
    allTestFiles.length === 0
      ? 0
      : Math.round((selectedTestFiles.length / allTestFiles.length) * 10000) / 100;

  const observedFailureCount = failedTestFiles.length;
  const selectedFailures = failedTestFiles.filter((f) => selectedSet.has(f));
  const missedFailures = failedTestFiles.filter((f) => !selectedSet.has(f));
  const selectedFailureCount = selectedFailures.length;

  if (observedFailureCount === 0) {
    return {
      selectedPercentage,
      observedFailureCount: 0,
      selectedFailureCount: 0,
      failureRecall: null,
      missedFailures: [],
      unknownChangedFiles,
      escalatedToFull,
      safeForActivation: false,
      reason: "no-full-suite-failure-observed",
    };
  }

  const failureRecall =
    Math.round((selectedFailureCount / observedFailureCount) * 10000) / 100;

  if (escalatedToFull) {
    return {
      selectedPercentage: 100,
      observedFailureCount,
      selectedFailureCount: observedFailureCount,
      failureRecall: 100,
      missedFailures: [],
      unknownChangedFiles,
      escalatedToFull: true,
      safeForActivation: true,
      reason: "full-suite-escalation",
    };
  }

  return {
    selectedPercentage,
    observedFailureCount,
    selectedFailureCount,
    failureRecall,
    missedFailures,
    unknownChangedFiles,
    escalatedToFull: false,
    safeForActivation: failureRecall === 100 && unknownChangedFiles.length === 0,
    reason: failureRecall === 100 ? "full-recall" : "missed-failures",
  };
}

/**
 * @param {Array<{testId:string, runId:string, treeSha:string, outcome:string, durationMs?:number}>} samples
 */
export function classifyFlakeHistory(samples = []) {
  const byTest = new Map();
  for (const sample of samples) {
    const testId = String(sample?.testId ?? "");
    if (!testId) continue;
    const outcome = String(sample?.outcome ?? "").toLowerCase();
    if (!byTest.has(testId)) {
      byTest.set(testId, { testId, failedRuns: 0, passedRuns: 0, samples: 0 });
    }
    const entry = byTest.get(testId);
    entry.samples += 1;
    if (outcome === "failed" || outcome === "fail") entry.failedRuns += 1;
    else if (outcome === "passed" || outcome === "pass") entry.passedRuns += 1;
  }

  const suspectedFlakes = [];
  const insufficientHistory = [];
  for (const entry of byTest.values()) {
    if (entry.samples < 3 && entry.failedRuns > 0 && entry.passedRuns > 0) {
      insufficientHistory.push(entry.testId);
      continue;
    }
    if (entry.failedRuns > 0 && entry.passedRuns > 0) {
      suspectedFlakes.push({
        testId: entry.testId,
        failedRuns: entry.failedRuns,
        passedRuns: entry.passedRuns,
        samples: entry.samples,
      });
    }
  }

  suspectedFlakes.sort((a, b) => a.testId.localeCompare(b.testId));
  insufficientHistory.sort();

  return { suspectedFlakes, insufficientHistory };
}

/**
 * @param {Array<object>} samples
 */
export function calculateCacheEconomics(samples = []) {
  const byName = new Map();
  for (const sample of samples) {
    const cacheName = String(sample?.cacheName ?? "unknown");
    if (!byName.has(cacheName)) {
      byName.set(cacheName, {
        cacheName,
        samples: 0,
        hits: 0,
        misses: 0,
        bytes: 0,
        restoreMs: 0,
        saveMs: 0,
        downstreamMs: 0,
        estimatedTimeSavedMs: 0,
      });
    }
    const agg = byName.get(cacheName);
    const hit = sample?.hit === true;
    const bytes = Number(sample?.bytes ?? 0);
    const restoreMs = Number(sample?.restoreMs ?? 0);
    const saveMs = Number(sample?.saveMs ?? 0);
    const downstreamMs = Number(sample?.downstreamMs ?? 0);
    const coldBaselineMs = Number(sample?.coldBaselineMs ?? 0);

    agg.samples += 1;
    if (hit) agg.hits += 1;
    else agg.misses += 1;
    agg.bytes += bytes;
    agg.restoreMs += restoreMs;
    agg.saveMs += saveMs;
    agg.downstreamMs += downstreamMs;
    // Time saved vs cold baseline on hits (downstream only; restore/save are costs).
    if (hit && coldBaselineMs > 0) {
      const saved = Math.max(0, coldBaselineMs - downstreamMs);
      agg.estimatedTimeSavedMs += saved;
    }
  }

  return [...byName.values()]
    .map((agg) => {
      const hitRate = agg.samples === 0 ? 0 : Math.round((agg.hits / agg.samples) * 10000) / 100;
      // Net value: time saved on hits minus restore/save overhead across samples.
      // Spec test: estimatedTimeSavedMs 500, restore 120, save 140 → net 240
      // 500 - 120 - 140 = 240
      const net = agg.estimatedTimeSavedMs - agg.restoreMs - agg.saveMs;
      return {
        cacheName: agg.cacheName,
        samples: agg.samples,
        hits: agg.hits,
        misses: agg.misses,
        hitRate,
        bytes: agg.bytes,
        restoreMs: agg.restoreMs,
        saveMs: agg.saveMs,
        downstreamMs: agg.downstreamMs,
        estimatedTimeSavedMs: agg.estimatedTimeSavedMs,
        netValueMs: net,
      };
    })
    .sort((a, b) => a.cacheName.localeCompare(b.cacheName));
}

/**
 * @param {object} json Vitest JSON reporter payload
 * @param {{ packageName: string, repoRoot?: string, runId?: string, treeSha?: string }} meta
 */
export function parseVitestJsonReport(json = {}, meta = {}) {
  const packageName = String(meta.packageName ?? "unknown");
  const repoRoot = String(meta.repoRoot ?? "");
  const runId = String(meta.runId ?? "");
  const treeSha = String(meta.treeSha ?? "");
  const testResults = Array.isArray(json.testResults) ? json.testResults : [];

  const failedTestFiles = [];
  const files = [];
  const tests = [];

  for (const suite of testResults) {
    const file = normalizeRepoRelative(suite?.name ?? "", repoRoot);
    const status = String(suite?.status ?? "").toLowerCase();
    const startTime = Number(suite?.startTime ?? 0);
    const endTime = Number(suite?.endTime ?? startTime);
    const durationMs = Math.max(0, endTime - startTime);
    files.push({ file, status, durationMs });
    if (status === "failed") failedTestFiles.push(file);

    const assertions = Array.isArray(suite?.assertionResults) ? suite.assertionResults : [];
    for (const assertion of assertions) {
      const ancestors = Array.isArray(assertion?.ancestorTitles)
        ? assertion.ancestorTitles
        : [];
      const titleParts = [...ancestors, String(assertion?.title ?? "")].filter(Boolean);
      const title = titleParts.join(" > ");
      const outcome = String(assertion?.status ?? "unknown").toLowerCase();
      tests.push({
        testId: `${packageName}::${file}::${title}`,
        file,
        title,
        outcome,
        durationMs: Number(assertion?.duration ?? 0),
        runId,
        treeSha,
      });
    }
  }

  failedTestFiles.sort();
  return { failedTestFiles, files, tests };
}

/**
 * @param {Array<{ phase: string, durationMs: number }>} samples
 */
export function summarizeTimings(samples = []) {
  const byPhase = new Map();
  for (const sample of samples) {
    const phase = String(sample?.phase ?? "unknown");
    const durationMs = Number(sample?.durationMs ?? 0);
    if (!Number.isFinite(durationMs)) continue;
    if (!byPhase.has(phase)) byPhase.set(phase, []);
    byPhase.get(phase).push(durationMs);
  }

  return [...byPhase.entries()]
    .map(([phase, durations]) => {
      const sorted = [...durations].sort((a, b) => a - b);
      const totalMs = sorted.reduce((a, b) => a + b, 0);
      return {
        phase,
        samples: sorted.length,
        totalMs,
        minMs: sorted[0] ?? 0,
        p50Ms: nearestRank(sorted, 50),
        p90Ms: nearestRank(sorted, 90),
        maxMs: sorted[sorted.length - 1] ?? 0,
      };
    })
    .sort((a, b) => a.phase.localeCompare(b.phase));
}
