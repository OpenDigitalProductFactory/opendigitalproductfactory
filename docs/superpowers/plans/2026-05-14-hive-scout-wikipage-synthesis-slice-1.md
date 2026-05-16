# Hive Scout → WikiPage Synthesis: Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Hive Scout upsert one `RawSource` row per parsed catalog entry (idempotent on a stable `sourceKey`), and surface the resulting `RawSource.id` on the ambiguity-review activity record so Slice 3 can compose a `ProposalSource` from it without re-deriving provenance.

**Architecture:** Reuse the shipped `upsertRawSource` helper from `@dpf/db/wiki-store` (idempotent by `sourceKey`). Extend the `HiveScoutPrisma` type seam to include the `rawSource` model. Compose the stable key from a catalog identifier + the canonical slug of the entry's source URL. Write the `rawSourceId` into the existing `BacklogItemActivity.payload` JSON blob alongside the ambiguity-review record so consumers do not need a second query.

**Tech Stack:** TypeScript, Prisma, Vitest, pnpm workspaces. No new dependencies. No new MCP tools. No new grant keys. No schema migration.

**Spec:** [docs/superpowers/specs/2026-05-14-hive-scout-wikipage-synthesis-design.md §7 Slice 1](../specs/2026-05-14-hive-scout-wikipage-synthesis-design.md)

**Open PR for the spec:** [#639](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/639)

---

## Scope Boundaries

**In scope:**
- One `RawSource` row per **evaluated catalog entry** (i.e. entries that reach the ambiguity-review / backlog-creation step — gaps, not the full catalog).
- Stable `sourceKey` of shape `hive-scout:500-ai-agents:<canonical-slug>` derived from the catalog name + the entry's `sourceUrl`.
- `RawSource.sourceType = "external-url"`, `license` from `CATALOG_LICENSE`, `retrievedAt` set to run timestamp, `organizationId = null`.
- `rawSourceId` added to the `BacklogItemActivity.payload` JSON next to the existing `ambiguityReview` field.
- Idempotence assertion added to the manual-run harness.

**Spec/plan reconciliation note on `organizationId`:** Spec §4.3 reads `organizationId: install's primary org`. This plan sets `organizationId: null` because the 500-AI-Agents-Projects catalog is platform-shared (every install reads the same upstream README); duplicating the RawSource row per org would defeat the unique-`sourceKey` idempotence. The WikiPage rows that cite the source in Slice 3 remain org-scoped per `commitIngestProposal`'s contract. The spec will be amended at Slice 3 plan-time to match this division. Documented here so the divergence isn't silent.

**Out of scope:**
- `WikiIngestEvent.taskRunId` migration (Slice 2).
- Calls to `proposeWikiDiff` or `commitIngestProposal` (Slice 3).
- AI Operations Map projection (Slice 4).
- `RawSource` rows for entries that the gap filter rejects (`isGap` returns false). These are catalog entries the platform already has coverage for; no citation is needed yet. Revisit in Slice 3 if `duplicate_pattern` classifications need them.

---

## Pre-flight Checks

Run these before starting. Each should pass cleanly on `origin/main`. Use `git grep` for cross-shell portability (this repo is developed on both Windows/PowerShell and Unix).

```bash
# Confirm you're on a fresh branch off origin/main
git fetch origin main
git checkout -b feat/hive-scout-rawsource-upsert origin/main

# Confirm the upstream helper exists
git grep -n "export async function upsertRawSource" -- packages/db/src/wiki-store.ts
# Expected: one match around line 427

# Confirm the RawSource model is on the schema
git grep -n "^model RawSource" -- packages/db/prisma/schema.prisma
# Expected: one match around line 7140

# Confirm @dpf/db/wiki-store subpath export exists (B4 from review)
git grep -n '"./wiki-store"' -- packages/db/package.json
# Expected: one match — confirms `import from "@dpf/db/wiki-store"` resolves

# Confirm the existing test harness passes (sanity baseline)
pnpm --filter web test apps/web/lib/actions/hive-scout/ingest-500-agents.test.ts
# Expected: all tests pass
```

If any pre-flight fails, STOP and surface to human — the branch is not based on the assumed state.

---

## Task 1: Extend `HiveScoutPrisma` Type Seam

**Files:**
- Modify: `apps/web/lib/actions/hive-scout/ingest-500-agents.ts:166-177`

**Why:** The `HiveScoutPrisma` type currently lists only the Prisma models the action touches. Adding `rawSource` to this type is the smallest change that lets `upsertRawSource` typecheck against the production client AND lets tests inject a mock that only implements `rawSource.upsert`.

- [ ] **Step 1: Open `ingest-500-agents.ts` and locate `HiveScoutPrisma` type definition (around line 166).**

- [ ] **Step 2: Add `"rawSource"` to the `Pick<PrismaClient, …>` keys.** Result should look like:

  ```ts
  type HiveScoutPrisma = Pick<
    PrismaClient,
    | "eaReferenceModelElement"
    | "skillDefinition"
    | "agent"
    | "backlogItem"
    | "backlogItemActivity"
    | "user"
    | "platformConfig"
    | "rawSource"
  > & {
    taskRun?: unknown;
  };
  ```

- [ ] **Step 3: Run typecheck to confirm no regression.**

  ```bash
  pnpm --filter web typecheck
  ```
  Expected: exit 0. If errors appear unrelated to this change, surface to human.

- [ ] **Step 4: Commit.**

  ```bash
  git add apps/web/lib/actions/hive-scout/ingest-500-agents.ts
  git commit -s -m "refactor(hive-scout): expose rawSource on HiveScoutPrisma type"
  ```

---

## Task 2: Write Failing Test for `rawSourceKeyForEntry`

**Files:**
- Modify: `apps/web/lib/actions/hive-scout/ingest-500-agents.test.ts` (append a new `describe` block at the end)

**Why:** TDD — define the stable-key contract before implementation. The key must be (a) stable across runs for the same source URL, (b) collision-free across different URLs, (c) human-readable in DB queries, (d) prefixed with the catalog name so future catalogs don't collide.

- [ ] **Step 1: Append a new `describe` block to the test file.** The function takes `Pick<CatalogEntry, "sourceUrl">` so the tests pass only `sourceUrl`.

  ```ts
  describe("rawSourceKeyForEntry", () => {
    it("produces a stable key prefixed with the catalog name", () => {
      expect(rawSourceKeyForEntry({
        sourceUrl: "https://github.com/harshhh28/hia.git",
      })).toBe("hive-scout:500-ai-agents:github-com-harshhh28-hia");
    });

    it("is identical for the same source URL across calls", () => {
      const entry = { sourceUrl: "https://github.com/foo/bar" };
      expect(rawSourceKeyForEntry(entry)).toBe(rawSourceKeyForEntry(entry));
    });

    it("differs across distinct source URLs", () => {
      const a = rawSourceKeyForEntry({ sourceUrl: "https://github.com/foo/bar" });
      const b = rawSourceKeyForEntry({ sourceUrl: "https://github.com/foo/baz" });
      expect(a).not.toBe(b);
    });

    it("strips trailing .git and normalises case", () => {
      expect(rawSourceKeyForEntry({
        sourceUrl: "HTTPS://GitHub.com/Foo/Bar.git",
      })).toBe("hive-scout:500-ai-agents:github-com-foo-bar");
    });

    it("treats userinfo, port, query, and fragment as ignorable noise", () => {
      // I4 from plan review: scheme/userinfo/port/query/fragment must not
      // produce distinct keys for the same logical source.
      const baseline = rawSourceKeyForEntry({ sourceUrl: "https://github.com/foo/bar" });
      expect(rawSourceKeyForEntry({
        sourceUrl: "https://user:pass@github.com:443/foo/bar?x=1#y",
      })).toBe(baseline);
    });
  });
  ```

- [ ] **Step 2: Add `rawSourceKeyForEntry` to the import list at the top of the test file.**

- [ ] **Step 3: Run the test and confirm it fails (export missing).**

  ```bash
  pnpm --filter web test apps/web/lib/actions/hive-scout/ingest-500-agents.test.ts
  ```
  Expected: typecheck error or import error on `rawSourceKeyForEntry`. **Do not proceed if it passes — that means the function already exists and the test is meaningless.**

- [ ] **Step 4: Commit the failing test.**

  ```bash
  git add apps/web/lib/actions/hive-scout/ingest-500-agents.test.ts
  git commit -s -m "test(hive-scout): contract for rawSourceKeyForEntry (failing)"
  ```

---

## Task 3: Implement `rawSourceKeyForEntry`

**Files:**
- Modify: `apps/web/lib/actions/hive-scout/ingest-500-agents.ts` (add export near `itemIdForSource` / `sourceUrlHash`)

- [ ] **Step 1: Locate `itemIdForSource` and `sourceUrlHash` in the file (search for `function itemIdForSource`).**

- [ ] **Step 2: Add a constant + function next to them.**

  ```ts
  const RAW_SOURCE_KEY_PREFIX = "hive-scout:500-ai-agents";

  /**
   * Stable, human-readable key for `RawSource.sourceKey`. Idempotency depends
   * on this returning the same string for the same source URL across runs.
   *
   * Shape: `hive-scout:500-ai-agents:<canonical-slug>` where the slug is
   * derived from the URL host + path with non-alphanumerics collapsed to
   * single dashes. Scheme, userinfo, port, query, and fragment are stripped
   * so cosmetic URL variations do not split a single logical source into
   * two RawSource rows.
   */
  export function rawSourceKeyForEntry(entry: Pick<CatalogEntry, "sourceUrl">): string {
    return `${RAW_SOURCE_KEY_PREFIX}:${canonicalSlugForUrl(entry.sourceUrl)}`;
  }

  function canonicalSlugForUrl(rawUrl: string): string {
    let canonical: string;
    try {
      const parsed = new URL(rawUrl.trim());
      // host (no userinfo, no port) + pathname only; query + fragment dropped.
      canonical = `${parsed.hostname}${parsed.pathname}`;
    } catch {
      // Fall back to lenient parsing for malformed URLs — preserves a key
      // rather than throwing mid-ingest. Strip scheme + userinfo + port + ?…/#….
      canonical = rawUrl
        .trim()
        .replace(/^[a-z]+:\/\//i, "")
        .replace(/^[^/@]*@/, "")
        .replace(/:\d+/, "")
        .split(/[?#]/)[0];
    }
    return canonical
      .toLowerCase()
      .replace(/\.git$/i, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
  ```

- [ ] **Step 3: Run the test and confirm it passes.**

  ```bash
  pnpm --filter web test apps/web/lib/actions/hive-scout/ingest-500-agents.test.ts
  ```
  Expected: all `rawSourceKeyForEntry` tests pass; everything else unchanged.

- [ ] **Step 4: Commit.**

  ```bash
  git add apps/web/lib/actions/hive-scout/ingest-500-agents.ts
  git commit -s -m "feat(hive-scout): rawSourceKeyForEntry stable key helper"
  ```

---

## Task 4: Write Failing Tests for `RawSource` Upsert During Ingest

**Files:**
- Modify: `apps/web/lib/actions/hive-scout/ingest-500-agents-run.test.ts` (extend hoisted mock + append new `describe` block)

**Why:** The run-level test uses `vi.hoisted()` + `vi.mock("@dpf/db", …)` to inject the prisma stub through the module boundary — NOT a `buildMockPrisma` helper or a `prisma` option to `runHiveScoutIngest`. We extend the existing `mocks.prisma` object with a `rawSource.upsert` mock and assert through `mocks.prisma.rawSource.upsert.mock.calls`. The shipped fixture `SAMPLE_README` contains one entry (`Threat Hunter Agent`), so the assertions count exactly one upsert per run.

- [ ] **Step 1: Read the existing test file to lock in the mock pattern.**

  ```bash
  pnpm --filter web exec cat apps/web/lib/actions/hive-scout/ingest-500-agents-run.test.ts
  ```
  Confirm: (a) `vi.hoisted` defines `mocks.prisma` with named Prisma surfaces; (b) `vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }))` is the seam; (c) `runHiveScoutIngest` is called with at most `{ fetcher, actorAgentId, taskRunId }`; (d) `SAMPLE_README` has exactly one use-case row (Threat Hunter Agent, sourceUrl `https://github.com/example/threat-hunter`).

- [ ] **Step 2: Extend `mocks.prisma` in the `vi.hoisted` block to include `rawSource`.**

  Edit the `vi.hoisted(() => ({ prisma: { … } }))` block. Add a new key alongside `backlogItemActivity`:

  ```ts
  rawSource: {
    upsert: vi.fn(),
  },
  ```

- [ ] **Step 3: Set the default `rawSource.upsert` resolved value in the existing `beforeEach`.**

  Add this line at the end of the `beforeEach` body (after the existing `mocks.loadPrompt.mockResolvedValue(...)`):

  ```ts
  mocks.prisma.rawSource.upsert.mockResolvedValue({ id: "raw-fixed-id" });
  ```

- [ ] **Step 4: Append a new `describe` block at the bottom of the file.** Assertions are scaled to the one-entry fixture.

  ```ts
  describe("runHiveScoutIngest — RawSource upsert", () => {
    it("upserts one RawSource per gap entry with the canonical sourceKey", async () => {
      await runHiveScoutIngest({
        fetcher: async () => SAMPLE_README,
        actorAgentId: "external-catalog-scout",
        taskRunId: "TR-SCHED-HIVE1",
      } as never);

      expect(mocks.prisma.rawSource.upsert).toHaveBeenCalledOnce();
      const [firstCall] = mocks.prisma.rawSource.upsert.mock.calls;
      expect(firstCall[0]).toMatchObject({
        where: { sourceKey: "hive-scout:500-ai-agents:github-com-example-threat-hunter" },
        create: expect.objectContaining({
          sourceType: "external-url",
          license: "MIT",
          title: "Threat Hunter Agent",
          url: "https://github.com/example/threat-hunter",
          organizationId: null,
          isKernel: false,
        }),
      });
      expect(firstCall[0].create.retrievedAt).toBeInstanceOf(Date);
    });

    it("surfaces rawSourceId on the BacklogItemActivity payload", async () => {
      await runHiveScoutIngest({
        fetcher: async () => SAMPLE_README,
        actorAgentId: "external-catalog-scout",
        taskRunId: "TR-SCHED-HIVE1",
      } as never);

      expect(mocks.prisma.backlogItemActivity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          payload: expect.objectContaining({
            rawSourceId: "raw-fixed-id",
          }),
        }),
      });
    });

    it("invokes upsert with the same sourceKey across two runs (idempotence by unique key)", async () => {
      // Two back-to-back runs against the same fixture. Postgres' unique
      // constraint on RawSource.sourceKey is what enforces idempotence in
      // production; here we only assert that we call upsert with the same
      // where-key so the constraint can do its job.
      await runHiveScoutIngest({ fetcher: async () => SAMPLE_README } as never);
      await runHiveScoutIngest({ fetcher: async () => SAMPLE_README } as never);

      const keys = mocks.prisma.rawSource.upsert.mock.calls.map(
        ([args]: [{ where: { sourceKey: string } }]) => args.where.sourceKey,
      );
      expect(keys).toEqual([
        "hive-scout:500-ai-agents:github-com-example-threat-hunter",
        "hive-scout:500-ai-agents:github-com-example-threat-hunter",
      ]);
    });
  });
  ```

- [ ] **Step 5: Run the test and confirm all three new assertions fail.**

  ```bash
  pnpm --filter web test apps/web/lib/actions/hive-scout/ingest-500-agents-run.test.ts
  ```
  Expected: pre-existing test still passes; three new tests fail (upsert never called; payload missing `rawSourceId`). **Do not proceed if any of the three new tests pass without implementation.**

- [ ] **Step 6: Commit the failing tests.**

  ```bash
  git add apps/web/lib/actions/hive-scout/ingest-500-agents-run.test.ts
  git commit -s -m "test(hive-scout): rawSource upsert + activity payload + idempotence (failing)"
  ```

---

## Task 5: Implement `RawSource` Upsert in the Ingest Loop

**Files:**
- Modify: `apps/web/lib/actions/hive-scout/ingest-500-agents.ts` (import `upsertRawSource`; call inside the candidate loop; thread `rawSourceId` into payload)

- [ ] **Step 1: Add the import near the top of the file (next to the existing `@dpf/db` import).**

  ```ts
  import { upsertRawSource } from "@dpf/db/wiki-store";
  ```

  If the import path doesn't resolve at the workspace boundary, fall back to:

  ```ts
  import { upsertRawSource } from "../../../../../packages/db/src/wiki-store";
  ```

  Run `pnpm --filter web exec tsc --noEmit` after adding to confirm which form resolves.

- [ ] **Step 2: Locate the candidate-creation loop starting at `for (const candidate of candidates) {` (around line 704).**

- [ ] **Step 3: Before the `db.backlogItem.create` call, upsert the RawSource and capture the id.**

  Insert this block immediately inside the loop, before `const match = applyReviewToMatch(...)`:

  ```ts
  const rawSource = await upsertRawSource(db, {
    sourceKey: rawSourceKeyForEntry(entry),
    sourceType: "external-url",
    title: entry.name,
    url: entry.sourceUrl,
    license: CATALOG_LICENSE,
    retrievedAt: new Date(),
    organizationId: null,
    isKernel: false,
  });
  const rawSourceId = (rawSource as { id: string }).id;
  ```

- [ ] **Step 4: Thread `rawSourceId` into the `BacklogItemActivity.payload` field.**

  Find the existing `payload: { … }` object inside `db.backlogItemActivity.create({ data: { … } })` (around line 734) and add the new key alongside `ambiguityReview`:

  ```ts
  payload: {
    taskRunId: options.taskRunId ?? null,
    catalog: CATALOG_NAME,
    catalogLicense: CATALOG_LICENSE,
    sourceUrl: entry.sourceUrl,
    sourceUrlHash: sourceUrlHash(entry.sourceUrl),
    framework: entry.framework ?? null,
    valueStream: match.stream,
    valueStreamConfidence: match.confidence,
    ambiguityReview: review,
    rawSourceId, // ← NEW
  } as Prisma.InputJsonValue,
  ```

- [ ] **Step 5: Run the failing tests and confirm they pass.**

  ```bash
  pnpm --filter web test apps/web/lib/actions/hive-scout/ingest-500-agents-run.test.ts
  ```
  Expected: all tests pass, including the three new ones.

- [ ] **Step 6: Run the FULL hive-scout test suite to confirm no regression.**

  ```bash
  pnpm --filter web test apps/web/lib/actions/hive-scout/
  ```
  Expected: every pre-existing test still passes.

- [ ] **Step 7: Run workspace-wide typecheck.**

  ```bash
  pnpm --filter web typecheck
  ```
  Expected: exit 0.

- [ ] **Step 8: Commit.**

  ```bash
  git add apps/web/lib/actions/hive-scout/ingest-500-agents.ts
  git commit -s -m "feat(hive-scout): upsert RawSource per gap entry; surface id on activity payload"
  ```

---

## Task 6: Add Idempotence Assertion to Manual-Run Harness

**Files:**
- Modify: `apps/web/scripts/hive-scout-manual-run.ts`

**Why:** The spec's Slice 1 acceptance criterion includes "Repeat runs do not create duplicates." The manual-run harness already invokes the ingest twice; we add a final query that asserts `RawSource` row count for `hive-scout:500-ai-agents:*` keys is the same after the second run as after the first.

- [ ] **Step 1: Open `apps/web/scripts/hive-scout-manual-run.ts`. Modify `main()` to count `RawSource` rows after each run and assert equality.**

  ```ts
  async function main() {
    console.log("[hive-scout] seeding skills...");
    await seedSkills(prisma as never);

    console.log("[hive-scout] seeding prompt templates...");
    await seedPromptTemplates(prisma as never);

    console.log("[hive-scout] first run...");
    const first = await runHiveScoutIngest();
    console.log("FIRST RUN:", first);

    const firstRawSources = await prisma.rawSource.count({
      where: { sourceKey: { startsWith: "hive-scout:500-ai-agents:" } },
    });
    console.log(`[hive-scout] RawSource rows after first run: ${firstRawSources}`);

    console.log("[hive-scout] second run (expect 0 new created)...");
    const second = await runHiveScoutIngest();
    console.log("SECOND RUN:", second);

    const secondRawSources = await prisma.rawSource.count({
      where: { sourceKey: { startsWith: "hive-scout:500-ai-agents:" } },
    });
    console.log(`[hive-scout] RawSource rows after second run: ${secondRawSources}`);

    if (firstRawSources !== secondRawSources) {
      console.error(
        `[hive-scout] IDEMPOTENCE VIOLATION: RawSource count changed ` +
          `${firstRawSources} → ${secondRawSources} across runs`,
      );
      process.exit(1);
    }
    console.log(`[hive-scout] RawSource idempotence OK (${firstRawSources} rows stable)`);

    await prisma.$disconnect();
  }
  ```

- [ ] **Step 2: Smoke-check the script compiles.**

  ```bash
  pnpm --filter web typecheck
  ```
  Expected: exit 0.

- [ ] **Step 3: (Optional — only if a local Postgres is available)** Run the manual harness end-to-end against a local DB.

  ```bash
  DATABASE_URL=postgresql://dpf:PASS@localhost:5432/dpf \
    pnpm --filter web exec tsx scripts/hive-scout-manual-run.ts
  ```
  Expected output ends with `[hive-scout] RawSource idempotence OK (N rows stable)`. If no local DB is available, document this in the PR description as "manual harness verified via typecheck only — needs Postgres run in CI."

- [ ] **Step 4: Commit.**

  ```bash
  git add apps/web/scripts/hive-scout-manual-run.ts
  git commit -s -m "test(hive-scout): assert RawSource idempotence in manual-run harness"
  ```

---

## Task 7: Final Verification + PR

- [ ] **Step 1: Run the full vitest suite for the workspace (per Mark's standing rule — full suite, not just changed files).**

  ```bash
  pnpm --filter web test
  pnpm --filter @dpf/db test
  ```
  Expected: all tests pass. If any pre-existing test fails, surface to human — do not paper over.

- [ ] **Step 2: Run workspace typecheck using the package scripts (parity with CI).**

  ```bash
  pnpm --filter web typecheck
  pnpm --filter @dpf/db typecheck
  ```
  Expected: exit 0 from both.

- [ ] **Step 3: Sweep for overlap with concurrent sessions before pushing.** Per Mark's continuous-overlap-check rule (re-sweep before every push, not just at session start). Combine title search + path-level history:

  ```bash
  gh pr list --state open --search "hive-scout in:title" --limit 20
  gh pr list --state open --search "rawsource in:title,body" --limit 20
  git fetch origin main --quiet
  git log origin/main --since="3 days ago" --oneline | head -40
  git log origin/main --since="3 days ago" --name-only -- \
    apps/web/lib/actions/hive-scout/ packages/db/src/wiki-store.ts | head -40
  ```
  If anything touches `apps/web/lib/actions/hive-scout/ingest-500-agents.ts`, `packages/db/src/wiki-store.ts`, or `RawSource` writes, STOP and reconcile before pushing.

- [ ] **Step 4: Push the branch.**

  ```bash
  git push -u origin feat/hive-scout-rawsource-upsert
  ```

- [ ] **Step 5: Open the PR.** Use this template (adapt with actual test counts):

  ```bash
  gh pr create --title "feat(hive-scout): RawSource upsert per gap entry (Slice 1 of wiki bridge)" --body "$(cat <<'EOF'
  ## Summary

  - Implements Slice 1 of [docs/superpowers/specs/2026-05-14-hive-scout-wikipage-synthesis-design.md](docs/superpowers/specs/2026-05-14-hive-scout-wikipage-synthesis-design.md): upserts one `RawSource` row per parsed catalog entry, idempotent on a stable `sourceKey` of shape `hive-scout:500-ai-agents:<canonical-slug>`.
  - Surfaces the resulting `RawSource.id` on `BacklogItemActivity.payload` so Slice 3 can compose a `ProposalSource` without a second query.
  - Reuses the shipped `upsertRawSource` helper from `@dpf/db/wiki-store`. No new dependencies, no new MCP tools, no new grant keys, no schema migration.
  - Behavior-neutral on its own: no `WikiPage` writes yet. RawSource rows light up the `stale` lint detector once any wiki write reaches scout-originated sources (Slice 3).

  ## Test plan

  - [x] Full vitest suite passes (`pnpm --filter web test`).
  - [x] New tests: `rawSourceKeyForEntry` contract, RawSource upsert during ingest, `rawSourceId` on activity payload, idempotence across two runs.
  - [x] Workspace typecheck clean.
  - [ ] Manual-run harness verified against local Postgres (or noted as needing CI run if no local DB available).

  ## Stacking

  Independent of any open PR. Base = `main`. The spec PR (#639) is informational context only; this slice is self-contained.

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```

- [ ] **Step 6: Confirm the PR URL is reported back to the user.**

---

## Risks & Edge Cases

| Risk | Mitigation in this plan |
| --- | --- |
| `upsertRawSource` rejects calls when `db.rawSource` is undefined on the test mock | Task 4 explicitly assigns `db.rawSource` on the mock; Task 1 widens the type so production typechecks. |
| Two different source URLs canonicalise to the same slug (e.g. trailing slashes) | Task 2's slug normaliser collapses non-alphanumerics and strips trailing dashes; the third test (`differs across distinct source URLs`) catches collisions in CI. If a real collision surfaces in production, add a deduplicating suffix and write a regression test. |
| `BacklogItemActivity.payload` schema downstream consumer breaks on the new `rawSourceId` field | `payload` is a `Json` column with no schema enforcement; consumers that read other fields are unaffected. The ambiguity-review reader at line 491 explicitly destructures `payload.ambiguityReview`, not all of `payload`. |
| Re-run of harness against a populated DB produces unexpected non-zero deltas | `upsertRawSource` is idempotent by unique constraint on `sourceKey`. The new harness assertion compares counts before/after, not before/empty — so prior runs do not invalidate the check. |
| Concurrent session lands a competing change to ingest-500-agents.ts | Task 7 Step 3 sweeps before pushing. |
| `Prisma.InputJsonValue` cast around the activity payload literal silently drops when adding `rawSourceId` | Task 5 Step 4 explicitly preserves the `as Prisma.InputJsonValue` cast on the payload object. |
| `RawSource.sourceType` accepts free-form strings (no DB check constraint) so a typo could silently land | Schema comment documents `external-url` as a valid value; the new run-level test pins the literal `"external-url"` so a typo regresses CI. |
| Plan's `organizationId: null` diverges from spec §4.3's "install's primary org" | Plan's Scope Boundaries section documents this divergence explicitly with rationale (platform-shared catalog, dedup via unique sourceKey); spec amendment scheduled at Slice 3 plan-time. |

---

## Out of Scope (Do Not Implement in This PR)

- `proposeWikiDiff` / `commitIngestProposal` invocation — that is Slice 3.
- `WikiIngestEvent.taskRunId` migration — that is Slice 2.
- Any change to the ambiguity-review classifier — already shipped, not this slice's concern.
- Backfill of historical RawSource rows for backlog items created by prior Hive Scout runs — out of scope; the spec contract starts forward-looking.
- Calling `attachSource` for `duplicate_pattern` classifications — Slice 3 (`§4.2` of the spec).

---

## Definition of Done

1. The three new tests in `ingest-500-agents.test.ts` and `ingest-500-agents-run.test.ts` pass.
2. The full `pnpm --filter web test` suite passes.
3. `pnpm --filter web exec tsc --noEmit` exits 0.
4. The manual-run harness contains the idempotence assertion and (when local Postgres is available) prints `RawSource idempotence OK` on a second run.
5. PR opened against `main`, DCO sign-off on every commit (`git commit -s`), no merge conflicts (verify with `gh pr view --json mergeable`).
6. PR description references the spec and explicitly states "Slice 1 only".

Once merged, the next implementer picks up the Slice 2 plan (separate document, to be drafted after Slice 1 lands).
