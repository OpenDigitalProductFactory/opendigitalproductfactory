import { SEED_FIT_DECISIONS } from "../lib/seed-fit-gate.mjs";
import {
  LOCAL_READINESS_PROFILE_NAMES,
  POLICY_GUARD_PROFILES,
  isPolicyGuardSelfTest,
} from "../lib/ci-policy-guards.mjs";
import { formatGateContextMarkdown } from "../lib/gate-context.mjs";
import { isSignedOff } from "../lib/dco-signoff.mjs";
import { isDocsOnlyFileSet } from "../pr-health.mjs";
import { classifySlotRecord } from "../lib/pregate-status.mjs";
import { guardAppliesToScope } from "../lib/pregate-preflight.mjs";
import { hasBoundDocumentationEvidence } from "../lib/local-ci-gate-state.mjs";
import { classifyLocalCiOverride, classifyGateInfrastructureEvidence, GATE_INFRASTRUCTURE_UNAVAILABLE_CODE } from "../../packages/dpf-skill-pack/hooks/lib/local-ci-override.mjs";
import { classifyPublishedCorrection } from "../../packages/dpf-skill-pack/hooks/lib/published-correction.mjs";
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

function fetchesReadinessBase([command, args]) {
  // This exact CI setup is already performed before readiness resolves main.
  // Other fetches may obtain independent evidence and must remain in the plan.
  return command === "git" && args.join("\0") === ["fetch", "--no-tags", "--quiet", "origin", "main"].join("\0");
}

export function buildGatePlan({
  prBody = "",
  prLabelsJson = "[]",
  profiles = POLICY_GUARD_PROFILES,
  changeScope = null,
  publishedCorrection = false,
  baseSha = "origin/main",
  headSha = "HEAD",
} = {}) {
  const env = {
    BASE_SHA: baseSha,
    HEAD_SHA: headSha,
    PR_BODY: prBody,
    PR_LABELS_JSON: prLabelsJson,
    GITHUB_EVENT_NAME: "pull_request",
  };

  return LOCAL_READINESS_PROFILE_NAMES.flatMap((profileName) =>
    (profiles[profileName] ?? []).flatMap((entry) => {
      if (publishedCorrection && !new Set(["docs-impact-gate", "seed-fit-gate", "spec-plan-doc-gate", "data-impact-gate", "convergence-impact-gate", "design-grounding-gate", "hidden-unicode-commit-text-guard"]).has(entry.id)) return [];
      if (!guardAppliesToScope(entry, changeScope)) return [];
      // The readiness command runs in the author's topic worktree. Never replay
      // CI setup that rewrites Git state there. Its checks remain covered by CI
      // and by the exact-tree local-CI gate.
      if (entry.commands.some(mutatesGitState)) return [];

      // Fetch once before resolving the run's source; a profile's CI setup must
      // not move a shared ref midway through this already-pinned host plan.
      const commands = entry.commands.filter((command) => !isPolicyGuardSelfTest(command)
        && !fetchesReadinessBase(command));
      return commands.map((command, index) => ({
        name: commands.length === 1 ? entry.name : `${entry.name} (${index + 1}/${commands.length})`,
        command: [command[0], command[1].map((arg, index) => arg === "origin/main" && command[1][index - 1] === "--merge-with" ? baseSha : arg), ...command.slice(2)],
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
  // The seed-fit gate reads the first token and requires `mechanism=` / `symbol=`
  // on the same line for a scoped decision. Validate the token, not the suffix.
  const seedFitToken = String(seedFit ?? "").trim().split(/\s+/)[0] ?? "";
  if (seedFit && !VALID_SEED_FIT_DECISIONS.has(seedFitToken)) {
    blockers.push(
      `Invalid Seed-Fit-Decision "${seedFitToken}". Valid values: ${[...VALID_SEED_FIT_DECISIONS].join(", ")}.`,
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

function publicationAttestation({ repo, trailers, records, now }) {
  const blockers = [], notes = [];
  if (!repo || isDocsOnlyFileSet(repo.changedFiles)) return { blockers, notes };
  const evidence = trailers.find(t => t.name === PR_TRAILER_NAMES.localCiEvidence);
  const override = trailers.find(t => t.name === PR_TRAILER_NAMES.localCiOverride);
  if (!evidence && !override) {
    if (repo.isDetached && repo.publishedRef && repo.publishedRefMatchesHead === true) {
      // Build Studio's caller already owns canonical preflight qualification.
      // This selects existing published-tree mechanics, never authority or a
      // PASS for a private/remapped tree. Supplied proof still qualifies below.
      notes.push("Published-tree mechanical checks only: local proof UNPROVEN; canonical verification remains server-owned. This flag grants no publication authority and attests no local integration PASS.");
    } else {
      blockers.push("Publication requires Local-CI-Evidence or Local-CI-Override in the PR body. Carry existing qualified evidence; a metadata omission does not require a full gate rerun.");
    }
  } else if (evidence) {
    const evidenceId = evidence.value.split(/\s+/)[0];
    const qualified = records.some(({ state, metadata }) => {
      if (!repo.headSha || state?.sha !== repo.headSha || state?.branch !== repo.branch
        || state.status !== "passed" || state.skipped || state.evidenceRecordId !== evidenceId
        || !(Date.parse(state.expiresAt) > now)) return false;
      const verdict = classifySlotRecord({ state, metadata, headSha: repo.headSha, headBranch: repo.branch, now });
      const producerBound = hasBoundDocumentationEvidence(state) || (
        metadata?.candidateSha === repo.headSha && metadata?.execution?.status === "passed"
        && Boolean(state.leaseId) && metadata.runLeaseId === state.leaseId
      );
      return verdict.verdict === "PASS" && producerBound;
    });
    if (qualified) notes.push(`Local-CI evidence ${evidenceId} qualified for this exact branch and HEAD; no gate rerun.`);
    else blockers.push(`Local-CI-Evidence ${evidenceId} has no qualified current-head record in this worktree. Reconcile existing evidence/provenance or use an authorized truthful override; the identifier alone is not proof.`);
  } else {
    const classified = classifyLocalCiOverride(override.value);
    if (!classified.ok) blockers.push(classified.reason);
    else if (classified.code === "published-correction") {
      const qualified = records.some(({ state, publicationInspection }) => publicationInspection?.ok === true && publicationInspection.state === state && state?.skipReason === override.value
        && classifyPublishedCorrection(state, { sha: repo.headSha, branch: repo.branch, repositoryFullName: repo.repositoryFullName, now }).ok);
      if (!qualified) blockers.push("Published correction requires qualified current-head machine proof; prose alone is not evidence. Run the affected correction verifier, not the entire local integration gate.");
      else notes.push("Local integration UNRUN; affected checks qualified and full integration delegated to protected GitHub checks and merge queue.");
    }
    else if (classified.code === GATE_INFRASTRUCTURE_UNAVAILABLE_CODE && !records.some(({ state }) =>
      state?.sha === repo.headSha && state?.branch === repo.branch && state.skipped === true
      && state.gatePassed === false && state.skipReason === override.value
      && classifyGateInfrastructureEvidence(state.infrastructureEvidence).ok
    )) blockers.push("Local-CI-Override gate-infrastructure-unavailable requires the matching push-time machine evidence; prose alone is not evidence.");
    else notes.push(`Local-CI UNRUN under ${classified.code}; this override is not a passing gate. Protected GitHub checks remain required.`);
  }
  return { blockers, notes };
}

export function evaluateReadiness({ repo, gateResults = [], prBody = "", gateContext = null, localCiRecords = [], now = Date.now() } = {}) {
  const blockers = [];
  const warnings = [];
  const notes = [];
  const passed = [];
  const changedFiles = repo?.changedFiles ?? [];

  if (!repo) {
    blockers.push("Repository state could not be read.");
  } else {
    if (repo.publicationIdentityChanged) blockers.push("Repository identity changed during readiness; no current-head publication verdict was reached.");
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

    const unsigned = (repo.commits ?? []).filter((commit) => !isSignedOff(
      commit.body ?? "",
      { authorName: commit.authorName, authorEmail: commit.authorEmail },
    ));
    for (const commit of unsigned) {
      blockers.push(`Commit ${commit.sha.slice(0, 12)} (${commit.subject}) is missing its author-matching DCO sign-off.`);
    }
  }

  const trailerVerdict = validatePrBodyTrailers(prBody);
  blockers.push(...trailerVerdict.blockers);
  warnings.push(...trailerVerdict.warnings);
  const attestation = publicationAttestation({ repo, trailers: trailerVerdict.trailers, records: localCiRecords, now });
  blockers.push(...attestation.blockers);
  notes.push(...attestation.notes);

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
    base: repo?.baseSha ?? "origin/main",
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
