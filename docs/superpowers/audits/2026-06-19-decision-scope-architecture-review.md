# Decision-Scope Architecture Review — WWMD / WWWD / WSID

**Date:** 2026-06-19
**Trigger:** After the AI-second-brain review, the operator asked to apply the same approach to the platform's three decision/knowledge scopes — **WWMD** (platform/founder), **WWWD** (organization/archetype), **WSID** (coworker/trade) — examined through one lens: each has a *persona*, a *source*, and a *human interaction*; they must operate **independently yet in each other's context**; and it must work for **autonomous decisions, proactive opportunities, and the respective human context**.
**Verdict:** The three-scope model is real, documented, and substantially built — personas, sources, per-scope humans, composition (prompt layering + inheritance chain), and the non-inherit boundary all exist in code and user-guide docs. As with the second-brain review, the missing piece is **governing doctrine**: the model lived in user-guide docs and specs but was **not a kernel principle**, so it didn't govern agent behavior or `principle_decide`. That gap is now closed. The remaining gaps are tracked build work, routed below — not re-implemented here.

---

## 1. The three scopes through the operator's lens

| | **WWMD** (platform) | **WWWD** (organization) | **WSID** (profession) |
|---|---|---|---|
| **Persona** | The founder / platform | The business (archetype-shaped) | The trade / competent professional |
| **Source** | Founder kernel (`docs/founder-kernel/`) | Org-overlay wiki + `DecisionPerspectiveProfile`, archetype-seeded | Per-profession source-traced corpus (`docs/professions/`) |
| **Human** | DPF contributor / Build Studio owner | Business owner / operator | The worker in that role |
| **Decision engine** | `principle_decide` + option-scoring | Decision Perspective Gate (profile-aware) | Profession corpus injected into the coworker prompt |
| **Autonomous use** | Build Studio gates, runtime kernel gate | Gate autonomy ladder (recommend/arbitrate/escalate/defer) per profile policy | Prompt-level craft grounding via `decision-routing-block` |
| **Proactive use** | Not yet | Not yet (depends on org-profile wiring) | Not yet |
| **Composed** | Layered into one coworker prompt: WSID corpus → WWWD wiki → tools; routing block tells the coworker which scope owns each question | | |
| **Status** | Live for platform decisions | **Seeded but never read** in decisions | Live + injected every response (EP-WSID **done**) |

**Independence is real and documented:** the inheritance chain (WSID → WWWD → DPF-advisory → defer), the non-inherit boundary ("a customer profile does not inherit platform business judgment as authority"), and per-scope human resolvers (`DecisionResolverRule`: build-studio-owner / principal / role / manual) all exist. Sources: `apps/web/lib/decision-perspective/`, `apps/web/lib/tak/prompt-assembler.ts`, `apps/web/lib/tak/decision-routing-block.ts`, `docs/user-guide/ai-workforce/decision-perspective{,-in-practice}.md`.

## 2. The genuine gaps (live-backlog-grounded)

| Gap | Status | Tracked as | Action |
|---|---|---|---|
| **No kernel principle for the three-scope authority model** | **Was absent** | — | **Implemented** (this change) |
| **Org WWWD is seeded but never read** — `resolveProfileMaterialForOrg()` exists, tested, called nowhere; decisions resolve against WWMD | Designed, code-complete, unwired | **BI-230C9EF7** (open) in **EP-WWMD-MCP** (verified live) | Route — build work |
| **Dual decision paths** — Gate is profile-aware but Build-Studio-only; `principle_decide` (what coworkers call) is profile-unaware → business decisions scored against the founder kernel | Designed | Cited in specs as "BI-E1FB2307"; **not present in this install's live backlog** — a cross-install/Mac-handoff artifact. The consolidation/exposure work lives under **EP-WWMD-MCP** (16 open) | Route — verify/ refile under EP-WWMD-MCP before acting |
| **WWWD cold-start** — org seeded with templates, continuous enrichment unbuilt | Designed | EP-CORPUS-BOOTSTRAP (per spec) | Route + the elicitation discipline (below) |
| **Proactive opportunities, scope-aware** — each scope proposing work to its own human | Unbuilt | **Not clearly tracked** — `EP-PROACTIVE-OPS` is Digital-Product operational awareness, a different domain | Recommend a BI after a backlog sweep |

## 3. What this change implements

Mirroring the second-brain review: additive **governing doctrine**, no duplicated substrate.

- **Kernel principle** [`decisions-belong-to-their-scope`](../../founder-kernel/wiki/principles/decisions-belong-to-their-scope.md) (`core`, `principlePublic: false`) — the keystone. Names the three scopes with their persona/source/human, states the non-inherit boundary as its operative rule (anchored in **subsidiarity**, raw-source `frameworks/subsidiarity`), distinguishes the decision-scope trio from the delivery-surface trio (`one-common-process-three-surfaces`), and makes "a silent scope is a capture gap, not a license to borrow authority" explicit. This elevates the model from user-docs into the kernel that governs agent behavior and `principle_decide`, and gives the tracked consolidation work (EP-WWMD-MCP) a citable doctrine.
- **Connected the second-brain knowledge-engineering cluster to the three scopes:** [`elicit-tacit-knowledge`](../../founder-kernel/wiki/principles/elicit-tacit-knowledge.md) and the `dpf-elicit-tacit-knowledge` skill now name the three scope-sources and flag the **WWWD cold-start as the prime elicitation target** — the most concrete, highest-value acquisition gap, where an org's real "what would we do" is tacit in the operator's head and the corpus is still template-seeded.
- **AGENTS.md §16** "WWMD vs WWWD" now points at the governing principle.
- Manifest: `pageCount` 91→92, `sourceCount` 14→15 (cumulative with the second-brain batch in this worktree).

**On tier:** the non-inherit boundary is described as "non-negotiable" in `decision-perspective.md`. The principle is authored `core` (humble for a new kernel page); it may warrant `commandment` on the operator's ratification — flagged for the PR.

## 4. Deliberately not built

- **The dual-path consolidation, org-profile wiring (BI-230C9EF7), continuous WWWD enrichment** — substantial feature work, already tracked under **EP-WWMD-MCP** / EP-CORPUS-BOOTSTRAP. Implementing them is a Build-Studio / planned-spec effort, not a doctrine-review task. Routed, not duplicated (`verify-substrate-before-proposing-new`).
- **A "proactivity is scope-bounded" principle** — proactive opportunity generation is unbuilt across all scopes; authoring doctrine for a non-existent capability is premature (`schema-honesty-over-aspirational-naming`). Better as a BI once the substrate exists.
- **Re-documenting the model** — `decision-perspective{,-in-practice}.md` already explain it well; the principle points at them rather than restating (`single-source-of-truth`).

## 5. Recommended next step

Land the doctrine (this change, with the second-brain batch), then — if the operator wants to move the architecture forward — the highest-leverage build is **BI-230C9EF7**: wire `resolveProfileMaterialForOrg()` into the decision path so the org's WWWD finally becomes authoritative for its own business decisions, which is the single change that makes the non-inherit boundary *enforced* rather than *documented*. The new principle is the doctrine that work satisfies.
