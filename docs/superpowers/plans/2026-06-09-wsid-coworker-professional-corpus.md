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

## Phase 1 — Profession profiles + role resolver

**Deliverable:** three seeded profession profiles and a resolver from coworker role →
profile; unbound roles resolve to null (existing behavior preserved).

- `packages/db/src/seed-decision-perspective.ts`: seed `WSID-DATA-ARCHITECT`,
  `WSID-FINANCE`, `WSID-MARKETING` (kind `profession`, scope per spec §4.2,
  `fallbackProfileId` → the org/platform profile, initial version row). Role bindings
  use registry `agent_name` keys + prompt-slug aliases (spec §4.3):
  `build-data-architect`+`data-architect`, `finance-agent`, `marketing-specialist`.
  Idempotent upsert; loud skip-logging (silent-seed-skips audit).
- New `apps/web/lib/decision-perspective/resolve-profession-profile.ts`:
  `resolveProfessionProfile({ agentId | roleSlug })` resolving agentId → registry entry
  → `agent_name` (or alias) → profile via `scope.roles`. Mirror the landed
  `resolveProfileMaterialForOrg` client-injection pattern so tests use a structural
  fake.
- Tests: resolver hit, miss (null), and fallback-chain shape.

**Verification:** unit tests; then seed against a disposable shadow Postgres
(`source-only worktree verification` pattern) and assert 3 profile rows + version rows +
chain wiring via a seed invariant check. Runtime-bound seed verification routes through
the local-CI convergence sandbox lease, not the worktree.

## Phase 2 — Data-architect starter corpus (first user-visible value)

**Deliverable:** the first real corpus — DMBOK/ANSI-SQL/OWASP distillations — installed,
embedded, and retrievable.

- Corpus content: DPF-authored distillation pages (markdown, founder-kernel wiki layout)
  under a new `docs/professions/data-architect/wiki/` tree — `principle`, `heuristic`,
  `entity`, `summary` kinds; frontmatter carries `principleConsumerArchetype: specialist`,
  `principleConsumerContexts: [data-model]` (+ `data-security` slug if authoring needs
  it — slugs are open kebab-case, no schema change), `principleRingScope: ring-1-coworker`.
  Commandment-in-context for the safety rules (parameterized SQL, least-privilege DB
  access). **Copyright-clean: citations via RawSource, no reproduced licensed text.**
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

## Phase 5 — Finance + marketing corpora, MCP exposure, docs

**Deliverable:** the remaining starter corpora and the external surface.

- `docs/professions/finance/wiki/` (GAAP/ASC distillations, double-entry invariants,
  SoD/SOX concepts) and `docs/professions/marketing/wiki/` (AMA ethics, STP/4Ps,
  consent-compliance commandments) + seed wiring in `seed-profession-corpus.ts`.
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
craft question per role → cited recommend; unbound role → unchanged; fresh install seeds
all three corpora; org overlay wins for that org. Full build gate (§5 AGENTS.md) before
each PR.

## Risks & rollback

| Risk | Mitigation / rollback |
|---|---|
| Gate selection regression for existing flows | Selection is additive (null resolver → exact current path); unbound-role regression test in Phase 3; rollback = unbind roles (profiles stay, nothing selects them). |
| Enrichment generalization breaks org corpus | Org tests frozen-green requirement in Phase 4; discriminated union keeps the org branch byte-compatible; rollback = revert the facade commit, profession seeds unaffected. |
| Seed bloat / silent skips on fresh install | Idempotent upserts + loud skip logging + seed invariant check (Phase 1/2); the silent-seed-skips audit pattern applies. |
| Copyright exposure from BoK content | Distillation-only policy + RawSource citations + quotation-length lint (spec §7); content reviewed at PR time. |
| Profession doctrine overriding org business judgment | Authority boundary is explicit evaluator-input shaping (Phase 3) with arbitrate/escalate rules from spec §4.5; the non-inherit boundary is untouched. |

## Sequencing notes

- Phase 0 ships independently and unblocks everything; Phases 1→2→3 are strictly ordered;
  Phase 4 depends on 1 (profiles) but not 3; Phase 5 depends on 2's content pattern.
- Each phase is a Build Studio-sized slice: file child BIs under EP-WSID at promotion
  time (umbrella BI-48B3CEC4 stays the parent, EP-WWMD-MCP umbrella pattern).
- BI-230C9EF7 (org profile resolution) **has landed** (verified 2026-06-09 —
  `resolveProfileMaterialForOrg` in `material.ts` with tests): Phase 3 composes with it —
  same entry-point, two resolvers. Still overlap-sweep before each slice; EP-WWMD-MCP
  remains active on adjacent surfaces (the wwmd MCP tools themselves are unshipped, see
  Phase 5).
