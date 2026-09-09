---
status: active
---

# Dependency diet and vertical integration plan

_Founder-directed research and re-architecture planning thread, 2026-09-08._
_Epic: `EP-8DC217EB` (Vertical Integration Inward). Extends [the 2026-07-07 plan](2026-07-07-vertical-integration-inward-plan.md) BET-14 and the [dependency-reduction routine](../../architecture/dependency-reduction-routine.md); it does not replace either._

> **For agentic workers:** execute one move per backlog item, one branch, one PR. Moves marked **WWMD** need a `principle_decide` record before code. Every move ships its ratchet (§7) in the same PR or names the item that will.

## 0. What the founder asked, and the honest answer

The direction: fewer dependencies, fewer duplicate versions, fewer pins, vertically integrate what we already half-own, and get faster builds and compile times out of it.

Measured on `main` at `2fa630fcbe2` (2026-09-08), the picture is:

| Measure | Value |
|---|---|
| Resolved packages in `pnpm-lock.yaml` | 2000 (1709 names) |
| Names resolved at more than one version | 227 (291 surplus copies) |
| Production-runtime closure (portal + adp + edge) | 825 (41%) |
| Dev / build / test / mobile-only | 1175 (59%) |
| `pnpm-workspace.yaml` override entries | 78 |
| Shipped portal image | 4.17 GB |
| `node_modules` inside that image | 1.83 GB, 1167 package directories |
| `apps/web` typecheck, local | 98 s wall, 60 s in the checker, 7.3 GB heap |
| First-party TypeScript loaded by that typecheck | 3.05 M lines vs 0.40 M lines of `.d.ts` |
| CI long poles (merge-group run 34303811714) | UX route sweep 573 s, production build 420 s, typecheck 274 s, web unit shards 271 to 340 s |

Three conclusions shape the plan:

1. **The image bloat is a packaging defect, not a dependency-count problem.** The runner stage copies the whole workspace `node_modules` (`Dockerfile` line 312), so the production image carries two TypeScript compilers, vitest, jsdom, msw, mermaid with its headless-browser stack, Prisma Studio, and a 130 MB browser-only ONNX runtime. Fixing that removes roughly 1.3 GB and about 450 packages from the shipped artifact without touching a single dependency declaration (§3 M1).
2. **The dependency count is dominated by five roots.** `inngest` (380 in its closure, 130 exclusive to it, in production), `@mermaid-js/mermaid-cli` (349 / 113, dev), the Expo toolchain (about 940 shared, mobile only), `@stoplight/prism` (211 / 26, harness), and the document cluster in `apps/web` (react-pdf, react-markdown, remark-gfm, pdf-parse: about 230 / 106). Everything else is long tail.
3. **Compile time is source-bound, not dependency-bound.** Definitions are 12% of the lines the checker loads; our own code is 88%, and 37% of that is test files. Dependency work will not move typecheck time; program shape will (§3 M11).

The rent-versus-own doctrine (founder, 2026-06-20) and the tiered posture (2026-07-21) stay in force. This plan works the first three rungs of that ladder, **eliminate, dedupe, hybridize onto substrate we already own**, and reaches "own" only where the platform already carries the capability (Postgres, the browser sidecar, the document pipeline).

## 1. Evidence

### 1.1 Where the packages come from

Closure = every package reachable from the direct dependency. Exclusive = reachable from no other direct dependency anywhere in the workspace.

| Direct dependency | Closure | Exclusive | Kind | Workspace |
|---|---|---|---|---|
| `inngest` | 380 | 130 | prod | apps/web |
| `@mermaid-js/mermaid-cli` | 349 | 113 | dev | root |
| `@react-pdf/renderer` | 67 | 45 | prod | apps/web |
| `react-markdown` + `remark-gfm` | 85 + 68 | 48 | prod | apps/web |
| `@tailwindcss/postcss` | 44 | 29 | dev | apps/web |
| `@stoplight/prism-cli` | 211 | 26 | prod | integration-test-harness |
| `jest-expo` | 940 | 17 | dev | apps/mobile |
| `nativewind` | 499 | 16 | prod | apps/mobile |
| `pdf-parse` | 13 | 13 | prod | apps/web |
| `recharts` | 44 | 12 | prod | apps/web |
| `@modelcontextprotocol/sdk` | 92 | 11 | prod | services/adp |
| `mammoth` | 26 | 8 | prod | apps/web |
| `next-auth` | 106 | 6 | prod | apps/web |
| `@ricky0123/vad-web` | 19 | 6 | prod | apps/web |

Exclusive packages by workspace and kind: apps/web prod 301, root devDependencies 120, apps/web dev 37, apps/mobile 51, harness 27, adp 15, db 21.

### 1.2 What the duplicate versions trace to

| Package | Versions | Pulled by |
|---|---|---|
| `commander` | 6 | terser, sucrase, d3-dsv, katex, react-native, mermaid-cli |
| `@types/node` | 5 | `@inngest/ai` (22), `@types/net-snmp` (24), `docx` (25), first-party (26) |
| `typescript` | 2 in the image | first-party 6.0.3; `@inngest/ai` drags 5.9.3 |
| `pino` | 3 | Prism (6), `@zenuml/core` via mermaid (8), harness (10) |
| `lightningcss` | 3 | `react-native-css-interop` (1.27), tailwind 4 (1.32, 1.33) |
| `elkjs` | 3 | mermaid layout (0.9), Prisma Studio (0.11), first-party (0.12) |
| `tailwindcss` | 3.x and 4.x | the only first-party split in `sbom/baseline.json`: mobile on nativewind v4 |
| `semver` 6, `lru-cache` 5, `glob` 7, `minimatch` 3 | old majors | Babel and `test-exclude` (Expo / coverage) |

Every row except the Babel one disappears with a move in §3: mermaid-cli (M2), inngest (M3), Prism (M4), mobile toolchain (M10).

### 1.3 What the image ships that the portal never executes

From `docker history` and a `du` inside `dpf-portal:v2026.09.08-reviewer-recovery.3`:

| Layer or directory | Size |
|---|---|
| `COPY /app/node_modules` | 1.83 GB |
| Next standalone output (already carries its own traced `node_modules`) | 880 MB |
| `apps/web-src` + `packages-src` (Build Studio source copies) | 187 MB |
| apk toolchain (docker-cli, git, git-lfs, postgres client, nmap) | 185 MB |

Inside that `node_modules`: mermaid + zenuml + katex + cytoscape 202 MB, vitest + jsdom + msw + vite + rolldown + esbuild + two TypeScripts 145 MB, `onnxruntime-web` 130 MB (browser-only, from `vad-web`), Prisma Studio 43 MB, `@fortawesome/fontawesome-free` 36 MB (mermaid-cli only), `effect` 34 MB (`@prisma/config`), `date-fns` 33 MB (`react-day-picker` only), `@electric-sql/pglite` 24 MB (`@prisma/dev`).

The Dockerfile comment explains the copy: seeds and migrations import `@dpf/*` workspace packages and run under `tsx`, so the runner needs a resolvable workspace. That justifies a **production** workspace install, not the dev one.

### 1.4 What the durable-job engine actually uses

`inngest` is the largest production root and the only consumer of the `redis` container (the sole other reference is a poison-queue drain script). Usage on `main`:

| Feature | Sites |
|---|---|
| `createFunction` | 117 across 86 files, 85 of them under `lib/queue/` |
| `step.run` | 236 |
| `step.waitForEvent` | 19 |
| `step.sleep` / `sleepUntil` | 5 |
| `cron:` triggers | 78 |
| `concurrency:` / `retries:` / `priority:` options | 89 / 121 / 231 |
| `idempotency` / `cancelOn` | 3 / 1 |
| `inngest.send(` | 45 |

That is a bounded feature set: memoized steps, event wait, sleep, cron, concurrency keys, retries, priority. The event store already lives in Postgres (`INNGEST_POSTGRES_URI`); Redis holds the queue. The shape is the same one BET-5 retired for Neo4j and Qdrant: a non-authoritative projection sitting beside Postgres.

### 1.5 Retired substrate still referenced

97 files under `apps/web/lib` and `packages/db/src` still mention `neo4j` or `qdrant` after BI-A1E864A5 closed (2026-08-13), led by `operate/backups/engine-specs.ts` (60 mentions), `operate/metrics.ts` (20) and the backup test suites. `scripts/check-retired-substrate.mjs` exists but ratchets rather than forbids.

### 1.6 Compile-time profile

`tsc --extendedDiagnostics` on `apps/web`: 11,554 files, parse 5.5 s, bind 2.8 s, **check 60.5 s**, incremental emit 24 s, total 98 s, 7.3 GB heap (the `run-tsc.mjs` wrapper already raises the heap for this). Tracked `apps/web` TypeScript is 1.40 M lines, of which 0.52 M (37%) are `*.test.ts(x)` files compiled into the same program. The four largest `lib/` domains by file count are `build` (400), `actions` (361), `tak` (324) and `mcp` (273).

## 2. What already exists (extend, do not reinvent)

- Routine, gates and doctrine: [dependency-reduction-routine.md](../../architecture/dependency-reduction-routine.md) (New Dependency Gate, SBOM Divergence Guard, Singleton Safety Guard, OSV scan, release-age floor, `pnpm candidates`, `pnpm surface`).
- Posture: [dependency sovereignty spec](../specs/2026-07-21-dependency-sovereignty-and-supply-chain-intake-hardening-design.md) (Tier 0 / 1 / 2, six-criterion vendoring bar `DI-957F61CFECEA`).
- Prior retirement precedent: BI-A1E864A5 (Neo4j + Qdrant onto Postgres, benchmarked, founder green-lit, done).
- Open long-tail item this plan decomposes: BI-C0CEB377 (BET-14).
- Override audit: `pnpm audit:stale-overrides` reports "un-auditable" offline; it needs `GITHUB_REPOSITORY` + `GITHUB_TOKEN` to cross-check, so the 78-entry block has never actually been pruned by the tool.

## 3. The moves

Ranked by leverage ÷ effort ÷ risk. Effect numbers are from §1; "packages" means lockfile resolutions unless stated.

### M1 · Ship a production dependency set in the portal image · effort M · leverage H · no decision needed

**Now:** runner stage copies the dev workspace `node_modules` (1.83 GB, 1167 package dirs).
**Move:** build a second install in the `init` stage with `pnpm install --prod --frozen-lockfile --filter` scoped to what the runner executes at runtime (`@dpf/db` seed and migrate under `tsx`, the Prisma CLI for `migrate deploy`, `scripts/` consumers such as gate-context and the backup runners), and copy only that. Build Studio already bootstraps its own `/workspace` install from the shipped manifests, so it loses nothing. Keep `apps/web-src` and `packages-src` (source is not the problem).
**Effect:** roughly 1.3 GB off the image and about 450 packages out of the shipped artifact, including both stray TypeScripts, vitest, jsdom, mermaid, puppeteer, Prisma Studio and the ONNX runtime. Smaller image pulls on every self-upgrade across the fleet.
**Risk:** a runtime import that only resolved because the dev tree was present. Mitigation: enumerate every `require`/`import` executed from `/app/scripts` and the seed path first, and prove the image on the local-CI gate plus `/ops/self-upgrade` on the dev install.
**Ratchet:** an image-size budget in `publish-image.yml` and a `node_modules` package-count assertion in the runner stage.

### M2 · Take the diagram and docx toolchain out of the workspace · effort S · leverage H · no decision needed

**Now:** `@mermaid-js/mermaid-cli`, `puppeteer`, `docx` are root devDependencies used only by `scripts/render-doc-diagrams.mjs` (84 files with mermaid fences, 18 committed `.mmd`) and three `docs:*-docx` generators. They bring 349 + 22 packages, eight exact override pins, `commander@13`, `pino@8`, `elkjs@0.9`, `katex`, `cytoscape` and 36 MB of Font Awesome.
**Move:** run the renderer from a pinned OCI tool image (`minlag/mermaid-cli` upstream or a DPF-built `dpf-doctools` image alongside the promoter image) invoked by the same script; move the docx generators into the same tool image or onto the portal's existing document pipeline. The diagram stack keeps its "last policy-vetted release" discipline through the image digest instead of eight npm pins.
**Effect:** about 370 packages, 8 overrides, one `commander`, one `pino`, one `elkjs` and 202 MB of the current image.
**Risk:** contributors without Docker cannot render diagrams locally. The check mode (`--check`) stays pure Node, so the PR gate is unaffected.
**Ratchet:** the New Dependency Gate already blocks re-adding; add the three names to a deny list in `sbom/dependency-allowlist.json`.

### M3 · Hybridize the durable-job engine onto Postgres · effort XL · leverage H · **WWMD**

**Now:** §1.4. Two always-on containers (`inngest`, `redis`) plus `redis-exporter`, a per-step HTTP round trip portal → inngest → portal, the largest production root, and the source of the duplicate TypeScript and `@types/node@22` in the image.
**Move:** an owned `@dpf/jobs` package on Postgres: a `FOR UPDATE SKIP LOCKED` run queue, a step-memo table giving the same `step.run` replay semantics, `LISTEN/NOTIFY` for `waitForEvent`, a cron scheduler folded into the existing `ScheduledJob` substrate (BET-11), and concurrency keys as advisory locks. Keep the `createFunction` / `step.*` facade so the 117 functions migrate mechanically, then retire the three containers and the `INNGEST_*` env surface. Sequence behind BET-11 so the scheduler lands once.
**Research and benchmarking (required before the decision):** compare `pg-boss`, `graphile-worker` and `river` for queue and retry semantics, and Inngest self-hosting for what we lose (its dashboard, replay UI, and step-level observability, which `/ops` already reports from `TaskRun`). Record what DPF adopts and rejects with the reason.
**Effect:** about 380 packages from the production closure, three containers, one HTTP hop per step, `typescript@5.9.3` and `@types/node@22` gone.
**Risk:** the biggest blast radius in this plan (86 files, every background workflow). Mitigation: facade first, dual-run behind a flag with the existing poison-queue and stall detectors as the oracle, one queue domain at a time.
**Decision:** `principle_decide` on `own_postgres_jobs` vs `keep_inngest` vs `rent_pg_boss`, scoring `operational_independence` and `vendor_lock_in` against `long_term_maintainability` and `blast_radius`.

### M4 · Replace Prism in the integration-test harness with an owned contract validator · effort M · leverage M · **WWMD**

**Now:** `@stoplight/prism-http` and `prism-cli` (211 packages, `pino@6`, one `commander`) back a 60-line `prism-contract.ts` that validates vendor fixtures against an OpenAPI document in a 1,360-line service.
**Move:** validate request and response shapes with the OpenAPI document plus `zod` (already a dependency) or a single small OpenAPI validator, and serve fixtures from the harness's own router.
**Effect:** about 210 packages, `pino` collapses from three majors to one.
**Decision:** small, but it is an own-versus-rent call, so record it.

### M5 · Collapse the document cluster in `apps/web` · effort M · leverage M · **WWMD** for the markdown engine

- `@react-pdf/renderer` (67 packages, 45 exclusive) has one call site, `lib/invoice-pdf.tsx`. The platform already runs a browser sidecar and Playwright for UX verification; render the invoice as the same HTML the portal shows and print it to PDF through that path. Effect: −67 packages.
- `react-markdown` + `remark-gfm` (153 packages) have six call sites. Markdown rendering is a sanitization boundary, so this is not a "write our own" candidate under the vendoring bar; the decision is one engine, server-side, behind a single `renderMarkdown()` primitive, and whether the unified pipeline or a single-package renderer is that engine.
- `pdf-parse`, `mammoth`, `read-excel-file`, `papaparse`, `fast-xml-parser` stay (rent), but behind the `parseDocument()` facade BET-14 already names, and `pdf-parse` moves off the eager path if its 56 MB of `pdfjs-dist` + `@napi-rs/canvas` can load lazily.
- `@ricky0123/vad-web` is browser-only; assert it never enters a server chunk (M1 removes its ONNX runtime from the image regardless).

### M6 · Split the mobile app into its own pnpm workspace · effort M · leverage H · **founder decision**

**Now:** `apps/mobile` is active (26 commits since July) and healthy, but it is why the platform lockfile carries about 950 Expo, React Native, Metro and Jest packages, the exact `react` / `react-dom` 19.2.3 override (React Native's embedded renderer), 42 of the 78 overrides (the Jest 30 unification), the only first-party version split (`tailwindcss` 3 vs 4), `lightningcss@1.27` and `commander@12`.
**Move:** give `apps/mobile` its own `pnpm-workspace.yaml` and lockfile, consuming `@dpf/api-client`, `@dpf/types` and `@dpf/validators` as published or packed artifacts (the same boundary an external consumer of the API would use). The platform SBOM, typecheck, unit-test shards and image builds stop seeing the mobile toolchain; the mobile CI keeps its own.
**Effect:** lockfile 2000 → about 1050; overrides 78 → about 30; `react` pin gone; the Tier-1 split gone.
**Cost:** two lockfiles to scan; the routine's scripts take a `--lockfile` argument. Shared-type changes need a publish step, which is a feature, not a bug, for an API boundary.
**Decision:** the founder owns whether mobile stays in the platform monorepo. The recommendation is to split.

### M7 · Toolchain multi-version cleanup · effort S · leverage M · no decision needed

Independent of M2, M3, M4 and M6: floor `@types/node` to `^26` for `@types/net-snmp` and `docx` (or drop `@types/net-snmp` by typing the four call sites), trace and align the `immer` 10/11 pair already accepted in `sbom/singleton-baseline.json`, and run `pnpm dedupe` for the Tier-2 same-major drift (81 candidates in the baseline). Then ratchet `sbom/baseline.json` totals down.

### M8 · Prune the override block with the tool it already has · effort S · leverage M · no decision needed

Run `pnpm audit:stale-overrides` with a `GITHUB_TOKEN` in the `dependency-scan.yml` schedule so the cross-check actually executes, and remove every floor whose parent range now resolves at or above it. The 42 Jest lines go with M6; the 8 diagram pins go with M2; the remaining CVE floors (about 18) are load-bearing until the audit says otherwise.

### M9 · Sweep the retired-substrate residue · effort S · leverage M · no decision needed

Reduce the 97 `neo4j` / `qdrant` mentions to the guard, the deferral note in BI-A1E864A5 and nothing else; convert `check-retired-substrate.mjs` from ratchet to forbid once the count is zero. Backups `engine-specs.ts` and `operate/metrics.ts` are the bulk.

### M10 · Gate the observability fleet by profile · effort S · leverage M · no decision needed (BET-14 already names it)

Prometheus, Grafana, Loki, Alloy, cAdvisor, node-exporter, postgres-exporter and redis-exporter are eight containers in the default compose file. Grafana is already profile-gated; put the rest behind the same profile, and retire `redis-exporter` outright with M3. Consumer installs boot with Postgres and the portal; operators opt in to the fleet.

### M11 · Cut typecheck and build time at the source · effort M · leverage H · no decision needed

Dependency work does not move this number (§1.6). What does:

1. **Separate the test program.** A `tsconfig.test.json` that owns `*.test.ts(x)` and the vitest setup, and a production `tsconfig.json` that excludes them. That removes 37% of the checked lines from the gate that runs on every push; vitest keeps typechecking tests through its own program. Expected: check time 60 s → about 40 s, heap well under the 8 GB ceiling `run-tsc.mjs` has to request today.
2. **Project references for the four heavy domains** (`lib/build`, `lib/actions`, `lib/tak`, `lib/mcp`) so incremental builds skip untouched domains and CI can check them in parallel. This is the structural fix and it pairs with the module-size guard already in place.
3. **CI shape.** The long poles are the UX route sweep (573 s) and the production build (420 s), not tsc (274 s). The route sweep is the next target once M1 lands, because a smaller image is a faster sandbox boot for it.
4. **Measure, then ratchet.** Commit the `--extendedDiagnostics` baseline (`Files`, `Lines of TypeScript`, `Check time`) next to `sbom/baseline.json` and fail a PR that grows checked lines by more than its diff explains.

## 4. Sequencing

| Wave | Moves | Why this order |
|---|---|---|
| **A · packaging and hygiene** (no decisions) | M1, M2, M7, M8, M9, M10, M11 step 1 | Each is one PR, reversible, and lands the measurement baselines the later waves are judged by. M1 alone is most of the image win. |
| **B · decisions** | M6 (founder), M3 and M4 and M5 (`principle_decide`) | Route the four decisions in parallel while Wave A ships; M6 is the biggest lockfile win and needs only a yes. |
| **C · structural** | M3 build-out behind BET-11, M11 steps 2 to 4, M5 build-out | Migration-bearing work sequenced behind its read-model and scheduler substrate. |

## 5. Targets

| Measure | Now | After Wave A | After Waves B and C |
|---|---|---|---|
| Lockfile resolutions | 2000 | about 1620 | about 700 |
| Names at more than one version | 227 | about 200 | under 120 |
| Override entries | 78 | about 65 | under 25 |
| Production closure | 825 | 825 | about 450 |
| Portal image | 4.17 GB | under 2.5 GB | under 2 GB |
| Always-on containers (default profile) | 16 | 8 | 5 |
| `apps/web` typecheck, local | 98 s | about 70 s | under 60 s with references |

## 6. Kernel decisions to route

1. **M3** own a Postgres job engine vs keep Inngest vs rent `pg-boss`. Blast radius large; the precedent decision `DI-957F61CFECEA` and BI-A1E864A5 both point at "prove with a benchmark, then retire".
2. **M4** own the contract validator vs keep Prism.
3. **M5** which markdown engine is the single sanitizing renderer.
4. **M6** is a founder call on repository shape, not a kernel score.

## 7. Ratchets (so it cannot regrow)

- Image size and shipped package-count budget in the publish workflow (M1).
- Deny list in the dependency allowlist for names retired by M2, M3, M4 (the gate already blocks unlisted names; the deny list blocks re-acknowledging them without a decision record).
- `sbom/baseline.json` totals become budgets, ratcheted down per wave, not informational.
- Typecheck line-count and check-time baseline (M11).
- `check-retired-substrate.mjs` flips to forbid (M9).
- Compose default-profile container count asserted by the existing compose-pin guard (M10).

## 8. Backlog coverage

Filed 2026-09-08 under `EP-8DC217EB` (they decompose BI-C0CEB377, BET-14):

| Move | Backlog item | Effort | Priority |
|---|---|---|---|
| M1 production dependency set in the image | BI-C7C6D827 | medium | p1 |
| M2 diagram and docx toolchain out of the workspace | BI-DBDB8C6D | small | p1 |
| M3 durable-job engine onto Postgres (WWMD) | BI-068BBA33 | xlarge | p2 |
| M4 Prism replaced in the harness (WWMD) | BI-BB1D8453 | medium | p3 |
| M5 document cluster collapse (WWMD for markdown) | BI-0AB1FD47 | medium | p3 |
| M6 mobile workspace split (founder) | BI-2FD295F3 | medium | p2 |
| M7 + M8 multi-version cleanup and override prune | BI-5265CAD0 | small | p2 |
| M9 retired-substrate sweep | BI-B1977CEE | small | p2 |
| M10 observability fleet profile gate | BI-A5B2A32F | small | p3 |
| M11 typecheck at the source | BI-0A3B155F | medium | p2 |

## 9. What this plan does not do

- It does not revisit the rent-versus-own default. Nothing here vendors a library; it removes roots whose job the platform already does, and it packages what remains correctly.
- It does not touch the CVE override floors. Those are the fix for the transitive advisories, and M8 prunes only what the audit proves redundant.
- It does not claim compile-time gains from dependency removal. The measurement says the gain is in program shape, and M11 is scoped accordingly.
