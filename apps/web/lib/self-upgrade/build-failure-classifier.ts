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
  // A build-time import uses a RELATIVE path that climbs OUT of apps/web into a
  // repo-root directory (config/, docs/, packages/ data JSON, …) that the
  // production Dockerfile's narrow COPY allowlist never copies into the build
  // context. The file resolves on the full host/CI checkout (plain `next build`
  // → green) but 404s inside the narrower Docker image — only exercised at
  // self-upgrade / tag-release. Distinct from a bare-specifier hoist and from a
  // bundle-boundary lazy-import issue; fixed by adding the missing `COPY <dir>/`
  // (see PR #2786 + the dockerfile-build-context guard).
  | "docker-build-context-missing-path"
  // The promoter subprocess blew its wall-clock budget and runPromoter killed it
  // (`[promoter-timeout]`). Almost always a transient environment stall — a
  // `docker build` step hanging on a degraded network fetch (SUR-756751D1: an
  // `apk add` that crawled 52 min). Retry the upgrade; only dig deeper if it
  // times out the same way twice. Environment, not a main defect.
  | "promoter-timeout"
  // Candidate readiness refused to begin quiescence. Preserve the machine code
  // so the remediation path is diagnosable instead of falling through to
  // "unknown".
  | "promoter-readiness-failed"
  // A migrate-step failure where the target Postgres lacks pgvector, so
  // `CREATE EXTENSION vector` cannot open `vector.control`. A pre-BET-5 install
  // on postgres:16-alpine hits this until its promoter is current; the promoter's
  // ensure-pgvector step recreates Postgres onto pgvector/pgvector:pg16 before
  // migrate (data-preserving). Environment/image gap, not a main defect
  // (SUR-* 2026-07-14; fixed by PR #2969/#2978).
  | "pgvector-extension-missing"
  // A migration FAILED TO APPLY (P3018) because a statement hit a unique-
  // constraint violation (Postgres 23505 "duplicate key value"). The canonical
  // case (SUR-859DB221/SUR-69A54F89, 2026-07-16): a data migration's bulk UPDATE
  // over PlatformIssueReport re-validated the partial unique index
  // `PlatformIssueReport_dedupeKey_open_key` and collided with the log-signature
  // scanner concurrently writing the same hot table. The failed record then
  // wedges ALL future upgrades (P3009) until resolved — and the resolve direction
  // depends on whether the schema half applied. Distinct from the pgvector P3018
  // (0A000 "extension vector") above, which is its own class.
  | "migration-unique-violation"
  // A prior failed migration left Prisma's P3009 state, which blocks ALL later
  // migrations until the failed record is resolved (migrate resolve
  // --rolled-back OR --applied — see summary). Environment state from an earlier
  // aborted attempt — often the pgvector or unique-violation failure above.
  | "p3009-failed-migration"
  // The migrate/boot step cannot reach Postgres (Prisma P1001 "Can't reach
  // database server") — the DB is down or unreachable (e.g. postgres stranded in
  // `Created`, crashed, still starting). Environment/infra, not a main defect:
  // confirm dpf-postgres-1 is Up; recreate it from the host compose if stuck
  // (the pgdata volume is intact). Matched on the specific Prisma phrasing, NOT a
  // bare ECONNREFUSED (which is ambiguous and stays unclassified).
  | "database-unreachable"
  // Docker Desktop refused to share a host path into a self-upgrade container
  // (#3262 fleet blocker): the portal's /dpf-state mount falls back to
  // ${HOME}/.dpf, which is /root/.dpf inside the root-run promoter, and Docker
  // Desktop won't share it — the run dies silently at step=migrate. Fixed by
  // pinning DPF_STATE_DIR to an absolute shared host path in the install .env.
  | "docker-mount-denied"
  // promote.sh's capability preflight aborted with `error: capability_state_stale`
  // — a MISLABEL: it means /dpf-state/install-state.json (or the compose-profile
  // adapter) was not available inside the promoter, not that capability state is
  // stale. Root cause is a promoter launcher predating the /dpf-state self-upgrade
  // mount (#3272) running a promote.sh that requires it (#3266); an install
  // deployed in that window can't self-heal (BI-B132DF1D). Version-skew, not a
  // defect in this run's code.
  | "capability-state-preflight-unavailable"
  // promote.sh (#3282) requires a SIGNED install-state migration handoff
  // (DPF_INSTALL_STATE_MIGRATION_ENVELOPE + _SIGNATURE) that only a #3282+
  // launcher constructs. A pre-#3282 portal cannot produce it, so a legacy
  // install cannot self-upgrade INTO #3282 — the fix is the documented
  // out-of-band crossing bootstrap, never a rebuild or a retry (BI-BE8BBDE9).
  | "install-state-migration-handoff-missing"
  // The build/host step failed because the host (or the Docker VM) ran OUT OF
  // MEMORY: buildkit's context sender OOMs on `readdirent … cannot allocate
  // memory` (ENOMEM), or a container is OOMKilled, or Node's heap exhausts.
  // Canonical case SUR-BF75ED2A (2026-08-11): the WSL2 VM (hard-capped 24GB) was
  // thrashing during the candidate promoter build and the context load failed
  // ENOMEM. Transient host pressure, NOT a main defect — the candidate build
  // runs BEFORE any portal swap, so nothing was deployed. The governed path now
  // DEFERS on a host-memory-headroom guard and retries after reclaim; a run that
  // still reaches here should be retried once the host frees memory.
  | "host-out-of-memory"
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
// The guard PR #2786 added: it derives the build-stage COPY allowlist from the
// Dockerfile and fails Unit Tests if an apps/web static import escapes into an
// un-COPYed repo dir. Adding the missing `COPY <dir>/` auto-satisfies it.
const DOCKER_CONTEXT_PLAYBOOK = "apps/web/lib/verify/dockerfile-build-context.guard.test.ts";

// Docker-only / host-only modules that must never be statically imported into a
// route/page/action/Inngest bundle. Their presence in a Turbopack/NFT trace is
// the bundle-boundary fingerprint.
const HOST_ONLY_MODULE = /(promoter|self-upgrade|child_process|node:child_process|dockerode|\/queue\/functions\/|api\/inngest)/i;
const DUPLICATE_ASSET = /(duplicate\s+emitted\s+asset|multiple\s+assets\s+emit|conflict:.*emit|emit[^\n]*to the same (file|filename))/i;
const UNEXPECTED_NFT_PROJECT_TRACE = /encountered unexpected file in NFT list|whole project was traced unintentionally/i;
const MODULE_NOT_FOUND = /(cannot find module ['"]([^'"]+)['"]|module not found:\s*can't resolve ['"]([^'"]+)['"])/i;
// A relative import climbing OUT of the importing package (one or more "../"),
// e.g. '../../../../config/seed-content-paths.json'. The first non-".." segment
// ('config') is the repo-root dir the Docker COPY allowlist is missing.
const RELATIVE_ESCAPE = /^\.\.\/(?:\.\.\/)*([^/'"]+)/;

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
// Host / Docker-VM out-of-memory. buildkit's context sender fails a getdents64
// with `readdirent … cannot allocate memory` (ENOMEM); Docker kills an OOM
// container with `OOMKilled`; Node exhausts its heap. Deliberately anchored on
// these decisive OOM phrasings so an unrelated failure never gets swept in.
const HOST_OUT_OF_MEMORY = /cannot allocate memory|OOMKilled|\bENOMEM\b|JavaScript heap out of memory/i;
// runPromoter's marker when it kills a promoter that blew its wall-clock budget.
const PROMOTER_TIMEOUT = /\[promoter-timeout\]/i;
// Production wraps the terminal machine code in a human-readable diagnostic:
// `promoter-readiness-failed: Promoter readiness check failed: <code>`.
// The prefix itself is the stable contract; older promoters and malformed
// reports may not carry a machine code. Extract a code only when the same line
// ends in a compound snake/kebab token, never from later diagnostics.
const PROMOTER_READINESS_FAILED = /promoter-readiness-failed:/i;
const PROMOTER_READINESS_CODE = /(?:^|:)\s*([a-z0-9]+(?:[_-][a-z0-9]+)+)\s*$/i;
// BET-5 migrate-step failures. Both recovery procedures live in the runbook.
const BET5_PLAYBOOK = "docs/runbooks/bet5-windows-self-upgrade.md";
// Docker Desktop mounts-denied on the /dpf-state mount (#3262).
const MOUNTS_DENIED_PLAYBOOK = "docs/runbooks/2026-07-18-self-upgrade-mounts-denied-state-dir.md";
// Docker Desktop file-sharing rejection. Anchored on the daemon's exact
// "mounts denied … not shared from the host" phrasing and captures the denied
// path. The /dpf-state mount uses ${DPF_STATE_DIR:-${HOME}/.dpf}; under the
// root-run promoter ${HOME}=/root, so an unset DPF_STATE_DIR resolves to the
// unshareable /root/.dpf (#3262). Deliberately specific so an ordinary bad
// bind-mount stays unclassified rather than being swept into the state-dir fix.
const MOUNTS_DENIED = /mounts denied:[\s\S]{0,120}?path\s+(\S+)\s+is not shared from the host/i;
// promote.sh's capability preflight aborts with exactly this line when the
// governed install snapshot or the compose-profile adapter is not resolvable in
// the promoter (a missing /dpf-state mount, not a genuinely stale state). Anchor
// on the emitted string; the wrapper "unknown (unclassified)" was the live
// symptom this rule replaces (BI-B132DF1D).
const CAPABILITY_STATE_STALE = /^error: capability_state_stale$/im;
// promote.sh (#3282) exits 78 with exactly this line when the signed install-state
// migration handoff was not supplied by the launcher. Anchor on the emitted string;
// like capability_state_stale above, the live symptom this rule replaces was the
// misleading "unknown (unclassified)" wrapper pointing at the wrong playbook.
const MIGRATION_HANDOFF_MISSING = /^error: install_state_migration_handoff_missing$/im;
// `CREATE EXTENSION vector` on a Postgres image without pgvector: the canonical
// Postgres errors are `extension "vector" is not available` and a `DETAIL: Could
// not open extension control file ".../vector.control"`. Deliberately anchored on
// the word "vector" so a generic missing-extension error stays unclassified.
const PGVECTOR_MISSING = /extension\s+"?vector"?\s+is not available|could not open extension control file[^\n]*vector|vector\.control/i;
// A migration that FAILED TO APPLY (P3018) on a UNIQUE-constraint violation
// (Postgres 23505). Requires BOTH the apply-failure marker AND the duplicate-key
// signal so a P3018 with a DIFFERENT underlying error (e.g. pgvector's 0A000,
// handled above) is never swept in here. The constraint name is pulled out for a
// specific diagnosis.
const MIGRATION_APPLY_FAILED = /\bP3018\b|A migration failed to apply/i;
const UNIQUE_VIOLATION = /duplicate key value violates unique constraint|Database error code:\s*23505|\bSqlState\(E?23505\)/i;
const UNIQUE_CONSTRAINT_NAME = /violates unique constraint "([^"]+)"/i;
// Prisma's P3009: a prior migration is recorded failed and blocks all later ones.
// Anchored on the P3009 code / its exact phrasing — NOT a bare "migrate failed",
// which is a different (unknown) failure that must not be mislabeled.
const P3009_FAILED_MIGRATION = /\bP3009\b|migrate found failed migrations in the target database|following migrations? have failed/i;
// Prisma P1001: the DB server is unreachable. Anchored on the P1001 code / its
// exact "Can't reach database server" phrasing — deliberately NOT a bare
// ECONNREFUSED, which appears in many unrelated failures and stays unclassified.
const DATABASE_UNREACHABLE = /\bP1001\b|can'?t reach database server|cannot reach database server/i;

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

  // Host / VM out-of-memory FIRST. An OOM is a decisive environmental cause: it
  // cancels whatever step was running, so any half-emitted trace — or the
  // `promoter-readiness-failed:` / `promoter_candidate_build_failed:` wrapper the
  // pipeline prepends — is noise, not the cause. Checked ahead of the readiness
  // extraction below (which would otherwise short-circuit an OOM'd candidate
  // build into the generic, unactionable `promoter-readiness-failed` class — the
  // exact SUR-BF75ED2A mislabel this class fixes).
  if (HOST_OUT_OF_MEMORY.test(log)) {
    return {
      class: "host-out-of-memory",
      summary:
        "The build failed because the host / Docker VM ran out of memory (`cannot allocate memory` / OOMKilled) — buildkit's context sender could not allocate a buffer to read the build context. Transient host pressure, NOT a main defect: the candidate build runs before any portal swap, so nothing was deployed and the running portal is untouched. Free host memory (WSL2 autoMemoryReclaim, or shed heavy consumers) and retry — the self-upgrade's host-memory-headroom guard now DEFERS instead of failing when MemAvailable is below the build floor, so a healthy retry happens automatically on the next cron tick.",
      playbookLink: SPEC,
      failingTrace: traceAround(log, HOST_OUT_OF_MEMORY),
      isMainDefectVsEnvironment: "environment",
    };
  }

  const readinessFailure = log.match(PROMOTER_READINESS_FAILED);
  if (readinessFailure) {
    const readinessLine = log.slice(readinessFailure.index).split(/\r?\n/, 1)[0];
    const code = readinessLine.match(PROMOTER_READINESS_CODE)?.[1];
    return {
      class: "promoter-readiness-failed",
      summary: `Promoter readiness refused to quiesce the portal${code ? ` (${code})` : ""}. Resolve the reported candidate/state/environment prerequisite, then retry; the running portal was left serving traffic.`,
      playbookLink: SPEC,
      failingTrace: traceAround(log, PROMOTER_READINESS_FAILED),
      isMainDefectVsEnvironment: null,
    };
  }

  // After the more specific readiness refusal, a promoter timeout supersedes
  // whatever build output preceded it: the kill
  // happened because nothing ever completed, so any half-emitted trace above is
  // noise, not the cause. Check it first.
  if (PROMOTER_TIMEOUT.test(log)) {
    return {
      class: "promoter-timeout",
      summary:
        "The promoter exceeded its wall-clock budget and was killed (its container force-removed). Almost always a transient environment stall — a docker-build step hanging on a degraded network fetch (SUR-756751D1: an `apk add` that crawled 52 min). Retry the upgrade; only dig deeper if it times out the same way twice.",
      playbookLink: SPEC,
      failingTrace: traceAround(log, PROMOTER_TIMEOUT),
      isMainDefectVsEnvironment: "environment",
    };
  }

  // Docker Desktop refused a host-path mount for a self-upgrade container. This
  // is a config gap, not a code defect in the run: the operator can unblock now
  // by pinning DPF_STATE_DIR. Check it early — the daemon error is decisive and
  // the build output above it (a clean image build) is not the cause (#3262).
  const mountDenied = log.match(MOUNTS_DENIED);
  if (mountDenied) {
    const deniedPath = mountDenied[1];
    const isStateDir = /[/\\]\.dpf(?:[/\\]|$)|dpf-state/i.test(deniedPath);
    return {
      class: "docker-mount-denied",
      summary: isStateDir
        ? `Docker Desktop refused to share ${deniedPath} into a self-upgrade container — the /dpf-state mount fell back to \${HOME}/.dpf, which is /root/.dpf inside the root-run promoter. Set DPF_STATE_DIR in the install .env to an ABSOLUTE, Docker-Desktop-shared host path (e.g. /Users/<user>/.dpf) and re-trigger the upgrade.`
        : `Docker Desktop refused to share the host path ${deniedPath} into a self-upgrade container. Point the mount at an absolute path Docker Desktop shares (Docker → Settings → Resources → File Sharing) — or provision the DPF_STATE_DIR / DPF_*_HOST_PATH env var the mount relies on in the install .env.`,
      playbookLink: MOUNTS_DENIED_PLAYBOOK,
      failingTrace: traceAround(log, MOUNTS_DENIED),
      isMainDefectVsEnvironment: "environment",
    };
  }

  // promote.sh's capability preflight aborted before any build (`error:
  // capability_state_stale`). Decisive and precedes the build output, like the
  // mount-denied case — classify it here so it stops surfacing as
  // "unknown (unclassified)" pointing at the wrong playbook (BI-B132DF1D).
  if (CAPABILITY_STATE_STALE.test(log)) {
    return {
      class: "capability-state-preflight-unavailable",
      summary:
        "promote.sh's capability preflight aborted with `error: capability_state_stale` — a MISLABEL: it means the governed install snapshot (/dpf-state/install-state.json) or the compose-profile adapter was not available inside the promoter, not that capability state is genuinely stale. Root cause is a promoter launcher predating the /dpf-state self-upgrade mount (#3272) running a promote.sh that already requires it (#3266): an install deployed in that window cannot self-heal and must be bootstrapped out-of-band onto a portal >= #3272 (BI-B132DF1D). Version-skew / environment, not a defect in this run's code.",
      playbookLink: SPEC,
      failingTrace: traceAround(log, CAPABILITY_STATE_STALE),
      isMainDefectVsEnvironment: "environment",
    };
  }

  // promote.sh (#3282) refused to migrate because the launcher supplied no signed
  // migration handoff. Decisive and precedes any build output, like the two cases
  // above — classify it so a legacy install crossing into #3282 is sent to the
  // bootstrap procedure instead of "unknown (unclassified)" (BI-BE8BBDE9).
  if (MIGRATION_HANDOFF_MISSING.test(log)) {
    return {
      class: "install-state-migration-handoff-missing",
      summary:
        "promote.sh refused the governed install-state migration because the signed handoff (DPF_INSTALL_STATE_MIGRATION_ENVELOPE + DPF_INSTALL_STATE_MIGRATION_SIGNATURE) was not supplied. Only a #3282+ launcher builds and signs that envelope (signing also needs /dpf-state/runtime-transition.secret), so an install still running a PRE-#3282 portal cannot self-upgrade INTO #3282 — every fix ships into a version the install cannot reach. Do NOT retry or rebuild: the run will fail identically. Cross the boundary once, out-of-band (build the portal from current origin/main, initialize the transition secret via scripts/rotate-runtime-transition-secret.mjs --initialize, set DPF_HOST_PLATFORM/DPF_HOST_ARCH in the install .env to match install-state, then recreate portal+portal-init). After that the launcher can sign handoffs and self-upgrade resumes normally (BI-BE8BBDE9). Version-skew / environment, not a defect in this run's code.",
      playbookLink: SPEC,
      failingTrace: traceAround(log, MIGRATION_HANDOFF_MISSING),
      isMainDefectVsEnvironment: "environment",
    };
  }

  // Fatal-marker priority for the most specific case. A "Module not found" whose
  // missing spec is a RELATIVE path climbing out of the package
  // ('../../../../config/…') is a Docker build-context miss: the file exists on
  // the full checkout but its repo-root dir is not COPYed into the image.
  // Turbopack/NFT "whole project traced unintentionally" WARNINGS routinely
  // print ABOVE this fatal and fingerprint a host-only module, so the
  // bundle-boundary heuristic below would otherwise steal the class —
  // SUR-BCFB72BB was mislabeled `bundle-boundary-static-import` for exactly this
  // reason, sending its corrective BI to the wrong playbook. Classify the
  // escaping fatal FIRST. (A bare-specifier miss like 'undici' is NOT this class
  // and falls through to the bundle-boundary / hoist paths below unchanged.)
  const earlyMiss = log.match(MODULE_NOT_FOUND);
  const earlyMissSpec = earlyMiss ? earlyMiss[2] || earlyMiss[3] || "" : "";
  const escape = earlyMissSpec.match(RELATIVE_ESCAPE);
  if (escape) {
    const rootDir = escape[1];
    return {
      class: "docker-build-context-missing-path",
      summary: `Docker build cannot resolve '${earlyMissSpec}' — a relative import climbing out of apps/web into the repo-root '${rootDir}/' directory, which the production Dockerfile's narrow COPY allowlist never copies into the build context (plain \`next build\` on the full checkout stays green; only the Docker image, built at self-upgrade/tag-release, 404s). Add \`COPY ${rootDir}/\` to the build (and init) stage — see PR #2786 and the dockerfile-build-context guard. NOT a bundle-boundary issue.`,
      playbookLink: DOCKER_CONTEXT_PLAYBOOK,
      failingTrace: traceAround(log, MODULE_NOT_FOUND),
      isMainDefectVsEnvironment: "main-defect",
    };
  }

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

  // Migrate-step failures (checked after the build-output classes — a migrate
  // failure means the build already succeeded). Connectivity first: if the DB is
  // unreachable, migrate never ran, so no pgvector/P3009 signal can be present.
  if (DATABASE_UNREACHABLE.test(log)) {
    return {
      class: "database-unreachable",
      summary:
        "The migrate/boot step cannot reach Postgres (Prisma P1001 — \"Can't reach database server\"). The database is down or unreachable, not a main defect: confirm dpf-postgres-1 is Up and healthy; if it is stranded in `Created` (the pre-#2978 ensure-pgvector symptom) recreate it from the host compose — the named pgdata volume is intact — then re-trigger. Do NOT hand-rebuild the portal.",
      playbookLink: BET5_PLAYBOOK,
      failingTrace: traceAround(log, DATABASE_UNREACHABLE),
      isMainDefectVsEnvironment: "environment",
    };
  }

  // pgvector first among the reachable-DB migrate failures: when a retry shows
  // P3009 it is the downstream symptom of this root cause.
  if (PGVECTOR_MISSING.test(log)) {
    return {
      class: "pgvector-extension-missing",
      summary:
        "The target Postgres lacks the pgvector extension — `CREATE EXTENSION vector` cannot open `vector.control`. A pre-BET-5 install on postgres:16-alpine hits this until its promoter is current; the promoter's ensure-pgvector step recreates Postgres onto pgvector/pgvector:pg16 before migrate (data-preserving — same PG16 engine + volume). Environment/image gap, not a main defect — do NOT hand-rebuild the portal; rebuild the promoter from current main and re-trigger.",
      playbookLink: BET5_PLAYBOOK,
      failingTrace: traceAround(log, PGVECTOR_MISSING),
      isMainDefectVsEnvironment: "environment",
    };
  }

  // A migration that FAILED TO APPLY on a unique-constraint violation. Checked
  // before P3009 because this is the FIRST-failure signature (P3018 + 23505); the
  // P3009 block below is the downstream symptom the identical retry then hits.
  if (MIGRATION_APPLY_FAILED.test(log) && UNIQUE_VIOLATION.test(log)) {
    const constraint = log.match(UNIQUE_CONSTRAINT_NAME)?.[1] ?? null;
    const constraintNote = constraint ? ` (unique index \`${constraint}\`)` : "";
    return {
      class: "migration-unique-violation",
      summary:
        `A migration failed to apply (P3018) on a duplicate-key / unique-constraint violation${constraintNote}. ` +
        "The canonical cause is a data migration's bulk UPDATE/insert re-validating a partial unique index on a HOT table while the app is still writing it (SUR-859DB221, 2026-07-16: the log-signature scanner concurrently minting PlatformIssueReport rows during the staging-gate migration's backfill). RECOVERY depends on whether the schema half-applied: if the migration's columns/index are already present in the DB, run `prisma migrate resolve --applied <name>` (NOT --rolled-back, which would re-run the ADD COLUMN and fail 'already exists'); if the schema did not apply, de-duplicate the offending rows for that key, then `--rolled-back` + re-trigger. A failed record left here wedges ALL future upgrades via P3009. Deeper fix: keep a bulk data-migration off a table under active concurrent writes to a partial unique index.",
      playbookLink: BET5_PLAYBOOK,
      failingTrace: traceAround(log, UNIQUE_VIOLATION),
      isMainDefectVsEnvironment: "environment",
    };
  }

  if (P3009_FAILED_MIGRATION.test(log)) {
    return {
      class: "p3009-failed-migration",
      summary:
        "A prior failed migration left Prisma's P3009 state, which blocks ALL later migrations. Resolve the failed migration once its precondition is fixed, choosing the direction by what actually landed: `prisma migrate resolve --rolled-back <name>` when the migration did NOT apply its schema (e.g. the BET-5 pgvector case, which the promoter's step-3a self-heals), or `prisma migrate resolve --applied <name>` when the migration's schema changes are ALREADY present (a partial-apply, e.g. a data-collision failure — otherwise a re-run re-executes the DDL and fails 'already exists'). Environment state from an earlier aborted attempt, not a main defect.",
      playbookLink: BET5_PLAYBOOK,
      failingTrace: traceAround(log, P3009_FAILED_MIGRATION),
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

/**
 * Longest operator-facing failure reason we persist on a run row. The column is
 * a status line, not a log: the full output already lives in `failureLog`.
 */
export const FAILURE_REASON_MAX = 200;

/** A structured leading token, matching the `class: detail` shape skip reasons use. */
const STRUCTURED_PREFIX = /^([a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:_[a-z0-9-]+)*):/;

/**
 * Derive a short, operator-readable reason for a failed self-upgrade run.
 *
 * Why this exists: `skipRun` has always written a structured `reason`
 * ("activity-in-flight: coworker.reasoning-loop") that the Upgrade Center
 * renders in plain language, while `failRun` wrote only `failureLog` — so
 * every FAILED run showed the operator nothing but a raw Docker log behind a
 * tooltip. Measured on this install: 55 of 55 failed runs had no reason, and
 * that produced two multi-day invisible outages (four consecutive daily
 * failures 2026-07-26..29, and the Git-LFS breakage of 2026-08-29).
 *
 * The classification this returns is not new judgement: `failRun` already
 * classified the same log to fingerprint the corrective BI and then discarded
 * the result. This keeps ONE classification and lets the run row carry it too.
 *
 * Never throws — a reason is diagnostic garnish, and must not be able to fail
 * the write that records the failure itself.
 */
export function deriveFailureReason(log: string): string {
  const text = (log ?? "").trim();
  if (!text) return "unknown";

  let className: BuildFailureClass = "unknown";
  try {
    className = classifyBuildFailure({ log: text }).class;
  } catch {
    // Fall through to the structured-prefix path below.
  }
  if (className !== "unknown") return className;

  // No known class. The pipeline's own wrappers (`promoter-readiness-failed:`,
  // `lfs-unmaterialized:`, `merge-conflict:`) are already the right shape, so
  // prefer the first structured line over a bare "unknown".
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const match = STRUCTURED_PREFIX.exec(line);
    if (match) return line.slice(0, FAILURE_REASON_MAX);
    break;
  }

  const firstLine = text.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
  return `unknown: ${firstLine}`.slice(0, FAILURE_REASON_MAX);
}
