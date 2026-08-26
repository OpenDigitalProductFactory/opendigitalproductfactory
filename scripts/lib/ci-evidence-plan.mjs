import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DERIVED_ARTIFACTS,
  matchesAnyGlob,
} from "./derived-artifacts-registry.mjs";

export const CI_EVIDENCE_PLAN_SCHEMA_VERSION = 1;
const DEFAULT_POLICY_PATH = fileURLToPath(
  new URL("../../config/ci-evidence-policy.json", import.meta.url),
);

function sortedUnique(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function normalizePath(value) {
  return String(value ?? "").trim().replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

export function loadEvidencePolicy(path = DEFAULT_POLICY_PATH) {
  const policy = JSON.parse(readFileSync(path, "utf8"));
  if (policy.schemaVersion !== CI_EVIDENCE_PLAN_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported CI evidence policy schema ${String(policy.schemaVersion)}; `
      + `expected ${CI_EVIDENCE_PLAN_SCHEMA_VERSION}.`,
    );
  }
  return policy;
}

function compilePatterns(patterns) {
  return (patterns ?? []).map((pattern) => new RegExp(pattern));
}

function matchesAny(path, patterns) {
  return patterns.some((pattern) => pattern.test(path));
}

function classifyPath(path, compiled) {
  if (matchesAny(path, compiled.docs)) return "docs";
  if (matchesAny(path, compiled.tests)) return "test";
  if (matchesAny(path, compiled.production)) return "production";
  return "other";
}

function documentationDerivedArtifacts(changedFiles, compiled) {
  const artifacts = new Set();
  for (const definition of DERIVED_ARTIFACTS) {
    const changedArtifacts = changedFiles.filter((path) => (
      matchesAnyGlob(path, definition.artifactPaths)
    ));
    if (changedArtifacts.length === 0) continue;

    const changedSources = changedFiles.filter((path) => (
      matchesAnyGlob(path, definition.sourceGlobs)
    ));
    if (
      changedSources.length > 0
      && changedSources.every((path) => classifyPath(path, compiled) === "docs")
    ) {
      changedArtifacts.forEach((path) => artifacts.add(path));
    }
  }
  return artifacts;
}

function packageOwner(path, packageRoots) {
  return Object.entries(packageRoots)
    .sort(([left], [right]) => right.length - left.length)
    .find(([root]) => path === root || path.startsWith(`${root}/`))?.[1] ?? null;
}

function testStem(path) {
  return path.replace(/\.[cm]?[jt]sx?$/, "");
}

function colocatedTests(path, knownTests) {
  const stem = testStem(path);
  const basename = stem.split("/").at(-1);
  const directory = stem.includes("/") ? stem.slice(0, stem.lastIndexOf("/")) : "";
  return knownTests.filter((testPath) => (
    testPath.startsWith(`${stem}.test.`)
    || testPath.startsWith(`${stem}.spec.`)
    || (
      basename
      && testPath.startsWith(`${directory ? `${directory}/` : ""}__tests__/${basename}.`)
    )
  ));
}

function normalizeRecommendationPaths(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => (
    typeof entry === "string" ? normalizePath(entry) : normalizePath(entry?.path)
  )).filter(Boolean);
}

export function deriveRoute(path) {
  const appPrefix = "apps/web/app/";
  if (!path.startsWith(appPrefix)) return null;
  const relative = path.slice(appPrefix.length);
  if (!/(^|\/)(page|route)\.[cm]?[jt]sx?$/.test(relative)) return null;
  const segments = relative
    .replace(/\/(page|route)\.[cm]?[jt]sx?$/, "")
    .replace(/^(page|route)\.[cm]?[jt]sx?$/, "")
    .split("/")
    .filter((segment) => segment && !(segment.startsWith("(") && segment.endsWith(")")));
  return `/${segments.join("/")}` || "/";
}

function routeFamily(route) {
  if (route === "/") return "/";
  const first = route.split("/").filter(Boolean)[0];
  return first ? `/${first}` : "/";
}

function graphVerdict(advice, input, policy) {
  if (!advice) return { trusted: false, code: "graph-missing" };
  if (advice.schemaVersion !== policy.graphAdviceSchemaVersion) {
    return { trusted: false, code: "graph-schema-mismatch" };
  }
  if (advice.indexStatus !== "ready") return { trusted: false, code: "graph-not-ready" };
  if (advice.workspaceDirty) return { trusted: false, code: "graph-dirty" };
  if (advice.indexedTreeSha !== input.headTreeSha) {
    return { trusted: false, code: "graph-tree-mismatch" };
  }
  const missing = policy.requiredGraphRelationships.filter(
    (relationship) => Number(advice.relationshipCounts?.[relationship] ?? 0) <= 0,
  );
  if (missing.length > 0) {
    return {
      trusted: false,
      code: "graph-relationships-missing",
      missingRelationships: missing,
    };
  }
  return { trusted: true, code: null };
}

function expandAffectedPackages(seedPackages, packageDependencies = {}) {
  const affected = new Set(seedPackages);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [consumer, dependencies] of Object.entries(packageDependencies)) {
      if (
        !affected.has(consumer)
        && (dependencies ?? []).some((dependency) => affected.has(dependency))
      ) {
        affected.add(consumer);
        changed = true;
      }
    }
  }
  return affected;
}

function riskCodesForPath(path, riskRules) {
  return riskRules
    .filter((rule) => matchesAny(path, rule.patterns))
    .map((rule) => rule.code);
}

function addEscalation(escalations, code, detail = undefined) {
  if (escalations.some((entry) => entry.code === code)) return;
  escalations.push(detail === undefined ? { code } : { code, detail });
}

export function createEvidencePlan(input) {
  const policy = input.policy ?? loadEvidencePolicy();
  const changedFiles = sortedUnique((input.changedFiles ?? []).map(normalizePath));
  const knownTests = sortedUnique((input.knownTests ?? []).map(normalizePath));
  const compiled = {
    docs: compilePatterns(policy.patterns.docs),
    tests: compilePatterns(policy.patterns.tests),
    production: compilePatterns(policy.patterns.production),
    mobile: compilePatterns(policy.patterns.mobile),
    mobileOnly: compilePatterns(policy.patterns.mobileOnly),
    workspaceRequiredDocs: compilePatterns(policy.patterns.workspaceRequiredDocs),
  };
  const riskRules = policy.riskRules.map((rule) => ({
    code: rule.code,
    patterns: compilePatterns(rule.patterns),
  }));
  const documentationArtifacts = documentationDerivedArtifacts(changedFiles, compiled);
  const kinds = new Map(changedFiles.map((path) => [
    path,
    documentationArtifacts.has(path) ? "docs" : classifyPath(path, compiled),
  ]));
  const productionFiles = changedFiles.filter((path) => kinds.get(path) === "production");
  const changedTests = changedFiles.filter((path) => kinds.get(path) === "test");
  const workspaceRequired = changedFiles.some((path) => (
    matchesAny(path, compiled.workspaceRequiredDocs)
  ));
  const docsOnly = !workspaceRequired
    && changedFiles.length > 0
    && changedFiles.every((path) => kinds.get(path) === "docs");
  const mobileOnly = !workspaceRequired
    && !docsOnly
    && changedFiles.length > 0
    && changedFiles.every((path) => (
      kinds.get(path) === "docs" || matchesAny(path, compiled.mobileOnly)
    ));
  const graph = graphVerdict(input.codeGraphAdvice, input, policy);
  const escalations = [];
  const affectedTests = new Set(changedTests);
  const affectedRoutes = new Set();
  const affectedPackages = new Set();
  const fileDispositions = [];
  const missingTestUpdates = [];

  for (const path of changedFiles) {
    const kind = kinds.get(path);
    const owner = packageOwner(path, policy.packageRoots);
    if (owner) affectedPackages.add(owner);
    const risks = riskCodesForPath(path, riskRules).filter((code) => !(
      code === "generated-contract" && documentationArtifacts.has(path)
    ));
    for (const code of risks) addEscalation(escalations, `risk:${code}`, path);

    if (kind === "docs") {
      fileDispositions.push({
        path,
        kind,
        disposition: "docs-only",
        tests: [],
        routes: [],
      });
      continue;
    }
    if (kind === "test") {
      fileDispositions.push({
        path,
        kind,
        disposition: "changed-test",
        tests: [path],
        routes: [],
      });
      continue;
    }

    const deterministicTests = normalizeRecommendationPaths(
      input.relatedTestsBySource?.[path],
    );
    const graphTests = graph.trusted
      ? normalizeRecommendationPaths(input.codeGraphAdvice?.recommendations?.[path])
      : [];
    const tests = sortedUnique([
      ...deterministicTests,
      ...graphTests,
      ...colocatedTests(path, knownTests),
    ]).filter((testPath) => knownTests.length === 0 || knownTests.includes(testPath));
    tests.forEach((testPath) => affectedTests.add(testPath));

    const routes = sortedUnique([
      deriveRoute(path),
      ...normalizeRecommendationPaths(input.routeAdviceBySource?.[path]),
    ]);
    routes.forEach((route) => affectedRoutes.add(route));

    if (risks.length > 0) {
      fileDispositions.push({
        path,
        kind,
        disposition: "global-risk",
        tests,
        routes,
      });
    } else if (kind === "production" && tests.length > 0) {
      fileDispositions.push({
        path,
        kind,
        disposition: "mapped-tests",
        tests,
        routes,
      });
    } else if (kind === "production") {
      fileDispositions.push({
        path,
        kind,
        disposition: "unmapped",
        tests: [],
        routes,
      });
      addEscalation(escalations, "unmapped-production", path);
    } else {
      fileDispositions.push({
        path,
        kind,
        disposition: "unmapped",
        tests: [],
        routes,
      });
      addEscalation(escalations, "unmapped-file", path);
    }

    if (
      kind === "production"
      && !changedTests.some((testPath) => tests.includes(testPath))
    ) {
      missingTestUpdates.push(path);
    }
  }

  if (productionFiles.length > 0 && !graph.trusted) {
    addEscalation(escalations, graph.code, graph.missingRelationships);
  }
  if (changedFiles.length === 0) addEscalation(escalations, "empty-diff");
  for (const inputError of sortedUnique(input.inputErrors ?? [])) {
    addEscalation(escalations, "planner-input-error", inputError);
  }
  if (policy.exhaustiveEvents.includes(input.eventName)) {
    addEscalation(escalations, "event-exhaustive", input.eventName);
  }

  const selectedTests = sortedUnique([...affectedTests]);
  const totalTestCount = Math.max(
    Number(input.totalTestCount ?? knownTests.length),
    selectedTests.length,
  );
  const selectedPercentage = totalTestCount > 0
    ? Number(((selectedTests.length / totalTestCount) * 100).toFixed(2))
    : 0;
  if (selectedPercentage > policy.selectionThresholdPercent) {
    addEscalation(escalations, "selection-threshold", {
      selectedPercentage,
      thresholdPercentage: policy.selectionThresholdPercent,
    });
  }

  const routes = sortedUnique([...affectedRoutes]);
  const executionLane = escalations.length > 0
    ? "exhaustive"
    : docsOnly
      ? "documentation"
      : "affected";
  const semanticPlan = {
    schemaVersion: CI_EVIDENCE_PLAN_SCHEMA_VERSION,
    plannerVersion: policy.plannerVersion,
    policyVersion: policy.policyVersion,
    mode: policy.mode,
    eventName: input.eventName,
    baseSha: input.baseSha,
    headSha: input.headSha,
    baseTreeSha: input.baseTreeSha,
    headTreeSha: input.headTreeSha,
    changedFiles,
    scope: {
      docsOnly,
      mobileOnly,
      mobile: changedFiles.some((path) => matchesAny(path, compiled.mobile)),
      heavy: !docsOnly && !mobileOnly,
    },
    graph: {
      graphKey: input.codeGraphAdvice?.graphKey ?? "source-code",
      trusted: graph.trusted,
      verdict: graph.code ?? "trusted",
    },
    affectedPackages: sortedUnique([
      ...expandAffectedPackages(affectedPackages, input.packageDependencies),
    ]),
    affectedTests: selectedTests,
    affectedRoutes: routes,
    routeFamilies: sortedUnique(routes.map(routeFamily)),
    globalGuards: sortedUnique(policy.globalGuards),
    uxMode: routes.length > 0 ? "changed-routes" : "none",
    executionLane,
    fullSuite: escalations.length > 0,
    evidenceTier: escalations.length > 0 ? "exhaustive" : "affected",
    escalations: escalations.sort((left, right) => left.code.localeCompare(right.code)),
    fileDispositions: fileDispositions.sort((left, right) => left.path.localeCompare(right.path)),
    observations: {
      missingTestUpdates: sortedUnique(missingTestUpdates),
    },
    selection: {
      selectedTestCount: selectedTests.length,
      totalTestCount,
      selectedPercentage,
      thresholdPercentage: policy.selectionThresholdPercent,
    },
  };
  // Local-CI synthesizes a fresh merge commit on every retry. Commit SHAs are
  // valuable provenance, but the Git tree is the immutable content identity:
  // two commits with the same tree require the same evidence recommendation.
  const { baseSha: _baseSha, headSha: _headSha, ...digestPlan } = semanticPlan;
  const digest = createHash("sha256").update(canonicalJson(digestPlan)).digest("hex");
  return { ...semanticPlan, digest };
}
