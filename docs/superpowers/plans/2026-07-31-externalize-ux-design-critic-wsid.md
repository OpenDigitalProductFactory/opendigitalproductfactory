# Externalize the ux-design critic — declared-borrow WSID consults, local axes, and a grounded corpus

**Backlog:** BI-52839DEA (externalization) · BI-F405AC58 (ux-design local axes) · BI-36CE8BAB (L1 page shells, the proving job)

**Epic:** EP-UX-SYSTEM

**Branch:** `claude/portal-ux-progressive-disclosure-6ac55f`

**Decision evidence:** DI-F20DB14D1B92 (mechanism: `served-judgment`, high confidence, margin 2.84) · DI-D4E46B42E22B (scope: `shells-then-migrate`, high confidence, margin 3.79)

**Founder decisions, 2026-07-31:** declared borrow (not impersonation) · advisory authority until the corpus grounds it · seed the corpus from this session's work.

## Outcome

AGT-906 `ux-design-critic` becomes a real participant in the external review process — Claude Code, Codex, and Grok sessions and the PRs they open — without leaving the platform. What crosses the boundary is a **consult**, never a copy: external surfaces call the live `wsid-ux-design` profile and its craft corpus, and every consult lands in the `DecisionInteraction` ledger marked as a borrow.

The first job it reviews is the surface that prompted this work: `/platform/ai/skills`, measured at 5,349 default-visible words against a 450-word budget.

## Grounding — verified live, 2026-07-31

Everything below was measured on this install, not inferred.

| Fact | Evidence |
|---|---|
| WSID is closed to external callers | `evaluate_profession_decision` → `{success:false, error:"no_agent_identity"}`; guard at `apps/web/lib/mcp/packs/profession-decision-pack.ts` `if (!context?.agentId)` |
| WWMD is already open to them | `principle_decide` with `callingPopulation: "external_coding_agent"` succeeded twice, recording DI-D4E46B42E22B and DI-F20DB14D1B92 |
| The coworker exists | `Agent` AGT-906 `ux-design-critic`, active since 2026-07-23 |
| The profile exists | `DecisionPerspectiveProfile` `wsid-ux-design`, kind `profession`, active |
| The craft corpus exists | 11 published pages under `professions/ux-design/` — Nielsen's heuristics, WCAG 1.4.3 / 2.5.8, POUR, hierarchy & density, heuristic-evaluation method, critique-corpus method, critique-calibration gate |
| The critique corpus is EMPTY | `SELECT ... WHERE slug LIKE 'craft/%'` → 0 rows |
| Local axes registry is empty and waiting | `PROFESSION_LOCAL_AXES = []` in `packages/db/src/profession-local-axes.ts`; header names the UX hierarchy-vs-density collapse as its motivating case |
| Axis blockers are cleared | BI-E1267C6D, BI-AA7D80FE, BI-106C2585 all `done` |
| Design-intelligence retrieval is generic | query `"information hierarchy progressive disclosure density"` → Breadcrumbs, Color Only, Heading Hierarchy, Font Size Scale, Progress Indicators |
| Identity is ambiguous | two active `Agent` rows for one coworker: `AGT-906` and `ux-design-critic`; `resolveProfessionProfile` matches `OR: [{agentId},{slugId}]` |

## Why not a skill

The obvious alternative — generate a skill body into `packages/dpf-skill-pack` and let external surfaces load it — scored 7.34 against 15.77 (DI-F20DB14D1B92). The decisive ledger entries were Single Source of Truth (0.35 vs 0.62) and evidence density (0.30 vs 0.85). A skill body is a snapshot of a corpus that keeps moving; prompt-versus-reality drift is root cause RC5 in the holistic-UX spec, and this platform has already been bitten by it twice (design-intelligence CSVs drifting +2 rows from the skill's copy; `specialist-prompts.ts` teaching utilities that no longer exist).

The skill-pack still has a role: it is where the *procedure* for consulting the critic lives. It must not become a second home for the critic's *knowledge*.

## Deliverables

### 1. Declared-borrow WSID (BI-52839DEA)

- `evaluate_profession_decision` accepts `callingPopulation` and `professionKey`. With no `context.agentId` and an external population declared, resolve the profile by key through `resolveProfileMaterialForProfession`. With `context.agentId` present, behaviour is unchanged and the caller may not override the profession it is bound to.
- Ledger rows record the borrow distinguishably: `authSource` external, `caller.client`, `consultedProfile`, and an explicit borrow flag. **This is load-bearing, not bookkeeping** — corpus calibration depends on separating the critic's own judgment from an external agent borrowing the profile. If those rows are indistinguishable, the calibration reference is corrupted at the source.
- Fail-closed preserved: unknown or unpublished `professionKey` errors rather than silently degrading to platform doctrine; low confidence still escalates.
- Converge the duplicate `Agent` rows to one identity before external callers start naming it.

### 2. Corpus reachability from external surfaces (BI-52839DEA)

- Read: craft corpus + critique corpus, for retrieval-augmented grounding.
- Write: critique entries as drafts only. The authority contract in `apps/web/lib/ux-critique/critique-entry.ts` is preserved exactly — an agent caller can only ever produce `verdictAuthority: "agent-proposed"`, which is never calibration-eligible, and `callerKind` is derived from the authenticated principal, never from a client-supplied field.

### 3. ux-design profession-local axes (BI-F405AC58)

Four axes, each sourced, each projecting onto the spine in one hop: `ux-design/hierarchy_clarity`, `ux-design/content_density`, `ux-design/disclosure_quality`, `ux-design/perceptual_coherence`. Provenance and projection targets are already specified on the BI. `content_density` must be labelled platform calibration, not validated science; `perceptual_coherence` is the one validated member (CHI 2015) and may carry more weight.

Constraint carried from the BI: **axes weigh options, they do not set thresholds.** The critique calibration gate's promotion threshold stays a founder risk-appetite call stated in advance, and the critic may not score its own promotion.

### 4. Corpus seeding from live work

As `/platform/ai/skills` is redesigned, capture before/after entries — route, commit sha, viewport, colour scheme, lens, screenshot — drafted `agent-proposed`, with founder verdicts attached through the existing wiki-overlay path. This is the flywheel: every founder review from here becomes calibration data instead of evaporating the way the EP-UX-COGLOAD findings did.

### 5. The proving job — shells, then migrate (BI-36CE8BAB)

Build the L1 page shells and migrate `/platform/ai/skills` onto one, adding it to `MIGRATED_ROUTES` so its absolute budget starts blocking. The critic reviews the redesign through the externalized path; if that consult produces nothing useful, the externalization is wrong and gets reworked before more surfaces depend on it.

## Authority — explicit

The externalized critic is **advisory**. It reports in session and on PRs and blocks nothing. Rationale: an ungrounded design judge is the UICrit zero-shot case at 13.1% comment validity, and a UX signal that cries wolf gets disabled — the failure mode that killed the checks catalogued in spec §2.

The flip to blocking stays owned by BI-8316AC0C's data criteria and BI-42892849's entry condition. **Externalization must not become a back door around the staged authority grant.** The deterministic gates — route-budget regression ratchet, ARIA snapshot, axe — keep blocking throughout; they need no calibration and are unaffected by this plan.

## Verification result — deliverable 1, 2026-07-31

Run against `dpf_local_ci_0` (a real Postgres carrying the real schema and seed), driving
`evaluateProfessionDecisionGate` with no agent identity and a declared borrow of `ux-design`.
Deliberately not the production database: the point was to prove the code path, not to write
borrow rows into the founder's live ledger.

- Resolved `wsid-ux-design`, `professionProfileSelected: true`, **`materialCount: 8`** — the real
  craft corpus was retrieved, not a fallback (sources included `critique-calibration-gate`,
  `information-hierarchy-and-density`, `heuristic-evaluation-method`, `error-prevention-and-recovery`).
- Ledger row `DI-E42BC51C3BE0`: `profileId: wsid-ux-design`, `gateKey: profession`,
  `declaredBorrow: true`, `borrowedProfessionKey: ux-design`, `callingPopulation: external_coding_agent`.
- Unknown craft `not-a-real-craft` → `escalate` with "does not fall back to platform doctrine". Fail-closed holds.

**The verdict was `escalate`** — "profile confidence 0.35 is below the recommendation threshold 0.55",
every material sitting at `effectiveWeight 0.45`. That is the design working, not a defect: the craft
corpus is not yet strong enough for the critic to arbitrate, which is exactly the advisory posture this
plan commits to and the reason the corpus is the gating asset.

Not covered by this run: the MCP transport itself (`context.agentId` plumbing through the tool pack),
which stays unit-covered until `:3001` frees or the portal image is rebuilt. The lease was held by
another contributor throughout (`feat/restaurant-host-command-center`, to 2026-08-01T17:00Z).

## Verification

1. Unit tests for external-population resolution, the unchanged in-portal path, ledger borrow-marking, and fail-closed on unknown profession.
2. `assertProfessionLocalAxisIntegrity` over the four new axes (sourcing, namespacing, one-hop spine projection).
3. Authority-contract tests: an agent-population caller cannot produce a founder/designer verdict by any input path.
4. **Functional proof from a real external session:** `evaluate_profession_decision` called from Claude Code returns a `wsid-ux-design`-grounded recommendation, and the resulting `DecisionInteraction` row shows the borrow. A structural pass is not verification.
5. Route sweep re-measured on the migrated skills route; the new number recorded against the 5,349 baseline.

## Documentation impact

`docs/professions/` gains the axis declarations. The dual-surface skill (`dpf-ux-fit-review` or a sibling) gains the consult procedure — procedure only, never a copy of the corpus. No schema change beyond what the ledger borrow-marking requires; that is decided in the BI.
