# Plan: WSID — Per-Coworker Professional Corpus (BI-48B3CEC4)

- **Date:** 2026-06-09
- **Backlog:** BI-48B3CEC4 — epic EP-WSID (xlarge umbrella; phases below are the decomposition)
- **Spec:** `docs/superpowers/specs/2026-06-09-wsid-coworker-professional-corpus-design.md`
- **Definition of done:** the BI's acceptance criteria (§8 of the spec)

## Substrate grounding (verified 2026-06-09)

| Claim | Evidence |
|---|---|
| Profile kinds are a TS registry over an open DB string | `apps/web/lib/decision-perspective/types.ts:1` (`DECISION_PROFILE_KINDS`), `schema.prisma` `DecisionPerspectiveProfile.kind String` |
| Fallback chains exist | `DecisionPerspectiveProfile.fallbackProfileId` self-relation (schema.prisma ~9383) |
| Profile selection point | `apps/web/lib/decision-perspective/build-studio-gate.ts:155-170` via `resolveProfileMaterial` |
| Org-scoped resolution **landed** (BI-230C9EF7) | `resolveProfileMaterialForOrg` at `apps/web/lib/decision-perspective/material.ts:363`; tests at `material.test.ts:155` — compose, don't rebuild |
| Profile seeding home | `packages/db/src/seed-decision-perspective.ts` |
| Kernel wiki seed machinery to generalize | `packages/db/src/seed-wiki-kernel.ts` — frontmatter parse, `deriveSlug`, RawSource ingest, precomputed `embeddings.jsonl` sidecar |
| wwmd MCP tools **not yet shipped** | specced in `2026-05-19-wwmd-mcp-exposure-design.md`; no registration in `apps/web/lib/mcp-tools.ts` — Phase 5's MCP item is conditional on EP-WWMD-MCP |
| Role identifiers in agent registry | `agent_registry.json` has no `role` field; canonical key is `agent_name` (`build-data-architect` / `finance-agent` / `marketing-specialist`); `prompts/specialist/*` slugs are a separate namespace (spec §4.3) |
| Enrichment facade to generalize | `apps/web/lib/wiki/enrich-org-corpus.ts` (`EnrichOrgCorpusInput`, `TRUST_TO_MATERIAL`, draft-by-default per BI-1378) |
| Retrieval scoping axes exist | `packages/db/src/wiki-taxonomy.ts` (`specialist` archetype, `finance`/`marketing`/`data-model` context slugs, `ring-1-coworker`) |
| Coworker role slugs | `packages/db/data/agent_registry.json` + `prompts/specialist/*.prompt.md` (e.g. `data-architect`) |

No structural migration anywhere in this plan — by design (spec §6).

## Phase 0 — Taxonomy & type registry (ships independently)

**Deliverable:** the platform recognizes the third scope, with zero behavior change.

- `apps/web/lib/decision-perspective/types.ts`: add `"profession"` to
  `DECISION_PROFILE_KINDS`; add `"professional-practice"` to `DECISION_DOMAIN_CLASSES`;
  extend `DecisionPerspectiveScope` with optional `professionKey` + `roles`.
- `apps/web/lib/mcp-tools.ts`: wherever profile kind / domain class enums are validated
  for the wwmd tools, accept the new values (grep `DECISION_DOMAIN_CLASSES` /
  `DECISION_PROFILE_KINDS` imports at implementation time).
- Tests: extend `evaluator.test.ts` kind-acceptance case (the `persona-real` test at
  `evaluator.test.ts:266` is the template) for `"profession"`; domain-class round-trip.

**Verification:** `pnpm --filter web exec vitest run lib/decision-perspective` green;
`pnpm --filter web typecheck` green. No UX change to verify (registry-only).

## Phase 1 — Profession Source Registry + all family profiles + role resolver

**Deliverable:** the full-roster coverage contract (spec §4.11) made concrete — the
governed registry, a profession profile for **every family** (~18 families covering all
63 registry agents + ~24 route personas), and the resolver; unbound identifiers resolve
to null (existing behavior preserved).

- New `docs/professions/registry.json` (spec §4.12 #1): every `professionKey` → bound
  roles (registry `agent_name` keys + persona/prompt-slug aliases per spec §4.3),
  context slugs, candidate source list with **license class**
  (`open`/`licensed`/`org-supplied`), and an SFIA/O*NET-derived coverage checklist per
  family. Coverage lint: every active registry agent and route persona appears in
  exactly one family — an unmapped role fails CI (spec §4.11 rule 1).
- `packages/db/src/seed-decision-perspective.ts`: seed one profile per registry family
  (kind `profession`, scope per spec §4.2, `fallbackProfileId` → the org/platform
  profile, initial version row). Families without a built corpus still get profiles —
  their `defer`s are the demand signal that prioritizes corpus rollout (spec §4.11
  rule 2). Idempotent upsert; loud skip-logging (silent-seed-skips audit).
- New `apps/web/lib/decision-perspective/resolve-profession-profile.ts`:
  `resolveProfessionProfile({ agentId | roleSlug })` resolving agentId → registry entry
  → `agent_name` (or alias) → profile via `scope.roles`. Mirror the landed
  `resolveProfileMaterialForOrg` client-injection pattern so tests use a structural
  fake.
- Tests: resolver hit, alias hit, miss (null), fallback-chain shape, and the
  registry-coverage lint (a synthetic unmapped agent fails).

**Verification:** unit tests; then seed against a disposable shadow Postgres
(`source-only worktree verification` pattern) and assert one profile row per registry
family + version rows + chain wiring via a seed invariant check. Runtime-bound seed
verification routes through the local-CI convergence sandbox lease, not the worktree.

## Phase 2 — Research-ingest pipeline + data-architect corpus through it

**Deliverable:** the §4.12 research pipeline working end-to-end, proven by producing the
first real corpus — DMBOK/ANSI-SQL/OWASP — **from fetched sources, not model memory**.

- Research run first (spec §4.12 #2–3): execute the data-architect research pass with
  the existing research-execution harness (`apps/web/lib/wiki/research-execution.ts`,
  `market-research.ts` precedent) against the registry's `open`-class sources (OWASP
  Top 10/ASVS/Query Parameterization Cheat Sheet, NIST/ISO public abstracts, DAMA
  public knowledge-area structure). Every fetch lands as a `RawSource` with locator,
  `retrievedAt`, content fingerprint, license class. `licensed`-class sources (DMBOK2
  text, ISO/IEC 9075 text) stay checklist-only or await `org-supplied` upload — the
  conduit rule (spec §7.7).
- Corpus content: distillation pages proposed **from the fetched source text** via
  `proposeWikiDiff` (markdown, founder-kernel wiki layout) under
  `docs/professions/data-architect/wiki/` — `principle`, `heuristic`, `entity`,
  `summary` kinds; frontmatter carries `principleConsumerArchetype: specialist`,
  `principleConsumerContexts: [data-model]` (+ `data-security` slug — open kebab-case,
  no schema change), `principleRingScope: ring-1-coworker`. Commandment-in-context for
  the safety rules (parameterized SQL, least-privilege DB access). **Copyright-clean:
  citations via RawSource, no reproduced licensed text.**
- Provenance invariant lint (spec §4.12 #4): every corpus page must carry ≥1 source
  reference resolving to a fetched RawSource; every material's `sourceRef` must trace.
  Wire into `wiki_lint`/CI so unsourced content cannot publish or promote.
- New `packages/db/src/seed-profession-corpus.ts`: **generalize the `seed-wiki-kernel.ts`
  machinery** (frontmatter parse, `deriveSlug`, RawSource ingest, embeddings sidecar)
  over a `docs/professions/<role>/` tree — parameterize the kernel loader, don't fork a
  parallel parser. Seeds RawSources (DMBOK2, ISO/IEC 9075, OWASP ASVS/Top 10 citations),
  WikiPages + WikiPageSource links + WikiPageLink neighborhood, PerspectiveMaterials on
  `WSID-DATA-ARCHITECT` (grade B / derived / promoted — PR-reviewed like kernel pages).
  Seed-time embeddings via a precomputed `embeddings.jsonl` sidecar (kernel precedent —
  a fresh install has no embedding provider configured at seed time); runtime
  enrichment embeds via `storeWikiPage`.
- `pnpm wiki:lint` (or the existing lint entry) passes on the new pages.

**Verification:** fresh-seed run shows pages + materials + zero silent skips;
`resolveProfileMaterial` for `WSID-DATA-ARCHITECT` returns promoted materials; a Qdrant
recall for "SQL injection" surfaces the OWASP-derived page. Functional, not structural:
run one evaluation against the profile with a craft question through the in-portal gate
path (`evaluateDecisionPerspective` via the decision-perspective server action — the
`wwmd_evaluate` MCP tool is not yet shipped) and confirm a `recommend` citing the
seeded material (sandbox lease).

## Phase 3 — Role-aware gate resolution

**Deliverable:** a coworker hitting a craft question is governed by its profession
profile, with the chain recorded in the ledger.

- Profile-selection wiring at the coworker gate entry (the in-portal handler that calls
  `evaluateDecisionPerspective` for coworker threads — locate via the gate panel's server
  action at implementation time; `build-studio-gate.ts` is the template): when the caller
  is an agent with a bound role and the question's domain is `professional-practice` (or
  the profile scopes the domain), select the profession profile; else current behavior.
  Compose with the landed BI-230C9EF7 org resolution — same entry-point, two resolvers.
- Authority boundary (spec §4.5): craft-vs-business conflict arbitrates org-over-
  profession; profession commandments escalate instead of yielding. This is evaluator
  *input* shaping (which profile is primary, which is fallback), not evaluator changes.
- `DecisionInteraction` rows already record profile + version + fallback level — assert,
  don't rebuild.

**Verification:** unit tests for selection logic; **live-install functional gate** (the
`dpf-verify-on-live-install` flow, preflight first): drive a data-architect coworker
craft question on the canonical install, observe `recommend` + cited WSID materials in
the Decision Canvas, and the ledger row naming `WSID-DATA-ARCHITECT`. A role with no
profile behaves exactly as before (regression check on an unbound coworker).

## Phase 4 — Role-scoped enrichment + gap loop

**Deliverable:** profession corpora grow at runtime under review, and `defer`s feed them.

- `apps/web/lib/wiki/enrich-org-corpus.ts`: generalize input with the
  `EnrichCorpusTarget` discriminator (spec §4.7); `profession` targets write
  platform-scoped pages/materials onto the profession profile; source-key
  `enrich:profession:${professionKey}:${sourceType}:${fingerprint}` (extends the
  shipped `deriveSourceKey` colon scheme). **Org path behavior is frozen
  by existing tests (`enrich-org-corpus.test.ts`) — they must stay green untouched.**
- Review-inbox lane: profession-profile gaps group under owner/operator wording
  (explainability spec's generic projection — verify, extend only if the projection
  hardcodes org/founder).
- Gap capture: a `defer` against a profession profile writes the profile-gap record
  (existing mechanics) — assert it lands in the inbox lane.

**Verification:** new enrichment tests for the profession target (disposition, draft-by-
default, idempotent source-key); org-path regression suite green; functional: enrich one
researched note into the data-architect corpus on the sandbox, see it as draft in the
review inbox.

## Phase 5 — Finance + marketing corpora (via the pipeline), MCP exposure, docs

**Deliverable:** the remaining pilot corpora — each through its own dedicated research
run — and the external surface.

- Dedicated research passes per profession (spec §4.12 — own effort, own sources):
  finance against FASB ASC public guidance, SOX/PCAOB public materials, double-entry
  invariants; marketing against AMA public definitions/ethics, deliverability/consent
  regulations (CAN-SPAM, GDPR). Then `docs/professions/finance/wiki/` and
  `docs/professions/marketing/wiki/` produced from the fetched text + seed wiring in
  `seed-profession-corpus.ts`. The provenance lint from Phase 2 gates both.
- MCP (conditional on EP-WWMD-MCP): the `wwmd_evaluate`/`wwmd_decide`/
  `wwmd_record_outcome` tools are not yet registered in `mcp-tools.ts` — if they have
  landed by this phase, verify profession profile ids are accepted as `profileId` under
  existing scopes (should be free if the tools are kind-generic); if not, record the
  requirement on EP-WWMD-MCP and ship this phase without the MCP claim. Agent→profile
  resolution composes with the landed BI-230C9EF7 entry-point rather than a new tool.
- Operator docs (doc-at-ship): extend
  `docs/user-guide/ai-workforce/decision-perspective.md` profile-kind table with
  `profession` and the WSID naming; AGENTS.md §16 WWMD-vs-WWWD note gains the WSID line.

**Verification:** the BI's acceptance criteria run end-to-end on the canonical install:
craft question per pilot role → cited recommend; unbound identifier → unchanged; fresh
install seeds all family profiles + three pilot corpora; org overlay wins for that org.
Full build gate (§5 AGENTS.md) before each PR.

## Phase 6 — Roster-wide corpus rollout (demand-prioritized waves)

**Deliverable:** the remaining ~15 profession families get corpora, in waves, ordered by
observed demand — not by guess.

- Prioritization signal: per-family `defer` counts from the gate ledger (spec §4.11
  rule 2 / §8.6) — the families whose coworkers most often hit craft questions their
  profile can't answer go first. Query surfaces from the existing `DecisionInteraction`
  ledger; no new telemetry.
- Per wave (batch of 2–4 families): dedicated research run against the family's
  registry source list → pipeline-produced corpus tree under
  `docs/professions/<family>/wiki/` → seed wiring → provenance lint → review → promote.
  Each wave is a Build-Studio-sized child BI under EP-WSID.
- Registry hygiene per wave: research passes confirm or supersede the candidate anchor
  standards recorded in Phase 1's registry; update `registry.json` in the same PR.

**Verification:** per wave — same functional gate as Phase 2 (craft question →
recommend with cited fetched sources, on the canonical install or sandbox lease).
Roster-coverage acceptance (spec §8.2) re-asserted after each wave: every active role
resolves; defer-queue trend for covered families decreases.

## Risks & rollback

| Risk | Mitigation / rollback |
|---|---|
| Gate selection regression for existing flows | Selection is additive (null resolver → exact current path); unbound-role regression test in Phase 3; rollback = unbind roles (profiles stay, nothing selects them). |
| Enrichment generalization breaks org corpus | Org tests frozen-green requirement in Phase 4; discriminated union keeps the org branch byte-compatible; rollback = revert the facade commit, profession seeds unaffected. |
| Seed bloat / silent skips on fresh install | Idempotent upserts + loud skip logging + seed invariant check (Phase 1/2); the silent-seed-skips audit pattern applies. |
| Copyright exposure from BoK content | Distillation-only policy + RawSource citations + quotation-length lint (spec §7); content reviewed at PR time. |
| Profession doctrine overriding org business judgment | Authority boundary is explicit evaluator-input shaping (Phase 3) with arbitrate/escalate rules from spec §4.5; the non-inherit boundary is untouched. |
| Training-data authoring sneaks in (research pass skipped under time pressure) | The provenance invariant is mechanical (Phase 2 lint/CI): unsourced pages can't publish, unsourced materials can't promote — the shortcut fails the gate, not a review judgment call. |
| Key sources unavailable or licensed (DMBOK text, ISO standards) | License-class field in the registry decides the path up front: `open` fetched, `licensed` checklist-only, `org-supplied` via document upload (conduit rule, spec §7.7); a thin-but-honest corpus beats a rich fabricated one. |
| Roster drift (new coworkers added without a family mapping) | Coverage lint (Phase 1) fails CI on any active agent/persona missing from `registry.json` — drift is caught at the PR that introduces the role. |

## Sequencing notes

- Phase 0 ships independently and unblocks everything; Phases 1→2→3 are strictly ordered;
  Phase 4 depends on 1 (profiles) but not 3; Phase 5 depends on 2's pipeline; Phase 6
  repeats Phase 5's shape per wave and runs as long as the defer queue says it should.
- Each phase is a Build Studio-sized slice: file child BIs under EP-WSID at promotion
  time (umbrella BI-48B3CEC4 stays the parent, EP-WWMD-MCP umbrella pattern).
- BI-230C9EF7 (org profile resolution) **has landed** (verified 2026-06-09 —
  `resolveProfileMaterialForOrg` in `material.ts` with tests): Phase 3 composes with it —
  same entry-point, two resolvers. Still overlap-sweep before each slice; EP-WWMD-MCP
  remains active on adjacent surfaces (the wwmd MCP tools themselves are unshipped, see
  Phase 5).
