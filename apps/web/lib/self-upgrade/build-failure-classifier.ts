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
  // A route / Inngest entrypoint statically imports Docker-only / host-only code
  // (promoter, child_process, the self-upgrade barrel), dragging it into the
  // server bundle and colliding chunks. The specific cause behind many of the
  // duplicate-asset symptoms; fixed by a lazy import boundary (see PR #1555).
  | "bundle-boundary-static-import"
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
// route or Inngest bundle. Their presence in a duplicate-asset trace is the
// bundle-boundary fingerprint.
const HOST_ONLY_MODULE = /(promoter|self-upgrade|child_process|node:child_process|dockerode|\/queue\/functions\/|api\/inngest)/i;
const DUPLICATE_ASSET = /(duplicate\s+emitted\s+asset|multiple\s+assets\s+emit|conflict:.*emit|emit[^\n]*to the same (file|filename))/i;
const MODULE_NOT_FOUND = /(cannot find module ['"]([^'"]+)['"]|module not found:\s*can't resolve ['"]([^'"]+)['"])/i;

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

  // Most specific first: a duplicate-asset error whose trace fingerprints a
  // host-only module is a bundle-boundary violation, not a generic NFT cascade.
  if (DUPLICATE_ASSET.test(log) && HOST_ONLY_MODULE.test(log)) {
    return {
      class: "bundle-boundary-static-import",
      summary:
        "A route/Inngest entrypoint statically imports Docker-only/host-only code (promoter/child_process/self-upgrade), dragging it into the server bundle and colliding chunks. Fix with a lazy import boundary — see PR #1555.",
      playbookLink: SPEC,
      failingTrace: traceAround(log, DUPLICATE_ASSET),
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
