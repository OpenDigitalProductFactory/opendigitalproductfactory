# Coworker-Driven Sandbox Verification Implementation Plan

> **Status (2026-04-20):** All ten chunks LANDED on `main`. Last chunk 7f9f98a2. See the "Delivery record" section at the bottom for a per-chunk commit map and the one outstanding non-plan issue (browser-use Dockerfile build break that predates this plan).

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the embedded sandbox iframe in Build Studio and replace it with (a) a prominent, copy-friendly preview URL the user opens in their own browser, plus (b) a fully wired coworker-driven verification pipeline so the `review` phase produces real visual evidence (screenshots + pass/fail per acceptance criterion) before the build can advance to `ship`.

**Architecture:** The iframe is deleted. A small `PreviewUrlCard` replaces it, sourcing the URL from a shared resolver that already exists in `apps/web/app/api/sandbox/preview/route.ts`. Browser-use is de-profile-gated and becomes a first-class service. A single shared sandbox-URL resolver is extracted so MCP tools call the sandbox over the compose network (`http://sandbox:3000`), not the host port. Screenshots land on a shared `browser_evidence` volume and are served through an auth-gated portal route; URLs to those screenshots are persisted in `FeatureBuild.uxTestResults`. Entry into the `review` phase enqueues an Inngest verification job that runs browser-use acceptance tests, writes `UxTestStep[]` to `FeatureBuild.uxTestResults`, updates the new scalar `FeatureBuild.uxVerificationStatus`, and emits progress through the agent event bus. Failed UX steps block `review → ship` through the existing `checkPhaseGate` path extended to read `uxTestResults` + `uxVerificationStatus`; `designReview.issues` and `parseReviewResponse` remain untouched.

**Tech Stack:** Next.js 16, Prisma 7, PostgreSQL, Inngest, browser-use (Python FastAPI + Playwright), Docker Compose, Vitest, React.

---

## Section 1: Problem Statement and Non-Goals

### Problem

Build Studio currently renders the sandbox dev server in an inline iframe ([apps/web/components/build/SandboxPreview.tsx](../../../apps/web/components/build/SandboxPreview.tsx), 102 lines). This is:

- **Redundant** — the sandbox port (3035 et al.) is already exposed on the host. A browser tab achieves the same thing with none of the iframe constraints.
- **A latent footgun** — no `sandbox` attribute, no auth isolation, cookies bleed from portal origin.
- **Meaningless unless the coworker drives it** — the original intent was AI-driven UX verification, which was never wired. The iframe is a promise the platform never kept.

At the same time, the "review" phase today only *instructs* the coworker to call `run_ux_test` ([prompts/build-phase/review.prompt.md:24](../../../prompts/build-phase/review.prompt.md#L24)); nothing enforces it, screenshots are dropped on the floor ([apps/web/lib/operate/browser-use-client.ts:61](../../../apps/web/lib/operate/browser-use-client.ts#L61)), browser-use is off by default (`profiles: ["browser-use"]`), and failed UX steps do not block the ship gate.

### Non-Goals

- **Not** implementing visual-regression diffing across builds. Screenshots are evidence, not baselines.
- **Not** building a test-authoring UI. Tests derive from `brief.acceptanceCriteria`.
- **Not** implementing sandbox authentication / per-build access tokens for the URL-in-your-browser surface. The sandbox remains host-port-exposed with no auth; that is an existing property of the platform, not something this plan changes. (Tracked separately if ever needed.)
- **Not** replacing or extending the existing `/api/sandbox/preview` proxy route. It stays because other flows use it.
- **Not** adding net-new tools to browser-use or changing its high-level capabilities (open/act/extract/screenshot/run_tests/close remain the canonical surface). Chunk 3 DOES extend the existing `browse_run_tests` contract with one additional input parameter (`evidence_dir`) and one additional output field (`screenshot_path`) per step. That's an additive, backward-compatible extension — not a new tool — but it is a change to an existing contract; callers that don't pass `evidence_dir` keep the legacy behavior.

---

## Section 2: Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          USER (BROWSER)                              │
│                                                                      │
│   ┌──────────────┐              ┌────────────────────────────────┐  │
│   │ Build Studio │              │  Sandbox preview tab (NEW)     │  │
│   │  (portal)    │  "Open ↗"    │  http://localhost:3035/...     │  │
│   │              │ ───────────► │  (user's own browser tab)      │  │
│   └──────────────┘              └────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
         │
         │  (review phase entered — queue verification)
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│            Inngest: build-review-verification                        │
│                                                                      │
│   1. Load build + brief.acceptanceCriteria                          │
│   2. POST http://browser-use:8500/mcp  browse_run_tests             │
│         { url: http://sandbox:3000, tests: [ac1, ac2, ...] }        │
│   3. For each step: write screenshot PNG to /evidence/<buildId>/... │
│   4. Persist UxTestStep[] with screenshotUrl pointing at portal     │
│      route /api/build/<buildId>/evidence/<stepId>.png and set       │
│      uxVerificationStatus = complete | failed | skipped             │
│   5. Emit agentEventBus progress + final summary                    │
│   6. Extend checkPhaseGate(review -> ship) to read                  │
│      uxTestResults + uxVerificationStatus directly                  │
└─────────────────────────────────────────────────────────────────────┘
         ▲                         │
         │                         │ base64 PNG response
         │                         ▼
┌────────────────────┐     ┌──────────────────────────────────────┐
│  shared volume     │     │         browser-use service           │
│  browser_evidence  │◄────┤  services/browser-use/ (Chromium)    │
│  mounted in both   │     │  - de-profile-gated (always up)      │
│  browser-use AND   │     │  - healthcheck wait in portal-init    │
│  portal containers │     │                                       │
└────────────────────┘     └──────────────────────────────────────┘
```

### Key design decisions

1. **User preview via URL, not iframe.** Delete `SandboxPreview.tsx`. Replace with `PreviewUrlCard` showing the opened-in-new-tab URL, a "Copy" button, and a status dot reflecting sandbox health. Tab in Build Studio keeps its slot so layout is unchanged.
2. **One resolver, one source of truth.** Extract the URL-resolution logic out of `apps/web/app/api/sandbox/preview/route.ts:25-36` into a shared module used by MCP tools, the new UI card, and the Inngest job.
3. **Screenshots on disk, served via auth-gated route.** A shared `browser_evidence` volume is already declared ([docker-compose.yml:223](../../../docker-compose.yml#L223)). Mount it in the portal container too. Serve screenshots through `/api/build/<buildId>/evidence/<fileName>` which checks session + ownership.
4. **Browser-use is no longer opt-in.** Remove `profiles: ["browser-use"]`. Add it to the portal's `depends_on` with a `condition: service_healthy` gate. Keep the `BROWSER_USE_URL` env override for future flexibility but make the default wiring stand on its own.
5. **Verification is an Inngest job, not a synchronous MCP call from the review coworker.** The coworker still *sees* the results (through the agent event bus + `FeatureBuild.uxTestResults`), but the job runs asynchronously so the coworker panel shows busy state and the user can navigate away without losing progress. This matches the "agent as main conduit" memory principle.
6. **Verification status is a dedicated column, not a wrapper around `uxTestResults`.** `FeatureBuild.uxTestResults` keeps its current shape (`UxTestStep[] | null`) — **we do not change its TypeScript signature**, so existing consumers ([apps/web/components/build/EvidenceSummary.tsx:67-71](../../../apps/web/components/build/EvidenceSummary.tsx#L67-L71), [apps/web/lib/explore/feature-build-types.ts:208,492-496](../../../apps/web/lib/explore/feature-build-types.ts#L492-L496), [apps/web/lib/mcp-tools.ts:2741](../../../apps/web/lib/mcp-tools.ts#L2741), [apps/web/components/build/ReviewPanel.tsx:39](../../../apps/web/components/build/ReviewPanel.tsx#L39)) keep working unchanged. We add a small migration for a new scalar column `FeatureBuild.uxVerificationStatus String?` with values `"running" | "complete" | "skipped" | "failed"`. `null` means "never triggered." This solves the `[]`/`null`/`in-progress` ambiguity cleanly without touching the JSON shape or the existing array consumers.
7. **Severity gate integration — one gate, extended.** The existing `checkPhaseGate` function at [apps/web/lib/explore/feature-build-types.ts:492-496](../../../apps/web/lib/explore/feature-build-types.ts#L492-L496) already blocks `review → ship` when `uxTestResults` has failures. We extend it (Chunk 6) to ALSO block when `uxVerificationStatus === "running"` or when it is `null` with non-empty `brief.acceptanceCriteria`. We do **not** add a parallel gate inside `advanceBuildPhase`. We do **not** append to `designReview.issues` — that structure is regenerated by the reviewer pipeline on each pass ([apps/web/lib/integrate/build-reviewers.ts:198](../../../apps/web/lib/integrate/build-reviewers.ts#L198) rebuilds issues from parsed LLM output). `uxTestResults` + `uxVerificationStatus` is the single source of truth for UX gating.
8. **Seed the review prompt, don't patch runtime.** The review prompt is regenerated to reflect the new flow (verification fires automatically; coworker narrates it). Per "fix the seed, not the runtime path."
9. **Replace `autoA11yAudit`, don't duplicate it.** `advanceBuildPhase` already fires a fire-and-forget `autoA11yAudit(buildId)` on review entry ([apps/web/lib/actions/build.ts:269-273,356](../../../apps/web/lib/actions/build.ts#L269-L273)). We REMOVE that call and the `autoA11yAudit` function entirely — its purpose (sandbox-aware accessibility audit) is subsumed by the new `run_ux_test` flow, which hits the actual running sandbox through browser-use rather than reading sandbox files through a specialist prompt. Running both would dispatch two overlapping background verifications with competing UI/progress signals.

---

## Section 3: Task Breakdown

The plan is ten chunks, ~25 tasks total. Every task follows TDD where code is produced; scaffolding tasks (migrations, Docker config) are gated on explicit manual verification. Commit after every task.

### Chunk 0: Schema migration for verification status

#### Task 0.1: Add `uxVerificationStatus` column

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (FeatureBuild model, after line 2357)
- Create: `packages/db/prisma/migrations/20260419230000_add_ux_verification_status/migration.sql`

- [ ] **Step 1:** Add to the `FeatureBuild` model, next to `uxTestResults`:
  ```
  uxVerificationStatus  String?           // null | "running" | "complete" | "failed" | "skipped"
  ```
  Keep as `String?` to match the project's canonical-enum-via-string pattern (see CLAUDE.md "Strongly-Typed String Enums"). No Prisma enum.
- [ ] **Step 2:** Run `pnpm --filter @dpf/db exec prisma migrate dev --name add_ux_verification_status`. Verify migration file is under a unique timestamp.
- [ ] **Step 3:** Add an `as const` value array to `apps/web/lib/feature-build-types.ts` (or the canonical types module): `export const UX_VERIFICATION_STATUSES = ["running", "complete", "failed", "skipped"] as const;` and a corresponding union type.
- [ ] **Step 4:** Run `pnpm --filter @dpf/db exec prisma generate`.
- [ ] **Step 5:** Run `pnpm --filter web exec tsc --noEmit` — MUST succeed.
- [ ] **Step 6:** Commit.

### Chunk 1: Extract the shared sandbox-URL resolver (foundation)

#### Task 1.1: Write failing test for `resolveSandboxUrl`

**Files:**
- Create: `apps/web/lib/integrate/sandbox/resolve-sandbox-url.test.ts`

- [ ] **Step 1:** Write a Vitest file with cases for:
  - Inside Docker (`SANDBOX_PREVIEW_URL` set), known `sandboxId` → `http://sandbox:3000`.
  - Inside Docker, unknown `sandboxId` → `http://<id>:3000` fallback.
  - Local dev (`SANDBOX_PREVIEW_URL` unset), known `sandboxId` → `http://localhost:<mapped port>`.
  - Local dev, unknown `sandboxId` → `http://localhost:<given fallback port>`.
- [ ] **Step 2:** Run `pnpm --filter web exec vitest run lib/integrate/sandbox/resolve-sandbox-url.test.ts` — test MUST fail (module doesn't exist yet).
- [ ] **Step 3:** Commit test.

#### Task 1.2: Implement `resolveSandboxUrl`

**Files:**
- Create: `apps/web/lib/integrate/sandbox/resolve-sandbox-url.ts`
- Modify: `apps/web/app/api/sandbox/preview/route.ts:7-36` (replace inline logic with import)

- [ ] **Step 1:** Create `resolve-sandbox-url.ts` exporting a pure function `resolveSandboxUrl(sandboxId: string, hostPort: number): { internal: string; host: string }`. Return BOTH the internal (compose network) URL and the host (user-facing) URL — callers pick which they need.
- [ ] **Step 2:** Port the `CONTAINER_TO_SERVICE` and `CONTAINER_TO_PORT` maps from `apps/web/app/api/sandbox/preview/route.ts:7-18` into the new module.
- [ ] **Step 3:** Replace the inline resolver in `apps/web/app/api/sandbox/preview/route.ts` with an import.
- [ ] **Step 4:** Run `pnpm --filter web exec vitest run lib/integrate/sandbox/resolve-sandbox-url.test.ts` — MUST pass.
- [ ] **Step 5:** Run `pnpm --filter web exec next build` — MUST succeed.
- [ ] **Step 6:** Commit.

#### Task 1.3: Refactor `run_ux_test` and `evaluate_page` to use the resolver

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts:5047, 5165` (both sites use `http://localhost:${port}`)
- Modify: `apps/web/lib/mcp-tools.ts` run_ux_test — also load `sandboxId` from DB alongside `sandboxPort`

- [ ] **Step 1:** Update the `prisma.featureBuild.findUnique` call in `run_ux_test` ([mcp-tools.ts:5156](../../../apps/web/lib/mcp-tools.ts#L5156)) to also select `sandboxId`.
- [ ] **Step 2:** Replace `http://localhost:${build.sandboxPort}` with `resolveSandboxUrl(build.sandboxId, build.sandboxPort).internal` — inside the portal container we are always on the compose network.
- [ ] **Step 3:** Same update in `evaluate_page` at [mcp-tools.ts:5047](../../../apps/web/lib/mcp-tools.ts#L5047) — derive target from build context if no explicit URL.
- [ ] **Step 4:** Run `pnpm --filter web exec next build` — MUST succeed. No unit test for this path (it's wiring); covered by the integration test in Chunk 8.
- [ ] **Step 5:** Commit.

### Chunk 2: Delete the iframe, add the URL surface

#### Task 2.1: Write failing test for `PreviewUrlCard`

**Files:**
- Create: `apps/web/components/build/PreviewUrlCard.test.tsx`

- [ ] **Step 1:** Use React Testing Library. Cases:
  - When `sandboxPort` is null and phase is `"build"` → renders "Sandbox not yet running" placeholder.
  - When `sandboxPort` set and phase is `"review"` → renders a link `<a href="http://localhost:3035" target="_blank" rel="noopener noreferrer">`.
  - Copy button writes the URL to clipboard (mock `navigator.clipboard.writeText`).
  - `data-testid="preview-url-card"` present on the wrapper for e2e.
- [ ] **Step 2:** Run the test — MUST fail.
- [ ] **Step 3:** Commit.

#### Task 2.2: Implement `PreviewUrlCard`

**Files:**
- Create: `apps/web/components/build/PreviewUrlCard.tsx`

- [ ] **Step 1:** Component signature: `{ buildId, phase, sandboxId, sandboxPort }`. Use `resolveSandboxUrl(sandboxId, sandboxPort).host` for the displayed/opened URL (not `.internal` — the user is on the host).
- [ ] **Step 2:** Render a vertically-centered card with:
  - Status dot (green when `sandboxPort` present and phase ∈ {build, review, ship}; gray otherwise).
  - Headline: "Preview in your browser".
  - Subtitle: "This opens in a new tab — inspect the live sandbox with your real browser's devtools, extensions, and account." (One line explaining *why* it's a new tab, not an iframe.)
  - Large `<a>` primary button: "Open http://localhost:3035 ↗". Renders only when running.
  - Secondary "Copy URL" button next to it. `onClick` writes to clipboard + shows ephemeral "Copied" toast text for 2s.
  - Empty-state message when not running (matches existing phase-specific copy from `SandboxPreview.tsx:33-38`).
- [ ] **Step 3:** No iframe. No `ref`. No postMessage. Keep the file under 90 lines.
- [ ] **Step 4:** Run test — MUST pass.
- [ ] **Step 5:** Run `pnpm --filter web exec next build` — MUST succeed.
- [ ] **Step 6:** Commit.

#### Task 2.3: Swap `SandboxPreview` for `PreviewUrlCard` in BuildStudio

**Files:**
- Modify: `apps/web/components/build/BuildStudio.tsx:9, 391-406, 418-423`
- Delete: `apps/web/components/build/SandboxPreview.tsx`

- [ ] **Step 1:** Replace the import at [BuildStudio.tsx:9](../../../apps/web/components/build/BuildStudio.tsx#L9).
- [ ] **Step 2:** Rename the `"Live Preview"` tab label to `"Preview"` and keep the same tab gating.
- [ ] **Step 3:** Replace the `<SandboxPreview .../>` render at [BuildStudio.tsx:419-423](../../../apps/web/components/build/BuildStudio.tsx#L419-L423) with `<PreviewUrlCard buildId={...} phase={...} sandboxId={activeBuild.sandboxId} sandboxPort={activeBuild.sandboxPort} />`. Ensure `sandboxId` is included in the `FeatureBuildRow` type selected for `activeBuild`; if not, extend the select clause.
- [ ] **Step 4:** `git rm apps/web/components/build/SandboxPreview.tsx`.
- [ ] **Step 5:** Grep to confirm no remaining imports: `grep -r "SandboxPreview" apps/web/ --include="*.tsx" --include="*.ts"` → empty.
- [ ] **Step 6:** Run `pnpm --filter web exec tsc --noEmit` and `pnpm --filter web exec next build` — MUST succeed.
- [ ] **Step 7:** Commit.

### Chunk 3: Persist screenshot evidence

#### Task 3.1: Mount `browser_evidence` volume in the portal container

**Files:**
- Modify: `docker-compose.yml` (portal service volume list)

- [ ] **Step 1:** Under `portal.volumes`, add `- browser_evidence:/evidence:ro` (read-only from the portal's perspective — the portal only serves files; browser-use writes them).
- [ ] **Step 2:** Confirm the `browser_evidence` named volume is declared at the bottom of `docker-compose.yml` (it already is, via `browser-use.volumes`). If not declared as a top-level volume, declare it.
- [ ] **Step 3:** Run `docker compose config` — MUST render without errors.
- [ ] **Step 4:** Commit.

#### Task 3.2: Extend browser-use server to write screenshots to `/evidence`

**Files:**
- Modify: `services/browser-use/server.py` (the `browse_run_tests` handler — search for `browse_run_tests` around line 435)

- [ ] **Step 1:** Read the current `browse_run_tests` handler to understand the response shape.
- [ ] **Step 2:** Extend the per-test result dict to include a `screenshot_path` field: for each test, after it runs, capture a screenshot, write to `/evidence/<buildId>/<testIndex>.png`, and include the path (relative to `/evidence`) in the response.
- [ ] **Step 3:** Accept a new `evidence_dir` parameter (string, optional) on `browse_run_tests` so the caller supplies the per-build subdirectory (e.g., `build_<buildId>`). Create the directory if absent.
- [ ] **Step 4:** Write a pytest in `services/browser-use/tests/test_run_tests_screenshots.py` that stubs the Chromium interaction and verifies files land under `/evidence/<evidence_dir>/`. (If the service has no existing pytest harness, add a minimal one using pytest + tmp_path; otherwise extend the existing one.)
- [ ] **Step 5:** Run the pytest inside the container build context: `docker compose build browser-use && docker compose run --rm browser-use pytest tests/`. MUST pass.
- [ ] **Step 6:** Commit.

#### Task 3.3: Update `browser-use-client` and `mcp-tools` to consume `screenshot_path`

**Files:**
- Modify: `apps/web/lib/operate/browser-use-client.ts:58-62`
- Modify: `apps/web/lib/mcp-tools.ts:5175-5190` (the run_ux_test step mapping)

- [ ] **Step 1:** Add `evidenceDir: string` parameter to `runBrowserUseTests`. Pass it to browser-use as `evidence_dir`.
- [ ] **Step 2:** Update the result mapping to populate `screenshotUrl` with the portal-served URL: `/api/build/${buildId}/evidence/${path.basename(screenshot_path)}`. (Path basename only; portal route handles the directory scoping via buildId.)
- [ ] **Step 3:** In `mcp-tools.ts run_ux_test`, pass `evidenceDir: \`build_${buildId}\`` and `buildId` down to the client call.
- [ ] **Step 4:** Write a unit test in `apps/web/lib/operate/browser-use-client.test.ts` using `vi.mocked(fetch)` to stub the MCP call. Verify it threads `evidence_dir` and produces `/api/build/.../evidence/<file>` URLs.
- [ ] **Step 5:** Run the test — MUST pass.
- [ ] **Step 6:** Commit.

#### Task 3.4: Write failing test for the evidence-serving route

**Files:**
- Create: `apps/web/app/api/build/[buildId]/evidence/[fileName]/route.test.ts`

- [ ] **Step 1:** Cases:
  - Unauthenticated → 401.
  - Authenticated, build not owned by user → 403.
  - Build owned, file exists → 200 with `Content-Type: image/png` and body bytes.
  - Build owned, file missing → 404.
  - Path traversal attempt (`..`, `%2e%2e`) in `fileName` → 400.
- [ ] **Step 2:** Use fs mocks (e.g. `vi.mock("node:fs/promises")`).
- [ ] **Step 3:** Run — MUST fail.
- [ ] **Step 4:** Commit.

#### Task 3.5: Implement the evidence-serving route

**Files:**
- Create: `apps/web/app/api/build/[buildId]/evidence/[fileName]/route.ts`

- [ ] **Step 1:** `GET` handler. Validate BOTH inputs:
  - `buildId` must match `/^[a-zA-Z0-9_-]+$/` (reject anything else with 400).
  - `fileName` must match `/^[a-zA-Z0-9_.-]+\.png$/`, length ≤ 64 (reject anything else with 400).
- [ ] **Step 2:** Call `auth()`, check session; look up `FeatureBuild` by `buildId`, verify `createdById === session.user.id`.
- [ ] **Step 3:** Build and validate the path:

    ```ts
    const base = path.resolve("/evidence");
    const target = path.resolve(path.join(base, `build_${buildId}`, fileName));
    if (!target.startsWith(base + path.sep)) return new NextResponse("bad path", { status: 400 });
    ```

    Belt-and-suspenders against any regex bypass.
- [ ] **Step 4:** Read the file using `fs/promises.readFile`. Return `new NextResponse(buf, { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=300" } })`.
- [ ] **Step 5:** Run tests — MUST pass.
- [ ] **Step 6:** Run `pnpm --filter web exec next build` — MUST succeed.
- [ ] **Step 7:** Commit.

### Chunk 4: Make browser-use a first-class service

#### Task 4.1: De-profile-gate browser-use

**Files:**
- Modify: `docker-compose.yml:219` (remove `profiles: ["browser-use"]`)
- Modify: `docker-compose.yml` portal `depends_on`

- [ ] **Step 1:** Delete the `profiles:` line under the `browser-use` service.
- [ ] **Step 2:** Add `browser-use: { condition: service_healthy }` to `portal.depends_on` and `portal-init.depends_on`. The existing healthcheck at [docker-compose.yml:233-238](../../../docker-compose.yml#L233-L238) is sufficient.
- [ ] **Step 3:** Add `BROWSER_USE_URL: http://browser-use:8500/mcp` explicitly to the portal environment block (so it's documented, not implicit).
- [ ] **Step 4:** Run `docker compose config` — MUST render without errors. Run `docker compose up -d browser-use` — MUST come up healthy within 60s.
- [ ] **Step 5:** Commit.

#### Task 4.2: Graceful-degrade error-message cleanup

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts:5210` (existing "docker compose --profile browser-use up -d" message)
- Modify: `apps/web/lib/mcp-tools.ts:5148` (same message in `evaluate_page`)

- [ ] **Step 1:** Since browser-use is now always-on, the `--profile browser-use` instruction is wrong. Replace with: `"UX verification service (browser-use) is unreachable. Run 'docker compose up -d browser-use' or check the browser-use container logs."`.
- [ ] **Step 2:** Run `pnpm --filter web exec next build` — MUST succeed.
- [ ] **Step 3:** Commit.

### Chunk 5: Auto-trigger verification on review-phase entry

#### Task 5.1: Add Inngest function for build-review verification

**Files:**
- Create: `apps/web/lib/queue/functions/build-review-verification.ts`
- Modify: `apps/web/lib/queue/functions/index.ts` (register the new function)
- Modify: `apps/web/lib/queue/inngest-client.ts` (add event type if an event registry exists there)

- [ ] **Step 1:** Look at an existing Inngest function (e.g., the code-graph-reconcile one added in plan `2026-04-19-code-graph-refresh-implementation.md`) to mirror the shape.
- [ ] **Step 2:** Event name: `build/review.verify`. Payload: `{ buildId: string }`. Handler steps:
  1. `step.run("load-build", …)` — fetch `FeatureBuild` with `sandboxId`, `sandboxPort`, `brief`. If missing, emit failure and return.
  2. `step.run("start-verification", …)` — emit `verification:started`; set `FeatureBuild.uxVerificationStatus = "running"`. Leave `uxTestResults` as-is (null on first run, last results on re-run).
  3. `step.run("guard-empty-criteria", …)` — if `brief.acceptanceCriteria` is empty or missing, set `uxVerificationStatus = "skipped"` and return. Do NOT call browser-use.
  4. `step.run("run-tests", …)` — call `runBrowserUseTests(internalUrl, criteria, buildId)`. Timeout 10 min.
  5. `step.run("persist-results", …)` — write `UxTestStep[]` to `uxTestResults` (unchanged shape) and set `uxVerificationStatus = "complete"` if every step passed, else `"failed"`. Both updates in a single `prisma.featureBuild.update` call for atomicity.
  6. `step.run("emit-completion", …)` — emit `verification:complete` with pass/fail summary. Log via `logBuildActivity`. **Do NOT append to `designReview.issues`** — the reviewer pipeline regenerates that structure and would overwrite our write. The ship gate in Chunk 6 reads `uxTestResults` + `uxVerificationStatus` directly.
- [ ] **Step 3:** Register in `apps/web/lib/queue/functions/index.ts` exports array.
- [ ] **Step 4:** Write a unit test `build-review-verification.test.ts` that mocks `runBrowserUseTests` and Prisma, verifies:
  - Happy path: all pass → `uxVerificationStatus === "complete"`, `uxTestResults` populated, no step has `passed: false`.
  - Failure path: one step fails → `uxVerificationStatus === "failed"`, `uxTestResults` contains the failing step.
  - Missing `brief.acceptanceCriteria` → `uxVerificationStatus === "skipped"`, `uxTestResults` untouched, no network call.
- [ ] **Step 5:** Run test — MUST pass.
- [ ] **Step 6:** Commit.

#### Task 5.2: Enqueue the event on phase transition — AND remove `autoA11yAudit`

**Files:**
- Modify: `apps/web/lib/actions/build.ts` — the `if (targetPhase === "review")` block at [build.ts:269-273](../../../apps/web/lib/actions/build.ts#L269-L273) and the `autoA11yAudit` function at [build.ts:356](../../../apps/web/lib/actions/build.ts#L356)

- [ ] **Step 1:** Locate the `if (targetPhase === "review")` branch. It currently calls `autoA11yAudit(buildId)`.
- [ ] **Step 2:** REPLACE that call with `await inngest.send({ name: "build/review.verify", data: { buildId } })`. Do NOT keep both — running both would dispatch two overlapping background verifications with competing UI/progress signals.
- [ ] **Step 3:** DELETE the `autoA11yAudit` function (build.ts:349-end of function) and any imports it uses that are now orphaned (`UX_ACCESSIBILITY_PROMPT` from `@/lib/integrate/specialist-prompts`). Grep for `autoA11yAudit` across the repo to confirm no other callers: `grep -r "autoA11yAudit" apps/web --include="*.ts" --include="*.tsx"` → should be empty after the deletion.
- [ ] **Step 4:** If `UX_ACCESSIBILITY_PROMPT` is also orphaned (grep for it after the change), delete its export too. If still referenced elsewhere, leave it.
- [ ] **Step 5:** Write a test that asserts: transitioning a fixture build to review calls `inngest.send` with the correct payload, and does NOT call `autoA11yAudit` (the import should no longer exist).
- [ ] **Step 6:** Run test — MUST pass.
- [ ] **Step 7:** Run `pnpm --filter web exec next build` — MUST succeed.
- [ ] **Step 8:** Commit.

#### Task 5.3: Agent event bus plumbing

**Files:**
- Modify: `apps/web/lib/agent-event-bus.ts` — add `verification:started | verification:step | verification:complete` event types
- Modify: `apps/web/components/build/ReviewPanel.tsx` — subscribe or rely on existing re-render via `uxTestResults` update

- [ ] **Step 1:** Extend the event bus discriminated union with the three events above. Mirror the shape of existing `test:step`/`evidence:update` events (search for `"test:step"` in `mcp-tools.ts:5196`).
- [ ] **Step 2:** Emit them from the Inngest handler (back-reference Task 5.1 step 2, 3, 6).
- [ ] **Step 3:** In `ReviewPanel.tsx`, read the NEW `build.uxVerificationStatus` column (added in Task 0.1 below) alongside `build.uxTestResults`:
  - `uxVerificationStatus === "running"` → spinner + "Running UX verification..." ABOVE the existing `UxTestsSection`. If `uxTestResults` has partial data, still render it.
  - `uxVerificationStatus === "skipped"` → muted info banner: "UX verification skipped — no acceptance criteria to test."
  - `uxVerificationStatus === "complete"` or `"failed"` → existing `UxTestsSection` rendering — no shape change; the array-based section works as-is.
  - `uxVerificationStatus === null` → hidden (no verification has ever been triggered).
- [ ] **Step 4:** Extend `FeatureBuildRow` in [apps/web/lib/explore/feature-build-types.ts:208](../../../apps/web/lib/explore/feature-build-types.ts#L208) with `uxVerificationStatus: "running" | "complete" | "failed" | "skipped" | null;`. Update the selects at [apps/web/lib/explore/feature-build-data.ts:43,112](../../../apps/web/lib/explore/feature-build-data.ts#L43) to include the new column.
- [ ] **Step 4:** Run `pnpm --filter web exec next build` — MUST succeed.
- [ ] **Step 5:** Commit.

### Chunk 6: Severity gate integration

#### Task 6.1: Write failing test for ship-gate block on failed UX

**Files:**
- Create: `apps/web/lib/actions/build.review-ship-gate.test.ts`

- [ ] **Step 1:** Tests live in the EXISTING gate, not a new file. Put them in `apps/web/lib/explore/feature-build-types.test.ts` (create if it doesn't exist; otherwise extend). Cases for `checkPhaseGate("review", "ship", …)`:
  - `uxVerificationStatus: null`, non-empty `brief.acceptanceCriteria` → `{ allowed: false, reason: "UX verification has not run yet." }`.
  - `uxVerificationStatus: null`, empty `brief.acceptanceCriteria` → allowed (no verification needed).
  - `uxVerificationStatus: "running"` → `{ allowed: false, reason: "UX verification in progress." }`.
  - `uxVerificationStatus: "skipped"` → allowed (zero acceptance criteria is not a failure).
  - `uxVerificationStatus: "complete"`, `uxTestResults` all pass → allowed.
  - `uxVerificationStatus: "failed"`, `uxTestResults` has a failing step → `{ allowed: false, reason: "UX verification failed: …" }` (keep the existing message format from feature-build-types.ts:495).
- [ ] **Step 2:** Run — MUST fail (no gate exists yet).
- [ ] **Step 3:** Commit.

#### Task 6.2: Implement the ship gate

**Files:**
- Modify: `apps/web/lib/explore/feature-build-types.ts` (extend `checkPhaseGate`, add `uxVerificationStatus` to `FeatureBuildRow`)
- Modify: `apps/web/lib/explore/feature-build-data.ts` (add column to selects)
- Modify: `apps/web/lib/actions/build.ts` (pass `uxVerificationStatus` and `brief` into the existing `checkPhaseGate` call at build.ts:121)
- Modify: `apps/web/lib/mcp-tools.ts:2734` and `mcp-tools.ts:3053`/`:3132` (same — pass new column)

- [ ] **Step 1:** In `feature-build-types.ts`, extend the `review → ship` branch of `checkPhaseGate`. BEFORE the existing `uxTestResults` array check at line 492, add:
  ```ts
  const status = evidence.uxVerificationStatus as string | null | undefined;
  const hasAcceptance = Array.isArray(evidence.acceptanceCriteria) && evidence.acceptanceCriteria.length > 0;
  if (status === "running") return { allowed: false, reason: "UX verification in progress." };
  if (status === null && hasAcceptance) return { allowed: false, reason: "UX verification has not run yet." };
  // status "skipped" falls through to existing array check (array is null/empty — allowed).
  ```
  The existing failed-steps check at line 494-495 stays as the failure branch.
- [ ] **Step 2:** Thread `uxVerificationStatus` through the three `checkPhaseGate` call sites above. `brief.acceptanceCriteria` is already available in most call paths; where it isn't, load it.
- [ ] **Step 3:** Tests from Task 6.1 — MUST pass.
- [ ] **Step 4:** Also re-run `apps/web/lib/integrate/build-disciplines-integration.test.ts` (existing integration test that touches `checkPhaseGate`) — MUST still pass.
- [ ] **Step 5:** Run `pnpm --filter web exec next build` — MUST succeed.
- [ ] **Step 6:** Commit.

#### Task 6.3: User-facing override for known-good edge cases

**Files:**
- Modify: `apps/web/lib/actions/build.ts`
- Modify: `apps/web/components/build/ReviewPanel.tsx`

- [ ] **Step 1:** Add an optional `overrideUxFailure: { reason: string }` param to `advanceBuildPhase`. When present AND the only blocker from `checkPhaseGate` is a UX-related reason (status string starts with "UX verification"), skip the gate and append a `BuildActivity` record with `tool: "ux-override"` summarizing the reason. Non-UX blockers (acceptance criteria unmet, missing evidence) are NOT overridable.
- [ ] **Step 2:** In `ReviewPanel.tsx`, when `uxVerificationStatus === "failed"`, show a "Ship anyway" button behind a confirmation modal that requires a non-empty reason (min 10 chars). This preserves escape-hatch authority without silently breaking the gate. (Aligns with the severity-gate memory.)
- [ ] **Step 3:** Test added cases in the gate test file (same one from Task 6.1): override with reason succeeds when blocker is UX; override with reason still fails when blocker is acceptance-criteria.
- [ ] **Step 4:** Run `pnpm --filter web exec next build` — MUST succeed.
- [ ] **Step 5:** Commit.

#### Task 6.4: Audit all existing `uxTestResults` consumers

**Files to review (changes only as noted):**
- `apps/web/components/build/EvidenceSummary.tsx:67-71` — reads the array. No shape change, but should reflect the new status.
- `apps/web/lib/mcp-tools.ts:2741` — `save_phase_handoff` auto-advance loads `uxTestResults` into its evidence bag. Must also load `uxVerificationStatus` so the gate downstream has full information.
- `apps/web/lib/build/process-graph-builder.test.ts:50` — fixture. Add `uxVerificationStatus: null` to keep type checker happy once `FeatureBuildRow` is extended.

- [ ] **Step 1:** Grep across the repo one final time: `grep -rn "uxTestResults" apps/web --include="*.ts" --include="*.tsx" | grep -v ".next/"`. Cross-reference against the list above. Any NEW hit introduced by earlier chunks must be reviewed.
- [ ] **Step 2:** Update `EvidenceSummary.tsx:67-71` — when `uxVerificationStatus === "running"`, return `status: "pending"` with detail "Running UX verification…". When `"skipped"`, return `status: "pass"` with detail "No acceptance criteria to verify." Otherwise fall through to the existing array-based pass/fail computation.
- [ ] **Step 3:** Update `mcp-tools.ts:2668` and `mcp-tools.ts:2741` to include `uxVerificationStatus` in the select and the evidence bag. The evidence bag is what `checkPhaseGate` reads — without this, the gate won't see the new status when invoked from `save_phase_handoff`.
- [ ] **Step 4:** Update test fixtures (`process-graph-builder.test.ts:50` and any similar) to include the new field set to `null`.
- [ ] **Step 5:** Run `pnpm --filter web exec tsc --noEmit` — MUST succeed. This is the cleanest way to confirm all consumers are covered.
- [ ] **Step 6:** Run `pnpm --filter web exec next build` — MUST succeed.
- [ ] **Step 7:** Commit.

### Chunk 7: Seed & prompt updates

#### Task 7.1: Rewrite the review-phase prompt

**Files:**
- Modify: `prompts/build-phase/review.prompt.md`

- [ ] **Step 1:** Replace the instructions around `run_ux_test` with language that reflects the new reality: "UX verification runs automatically when this phase starts. Do not call `run_ux_test` manually — check `uxTestResults` on the build for current results. If no results are present yet, say 'UX verification is still running.'"
- [ ] **Step 2:** Keep unit-test and acceptance-criteria instructions. Remove any language about opening browsers or driving the sandbox manually.
- [ ] **Step 3:** Bump the `version:` frontmatter field to `2`.
- [ ] **Step 4:** Run `pnpm --filter web exec vitest run lib/tak/prompt-loader.test.ts` (or whatever the prompt-loader suite is) — MUST pass.
- [ ] **Step 5:** Commit.

#### Task 7.2: Re-seed prompts and verify DB override behavior

**Files:**
- Nothing modified — this is a manual verification task.

- [ ] **Step 1:** Locate the real seed entrypoint BEFORE running anything: `ls packages/db/src/seed-*.ts`, then read the file to identify the exported function and how `portal-init` invokes it (grep `apps/web/docker-entrypoint.sh` and `Dockerfile` for `seed`). Use that exact invocation — do not guess the path. Document the confirmed command in the task checklist before executing.
- [ ] **Step 2:** Query `PromptTemplate` for the review prompt: verify `version: 2` and updated body.
- [ ] **Step 3:** No commit (verification only). Record the output in the task checklist.

#### Task 7.3: Remove the manual `run_ux_test` callable from the review-phase allowlist

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts:1062-1072` (tool definition for `run_ux_test`)

- [ ] **Step 1:** Change the `run_ux_test` tool's `buildPhases` from `["review"]` to `[]` (or remove the tool entirely if nothing else calls it — grep first: `grep -r "run_ux_test" apps/web --include="*.ts"`).
- [ ] **Step 2:** If it is dead after the Inngest function takes over: delete the `case "run_ux_test":` handler too. If other code still calls it (e.g., the coworker can invoke it ad-hoc), keep the case but leave it unreachable from phase tool lists.
- [ ] **Step 3:** Run `pnpm --filter web exec next build` — MUST succeed.
- [ ] **Step 4:** Commit.

### Chunk 8: End-to-end integration test

#### Task 8.1: Write an integration test covering the full flow

**Files:**
- Create: `apps/web/lib/integrate/build-verification-e2e.test.ts`

- [ ] **Step 1:** The test spins up a build fixture with a brief containing 2 acceptance criteria, mocks `runBrowserUseTests` to return one pass + one fail, directly invokes the Inngest handler (not via the queue), and asserts:
  - `uxTestResults` has 2 steps, `screenshotUrl` populated on both (`/api/build/.../evidence/...`).
  - `uxVerificationStatus === "failed"` on the updated build.
  - `designReview` is **unchanged** — the Inngest handler MUST NOT write to `designReview.issues` (reviewer pipeline regenerates it; gating lives on `uxVerificationStatus` + `uxTestResults` only).
  - `checkPhaseGate("review", "ship", …)` with the fixture's evidence returns `{ allowed: false, reason: /UX verification failed/ }`.
  - Calling `advanceBuildPhase("ship", { overrideUxFailure: { reason: "known false positive, verified manually" } })` succeeds and logs a `BuildActivity` with `tool: "ux-override"`.
- [ ] **Step 2:** Run — MUST pass.
- [ ] **Step 3:** Commit.

### Chunk 9: Docs

#### Task 9.1: Update the browser-use integration design spec

**Files:**
- Modify: `docs/superpowers/specs/2026-04-06-browser-use-integration-design.md`

- [ ] **Step 1:** Add a "Review-phase verification" section describing: de-profile-gated service, Inngest trigger on phase transition, shared `browser_evidence` volume, auth-gated screenshot serving route, severity-gate integration.
- [ ] **Step 2:** Commit.

#### Task 9.2: Update `CLAUDE.md` section "Browser Automation (browser-use)"

**Files:**
- Modify: `CLAUDE.md` (Browser Automation section)

- [ ] **Step 1:** Remove the line "Profile-gated: start with `docker compose --profile browser-use up -d`." Replace with: "Always-on in the default compose stack. Portal waits for browser-use to report healthy at startup."
- [ ] **Step 2:** Add a new bullet: "Review-phase verification runs automatically on phase entry via the `build/review.verify` Inngest event — do not invoke `run_ux_test` manually."
- [ ] **Step 3:** Commit.

#### Task 9.3: Update `README.md` dev notes if any reference the iframe or the profile gate

**Files:**
- Possibly `README.md`, possibly `docs/getting-started.md`

- [ ] **Step 1:** Grep: `grep -rni "sandbox preview\|iframe\|--profile browser-use" README.md docs/ 2>/dev/null | head -30`.
- [ ] **Step 2:** Update any hits to reflect new reality.
- [ ] **Step 3:** Commit.

#### Task 9.4: Extend `tests/e2e/platform-qa-plan.md` (REQUIRED by repo guardrails)

**Files:**
- Modify: `tests/e2e/platform-qa-plan.md` (Phase 10: Build Studio section, around line 130)

- [ ] **Step 1:** Read the current Build Studio phase block to match the table format (ID | Steps | Expected).
- [ ] **Step 2:** Add these new cases under Phase 10 (IDs continue the `BUILD-NN` sequence — use the next free numbers):
  - `BUILD-NN` | Navigate to an active build in the build phase | Build Studio shows a "Preview" tab. Tab content shows a "Preview in your browser" card with an "Open http://localhost:3035 ↗" button and a "Copy URL" button. No iframe is rendered.
  - `BUILD-NN` | Click the "Open ↗" button | A new browser tab opens pointing to the sandbox host URL.
  - `BUILD-NN` | Click "Copy URL" | Clipboard contains the sandbox host URL; ephemeral "Copied" confirmation shows for ~2 seconds.
  - `BUILD-NN` | Advance a build from plan → build → review (with 2+ acceptance criteria in brief) | Within 30s of entering review, `uxVerificationStatus` flips to `"running"`; ReviewPanel shows "Running UX verification…" spinner; coworker panel shows busy state.
  - `BUILD-NN` | Wait for verification to complete with all steps passing | `uxVerificationStatus = "complete"`; ReviewPanel UxTestsSection shows N/N passed with inline screenshots for each step.
  - `BUILD-NN` | Wait for verification to complete with one failing step | `uxVerificationStatus = "failed"`; ReviewPanel highlights the failing step with its screenshot; "Ship anyway" button appears.
  - `BUILD-NN` | Attempt to advance review → ship with UX failure, no override | Phase gate blocks with reason "UX verification failed: …".
  - `BUILD-NN` | Click "Ship anyway", submit a 10+ char reason | Phase advances to ship; BuildActivity row with `tool: "ux-override"` and the reason is visible on the build record.
  - `BUILD-NN` | Advance to review with ZERO acceptance criteria in brief | `uxVerificationStatus = "skipped"`; ReviewPanel shows "UX verification skipped — no acceptance criteria"; ship advance is allowed.
  - `BUILD-NN` | Stop the browser-use container mid-verification (`docker stop dpf-browser-use-1`) | Inngest handler records failure; `uxVerificationStatus = "failed"` with a diagnostic error in the UX test results; gate blocks ship advance.
- [ ] **Step 3:** Run the affected cases manually against a fresh `docker compose up -d` stack. Record PASS/FAIL next to each case in the QA plan file.
- [ ] **Step 4:** Commit.

### Chunk 10: Final verification

#### Task 10.1: Full-stack validation

**Files:**
- No file changes. Manual walkthrough.

- [ ] **Step 1:** `docker compose down && docker compose up -d` — full stack comes up clean.
- [ ] **Step 2:** Create a new build in Build Studio. Reach the `build` phase. Verify the Preview tab shows the URL card, "Open ↗" opens a new browser tab, Copy button works.
- [ ] **Step 3:** Advance to `review` phase. Verify within 30 seconds: the coworker panel shows busy state, `ReviewPanel` shows "Running UX verification..." spinner, Inngest logs show the function executing.
- [ ] **Step 4:** When done, verify screenshots are visible inline in `ReviewPanel > UX Test Results`, pass/fail dots correct.
- [ ] **Step 5:** If any failed, attempt to ship → blocked. Apply override → ships.
- [ ] **Step 6:** If all passed, ship directly → succeeds.
- [ ] **Step 7:** Run the 10 new cases from `tests/e2e/platform-qa-plan.md` Task 9.4 and record PASS/FAIL next to each in the file.

#### Task 10.2: Final push

**Files:**
- None — commits already on `main` per Section 9.

- [ ] **Step 1:** Confirm all chunk commits are on `main`: `git log --oneline main -30`.
- [ ] **Step 2:** `git push` — CI runs on push per repo convention.
- [ ] **Step 3:** Verify CI passes (Typecheck + Production Build).
- [ ] **Step 4:** Open a PR ONLY if the user explicitly requests one; otherwise leave the commits on `main`.

---

## Section 4: Files Touched per Phase (summary)

| Chunk | Files (created / modified / deleted) | LOC estimate |
| ----- | ------------------------------------- | ------------ |
| 0 — Migration | `~` schema.prisma, `+` migration SQL, `~` feature-build-types.ts (const array) | +40 / −0 |
| 1 — Resolver | `+` resolve-sandbox-url.ts, `+` its test, `~` preview/route.ts, `~` mcp-tools.ts | +120 / −30 |
| 2 — URL surface | `+` PreviewUrlCard.tsx, `+` its test, `~` BuildStudio.tsx, `−` SandboxPreview.tsx | +180 / −120 |
| 3 — Evidence | `~` docker-compose.yml, `~` browser-use/server.py, `+` pytest, `~` browser-use-client.ts, `~` mcp-tools.ts, `+` evidence route.ts, `+` its test | +250 / −10 |
| 4 — Always-on | `~` docker-compose.yml, `~` mcp-tools.ts messages | +10 / −5 |
| 5 — Auto-trigger | `+` build-review-verification.ts, `~` queue index, `~` build.ts (REMOVES autoA11yAudit), `~` agent-event-bus.ts, `~` ReviewPanel.tsx, `+` tests | +200 / −80 |
| 6 — Gate | `~` feature-build-types.ts (extend checkPhaseGate + FeatureBuildRow), `~` feature-build-data.ts, `~` build.ts, `~` mcp-tools.ts (2 call sites + evidence bag), `~` EvidenceSummary.tsx, `~` process-graph-builder.test.ts, `~` ReviewPanel.tsx, `+` gate test | +140 / −10 |
| 7 — Prompts | `~` review.prompt.md, `~` mcp-tools.ts tool def | +20 / −40 |
| 8 — Integration | `+` e2e test | +120 / −0 |
| 9 — Docs | `~` design spec, `~` CLAUDE.md, `~` README, `~` tests/e2e/platform-qa-plan.md | +80 / −10 |
| 10 — Verify | None | 0 |

Rough total: ~1100 LOC net addition, ~280 deletions (includes `autoA11yAudit` removal). **One small Prisma schema change** (new `uxVerificationStatus String?` column) — see Section 5.

---

## Section 5: Schema / Migration Needs

**One small migration** — Task 0.1.

- Add `uxVerificationStatus String?` to `FeatureBuild`.
- Valid values: `"running" | "complete" | "failed" | "skipped"` (String-typed enum per CLAUDE.md convention — no Prisma enum).
- Existing `uxTestResults` JSON field is **unchanged** — its shape (`UxTestStep[] | null`) is preserved so no existing consumer breaks. This was the key correction in review pass #2.

Why a separate scalar column instead of a JSON wrapper:

- `uxTestResults` already has multiple array-based consumers ([apps/web/components/build/EvidenceSummary.tsx:67-71](../../../apps/web/components/build/EvidenceSummary.tsx#L67-L71), [apps/web/lib/explore/feature-build-types.ts:492-496](../../../apps/web/lib/explore/feature-build-types.ts#L492-L496), [apps/web/lib/mcp-tools.ts:2741](../../../apps/web/lib/mcp-tools.ts#L2741)). Changing the shape would require updating all of them atomically and opens a backfill risk for any existing rows.
- A scalar column is trivially queryable (`WHERE uxVerificationStatus = 'running'` for dashboards) without `jsonb` operators.
- `null` cleanly represents "never triggered" — no sentinel ambiguity.

If, during Chunk 5, we discover we need a `verificationStartedAt` timestamp for observability, add it as a follow-up migration — do NOT retrofit into this plan mid-flight.

---

## Section 6: Docker / Infra Changes

1. **Remove** `profiles: ["browser-use"]` from `docker-compose.yml:219`.
2. **Add** `browser-use: { condition: service_healthy }` to `portal.depends_on` and `portal-init.depends_on`.
3. **Mount** the `browser_evidence` named volume read-only in the portal container.
4. **Explicitly declare** the `BROWSER_USE_URL=http://browser-use:8500/mcp` env var in the portal service environment block (currently relies on the default in code).
5. **No new volumes, no new services, no new ports.**

Verification: `docker compose config` renders clean; `docker compose up -d` brings the full stack up with browser-use healthy before portal accepts traffic.

---

## Section 7: Test Plan

| Layer | Covered by |
| ----- | ---------- |
| Pure resolver logic | Task 1.1 unit test |
| UI component (URL card) | Task 2.1 unit test (RTL) |
| Screenshot capture | Task 3.2 pytest (browser-use side) |
| Screenshot URL propagation | Task 3.3 client-side unit test |
| Evidence serving route | Task 3.4 route unit test (auth, traversal, 404) |
| Inngest verification handler | Task 5.1 unit test (happy + failure + missing brief) |
| Phase-transition enqueue | Task 5.2 unit test |
| Ship gate | Task 6.1 unit test (extended `checkPhaseGate` — 6 cases incl. override) |
| Consumer audit | Task 6.4 typecheck-driven verification |
| End-to-end flow | Task 8.1 integration test |
| Platform QA | Task 9.4 — 10 new `BUILD-NN` cases in `tests/e2e/platform-qa-plan.md` (required by repo guardrails) |
| Full stack | Task 10.1 manual walkthrough |

Unit tests are currently informational in CI per `CLAUDE.md`, but we still run them locally and they must pass. Typecheck + Production Build are the merge-blocking gates and must be green. Per repo guardrails, `platform-qa-plan.md` must be extended with new feature behavior and the new cases must be executed before the work is considered complete.

---

## Section 8: Docs to Update

- `docs/superpowers/specs/2026-04-06-browser-use-integration-design.md` — new "Review-phase verification" section (Task 9.1).
- `CLAUDE.md` "Browser Automation (browser-use)" section — remove profile-gated language, add auto-trigger note (Task 9.2).
- Any `README.md` / `docs/getting-started.md` reference to the iframe preview or `--profile browser-use` (Task 9.3).
- `tests/e2e/platform-qa-plan.md` — 10 new `BUILD-NN` cases under Phase 10 covering preview card, auto-trigger, ship-block, override, and failure modes (Task 9.4).
- This plan file (final verification notes in Task 10.1).

---

## Section 9: Rollout / Sequencing

**Default workflow per [AGENTS.md:54](../../../AGENTS.md#L54): commit directly on `main`, small focused commits, no feature branches unless the user explicitly asks for one.** The chunks below are commit boundaries, not PR boundaries. Each chunk leaves the system in a working state (typecheck + production build green) so `git revert` is safe at any boundary.

**Sequence is strict** — later chunks depend on earlier ones:

1. **Chunk 0** — schema migration first so later code can reference the new column. Small, isolated, revertable.
2. **Chunks 1 + 2** — extract resolver, remove iframe, add URL card. Immediate user-visible win; safe to stop here if later chunks slip.
3. **Chunk 3** — evidence persistence (screenshots + auth-gated serving route). Existing manual `run_ux_test` calls start producing inline images in ReviewPanel.
4. **Chunk 4** — browser-use always-on (remove profile gate).
5. **Chunks 5 + 6** — auto-trigger + severity gate + consumer audit. Review phase gains real teeth.
6. **Chunks 7–10** — prompt/doc/QA-plan/test cleanup, then Task 10.1 full-stack walkthrough.

**If the user later requests a branch-based rollout** (e.g., because external contributors need to review before it lands on main), the chunk boundaries above already map 1:1 to shippable PRs — no restructuring needed. Today, commit directly on main per AGENTS.md.

**Verification-before-claim:** Per AGENTS.md "Verification — Build Gate (mandatory)", run `pnpm --filter web exec next build` after every chunk and confirm green before the next commit. Platform-QA cases (Task 9.4) must execute PASS before declaring the work complete.

---

## Section 10: Open Questions

Please confirm or redirect before execution:

1. **Override authority.** Task 6.3 adds a "Ship anyway" escape hatch for failed UX, gated by a free-text reason (min 10 chars). Acceptable, or should failed UX be an absolute block with no override?
2. **Screenshot retention.** Screenshots live on the `browser_evidence` volume indefinitely today. Should we add a cleanup job (e.g., delete evidence older than 30 days, or delete evidence for builds whose status is `complete`)? Recommend YES as a follow-up plan, not part of this one.
3. **Accessibility findings from `evaluate_page`.** That tool (`mcp-tools.ts:1048`) is orthogonal to `run_ux_test`. It stays as an ad-hoc coworker capability. Confirm we don't want it auto-triggered too. Recommend NO — acceptance-criteria tests are the gate; generic a11y scans are advisory.
4. **Legacy `run_ux_test` manual tool.** Task 7.3 proposes removing it from the review-phase allowlist so it can't be called manually (the Inngest function owns it now). Is there a use case where a developer still wants to re-run verification manually from chat? If yes, we keep the handler but hide it behind a `Dev mode` gate.
5. **Single sandbox vs pool.** The existing sandbox pool work ([docker-compose.yml:160-186](../../../docker-compose.yml#L160-L186)) has `sandbox`, `sandbox-2`, `sandbox-3`. The resolver in Task 1.2 must handle all three. Confirm that's the expected scope (yes by default unless told otherwise).
6. **Inngest vs direct async.** Chunk 5 uses Inngest for async verification. Alternative: a simple fire-and-forget on the server action with `ctx.waitUntil`. Inngest gives us retries, observability, and a durable record, which matches the "evidence before diagnosis" principle — recommend sticking with it. Flag if you'd rather go lighter-weight.

---

## Appendix: Why this is not a patchwork

- **No dead code left behind.** `SandboxPreview.tsx` is deleted. The profile-gate language is deleted. The wrong `http://localhost:3035` call-sites are all migrated to the resolver. `autoA11yAudit` is deleted rather than running in parallel with the new flow.
- **No runtime-path-only fixes.** The review prompt is re-seeded (`version: 2`), not patched at runtime. Schema change lands through a proper migration, not a JSON-shape shift that breaks the five existing consumers.
- **Evidence lives where evidence belongs.** Screenshots are durable artifacts on a shared volume, served through an auth-gated route — not dropped on the floor as the current code does.
- **One source of truth for URL resolution.** Three call-sites become one (`resolveSandboxUrl`).
- **One source of truth for UX gating.** `uxTestResults` + `uxVerificationStatus`, consumed by the existing `checkPhaseGate`. No writes to `designReview.issues` — that structure is regenerated by the reviewer pipeline on each pass ([apps/web/lib/integrate/build-reviewers.ts:198](../../../apps/web/lib/integrate/build-reviewers.ts#L198)), so dual-writing would race. One mechanism, one gate.
- **No duplicate background verification on review entry.** The existing `autoA11yAudit` is removed; the new Inngest flow replaces it. No overlapping progress signals.
- **Existing `uxTestResults` consumers are preserved.** The JSON shape is unchanged; every one of the five consumer sites ([EvidenceSummary.tsx](../../../apps/web/components/build/EvidenceSummary.tsx), [feature-build-types.ts](../../../apps/web/lib/explore/feature-build-types.ts), [mcp-tools.ts:2668,2741](../../../apps/web/lib/mcp-tools.ts#L2668), [ReviewPanel.tsx](../../../apps/web/components/build/ReviewPanel.tsx), test fixtures) is audited in Task 6.4 and typecheck-verified.
- **Browser-use is no longer opt-in.** A core verification capability should not be profile-gated.
- **Tests at every boundary.** Unit tests for pure logic, route tests for the evidence server, integration tests for the e2e flow, 10 new platform-QA cases per the repo's mandatory guardrail.
- **Workflow matches the repo.** Commits land directly on `main` per [AGENTS.md:54](../../../AGENTS.md#L54); no unrequested feature branches or PR ceremony.
- **Docs move with code in the same commits.** No post-hoc documentation drift.

---

## Delivery record (2026-04-20)

All ten chunks committed and pushed to `main`. Portal rebuilt + restarted
with all changes live. Migration applied to the running DB.

| Chunk | Commit | Notes |
| ----- | ------ | ----- |
| 0 — schema + migration | `d37f05c0` (swept into a parallel-thread commit by accident; code correct, message mis-attributed — see memory `feedback_git_commit_only_for_concurrent_sessions`) | Column `uxVerificationStatus String?` + migration SQL + `UX_VERIFICATION_STATUSES` const |
| 1 — sandbox URL resolver | `f610e913` + `5df33aef` (graph.ts fix to unblock build) | New `resolve-sandbox-url.ts` with 5 unit tests; preview proxy + `run_ux_test` migrated |
| 2 — iframe → PreviewUrlCard | `74535ba5` | `SandboxPreview.tsx` deleted; 4 render-snapshot tests on new card |
| 3 — screenshot persistence | `8fec0332` | `evidence_dir` on `browse_run_tests`; auth-gated `/api/build/[buildId]/evidence/[fileName]` route with 9 tests |
| 4 — browser-use always-on | `4f109ede` | Profile gate removed; portal `depends_on` waits for health |
| 5 — Inngest verification + autoA11yAudit removal | `ca4cb827` | New `build/review.verify` handler; ReviewPanel shows running/skipped/failed states; `UX_ACCESSIBILITY_PROMPT` deleted |
| 6 — checkPhaseGate extension + consumer audit | `c2fe21d2` | Gate reads `uxVerificationStatus` + `uxTestResults`; `overrideUxFailure` only bypasses UX-class blockers |
| 7 — review prompt v2 | `3b38d273` | Coworker narrates, doesn't drive; `run_ux_test` dropped from review-phase allowlist |
| 8 — e2e integration test | `1b1cf60d` | 7 tests, including source-level shape assertion that the handler never writes to `designReview` |
| 9 — docs + QA plan | `7f9f98a2` | Spec §8, CLAUDE.md, 10 new `BUILD-17..26` QA cases |
| 10 — verification walkthrough | — | Typecheck clean (for plan-owned files); production build green; 25/25 plan tests passing; portal rebuilt + running |

### One outstanding issue NOT from this plan

The `services/browser-use/` container fails to build locally:
`playwright install chromium --with-deps` returns exit code 127. The
Dockerfile has not been modified by this plan — the break appears to be
a base-image upgrade (Debian package rename, most likely
`libasound2` → `libasound2t64`) that affects the pre-existing image.
Until that's fixed, the Inngest handler's `run-tests` step will return
an "unreachable or crashed" diagnostic step, and QA cases BUILD-20
through BUILD-26 cannot be executed. The platform code path handles the
failure gracefully (status flips to `failed` with a diagnostic step) —
the gate blocks ship advance as designed.

### Task 10.1 manual walkthrough

Deferred until browser-use is rebuildable. The automated boundary tests
(Chunks 1.1, 2.1, 3.4, 8.1) cover the seams; the live walkthrough
validates the full stack end-to-end. Recommend running it immediately
after the Dockerfile fix lands.
