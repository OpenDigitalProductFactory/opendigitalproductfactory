# Wiki Principle Scope Refactor — Delivery Plan

> **Status:** Draft for Mark's review. Tagging table is a first-pass classification, not a final call. No frontmatter edits will land until Mark red-lines the table.
>
> **Carve-out note.** This work is governance/maintenance reclassification, falling under the `feedback_no_manual_prs` carve-out for direct PR work while the Build Studio queue is jammed. No BS pipeline.

## Goal

Make the kernel wiki intuitive to navigate by scope. Today a Build Studio coworker, a finance coworker, and a human reading the wiki all see the same flat list of ~58 principles, most tagged `universal`. The schema and the wiki browser already support archetype + context grouping — the gap is purely content tagging plus a missing retrieval filter.

After this refactor, a user landing on `/wiki?kind=principle` filtered to "Build Studio" sees only the principles that actually bind Build Studio work, and a finance coworker's prompt context pulls only finance + universal principles.

## Root cause: today's tag distribution

Across 58 published principles under `docs/founder-kernel/wiki/principles/`:

| Field | Distribution |
|---|---|
| `principleConsumerArchetype` | 33 universal · 10 ai-coworker-universal · 1 generalist · 1 specialist · 1 route-domain-specific · **12 missing the field** |
| `principleConsumerContexts` | 0 populated entries (the one route-specific principle has an empty array) |

The renderer in `apps/web/components/wiki/WikiPageList.tsx` already groups principles by archetype → context → tier. It renders a flat "Universal · 33" bucket because that's what the data says. Retrieval (`recallPrincipleContext` in `apps/web/lib/wiki/principle-recall.ts`, `principle_decide` in `apps/web/lib/wiki/principle-decide.ts`) filters by `principleAppliesTo` (population) but **never by consumer context**, so cross-domain principles bleed into every coworker's prompt.

## Consumer-context vocabulary (proposed)

The seed examples in `packages/db/src/wiki-taxonomy.ts` are `build-studio, marketing, compliance, discovery, finance, storefront, portfolio`. Based on actual principle content, extending to:

| Slug | Scope |
|---|---|
| `build-studio` | BS lifecycle, sandbox, design review, contribution mode |
| `engineering-flow` | PR workflow, branches, worktrees, commits, DCO, push discipline |
| `ui` | Theme tokens, color rules, layout standards |
| `data-model` | Schema design, identity entities, enum stewardship, principal convergence |
| `mcp` | MCP tools, grants, token scopes, tool authorization |
| `release` | QA plan, build gate, release evidence, deployment contracts |
| `finance` | Accounting, controls, financial reporting |
| `storefront` | Storefront/portal customer-facing surface |
| `marketing` | Marketing surfaces |
| `discovery` | Discovery / scout / ideate phases |
| `compliance` | SOC2, regulatory, audit |
| `portfolio` | Portfolio management, epics, backlog scope decisions |

These remain governed slugs (not a closed enum), but additions need a PR-reviewed rationale.

## Phased delivery

### Phase A — Tagging audit *(content only, no code)*
- Lock the consumer-context vocabulary above.
- Walk all 58 principles. Set `principleConsumerArchetype` + `principleConsumerContexts` based on the table in §"First-pass classification" below (after Mark's red-line).
- Backfill the 12 missing-field principles in the same pass.
- One bundled PR — this is governance reclassification, not 12 separable concerns.

### Phase B — Retrieval filter *(code, ~½ day)*
- Add optional `consumerContexts: string[]` to `recallPrincipleContext` and `principle_decide`.
- Filter rule: rows with `archetype = "route-domain-specific"` must intersect caller contexts; `universal` / `ai-coworker-universal` / `generalist` always pass.
- Map calling surfaces → contexts at the wiring layer: Build Studio coworker → `["build-studio", "engineering-flow"]`; storefront chat → `["storefront"]`; finance coworker → `["finance"]`. Single registry at `apps/web/lib/wiki/consumer-context-map.ts`.

### Phase C — Browse UX *(small)*
- Filter chip row at top of `/wiki?kind=principle`: click "Build Studio" → hide route-specific entries that don't include `build-studio`. Universal stays.
- Scope badges on the principle detail page so the boundary is visible when reading the page directly.

### Phase D — Lint *(tiny)*
- New detector `principle-untagged-archetype` (severity: `warn`) so the field can't be omitted on a new principle.
- New detector `principle-universal-overuse` (severity: `info`) — warn when >40% of published principles are `universal`. Forces explicit context choice.

### Phase E — AGENTS.md cleanup *(after A lands)*
- AGENTS.md currently inlines 30+ principle links as a flat list. After re-tagging, restructure to call out the consumer context per group: "Engineering flow", "UI", "Data model", "MCP", etc. Cross-link the wiki's new filtered views.

### Phase F — Recursive scoping loop *(durable practice)*
- The kernel is its own decision substrate. When adding a new principle or periodically reassessing existing ones (after adding a feature, surfacing a new coworker specialist, introducing a new route/domain), use `mcp__dpf__principle_decide` to score archetype + context options against the live principle vector field.
- Authoring guidance added to [AUTHORING.md §8A](../../founder-kernel/AUTHORING.md). Captures the recursive pattern this plan itself used (running Q1–Q4 through `principle_decide` rather than guessing).
- Periodic-assessment triggers: new feature, new coworker specialist, new route/domain context, or a principle that keeps appearing in irrelevant prompt contexts. The principle-recall trace + the `principle_decide` ledger are the data signals for triggering review.
- Out of scope for this PR but worth a follow-up: a scheduled job that walks all `route-domain-specific` principles and re-runs `principle_decide` against the current vector field, surfacing any whose recommendation has drifted. Backlog candidate.

### Commandment cap removed (Phase A addition)
The original plan implied Phase A was pure tagging. During execution we discovered the kernel had 12 canonical commandments + 4 broken-legacy commandments — 16 total against a cap of 10. Per Mark's direction the cap is gone: commandments are about conflict-resolution priority (weight 1.0 wins), not scarcity. Phase A added: remove `PRINCIPLE_TIER_CAPS.commandment`, delete `principle-commandment-cap-exceeded` detector + tests, update SCHEMA.md / AUTHORING.md / spec lint table, and explicitly support "commandments in context" (a `route-domain-specific` principle may be tier=commandment to mean non-negotiable within its declared contexts).

## First-pass classification (DRAFT — needs Mark's review)

The Explore agent classified all 58 principles conservatively: 37 universal, 14 ai-coworker-universal, 7 route-domain-specific. I disagree on ~15 of those — the agent left engineering-flow rules (worktree, PR, DCO, branch-guard) and data-model rules (schema-audit, strongly-typed-enums) tagged as universal even though they only bind contributors touching code. They don't apply to a finance coworker working a /finance/* route who never touches a branch.

### Distribution after my refinements

| Archetype | Agent's count | My refined count |
|---|---|---|
| `universal` | 37 | ~14 |
| `ai-coworker-universal` | 14 | ~14 |
| `route-domain-specific` | 7 | ~30 |

### Per-principle table

Legend: **bold** rows are where I diverge from the Explore agent's first pass.

| slug | tier | proposed_archetype | proposed_contexts | rationale |
|---|---|---|---|---|
| all-changes-land-via-pr | commandment | **route-domain-specific** | engineering-flow | Binds code contributors; not finance/storefront coworkers |
| always-push-after-committing | contextual | **route-domain-specific** | engineering-flow | Same — code-contribution rule |
| architecture-over-shortcuts | commandment | universal | — | Posture binds all roles |
| autonomous-directives-are-blanket-approval | core | ai-coworker-universal | — | Agent execution grant |
| backlog-lives-in-postgresql | core | route-domain-specific | portfolio | Backlog scope |
| branch-guard-before-implementation | core | **route-domain-specific** | engineering-flow | Code contributors only |
| build-gate-mandatory | commandment | **route-domain-specific** | engineering-flow, release | Code completion contract |
| check-epic-overlap-before-creating | contextual | route-domain-specific | portfolio | Backlog discipline |
| check-tool-signals-first | core | ai-coworker-universal | — | Agent tool debugging |
| consult-specs-first | core | universal | — | Design-time discovery for all |
| contextualize-before-transforming | core | universal | — | Adoption discipline |
| db-fallback-explicit | contextual | route-domain-specific | mcp | MCP failover |
| dco-sign-off-required | commandment | **route-domain-specific** | engineering-flow | Code commits only |
| design-research-required | core | universal | — | Spec discipline |
| destructive-actions-require-explicit-go | commandment | ai-coworker-universal | — | Agent action approval |
| diversity-of-thought | core | ai-coworker-universal | — | Agent cognitive model |
| do-the-work-dont-task-the-operator | commandment | ai-coworker-universal | — | Agent work ethic |
| evidence-before-diagnosis | core | ai-coworker-universal | — | Diagnostic discipline |
| external-and-internal-work-share-gates | core | **route-domain-specific** | engineering-flow, build-studio | Build gate parity |
| fail-fast-explain-clearly | core | ai-coworker-universal | — | Agent error reporting |
| fix-the-seed-not-the-runtime | core | **route-domain-specific** | data-model | Seed/initialization |
| human-in-the-loop-at-phase-boundaries | commandment | universal | — | Governance gate |
| keep-root-clone-as-merge-worktree | contextual | **route-domain-specific** | engineering-flow | Worktree flow only |
| live-state-over-seed-data | core | **route-domain-specific** | data-model | Data sourcing |
| mention-uncommitted-changes | contextual | **route-domain-specific** | engineering-flow | Code-contribution reporting |
| never-ask-user-to-run-commands | commandment | ai-coworker-universal | — | Agent autonomy |
| never-fabricate | commandment | universal | — | Integrity binding all |
| never-wipe-db-for-code-fixes | commandment | ai-coworker-universal | — | Agent destructive guard |
| no-assumptions | commandment | universal | — | Verification discipline |
| no-hardcoded-colors | commandment | route-domain-specific | ui | UI infrastructure |
| one-concern-per-pr | core | **route-domain-specific** | engineering-flow | PR discipline |
| one-data-model | core | **route-domain-specific** | data-model | Architecture for data |
| orchestrator-worker-pattern | core | route-domain-specific | build-studio | BS workflow pattern |
| organization-canonical-identity | core | **route-domain-specific** | data-model | Identity entity |
| plan-before-install-paths | contextual | **route-domain-specific** | engineering-flow, release | Setup/seed/template work |
| prefer-self-hosted-infrastructure | core | universal | — | Infrastructure posture |
| principal-convergence | core | route-domain-specific | data-model | Identity entity model |
| release-qa-plan | core | route-domain-specific | release | Release discipline |
| research-and-use-standards | commandment | universal | — | Standards practice |
| research-before-implementing | core | universal | — | Implementation discipline |
| responsible-capacity-utilization | core | universal | — | Resource stewardship |
| schema-audit-before-features | core | **route-domain-specific** | data-model | Schema audit |
| security-fix-needs-regression-test-first | core | **route-domain-specific** | engineering-flow | Security PR discipline |
| selective-memory-not-total-recall | core | ai-coworker-universal | — | Agent memory |
| single-source-of-truth | commandment | universal | — | Master data discipline |
| specialization-over-generalization | core | ai-coworker-universal | — | Agent tool scope |
| state-results-directly | core | ai-coworker-universal | — | Agent reporting |
| strongly-typed-string-enums | core | **route-domain-specific** | data-model | Type safety for schema |
| structural-verification-is-not-functional | commandment | **route-domain-specific** | engineering-flow, build-studio | Code-completion definition |
| structured-handoffs-not-conversation-history | core | ai-coworker-universal | — | Phase handoff discipline |
| sweep-main-before-trusting-worktree-specs | core | **route-domain-specific** | engineering-flow | Worktree freshness |
| test-in-the-portal-build | commandment | **route-domain-specific** | engineering-flow, release | Feature verification |
| tool-evaluation-pipeline | core | route-domain-specific | mcp | Tool adoption governance |
| tools-must-be-self-documenting | core | route-domain-specific | mcp | MCP tool design |
| trust-the-data-spine | core | **route-domain-specific** | data-model | Data integrity contract |
| verify-substrate-before-proposing-new | core | universal | — | Duplication prevention spans roles |
| worktree-base-origin-main | core | **route-domain-specific** | engineering-flow | Worktree baseline |
| worktree-per-session | core | **route-domain-specific** | engineering-flow | Session isolation |

## Open questions — resolved via principle_decide (2026-05-22)

All four ran through the `principle_decide` advisory tool. Results below; full per-principle contribution ledger available by re-running the tool with the same context strings.

| Question | Recommendation | Composite | Margin | Confidence |
|---|---|---|---|---|
| Add 'engineering-flow' as a context slug? | **Yes** | 5.535 | 1.922 | high |
| Threshold for tagging 'universal'? | **Strict** (only if a non-code coworker would consult it) | 5.685 | 2.459 | high |
| build-gate-mandatory scope? | **engineering-flow + release** (not build-studio + release) | 5.064 | 0.847 | high |
| Phase B retrieval filter? | **Strict** (route-specific never appears outside declared contexts) | 5.648 | 1.817 | high |

**Strongest positive pulls across all four:** Research-and-Use-Standards, No-Hardcoded-Colors, Never-Assume-Verify, Architecture-Over-Shortcuts — the principle field favors explicit scoping, schema grounding, and lower long-run cognitive load.

**Real dissent worth recording:** "Do the work; don't task the operator" came in slightly negative on every rigorous option (-0.16 to -0.18 alignment). The tool reads "more scoping discipline = more authoring overhead." That overhead is real but lands on future principle authors, not on the current refactor. Mitigation: the proposed lint detectors (`principle-untagged-archetype`, `principle-universal-overuse`) absorb the discipline cost into the tooling, not into author memory.

**Smallest margin: Q3 (0.847).** The three-context option (engineering-flow + build-studio + release) was within ~1.0 of the winner. If Mark wants the build-gate to surface in BS sandbox prompts without going through context-map inheritance, this is the one to flip.

## Done criteria

- All 58 principle files have `principleConsumerArchetype` set explicitly. No `MISSING` rows.
- ≤30% of published principles tagged `universal` (down from 67% today).
- `recallPrincipleContext` and `principle_decide` accept and honor `consumerContexts`.
- `/wiki?kind=principle` ships a context filter chip row; default view groups by archetype → context → tier.
- AGENTS.md inline principle references are grouped by context with cross-links to filtered wiki views.
- New lint detectors (`principle-untagged-archetype`, `principle-universal-overuse`) wired and green.
