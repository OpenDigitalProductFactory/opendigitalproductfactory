---
date: 2026-05-24
backlog: BI-09A48EAD
epic: EP-9FC5D2FD
status: diagnosis complete — awaiting operator approval before applying fix
host: D:/DPF on Windows + Docker Desktop 4.74.0 (WSL2 backend)
---

# Portal rebuild failure — triage 2026-05-24

## TL;DR

The reported failure (`prisma generate` exit 1) is **misidentified**. `prisma generate` actually succeeds. The real blocker is the next step — `pnpm --filter web build` — failing during the TypeScript-check phase of `next build`:

```
./lib/gear-interface/otel-exporter.ts:127:25
Type error: Cannot find module '@opentelemetry/api' or its corresponding type declarations.
```

Introduced by [PR #1077… correction: PR #1082](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1082) (`feat(gear-interface): Reduction Gear Phase 0`, merged 2026-05-24T17:14 UTC) at [apps/web/lib/gear-interface/otel-exporter.ts:127](apps/web/lib/gear-interface/otel-exporter.ts:127). The file does `await import("@opentelemetry/api")` but `@opentelemetry/api` is **not declared as a direct dependency in any package.json**.

The "silent noop on cached rebuild" sub-bug is *not* a Docker cache pathology. `docker compose build portal` is in fact running the build and surfacing the error loudly. What the operator saw was the **`dpf-portal:latest` tag remaining pinned to the last successful image** (since BuildKit never re-tags on failed builds), giving the appearance of an unchanged image when the rebuild just failed to produce a new one.

## 1. Actual error text (full stderr context)

Captured from `docker buildx build --target build --progress=plain -f Dockerfile .` (full log at `/tmp/portal-build-full.log` on the host, retrieve before reboot).

The `prisma generate` step (Dockerfile:33) **passes**:

```
#22 [build 7/8] RUN pnpm --filter @dpf/db exec prisma generate
#22 2.092 Loaded Prisma config from prisma.config.ts.
#22 2.393 Prisma schema loaded from prisma/schema.prisma.
#22 7.012 ✔ Generated Prisma Client (7.8.0) to ./generated/client in 2.73s
#22 DONE 7.2s
```

The blocker is the next step (Dockerfile:34):

```
#23 [build 8/8] RUN pnpm --filter web build
…
#23 18.77 ✓ Compiled successfully in 17.1s
#23 18.78   Running TypeScript ...
#23 56.16 Failed to type check.
#23 56.16
#23 56.16 ./lib/gear-interface/otel-exporter.ts:127:25
#23 56.16 Type error: Cannot find module '@opentelemetry/api' or its corresponding type declarations.
#23 56.16
#23 56.16   125 |   let api: OtelApi | null = null;
#23 56.16   126 |   try {
#23 56.16 > 127 |     api = (await import("@opentelemetry/api")) as unknown as OtelApi;
#23 56.16   128 |   } catch {
#23 56.16   129 |     // SDK not installed; log the payload so it is observable.
#23 56.16   130 |     console.log("[gear-interface][otel] (no SDK)", JSON.stringify({ spanName, attributes ...
#23 56.41 Next.js build worker exited with code: 1 and signal: null
#23 56.58 /app/apps/web:
#23 56.58  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  web@0.1.0 build: `next build`
#23 56.58 Exit status 1
#23 ERROR: process "/bin/sh -c pnpm --filter web build" did not complete successfully: exit code: 1
```

The Dockerfile-line in the failure summary the operator originally read (`>>> RUN pnpm --filter @dpf/db exec prisma generate`) is from a **non-deterministic earlier failure** — Turbopack's TS worker sometimes crashes with V8 `SIGTRAP` ("Fatal error… unreachable code… Native stack trace") on the same input instead of producing the clean type-error above, and the user's compose log may have surfaced an adjacent line. Two consecutive `--no-cache` builds on the same source produced:
- Run 1: V8 SIGTRAP during "Running TypeScript ..."
- Run 2: clean `Type error: Cannot find module '@opentelemetry/api'`

Same root cause; the worker is just not robust to an unresolvable import in this position. Either way, the blocker is the missing module declaration, not Prisma.

## 2. Root cause

### 2.1 The missing dependency

[apps/web/lib/gear-interface/otel-exporter.ts:127](apps/web/lib/gear-interface/otel-exporter.ts:127):

```ts
api = (await import("@opentelemetry/api")) as unknown as OtelApi;
```

Wrapped in `try/catch` with a comment "SDK not installed; log the payload so it is observable" — so the runtime contract is deliberately "optional dependency, soft-fallback at runtime." But TypeScript's module resolver does not honor that intent — it tries to resolve the specifier statically and fails the build.

`@opentelemetry/api` is **not declared** in any of:
- [package.json](package.json) (root)
- [apps/web/package.json](apps/web/package.json)
- [packages/db/package.json](packages/db/package.json)
- any other `packages/*/package.json`, `services/*/package.json`, `apps/mobile/package.json`

Confirmed by `grep -rn "@opentelemetry/api" **/package.json` — only mention is `"@opentelemetry/otlp-transformer>protobufjs": "^8.3.0"` in the root `pnpm.overrides` block, which has nothing to do with `@opentelemetry/api`.

### 2.2 Why it lives in `node_modules/.pnpm/` but is not resolvable

`@opentelemetry/api@1.9.1` IS in the lockfile, but only as an **`optionalDependencies` entry of `next@16.2.6`** (and a transitive `peerDependencies` of `inngest@4.4.0`, `vitest@4.1.7`):

```
next@16.2.6(@babel/core@…)(@opentelemetry/api@1.9.1)(…):
  dependencies:
    '@next/env': 16.2.6
    …
  optionalDependencies:
    '@next/swc-darwin-arm64': 16.2.6
    …
    '@opentelemetry/api': 1.9.1       ← here
```

pnpm installs the package into the content-addressable store (`/app/node_modules/.pnpm/@opentelemetry+api@1.9.1/…`) but **does not hoist it to top-level** `/app/node_modules/@opentelemetry/api/`. Verified by inspecting the last successful image (`dpf-portal:latest` @ 14:56 UTC, pre-PR #1082):

```
$ docker run --rm dpf-portal:latest ls /app/node_modules/@opentelemetry
ls: /app/node_modules/@opentelemetry: No such file or directory
$ docker run --rm dpf-portal:latest cat /app/node_modules/.modules.yaml | grep -A 1 hoistPattern
  hoistPattern: ["*"]
```

`hoistPattern: ["*"]` is on, but pnpm's per-package hoisting algorithm excludes peer-bound packages from top-level. So even with `hoistPattern: *`, `@opentelemetry/api` is unreachable from `apps/web/`'s tsc resolution.

This was a latent bug — the dependency was missing from `apps/web/package.json` the whole time, but no code imported it. PR #1082 was the first code to `import("@opentelemetry/api")`, which is what made the missing declaration fatal.

## 3. Why CI passes but this host doesn't

This is the part the operator should care most about: a regression that breaks every customer install passed CI and merged.

CI's `Production Build` job ([.github/workflows/ci.yml:150-171](.github/workflows/ci.yml:150)) runs on `ubuntu-latest`:

```yaml
- run: pnpm install --frozen-lockfile
- run: pnpm --filter @dpf/db exec prisma generate
- run: pnpm --filter web build
```

In the CI log for PR #1082 ([run 26367648796](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/actions/runs/26367648796)):

```
Install dependencies: Progress: resolved 0, reused 0, downloaded 1827, added 1917, done
…
Build web (Next.js production):
  ✓ Compiled successfully in 58s
  Running TypeScript ...
  Finished TypeScript in 55s ...
  ✓ Generating static pages using 3 workers (112/112)
```

`added 1917` — CI sees the **full workspace** (apps/web, apps/mobile, packages/{db,api-client,finance-templates,integration-shared,storefront-templates,types,validators}, services/{adp,edge-node,integration-test-harness}) and installs ~1917 packages.

The Docker build's `deps` stage ([Dockerfile:14-22](Dockerfile:14)) only copies `apps/web/package.json` + `packages/db/package.json` before running `pnpm install --frozen-lockfile`:

```
#15 [deps 8/8] RUN pnpm install --frozen-lockfile
…
#15 2.422 Lockfile is up to date, resolution step is skipped
#15 2.623 Packages: +1099                                       ← 818 fewer
#15 28.65 Progress: resolved 1099, reused 0, downloaded 1099, added 1099, done
```

**The Docker deps stage installs 1099 packages with hoisting computed against a 2-project workspace view; CI installs 1917 packages with hoisting computed against the full 11-project workspace view.** pnpm's hoist algorithm picks which transitive peers to promote to top-level partly based on which workspace consumers exist. In CI, one of the wider workspace's deps causes `@opentelemetry/api` to land at `/node_modules/@opentelemetry/api/` where tsc finds it. In the Dockerfile, the narrower deps view doesn't trigger that hoist, and tsc fails.

The build stage's second `pnpm install --frozen-lockfile` ([Dockerfile:32](Dockerfile:32)) — which runs *after* `COPY packages/ ./packages/` brings in the full workspace — does not fix this, because pnpm in frozen-lockfile mode shortcuts when existing `node_modules/` already satisfies the lockfile:

```
#21 [build 6/8] RUN pnpm install --frozen-lockfile
#21 0.852 Lockfile is up to date, resolution step is skipped
#21 1.055 Already up to date
```

It doesn't re-evaluate hoisting against the now-larger workspace.

So CI's pass is essentially *accidental*. The codebase has a latent bug — `@opentelemetry/api` not declared — that CI happens to mask via wider-workspace hoisting. The proper-installed monorepo's `pnpm install` will always pull this in, but Dockerfile's bandwidth-saving partial-COPY install will not.

## 4. Proposed fix (do not apply without approval)

### 4.1 Primary fix — declare the dependency

Add `@opentelemetry/api` as a direct dependency of `apps/web`. Pick the same version pnpm has already resolved in the lockfile (`1.9.1`) to avoid lockfile churn. The runtime contract is unchanged (still try/catch fallback), but the type is now resolvable.

**File:** [apps/web/package.json](apps/web/package.json)

```diff
   "dependencies": {
+    "@opentelemetry/api": "1.9.1",
     "@next/env": "...",
     …
```

Then `pnpm install --lockfile-only` to update the lockfile, commit both files. Since `1.9.1` is already in the lockfile as a transitive, the lockfile delta will be small — just moving it from "peer/optional of next" to "direct dep of apps/web" and changing its hoisting class.

**Why not a different version range:** `@opentelemetry/api` is the spec-stability package — every other `@opentelemetry/*` package peers against it. Pinning to the exact version pnpm already picked avoids peer-resolution churn.

**Why not just delete the `await import`:** the gear-interface OTel export is the actual feature in PR #1082. Removing the import would back out a shipped Phase-0 feature.

**Why not loosen the try/catch to swallow the type error:** `@ts-ignore` would compile, but masks the same class of bug for any future addition. Declaring the dep is cleaner.

### 4.2 Secondary fix — make Docker rebuild safe (separate, optional)

The Dockerfile's two-pass install pattern (narrow `deps` then wider `build`) saves layer-cache size but is the structural cause of the CI/Docker divergence. Future PRs adding a new direct import from a transitive will hit the same trap. Options, listed lowest-risk first:

**Option A (cheap, recommended):** add a CI check that fails when any TS file imports a specifier not present in the importing package's declared deps. There's no existing skill for this; depcheck or knip would catch it. This makes future regressions PR-blocking instead of "ship-and-hope".

**Option B:** change the `deps` stage to copy `**/package.json` (all workspace package.json files) before `pnpm install`. This widens the deps-stage workspace view to match CI's. The cost is the deps layer invalidates on any package.json change in any workspace project (more cache misses for deps install). Probably acceptable.

**Option C:** delete the `deps` stage and inline its work into `build`. Conceptually clean but loses the cache-layer split that makes incremental builds fast.

Recommend (A) immediately and revisit (B) only if another similar bug recurs.

### 4.3 The "silent noop on cached rebuild" sub-issue

I cannot reproduce the silent-success-with-unchanged-hash behavior the operator reported. `docker compose build portal` (no `--no-cache`) on this host **does** run the build and **does** exit with the same `pnpm --filter web build` failure visible above. It does NOT exit 0.

What does happen — and could be confused with a silent noop — is that the **`dpf-portal:latest` image tag remains pointing at the pre-failure image** (`sha256:6cd4ace967e0…` from 14:56 UTC). BuildKit never tags a failed build, so `docker image inspect dpf-portal:latest` after the failure shows the same hash/timestamp as before. If the operator skimmed the tail of compose's output (which is interleaved across multiple services) and saw the unchanged hash, the appearance is "silent success."

If the operator did observe a *true* exit-0 from compose, that's a real bug worth chasing, but I'd want to repro it under controlled conditions before guessing at a fix. Possible explanation: `docker compose build` (no service arg) builds all services in parallel; if the portal-init service's runner-stage build hits cache and exits successfully while the portal service's runner-stage build fails, compose's overall exit code depends on its CLI version. **Confirm with the operator: was the failing command literally `docker compose build portal`, or `docker compose build` (no arg)? And what was the actual exit code (`$LASTEXITCODE` in pwsh)?**

If exit-0-on-failed-build is real, the proper-fix is a CI/script guard that compares pre/post image SHAs and fails if unchanged. Punt until reproduced.

## 5. Test plan

After applying §4.1 fix:

1. **Reproduce the failure on `main` first** to baseline. `cd /d/DPF && git checkout main && docker compose build --no-cache portal 2>&1 | tail -50` — expect the `Cannot find module '@opentelemetry/api'` error. (~10 min)
2. **Apply the package.json + lockfile change** on a topic branch off `origin/main`. `pnpm install --lockfile-only` to regenerate the lockfile entry, verify diff is small (only @opentelemetry/api moves from peer to direct).
3. **Local fix verification:** `docker compose build --no-cache portal 2>&1 | tail -30` — expect successful build to a new image hash. (~12 min)
4. **CI parity:** push to remote, watch the `Production Build` and `Typecheck` jobs on the PR — both should pass (they passed before by accident; should pass after by intent).
5. **Self-upgrade compatibility:** the fix is a package.json + lockfile change only. The self-upgrade machinery (`project_self_upgrade_kills_in_session_ux`) keys off bundle hash / version.json. version.json doesn't change, and bundle hash will naturally change because `.dpf-image-version` is computed from source content (Dockerfile:118-131). So the upgrade detector will see a new image and recycle the portal — which is the intended behavior, not a regression.
6. **Runtime smoke:** after the new image deploys, drive `/admin/cockpit` (Phase-0 read-only cockpit added by PR #1082) and confirm it loads. The OTel `import` path is taken only when `isOtelExportEnabled()` is true, which is feature-gated off by default — so the runtime change is null on default installs. Confirmed via reading [otel-exporter.ts:109](apps/web/lib/gear-interface/otel-exporter.ts:109).

If §4.2 Option (A) is also pursued, the depcheck/knip test should run on a known-good baseline first to surface any pre-existing missing-dep declarations (likely there are more, given the same hoist accident has been masking them).

## 6. Constraints honored

- No code or infra changes have been made by this diagnostic. Source tree, Dockerfile, lockfile, and existing `dpf-portal:latest` image are untouched.
- Diagnostic builds used `docker buildx build --target build` (no `compose up`, no tag overwrite). The running portal container at `sha256:6cd4ace967e0…` is undisturbed.
- BuildKit cache may have grown by 1-2 GB from the diagnostic builds; `docker system df` shows 25.28 GB of build cache (78% reclaimable). Operator can `docker builder prune` at convenience if disk matters.

## 7. Open questions for the operator

1. **Apply §4.1 (declare `@opentelemetry/api`)?** This is the minimal fix that restores portal rebuilds and the customer-facing portal pipeline.
2. **Also queue §4.2 Option A (depcheck/knip CI guard) as a separate BI?** Recommended — this exact class of bug will recur otherwise.
3. **Should I open the §4.1 PR from this worktree (`claude/quizzical-tharp-6f1fd2`, branched off `origin/main`), or do you want it from a specific branch?**
4. **Was the originally observed compose-build-noop a literal exit 0, or unchanged image hash after a non-zero exit?** Determines whether §4.3 is a real bug to file.
