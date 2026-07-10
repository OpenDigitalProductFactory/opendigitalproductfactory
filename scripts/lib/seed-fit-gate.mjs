import { readFileSync } from "node:fs";

const config = JSON.parse(
  readFileSync(new URL("../../config/seed-content-paths.json", import.meta.url), "utf8"),
);

export const SEED_FIT_DECISIONS = Object.freeze([
  "global-default",
  "archetype-scoped",
  "vertical-scoped",
  "parameterize-first",
  "install-local-only",
  "reject-as-seed",
]);

const MERGE_ELIGIBLE = new Set([
  "global-default",
  "archetype-scoped",
  "vertical-scoped",
]);
const DECISION_SET = new Set(SEED_FIT_DECISIONS);
const directoryPrefixes = config.directoryPrefixes;
const filePatterns = config.filePatterns.map((pattern) => new RegExp(pattern));
const excludePatterns = config.excludePatterns.map((pattern) => new RegExp(pattern));

function normalizeRepoPath(path) {
  return String(path).replaceAll("\\", "/").replace(/^\.\//, "").replace(/^[ab]\//, "");
}

export function isCanonicalSeedContentPath(path) {
  const normalized = normalizeRepoPath(path);
  if (!normalized || excludePatterns.some((pattern) => pattern.test(normalized))) return false;
  return directoryPrefixes.some((prefix) => normalized.startsWith(prefix))
    || filePatterns.some((pattern) => pattern.test(normalized));
}

export function findCanonicalSeedContentPaths(paths) {
  return [...new Set(paths.map(normalizeRepoPath).filter(isCanonicalSeedContentPath))];
}

function collectDecisionTokens(prBody, labels) {
  const bodyMatches = [...String(prBody).matchAll(/Seed-Fit-Decision:\s*([^\s`]+)/gi)]
    .map((match) => match[1].toLowerCase());
  const labelMatches = labels
    .map((label) => String(label).toLowerCase())
    .filter((label) => label.startsWith("seed-fit:"))
    .map((label) => label.slice("seed-fit:".length));
  return [...bodyMatches, ...labelMatches];
}

export function evaluateSeedFitGate({ changedFiles, prBody = "", labels = [] }) {
  const seedPaths = findCanonicalSeedContentPaths(changedFiles);
  if (seedPaths.length === 0) {
    return { ok: true, reason: "no-seed-content", seedPaths, decision: null };
  }

  const tokens = collectDecisionTokens(prBody, labels);
  const invalid = tokens.filter((decision) => !DECISION_SET.has(decision));
  if (invalid.length > 0) {
    return { ok: false, reason: "invalid-decision", seedPaths, decision: null, invalid };
  }

  const unique = [...new Set(tokens)];
  if (unique.length === 0) {
    return { ok: false, reason: "missing-decision", seedPaths, decision: null };
  }
  if (unique.length > 1) {
    return { ok: false, reason: "contradictory-decisions", seedPaths, decision: null, decisions: unique };
  }

  const decision = unique[0];
  if (!MERGE_ELIGIBLE.has(decision)) {
    return { ok: false, reason: "decision-not-merge-eligible", seedPaths, decision };
  }

  return { ok: true, reason: "eligible-decision", seedPaths, decision };
}
