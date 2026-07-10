// Classify a self-upgrade build-gate failure into a known recurring class so an
// agent gets an actionable diagnosis WITHOUT reproducing the build from zero.
//
// Spec: docs/superpowers/specs/2026-06-06-procedural-functional-verification-design.md (§3.3)
// BI-E4CBC7C1.
//
// The §2.1 trace burned ~15 minutes reproducing a build failure that was a
// known class. The promoter already captures {exitCode, stdout, stderr}; this
// pure function matches that log against the classes DPF has actually hit and
// returns {class, summary, playbookLink, failingTrace, isMainDefectVsEnvironment}.
// The self-upgrade function leads the persisted failure excerpt with this, so a
// MUST-ADVANCE → self-upgrade-failed → BLOCKED chain hands the agent the
// diagnosis, not a raw log.

export type BuildFailureClass =
  // Host build passes, Docker build fails: a transitive dep the wider CI/host
  // workspace hoists to top-level but the narrower Docker deps stage does not,
  // so the import resolves on the host and 404s in Docker. Latent undeclared
  // dependency — a real defect on main, masked by accidental hoisting.
  | "host-docker-hoist-divergence"
  // Turbopack/NFT emits two assets to one filename (the trace-cascade collapses
  // many output assets onto a shared chunk). Usually a small number of source
  // root causes re-emitted per asset.
  | "turbopack-nft-duplicate-asset"
  // A route / page / server-action / Inngest entrypoint statically imports
  // Docker-only / host-only code (promoter, child_process, the self-upgrade
  // barrel), dragging it into the server bundle. The specific cause behind many
  // Turbopack/NFT symptoms; fixed by a lazy import boundary (see PR #1555).
  | "bundle-boundary-static-import"
  // `pnpm install --frozen-lockfile` failed inside the Docker build. Two
  // sub-causes with opposite ownership: a lockfile/manifest mismatch
  // (ERR_PNPM_OUTDATED_LOCKFILE) is a main defect; a registry fetch error
  // (ECONNREFUSED/ETIMEDOUT/ERR_PNPM_FETCH, or the bare non-zero RUN line when
  // pnpm's output was lost) is a transient environment failure — retry the
  // upgrade before diagnosing anything (SUR-73668D5C, 2026-07-05: one flaky
  // smol-toml fetch failed the upgrade; the identical tree built clean on retry).
  | "pnpm-install-failure"
  | "unknown";

export type BuildFailureClassification = {
  class: BuildFailureClass;
  /** One sentence, safe to lead a BLOCKED reason or a BI body. */
  summary: string;
  /** Repo path (or PR ref) to the playbook for this class. */
  playbookLink: string;
  /** The log slice that triggered the match — the agent's starting point. */
  failingTrace: string;
  /**
   * main-defect => fix via a PR on main; environment => local/harness issue;
   * null => unknown, capture and reproduce via the governed path.
   */
  isMainDefectVsEnvironment: "main-defect" | "environment" | null;
};

export type BuildFailureInput = {
  log: string;
  /**
   * When known: did the host build pass while the Docker build failed? A true
   * value strengthens the hoist-divergence signal (it is the defining symptom).
   */
  hostBuildPassed?: boolean;
};

const SPEC = "docs/superpowers/specs/2026-06-06-procedural-functional-verification-design.md";
const HOIST_PLAYBOOK = "docs/triage/2026-05-24-portal-prisma-generate-rebuild-failure.md";

// Docker-only / host-only modules that must never be statically imported into a
// route/page/action/Inngest bundle. Their presence in a Turbopack/NFT trace is
// the bundle-boundary fingerprint.
const HOST_ONLY_MODULE = /(promoter|self-upgrade|child_process|node:child_process|dockerode|\/queue\/functions\/|api\/inngest)/i;
const DUPLICATE_ASSET = /(duplicate\s+emitted\s+asset|multiple\s+assets\s+emit|conflict:.*emit|emit[^\n]*to the same (file|filename))/i;
const UNEXPECTED_NFT_PROJECT_TRACE = /encountered unexpected file in NFT list|whole project was traced unintentionally/i;
const MODULE_NOT_FOUND = /(cannot find module ['"]([^'"]+)['"]|module not found:\s*can't resolve ['"]([^'"]+)['"])/i;

// The Dockerfile RUN line for a dependency install that exited non-zero —
// present even when the builder's step output (pnpm's own error text) was lost.
const PNPM_INSTALL_FAILED = /command ['"][^'"]*pnpm (install|fetch)[^'"]*['"] (returned a non-zero code|did not complete successfully)/i;
// Lockfile/manifest mismatch — deterministic, a defect on main.
const PNPM_OUTDATED_LOCKFILE = /ERR_PNPM_(OUTDATED_)?LOCKFILE|specifiers in the lockfile don't match|cannot install with "frozen-lockfile"/i;
// Registry fetch errors — transient environment. Deliberately ONLY pnpm's own
// error codes: bare network errnos (ECONNREFUSED etc.) appear in unrelated
// failures (e.g. prisma migrate unable to reach postgres) and must stay
// unclassified rather than misdiagnosed as a dependency fetch.
const PNPM_FETCH_ERROR = /ERR_PNPM_FETCH|ERR_PNPM_META_FETCH_FAIL|GET https:\/\/registry\.npmjs\.org\/[^\s]+: (?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|socket hang up)/i;

/** Up to ~6 lines around the first matching line, capped, for the agent. */
function traceAround(log: string, re: RegExp): string {
  const lines = log.split(/\r?\n/);
  const idx = lines.findIndex((l) => re.test(l));
  if (idx < 0) return log.slice(0, 400);
  const slice = lines.slice(Math.max(0, idx - 1), idx + 5).join("\n");
  return slice.length > 600 ? slice.slice(0, 600) : slice;
}

export function classifyBuildFailure(
  input: BuildFailureInput,
): BuildFailureClassification {
  const log = input.log ?? "";

  // Most specific first: a Turbopack/NFT error whose trace fingerprints a
  // host-only module is a bundle-boundary violation, not a generic NFT cascade
  // or hoist divergence that happens to appear later in the same build log.
  const nftBoundaryMatch = DUPLICATE_ASSET.test(log)
    ? DUPLICATE_ASSET
    : UNEXPECTED_NFT_PROJECT_TRACE;
  if (
    (DUPLICATE_ASSET.test(log) || UNEXPECTED_NFT_PROJECT_TRACE.test(log)) &&
    HOST_ONLY_MODULE.test(log)
  ) {
    return {
      class: "bundle-boundary-static-import",
      summary:
        "A route/page/action/Inngest entrypoint statically imports Docker-only/host-only code (promoter/child_process/self-upgrade), dragging it into the server bundle. Fix with a lazy import boundary — see PR #1555.",
      playbookLink: SPEC,
      failingTrace: traceAround(log, nftBoundaryMatch),
      isMainDefectVsEnvironment: "main-defect",
    };
  }

  if (DUPLICATE_ASSET.test(log)) {
    return {
      class: "turbopack-nft-duplicate-asset",
      summary:
        "Turbopack/NFT emitted two assets to one filename (trace-cascade). Investigate by source-code root cause, not by warning count — a small number of roots re-emit per asset.",
      playbookLink: SPEC,
      failingTrace: traceAround(log, DUPLICATE_ASSET),
      isMainDefectVsEnvironment: "main-defect",
    };
  }

  // Dependency-install failures before build-output analysis: a failed
  // `pnpm install` step produces no build output, so nothing below can match.
  if (PNPM_OUTDATED_LOCKFILE.test(log)) {
    return {
      class: "pnpm-install-failure",
      summary:
        "pnpm refused --frozen-lockfile: pnpm-lock.yaml does not match the package manifests at the target SHA. A manifest changed without regenerating the lockfile — fix on main (pnpm install, commit the lockfile).",
      playbookLink: SPEC,
      failingTrace: traceAround(log, PNPM_OUTDATED_LOCKFILE),
      isMainDefectVsEnvironment: "main-defect",
    };
  }
  const moduleMiss = log.match(MODULE_NOT_FOUND);
  if (moduleMiss) {
    const missing = moduleMiss[2] || moduleMiss[3] || "an undeclared module";
    const hostHint =
      input.hostBuildPassed === true
        ? " The host build passed while Docker failed — the signature of pnpm hoist divergence."
        : "";
    return {
      class: "host-docker-hoist-divergence",
      summary: `Docker build cannot resolve '${missing}' — a transitive dependency the wider host/CI workspace hoists but Docker's narrower deps stage does not. Declare '${missing}' as a direct dependency in the importing package.${hostHint}`,
      playbookLink: HOIST_PLAYBOOK,
      failingTrace: traceAround(log, MODULE_NOT_FOUND),
      isMainDefectVsEnvironment: "main-defect",
    };
  }

  // After the more specific build-output classes: a failed install RUN line, or
  // registry/network errnos in a log that ran a pnpm install step.
  if (PNPM_INSTALL_FAILED.test(log) || PNPM_FETCH_ERROR.test(log)) {
    const matched = PNPM_FETCH_ERROR.test(log) ? PNPM_FETCH_ERROR : PNPM_INSTALL_FAILED;
    return {
      class: "pnpm-install-failure",
      summary:
        "pnpm install failed inside the Docker build — most likely a transient registry fetch failure (SUR-73668D5C: one flaky package fetch, identical tree built clean on retry). Retry the upgrade first; only diagnose further if it fails the same way twice.",
      playbookLink: SPEC,
      failingTrace: traceAround(log, matched),
      isMainDefectVsEnvironment: "environment",
    };
  }

  return {
    class: "unknown",
    summary:
      "Unrecognized build-gate failure. Capture the trace and reproduce via the governed path (the shared local-CI lease), not by hand-rebuilding the live portal.",
    playbookLink: SPEC,
    failingTrace: log.slice(0, 400),
    isMainDefectVsEnvironment: null,
  };
}

/**
 * Lead a persisted failure excerpt with the classification so every surface
 * that shows the failure (run record, /ops/self-upgrade, the BLOCKED reason an
 * agent reads) carries the actionable class. Keeps the raw log beneath it.
 */
export function formatClassifiedExcerpt(
  classification: BuildFailureClassification,
  rawLog: string,
): string {
  const head =
    `[build-failure-class] ${classification.class} (${classification.isMainDefectVsEnvironment ?? "unclassified"})\n` +
    `[build-failure-class] ${classification.summary}\n` +
    `[build-failure-class] playbook: ${classification.playbookLink}\n` +
    `---`;
  return `${head}\n${rawLog}`;
}
