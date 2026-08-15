import { SEED_FIT_DECISIONS } from "../lib/seed-fit-gate.mjs";
import {
  LOCAL_READINESS_PROFILE_NAMES,
  POLICY_GUARD_PROFILES,
  isPolicyGuardSelfTest,
} from "../lib/ci-policy-guards.mjs";
import { formatGateContextMarkdown } from "../lib/gate-context.mjs";
import { isSignedOff } from "../lib/dco-signoff.mjs";
import {
  PR_TRAILER_NAMES,
  SUPPORTED_PR_TRAILERS,
} from "../lib/pr-trailer-contract.mjs";

const VALID_SEED_FIT_DECISIONS = new Set(SEED_FIT_DECISIONS);
const MUTATING_GIT_COMMANDS = new Set([
  "checkout",
  "clean",
  "commit",
  "merge",
  "rebase",
  "reset",
  "switch",
]);

export const SUPPORTED_TRAILERS = new Set(SUPPORTED_PR_TRAILERS);

/**
 * Trailers that are still PARSED so the author gets told they are inert, rather than
 * having them silently ignored and assuming they still gate something.
 * Map: trailer -> what replaced it.
 */
const RETIRED_TRAILERS = new Map([
  [
    PR_TRAILER_NAMES.uxFitRetired,
    'retired by BI-D967DEE0 — the UX-Fit Gate now requires a measured manifest at docs/ux-fit/<date>-<slug>.ux-fit.json (evidence.kind "sweep-measurement" or "propose-n-pick"). This trailer no longer satisfies any gate.',
  ],
]);

function mutatesGitState([command, args]) {
  return command === "git" && MUTATING_GIT_COMMANDS.has(args[0]);
}

export function buildGatePlan({
  prBody = "",
  prLabelsJson = "[]",
  profiles = POLICY_GUARD_PROFILES,
} = {}) {
  const env = {
    BASE_SHA: "origin/main",
    PR_BODY: prBody,
    PR_LABELS_JSON: prLabelsJson,
    GITHUB_EVENT_NAME: "pull_request",
  };

  return LOCAL_READINESS_PROFILE_NAMES.flatMap((profileName) =>
    (profiles[profileName] ?? []).flatMap((entry) => {
      // The readiness command runs in the author's topic worktree. Never replay
      // CI setup that rewrites Git state there. Its checks remain covered by CI
      // and by the exact-tree local-CI gate.
      if (entry.commands.some(mutatesGitState)) return [];

      const commands = entry.commands.filter((command) => !isPolicyGuardSelfTest(command));
      return commands.map((command, index) => ({
        name: commands.length === 1 ? entry.name : `${entry.name} (${index + 1}/${commands.length})`,
        command,
        env,
      }));
    }),
  );
}

export function parsePrBodyTrailers(prBody = "") {
  const visibleBody = String(prBody).replace(
    /<!--[\s\S]*?-->/g,
    (comment) => comment.replace(/[^\r\n]/g, ""),
  );
  return visibleBody
    .split(/\r?\n/)
    .flatMap((line, index) => {
      const match = line.match(/^\s*([A-Za-z][A-Za-z-]*):\s*(\S.*)?$/);
      if (!match || !SUPPORTED_TRAILERS.has(match[1])) return [];
      return [{ name: match[1], value: (match[2] ?? "").trim(), line: index + 1 }];
    });
}

export function validatePrBodyTrailers(prBody = "") {
  const trailers = parsePrBodyTrailers(prBody);
  const blockers = [];
  const warnings = [];
  const byName = new Map();

  for (const trailer of trailers) {
    if (!trailer.value) {
      blockers.push(`${trailer.name} on line ${trailer.line} has no value.`);
    }
    const retirement = RETIRED_TRAILERS.get(trailer.name);
    if (retirement) {
      warnings.push(`${trailer.name} on line ${trailer.line} is ${retirement}`);
    }
    byName.set(trailer.name, [...(byName.get(trailer.name) ?? []), trailer]);
  }

  for (const [name, entries] of byName) {
    if (entries.length > 1) {
      blockers.push(`${name} appears ${entries.length} times. Keep one reviewed trailer so CI reads one intent.`);
    }
  }

  const seedFit = byName.get(PR_TRAILER_NAMES.seedFit)?.[0]?.value;
  if (seedFit && !VALID_SEED_FIT_DECISIONS.has(seedFit)) {
    blockers.push(
      `Invalid Seed-Fit-Decision "${seedFit}". Valid values: ${[...VALID_SEED_FIT_DECISIONS].join(", ")}.`,
    );
  }

  if (byName.has(PR_TRAILER_NAMES.localCiEvidence) && byName.has(PR_TRAILER_NAMES.localCiOverride)) {
    blockers.push("Use either Local-CI-Evidence or Local-CI-Override, not both.");
  }

  if (trailers.length > 0) {
    warnings.push(
      "If a GitHub workflow run has already started, editing the PR body after a workflow run has started will not change that run's event payload. Push a new commit or re-run the workflow after body fixes.",
    );
  }

  return { ok: blockers.length === 0, blockers, warnings, trailers };
}

export function evaluateReadiness({ repo, gateResults = [], prBody = "", gateContext = null } = {}) {
  const blockers = [];
  const warnings = [];
  const notes = [];
  const passed = [];
  const changedFiles = repo?.changedFiles ?? [];

  if (!repo) {
    blockers.push("Repository state could not be read.");
  } else {
    const exactPublishedHead = Boolean(repo.publishedRef) && repo.publishedRefMatchesHead === true;
    if (repo.publishedRef && !exactPublishedHead) {
      blockers.push(`HEAD does not equal published ref ${repo.publishedRef}; refuse to validate a different tree.`);
    }
    if (repo.isShallow) {
      blockers.push("Repository is a shallow Git repository; fetch full history before computing a PR diff.");
    }
    if (!Array.isArray(repo.mergeBases) || repo.mergeBases.length === 0) {
      blockers.push("No merge-base with origin/main; fetch current main and rebase or recreate the branch.");
    } else if (repo.mergeBases.length > 1) {
      blockers.push(`Found an ambiguous merge-base with origin/main (${repo.mergeBases.length} candidates); repair history before opening a PR.`);
    }
    if (repo.isDetached && !exactPublishedHead) blockers.push("HEAD is detached; switch to a named topic branch before opening a PR.");
    if (repo.branch === "main") blockers.push("Current branch is main; create a topic branch before opening a PR.");
    if (String(repo.statusPorcelain ?? "").trim()) {
      blockers.push("The working tree has uncommitted changes; commit or discard them before opening or queueing the PR.");
    }
    if (Number(repo.ahead ?? 0) > 0 && !exactPublishedHead) {
      blockers.push(`${repo.ahead} local commit(s) are not pushed to ${repo.upstream ?? "the branch upstream"}; do not enter the merge queue yet.`);
    }
    if (changedFiles.length === 0) {
      blockers.push("No diff against current origin/main; there is no PR payload to validate.");
    }

    const unsigned = (repo.commits ?? []).filter((commit) => !isSignedOff(commit.body ?? ""));
    for (const commit of unsigned) {
      blockers.push(`Commit ${commit.sha.slice(0, 12)} (${commit.subject}) is missing DCO sign-off.`);
    }
  }

  const trailerVerdict = validatePrBodyTrailers(prBody);
  blockers.push(...trailerVerdict.blockers);
  warnings.push(...trailerVerdict.warnings);

  for (const gate of gateResults) {
    if (gate.skippedEnvironment) {
      warnings.push(
        `${gate.name} could not run on this source-only host; CI still enforces it. ${summarizeGateOutput(gate.output)}`,
      );
      continue;
    }
    if (gate.ok) {
      passed.push(gate.name);
      continue;
    }
    const detail = summarizeGateOutput(gate.output);
    blockers.push(`${gate.name} failed locally${detail ? `: ${detail}` : "."}`);
  }

  if (gateResults.length === 0) {
    notes.push("No local gate scripts were run; repository and trailer checks only.");
  }

  if (repo && blockers.length === 0) {
    passed.push("Git history, DCO, clean worktree, pushed branch, PR trailers, and local gate plan");
  }

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    notes,
    passed,
    changedFiles,
    branch: repo?.publishedRef && repo?.publishedRefMatchesHead ? repo.publishedRef : (repo?.branch ?? "(unknown)"),
    base: "origin/main",
    mergeBase: repo?.mergeBases?.[0] ?? null,
    gateContext,
  };
}

export function formatReadinessReport(result) {
  const lines = [];
  if (result.gateContext) {
    lines.push(formatGateContextMarkdown(result.gateContext).trimEnd(), "");
  }
  lines.push(`PR readiness: ${result.ready ? "READY" : "NOT READY"}`);
  lines.push(`Branch: ${result.branch}`);
  lines.push(`Base: ${result.base}${result.mergeBase ? ` (merge-base ${result.mergeBase.slice(0, 12)})` : ""}`);
  lines.push(`Changed files: ${result.changedFiles.length}`);
  lines.push("");

  if (result.ready) {
    lines.push("Safe to open or queue the PR.");
  } else {
    lines.push(`Fix these before opening or queueing the PR (${result.blockers.length}):`);
    for (const blocker of result.blockers) lines.push(`- ${blocker}`);
  }

  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings");
    for (const warning of result.warnings) lines.push(`- ${warning}`);
  }

  if (result.passed.length > 0) {
    lines.push("");
    lines.push("What passed");
    for (const item of result.passed) lines.push(`- ${item}`);
  }

  if (result.notes.length > 0) {
    lines.push("");
    lines.push("Notes");
    for (const note of result.notes) lines.push(`- ${note}`);
  }

  return `${lines.join("\n")}\n`;
}

function summarizeGateOutput(output = "") {
  const lines = String(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const failed = lines.find((line) => /\bFAILED\b|^ERROR\b/i.test(line));
  return failed ?? lines.at(-1) ?? "";
}
