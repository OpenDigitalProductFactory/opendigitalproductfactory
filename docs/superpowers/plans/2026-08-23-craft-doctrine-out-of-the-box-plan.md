---
status: draft
---

# Craft Doctrine Out of the Box: Ship the Baseline, Route the Approval

| Field | Value |
| ----- | ----- |
| Status | Draft — for owner review before implementation |
| Backlog | BI-F0B476D0 (seed provenance / vendor tier), BI-4448BBC4 (domain approval authority + first-run review) |
| Supersedes question in | BI-0F3D5F94 (WSID recommendation ceiling) |
| Decision record | DI-535966FDBEC1 (ship OOTB) · DI-CEEBF53011F0 (distinct vendor tier) · DI-DA958101713B (public-record research — WWWD escalated, owner ruling required) |
| Owner | Platform (WWMD) |
| Authored | 2026-08-23 |
| Claims re-verified | 2026-11-14 against `main` — see §9 |

---

## 1. The problem, in one line

A fresh install ships craft doctrine that no coworker can use, and asks every customer to hand-approve identical vendor-written content before it works.

## 2. What is actually wrong

### 2.1 One conflation causes two defects

`packages/db/src/profession-material-promotion.ts`:

```
PROFESSION_MATERIAL_TIERS = {
  derived:   { evidenceGrade: "B", confidenceWeight: 0.6 },
  confirmed: { evidenceGrade: "A", confidenceWeight: 0.9 },
  ruled:     { evidenceGrade: "A", confidenceWeight: 1.0 },
}
const held = input.tier === "derived" && isHighStakesProfession(input.contextSlugs);
```

Everything from the platform seed lands `derived`, with no distinction between:

- **vendor-authored** pages under `docs/professions/**` — written by a person and landed through PR, DCO, guards and semantic review; and
- **install-derived** material inferred from a particular org's own documents (`apps/web/lib/wiki/enrich-org-corpus.ts`, and `capture-business-document.ts` which explicitly captures with `origin="document", trust="derived"`).

Those have opposite provenance. The module's own comment already states the rule its code does not apply: *"Confirmed/ruled tiers are human actions by definition and go gate-live everywhere."* Vendor-authored corpus **is** a human action — reviewed once, upstream, by someone with more context on that doctrine than any individual customer.

**Defect 1 — the mute acumen.** High-stakes families (`contextSlugs` touching finance or compliance) are withheld from the gate on every fresh install. Measured: `wsid-security` sat `draft/candidate`, 6 rows, 0 attribution, until an operator approved it by hand.

**Defect 2 — the recommendation ceiling (BI-0F3D5F94).** `derived` yields `effectiveWeight = 0.6 × 0.75 = 0.45`, below the 0.55 threshold, at every risk tier. Measured: all six acumens returned `escalate` — 0.35 at medium, 0.20 at high. The craft tier has never once recommended.

### 2.2 Onboarding only ever addressed the owner

`2026-07-16-employee-occupation-onboarding-and-role-tailored-workspace-design.md` §2.2, confirmed: first-run is detected at org level (`isFirstRun()`) and the tour binds to `PlatformSetupProgress.userId` — the owner only. A non-owner employee's first login gets nothing. There is no per-user onboarding-completion flag. `OnboardingPanel.tsx` + the `OnboardingTask` model exist and function but are wired to no route.

So even where the right person to approve finance doctrine exists, nothing tells them to, and nothing told the operator to add them.

## 3. Design principles

1. **Nothing ships mute.** Craft competence must not depend on a customer noticing an unprompted task.
2. **Approval is an invitation, not a gate.** Review is offered to the right human; the baseline works meanwhile.
3. **Authority follows the job, not the admin ladder.** A compliance officer approves compliance doctrine without gaining platform administration.
4. **One taxonomy.** The authority axis reuses the `contextSlugs` the high-stakes hold already keys on — not a second parallel vocabulary.
5. **Small companies are the default case.** Every domain falls back to the setup person; nobody is blocked for lacking a compliance department.
6. **Approval is a recorded act, not a live permission check.** Material approved by someone who later leaves stays approved.
7. **No new UX surfaces.** Extend the surfaces that exist, disclosed progressively; sub-pages reveal detail on demand.
8. **Ask, don't form-fill.** The coworker gathers what it needs conversationally, from an uploaded document, or from public research — a form is the last resort, not the first.

## 4. Phases

### Phase 1 — Provenance at seed time (BI-F0B476D0)

Distinguish vendor-authored from install-derived at the seed call site.

- Vendor-authored `docs/professions/**` seeds at a **new `vendor` tier** (A/0.9, ranked below `confirmed`) and ships gate-live.
- `confirmed` keeps its existing meaning — *a human at this install confirmed it* — so an audit can always tell shipped doctrine from locally-reviewed doctrine, and a local confirmation visibly upgrades a vendor row. Settled by DI-CEEBF53011F0 (composite 9.259 vs 4.812, margin 4.447, high confidence) rather than reusing `confirmed` for the smaller diff.
- Widening `PROFESSION_MATERIAL_TIERS` touches `TIER_RANK` and `tierOf()`; the never-downgrade guard must rank `vendor` below `confirmed` below `ruled`.
- Install-derived / org-inferred material stays **`derived`** and stays held for high-stakes families — the case the hold was genuinely designed for, untouched.
- The never-downgrade guard already protects a `ruled` row from a later `confirmed` write, so an operator override still wins.

**Closes:** the mute acumen, and the recommendation ceiling — `vendor` carries A/0.9, so `effectiveWeight = 0.9 × 1.0 = 0.9`, clearing 0.55 at low/medium/high; critical still escalates, correctly.

**Verification:** a freshly seeded install answers `evaluate_profession_decision` for `security` with `professionProfileSelected: true` and a non-escalate outcome at medium risk, with no human action taken.

### Phase 2 — Domain approval authority (BI-4448BBC4)

A scoped authority answering "who may approve craft doctrine and stances for this area."

- Domains are `contextSlugs` (finance, compliance, data-security, …) plus a platform-wide default.
- Bound through the occupation seam (spec §5.6, `OccupationProfile.baseAccessProfile`), **not** by granting `manage_platform` — a platform-administration capability is the wrong instrument for domain stewardship (see §6.2).
- Unfilled domain → falls back to the setup person or a designated manager.
- Open for review: does authority attach to `OccupationProfile`, an explicit grant row, or an employee designation? Settle against §5.6's Option A/B seam before coding.

### Phase 3 — Acquiring who the approvers are, without a form (BI-4448BBC4)

Three input paths, in preference order, all landing on the same authority record:

1. **The coworker asks.** During the existing COO-led setup tour, the onboarding coworker asks who owns finance and who owns compliance/HR — the two areas the initial content most needs. This is the `SetupOverlay` → `open-agent-panel` → `autoMessage` path that already exists; it needs a step, not a screen.
2. **An uploaded document.** `apps/web/lib/onboarding/capture-business-document.ts` already stores an operator-uploaded document in the DMS, extracts its text, and passes it through the `enrich` seam to `enrichOrgCorpus(origin="document", trust="derived")`. An org chart, employee handbook, or governance policy goes through the same path; extracted names become **proposals**, not assignments.
3. **Public-information research.** Where officials are a matter of public record, the discovery/scout substrate can pre-fill proposals. Owner precedent: a study of a company with public officials recovered ~80% of this from public sources. Same rule — proposals, confirmed by a human before they carry authority.

All three converge on the same review step, so no path is privileged and no path can silently grant authority. Extracted or researched names land `derived`/draft exactly as document-captured corpus material does today.

### Phase 4 — First run reviews what shipped (BI-4448BBC4)

- Summarise the doctrine the install shipped with, per area, in owner language — a short summary, with sub-pages revealing the underlying pages on demand.
- Offer tailoring of the nuanced parts — policies and stances — rather than an all-or-nothing approve.
- Render on the **existing** `/coworker-decisions/review` surface (BI-5F3BFD13 precedent), generalised from "held, blocking" to "shipped, reviewable". No new route.
- An approver sees their own areas; the setup person sees what is unassigned.

## 5. The tradeoff, stated plainly

Shipping gate-live means a customer's coworkers act on vendor doctrine the customer never personally read. That is the real cost and it should not be glossed.

Three things make it the better trade: the material is auditable and visible on the review surface; an operator can still rule over it (`ruled` outranks `confirmed`); and the status quo's failure mode is a **silently** mute high-stakes acumen on every fresh install, which is worse precisely because nobody notices.

## 6. Research & benchmarking (AGENTS.md §7)

### 6.1 Shipping enabled defaults with per-org override — policy-as-code

Kubernetes policy-as-code engines are the closest external analogue: a vendor ships a **built-in policy library** that is enabled, and organisations add their own policies in a separate location that is composed in at render time — "this approach keeps the built-in policy library and custom policies cleanly separated while still following the same GitOps workflow." Kyverno uses declarative YAML with compliance reporting out of the box; OPA Gatekeeper uses Rego with reusable constraint templates across clusters.

**Adopt:** vendor baseline ships enabled; per-install material lives on a separate, clearly-marked path; both compose through one pipeline. This is exactly Phase 1's `confirmed` vs `derived` split.

**Reject:** the requirement to author policy in a DSL. Our corpus is prose with a dimension vector, aimed at non-technical owners; a Rego-equivalent authoring step would defeat principle 8.

### 6.2 Separating domain stewardship from system administration

Data-governance practice separates these as distinct roles rather than tiers of one ladder: **data stewards** "bridge business and IT: define metrics, enforce quality rules, and set access policies," while a **data custodian** — the system administrator — is "responsible for some aspect of the management and operation of a system," handling technical safeguards and monitoring. RBAC is described as preventing conflicts of interest by separating roles that involve data access, editing and governance. Microsoft Purview implements this concretely: governance-domain roles are assigned *per governance domain*, by a governance domain creator, under that domain's own Roles tab.

**Adopt:** domain approval authority is a stewardship role, assigned per domain, distinct from platform administration. This validates principle 3 as established practice rather than a local invention — the specific question flagged as unverified in the previous draft of this plan, now answered.

**Reject:** a full owner/steward/custodian triad. At the target company size the distinction that pays is steward vs administrator; adding custodianship as a third assignable role would create a taxonomy nobody fills.

### 6.3 Conversational onboarding over setup screens

Slack's Slackbot is the reference implementation of the input model in Phase 3: a bot-driven sequence that "teaches features through conversation… instead of a traditional product tour, users learn by doing, inside the actual product interface." Progressive-disclosure guidance is consistent across SaaS onboarding practice — surface information as it becomes relevant rather than all at once, to keep cognitive load manageable.

**Adopt:** the coworker asks inside the existing surface; detail is revealed on demand via sub-pages. Directly supports principles 7 and 8, and the platform already has the mechanism (`SetupOverlay` dispatching `open-agent-panel` with an `autoMessage`).

**Gap — no external pattern found.** Extracting *organisational role assignments* from an uploaded document, or from public-record research, to pre-fill governance authority is not an established pattern in the sources reviewed. Onboarding document upload is well covered as document *collection*; using it as a structured-fact source is an adaptation of our own `capture-business-document` → `enrichOrgCorpus` pipeline. Treat Phase 3 paths 2 and 3 as novel and therefore as **proposal generators requiring human confirmation** — which is what the existing pipeline already does by landing `derived`/draft.

**Sources:** [CNCF: GitOps policy-as-code with Argo CD and Kyverno](https://www.cncf.io/blog/2026/04/02/gitops-policy-as-code-securing-kubernetes-with-argo-cd-and-kyverno/) · [OPA vs Kyverno](https://www.plural.sh/blog/open-policy-agent-vs-kyverno/) · [Atlan: data governance roles](https://atlan.com/data-governance-roles-and-responsibilities/) · [Atlan: RBAC in data governance](https://atlan.com/know/rbac-access-data-governance/) · [Microsoft Purview: data governance roles and permissions](https://learn.microsoft.com/en-us/purview/data-governance-roles-permissions) · [University of Iowa: data governance roles](https://hub.data.uiowa.edu/data-governance/data-governance-roles) · [Appcues: SaaS onboarding examples](https://www.appcues.com/blog/saas-user-onboarding) · [Pendo: onboarding and progressive disclosure](https://www.pendo.io/pendo-blog/onboarding-progressive-disclosure/) · [UXPin: progressive disclosure](https://www.uxpin.com/studio/blog/what-is-progressive-disclosure/)

## 7. Out of scope

- Changing the high-stakes hold itself. It stays, and stays correct, for install-derived material.
- The `manage_platform` capability definition.
- Retiring the held-material review surface (BI-5F3BFD13) — still required for install-derived material.
- Any new route. Phase 4 generalises an existing surface; Phase 3 adds a setup step, not a screen.

## 8. Decisions settled, and the one that is not

Three questions this plan previously carried were platform-architecture calls and have been routed through WWMD rather than asked cold (AGENTS.md §11).

**Settled — vendor tier (DI-CEEBF53011F0).** A distinct `vendor` tier, not a reuse of `confirmed`. Composite 9.259 vs 4.812, margin 4.447, high confidence, autonomy eligible. Preserving the "who confirmed this, and where" distinction beat the smaller diff decisively.

**Settled — notify without blocking.** High-stakes areas raise a first-run notification rather than a gate. Visibility is what the hold was actually buying; the block was a blunt instrument for it, and principle 1 forbids shipping mute.

**Settled — no delegation in v1.** Single holder per domain plus fallback to the setup person. Delegation is deferrable substrate that nobody at the target company size has asked for; adding it now would be a taxonomy nobody fills (the same reason §6.2 rejected the full owner/steward/custodian triad).

**NOT settled — public-record research posture (DI-DA958101713B).** Routed to WWWD, which escalated: `orgProfileSelected: true`, `stanceAlignment: "none"` — the organisation has **no recorded stance** on researching named individuals from public records. This is correctly an owner ruling, not a platform decision, because it concerns real people rather than system architecture.

The question, plainly: when onboarding a customer, may the platform look up public-record information about named individuals at that company to pre-fill who approves what? The plan currently assumes the narrowest posture — only where officials are a matter of public record, always as unconfirmed proposals a human must accept, never for private individuals. **Phase 3 path 3 must not be built until this is ruled**, and the ruling should be recorded as an org stance so the question is answered once rather than re-escalated on every install.

## 9. Currency check, 2026-11-14

This plan was authored on 2026-08-23 and lands later, so every load-bearing claim in it was re-checked against `main` before it was published. All still hold:

| Claim | Where | State |
| --- | --- | --- |
| `held = tier === "derived" && isHighStakesProfession(...)` | `profession-material-promotion.ts:257` | unchanged |
| `HIGH_STAKES_CONTEXT_SLUGS = ["finance", "compliance"]` | same file, line 104 | unchanged |
| Tier ladder is still `derived` / `confirmed` / `ruled` with no vendor tier | same file | unchanged — Phase 1 is still unbuilt |
| Discounts: grade B 0.75, review draft 0.35, promotion candidate 0.45 | `decision-vectors.md` §5.2 | unchanged, so the 0.45-vs-0.55 ceiling still holds |
| §5.3 "the high-stakes hold, and how it is released" | `decision-vectors.md` | present |
| Held-material release path and its approval surface | `held-material-store.ts` | present (BI-5F3BFD13, #4590) |
| Document-capture seam into `enrichOrgCorpus` | `capture-business-document.ts` | present |
| "Onboarding exists only for the first owner" | occupation spec §2.2 | still the recorded gap |

So the two defects this plan exists to fix — the mute high-stakes acumen on a fresh install, and the craft tier that can never reach a recommendation — are both still live.

**Recovery note, recorded because it cost the work once already.** This plan was written in August but never pushed, because the local gate was failing for reasons unrelated to the diff (filed as BI-EB401AC8: the gate exited after the guard loop with no recorded reason, and its failure summary rendered as `[object Object]` because a structured object was passed where a string was expected). Holding an unpushed branch was the wrong call: the worktree janitor reaped the branch and worktree, and the only surviving copy was a dangling commit in the object store. A plan that is not pushed is not saved.
