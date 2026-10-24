---
status: draft
---

# Hive harvest and contribution reachability — Design Spec

| Field | Value |
|-------|-------|
| **Epic** | EP-HIVE-HARVEST |
| **Status** | Draft |
| **Created** | 2026-09-12 |
| **Author** | Claude Opus 5 for Mark Bodman |
| **Supersedes nothing** | Extends [2026-06-16-learning-propagation-commons-design.md](./2026-06-16-learning-propagation-commons-design.md) and [2026-06-19-hive-contribution-architecture-and-egress-model.md](./2026-06-19-hive-contribution-architecture-and-egress-model.md) |
| **Related** | BI-DE1333A1 (client-private memory) · contribution-model thread: BI-46E9AB38, BI-96253639, BI-9A405652, BI-D75B87B1, BI-FDB896D7, BI-A20D9F82 (see §4.8) · BI-C30A4694 (missing portfolio↔workroom rung, see §4.7) · [2026-07-11-seed-contribution-fit-gate.md](../plans/2026-07-11-seed-contribution-fit-gate.md) · [2026-05-23-governed-platform-upgrade-lifecycle-design.md](./2026-05-23-governed-platform-upgrade-lifecycle-design.md) |
| **Out of scope** | Inbound seed reconciliation (`SeedSnapshot` / customization fingerprint — its own risk, tracked in the upgrade-lifecycle spec) · the fork-PR contribution model · changing the consent posture · any auto-contribution without a human |
| **Primary goal** | An improvement made on one installation reaches every other installation, whatever kind of artifact it is and whichever client produced it, and the platform finds its own improvements rather than waiting to be handed one. |

---

## 1. Problem

The hive is the mechanism by which any installation's improvement becomes every installation's. It is enabled on this install and it has never carried anything.

### 1.1 Measured, 2026-09-12

| Measure | Value |
|---|---|
| `PlatformDevConfig.contributionMode` | `contributing` |
| DCO accepted / contributions paused | yes / no |
| `ImprovementProposal` rows, 2026-08-27 → 2026-09-11 | **239** (189 proposed, 50 prioritized) |
| — with `contributionStatus = 'contributed'` | **0** |
| `FeaturePack` rows, the contribution unit | **0** |
| `HiveContributionLedger` rows | **0** |
| `FeatureBuild` rows | 63, **every one `disposition = private`** |

A fully-enabled install produced 239 improvement proposals in a fortnight and contributed none. No build was ever marked shareable. The ledger the architecture doc names as the source-contribution audit record has never been written.

This is not an adoption problem. Three structural defects make the measured outcome the only possible one.

### 1.2 Defect one — the tool is unreachable for the agents doing the work

`contribute_to_hive` ([contribution-hive-pack.ts:273](../../../apps/web/lib/mcp/packs/contribution-hive-pack.ts)) takes **no content parameter**. Its only input is `include_migrations`. It resolves an active `FeatureBuild` and ships `build.diffPatch`:

```ts
const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
if (!buildId) return { success: false, error: "No active build." };
...
if (!diff.trim()) return { ... "Run deploy_feature first to extract the diff." };
```

So the rule is: whatever appears in a Build Studio sandbox diff can travel, and nothing else can. An external Claude or Codex session working in a governed worktree has no `FeatureBuild`, so the tool refuses. That is where most platform development happens.

Meanwhile the kernel principle [`learnings-belong-in-the-shared-commons`](../../founder-kernel/wiki/principles/learnings-belong-in-the-shared-commons.md) states that this tool is *"the only path by which a learning on one install becomes inherited knowledge on the next"*, and `dpf-route-learning-to-commons/SKILL.md` step 4 instructs agents to call it. **The skill's own worked example — a platform fact about a single-GPU install — has no build and returns `"No active build."`** The canonical example of the doctrine cannot execute.

### 1.3 Defect two — live state has no egress, so the "seed for DB" half does not exist

| Kind | Reaches upstream today | How |
|---|---|---|
| Code, schema, migrations, seed **files**, docs | yes | rides the build diff |
| SKILL.md | yes, twice | diff; and `propose_skill_improvement` → `writeSkillSeed` + `emitSeedPullRequest` |
| Prompt / persona | **file only** | an in-portal `PromptRevision` has no writeback and is reverted by the next boot reseed |
| Kernel / wiki page | **file only** | kernel pages are PR-only in-portal and no code emits that PR |
| `WikiPage` / `KnowledgeArticle` row | **no path at all** | — |
| Policy / config values | **no path** | a posture row is written to the ledger with no transport |

A platform fact captured exactly as the routing skill prescribes, as an org-overlay wiki page, is permanently install-local. Prompts are worse than stranded: an approved in-portal edit is silently reverted at the next boot reseed, which is the precise failure [`seed-writeback.ts`](../../../apps/web/lib/skills/seed-writeback.ts) was written to fix — for skills only.

**The missing loop already exists, once.** Approving a skill proposal writes the body to its seed file and emits a pull request. That is the whole pattern. It needs generalizing, not inventing.

### 1.4 Defect three — nothing harvests

Every path requires an agent or a human to volunteer.

- **52 scheduled jobs.** The only hive-adjacent one reconciles pull requests that already exist. Nothing sweeps for shareable work.
- **Zero coworker self-tasks** mention hive, contribution, upstream or commons.
- **Zero hooks.** `SessionEnd` and `Stop` run worktree hygiene. The route prompt was deferred to the client hook plane, whose spec is still `draft-for-operator-review`.
- **No gate asks whether a change belongs upstream** — not in `runPrePRGates`, not in Workroom closeout, not in the finishing-a-branch or PR skills.
- **Nothing reads `contributionStatus = 'local'`** looking for candidates. 239 rows sit there.
- **`local-changes-ledger.ts` already computes `origin/main...dpf/install`** — the exact private delta a harvester needs — and only the Upgrade Center display consumes it.
- **`run_hive_scout_ingest` harvests external catalogs**, never our own improvements and never another install.

### 1.5 The declared inbound leg does not exist

The learning-propagation spec §3.2 draws `contribute_to_hive → upstream PR → run_hive_scout_ingest (weekly) → backlog on other installs`. Hive Scout reads a public agent catalogue and market sources; it has never read the DPF upstream. The real inbound path is the self-upgrade git merge plus the boot reseed. Anyone reasoning about the loop from that spec is reasoning about machinery that is not there.

### 1.6 Safety inconsistencies found while measuring

These are not the headline, but they are real and cheap to fix.

- **The master pause is partly fiction.** `create_portal_pr` reaches the public hive without checking `contributionMode`, `hiveContributionsPaused` or DCO acceptance. The admin toggle's own comment claims it *"overrides everything"*.
- **The skill seed pull request checks nothing** — no disposition, no pause, no mode.
- **`contributionType: "source"`** is declared in the consent model and written by nobody; `feedback` and `result` are written and appear in no consent surface.
- **A failing security scan does not block**; it labels the pull request and proceeds.
- **`submitBuildAsPR` is dead code** that reads `process.env.GITHUB_TOKEN` directly with no disposition gate, and the architecture doc counts it as a covered chokepoint.

---

## 2. Research — what comparable systems do

Three patterns are worth adopting and one worth rejecting.

**openSUSE Open Build Service — the submit request.** A contributor branches a package, edits it, and raises a *submit request*, a first-class reviewable object that a maintainer accepts or declines ([user guide](https://openbuildservice.org/help/manuals/obs-user-guide/art-obs-bg), [collaboration](https://en.opensuse.org/openSUSE:Build_Service_Collaboration)). The lesson is that the unit of contribution is a reviewable request over content, decoupled from how the content was produced. DPF ties its unit to a sandbox build instead, which is what makes it unreachable. **Adopt:** a contribution source that is content, not a build.

**Home Assistant Blueprints — generalize before sharing.** A local automation is not shareable as-is. The author exports it as a blueprint with declared inputs, and only then can it serve someone else's house ([about blueprints](https://www.home-assistant.io/docs/blueprint/), [exchange](https://community.home-assistant.io/c/blueprints-exchange/53)). **DPF already has this step and does not use it for export.** `evaluateSeedContributionFit` returns `global-default`, `archetype-scoped`, `vertical-scoped`, `parameterize-first`, `install-local-only`, `reject-as-seed`. That is the blueprint question, already answered, with no export behind it. **Adopt:** the existing verdict becomes the routing decision for a contribution.

**Linux upstream-first and downstream patch triage.** Distributions keep an explicit inventory of their delta against mainline and triage it upstream on a cadence, queueing the ones that need thorough review ([patch porting study](https://arxiv.org/pdf/2402.05212), [upstream](https://en.wikipedia.org/wiki/Upstream_(software_development))). **Adopt:** the local-changes ledger is already that inventory; give it a triage cadence and a queue.

**Reject: telemetry-style automatic push.** Popularity-contest and metrics channels send data without a decision. DPF's consent posture is deny-by-default and the disposition gate is fail-closed. The harvester therefore produces **candidates only**; a human decides every contribution. Nothing in this spec auto-contributes.

Sources: [OBS beginner's guide](https://openbuildservice.org/help/manuals/obs-user-guide/art-obs-bg) · [OBS collaboration](https://en.opensuse.org/openSUSE:Build_Service_Collaboration) · [Home Assistant blueprints](https://www.home-assistant.io/docs/blueprint/) · [Blueprints Exchange](https://community.home-assistant.io/c/blueprints-exchange/53) · [Patch porting practices](https://arxiv.org/pdf/2402.05212) · [Upstream (software development)](https://en.wikipedia.org/wiki/Upstream_(software_development))

---

## 3. Design principles

1. **Extend the existing chain; add no second pipeline.** The gate chain, the private-paths strip, the disposition gate, the seed-fit classifier and the pull-request emitter all work. Only the *source* of the content is too narrow.
2. **A human decides every contribution.** The harvester nominates; it never contributes. This mirrors `commons-are-curated-not-just-appended` exactly: guards nominate, the accountable human decides.
3. **The file is authoritative.** Anything contributed must land as a seed file, because the boot reseed rewrites database rows from files. Contributing a row without writing its file ships something the next upgrade erases.
4. **Reachable from any client.** The path must work for an external Claude, Codex or Grok session with no Build Studio build, or it does not exist for the agents doing the work.
5. **Say what cannot travel.** When an artifact has no serializer, the tool names it rather than silently contributing a subset.

---

## 4. Design

### 4.1 A contribution source, not a build

`resolveContributionSource(input)` replaces the hard-coded build lookup and returns a normalized `{ files: Array<{path, content}>, provenance }`.

| Source | Input | Produces |
|---|---|---|
| `build` | active `FeatureBuild` (today's path, unchanged) | `build.diffPatch` |
| `artifacts` | ids of DB-resident artifacts | seed files rendered by §4.2, diffed against the checked-out tree |
| `paths` | explicit repo-relative paths in a governed worktree | a diff of those paths against `origin/main` |

The `build` branch keeps its exact current behaviour, so no existing caller changes. The two new branches make the tool reachable from an external session and from live state.

Everything downstream is untouched: the same gate chain, the same manifest, the same seed-fit classification, the same pull-request emitter.

### 4.2 A seed serializer registry

Generalize what skills already do. A `SeedSerializer` answers, for one artifact kind: where does this belong on disk, and what are its bytes?

```
kind → { resolveSeedPath(artifact), render(artifact), validate(rendered) }
```

| Kind | Seed target |
|---|---|
| skill | `packages/dpf-skill-pack/skills/<id>/SKILL.md` (existing, moved into the registry) |
| prompt / persona | `prompts/<category>/<slug>.prompt.md` |
| wiki page, org overlay | `docs/professions/<family>/wiki/<slug>.md` |
| kernel principle | `docs/founder-kernel/wiki/principles/<slug>.md` |
| knowledge article | the knowledge corpus seed |

Two rules carried over from `writeSkillSeed`, both load-bearing:

- **Never invent a path.** If no seed file and no unambiguous target exists, return `no-seed-file` and surface it. Guessing seeds a file the loader never reads.
- **Only a written file counts.** A contribution whose serializer did not write is reported as unpropagated, never as success.

`validate` runs the corpus's own checks before the file is offered — the persona audit for a persona, `wiki_lint` for a wiki page — so a contribution cannot ship something the receiving install's gates will reject.

### 4.3 The harvester

A scheduled job, `contribution-candidate-sweep`, weekly, reading three sources it does not currently read:

1. **The local-changes ledger** — files this install has that upstream does not.
2. **`ImprovementProposal` where `contributionStatus = 'local'`** and status is `prioritized` or `verified`. There are 239 of these.
3. **Artifacts changed since the last sweep** that have a serializer.

Each candidate is classified by `evaluateSeedContributionFit` and recorded with its verdict. `install-local-only` and `reject-as-seed` are recorded as decided, not as pending, so the queue does not fill with noise.

Output is a **candidate list a human triages**, surfaced in the Upgrade or Contribution surface and summarized into one backlog item per sweep, following the existing `canonical-improvement-digest` shape. **The sweep never calls `contribute_to_hive`.**

A candidate carries its verdict, its rationale and its artifact, so accepting one is a single action rather than a re-investigation.

### 4.4 The question becomes part of finishing work

`Seed-Fit-Decision` already exists as a required trailer on any pull request touching seed content, and it already asks the right question: is this a global default, archetype-scoped, parameterize-first, or install-local-only. It is answered on every seed pull request and connected to nothing.

Bind it. When a branch finishes with a `Seed-Fit-Decision` of `global-default`, `archetype-scoped` or `vertical-scoped`, the work is a contribution candidate and is recorded as one. When it is `install-local-only`, that is a recorded decision with a reason, not silence.

This adds no new question to anyone's workflow. It uses the answer already being given.

### 4.5 Reconcile the egress paths

One `assertContributionAllowed(context)` used by every path that can reach upstream: `contribute_to_hive`, `create_portal_pr` when its target is the public hive, and the skill seed pull request. It checks mode, master pause, DCO and disposition. The master pause becomes true.

Write `contributionType: "source"` to the ledger on every source contribution, so the audit record the architecture doc names actually exists. Add `feedback` and `result` to the consent surface, since they are written today and disclosed nowhere.

Make a failing security scan **block** rather than label. A post-hoc report on an already-open pull request is not a gate.

Delete `submitBuildAsPR`. Dead code holding a raw token read is a liability, and the architecture doc should stop counting it as a covered chokepoint.

### 4.6 Contribution scope must be carried, not guessed

**Founder correction, 2026-09-12.** WWMD is platform mechanics: inescapable, core to everything else working, and therefore near-universally `global-default`. WWWD and WSID are archetype-aligned and nuanced. The reach of a contribution is largely a property of *which corpus it came from*, not a judgement to be re-made per item.

The design above classifies every candidate with `evaluateSeedContributionFit`. That is the right question and the wrong assumption, because scope is not carried anywhere it could be read from.

**Five parallel scope vocabularies exist and none import each other:**

| Vocabulary | Where | Consequence today |
|---|---|---|
| `BacklogScopeKind` — platform / common / archetype-category / archetype-leaf / multi-archetype | `shared.prisma`, on `BacklogItem` and `Epic` only | exactly one: `isPlatformScopedDemand` lets a platform-scoped item cross an org boundary |
| `SeedContributionFitDecision` — global-default / archetype-scoped / vertical-scoped / … | `seed-contribution-fit.ts` | routes a seed contribution |
| `VERTICAL_CATEGORIES` | `contribution-review.ts` | 18 hand-maintained entries against 25 real archetype categories |
| `PRINCIPLE_RING_SCOPES` incl. `ring-3-archetype` | `wiki-taxonomy.ts` | filters principle retrieval |
| `ToolConsequenceScope` — business / platform | `mcp-tools.ts`, added 2026-09-09 | gates consequential tools |

Two are outright broken as scope carriers. `archetype-scoped` and `vertical-scoped` are filled from the same `applicable` array and differ only in which output field receives identical values. And `VERTICAL_CATEGORIES` cannot express seven archetype categories that `BacklogItem.archetypeCategories[]` can.

**The corpora do not carry it either.** `WikiPage` has no archetype column. WWWD pages are seeded *from* the organization's archetype and then lose the reference, so a contributed organization fact cannot say which archetype it was true for. WSID pages carry profession, jurisdiction and competency in an untyped Json bag. WWMD principles carry `principleConsumerArchetype`, which is a *consumer* taxonomy (universal / generalist / specialist) and collides lexically with business archetype while meaning something else entirely.

**Consequence for this spec, and it is load-bearing.** Slice 3 would serialize a WWWD wiki page into a seed file with no archetype tag. The receiving install then has a fact that is either wrongly global or unmergeable. Serializing without carrying scope produces contributions the fleet cannot safely accept, which is the same class of defect as contributing seed data to a fleet with no three-way merge.

**Therefore:**

1. A serializer MUST emit the artifact's scope alongside its content, and MUST refuse rather than guess when the source carries none. `no-scope` joins `no-seed-file` as a surfaced outcome.
2. Scope is **derived from the corpus by default** and overridden only explicitly: a WWMD principle defaults to `global-default`; a WSID profession page defaults to profession-scoped; a WWWD organization page defaults to the archetype that seeded it, which requires that archetype to be retained on the page.
3. The vocabularies are reconciled to one, or one is named canonical and the rest become adapters onto it. Five axes saying almost the same thing is how `archetype-scoped` and `vertical-scoped` came to be indistinguishable.

### 4.7 The missing rung between portfolio and workroom

The founder also names a missing level between the portfolios and the Workroom. It exists, it is specified, and it has no model.

The rendered hierarchy is two levels, because the portfolio-activity projection sets `branchId = room.portfolioRole ?? "unplaced"`. `Workroom` has no `portfolioId`, no `taxonomyNodeId` and **no archetype field at all**; `archetypeCategories` and `archetypeIds` exist on `BacklogItem` and `Epic` and nowhere else. A room reaches a `ValueStreamTeam` only through a nullable `WorkItem.teamId`, with placement resolved by string matching that has an explicit `unresolved` outcome.

The rung is named in [`docs/architecture/workroom-vocabulary-boundary.md`](../../architecture/workroom-vocabulary-boundary.md) as the **Workroom definition**, a projection of a `WorkUnitDefinition` with its owning flow and stage. Its required declarations already include *the applicable archetype and value-stream position* and *the primary coordinated portfolio role* — precisely the two things the founder is asking for. The PAAW standard places it at R2 to R3 in the refinement ladder and requires every R3 object to trace upward to an R0 to R2 purpose. The 2026-08-24 convergence plan states plainly that it *"does not add a `WorkroomDefinition` model"*.

So the grid the standard describes is portfolio × archetype, and the room sits on only one of those two axes today.

This spec does not build that rung. It records that **scoped contribution depends on it**: without a level that carries archetype and value-stream position, a contribution harvested from a room has no scope to declare, and §4.6 degrades from derivation to guesswork. Filed separately so the hive work is not blocked behind an architectural refactor, and so the dependency is explicit rather than discovered later.

### 4.8 Reconciliation with the contribution-model thread, and the egress ordering

A parallel thread filed six items on 2026-09-12 against the same functions this spec touches. They are not duplicates; they own a different property of the same code, and the two together imply an ordering neither states alone.

| Item | Owns |
|---|---|
| BI-46E9AB38 | `create_portal_pr` publishes the branch **before** the readiness contract runs, so a blocked build still leaves a branch upstream |
| BI-96253639 | the local-CI gate is a git hook, and the in-platform path never runs `git push`, so the gate is structurally absent from the only way a consumer install can contribute |
| BI-9A405652 | `publishBranchCommit` force-updates an existing ref with no authorship or ancestry check, so two similarly-described builds silently overwrite each other |
| BI-D75B87B1 | docs and admin copy promise a contributor fork that no shipping path creates; both tools push directly with head equal to base |
| BI-FDB896D7 | AI spend originating outside the portal is invisible to it |
| BI-A20D9F82 | metered spend is governance, not coding |

This spec owns **consent** — may this install contribute at all, under what mode, pause, DCO and disposition. Those items own **integrity** — is what we are about to write correct, ordered, gated and non-destructive. They meet at one function, and the combined rule is simple:

> **Nothing is written to a remote until consent, readiness and ref safety have all passed.**

Today the order is inverted or absent at every step: consent is unchecked on the portal path, readiness runs after the branch is already published, and the ref write force-updates without an ancestry check.

**Therefore slice 1 narrows.** It delivers `assertContributionAllowed` and the ledger and consent-surface corrections, and it calls the check **before** any publish, establishing the position in the sequence. It does not re-order the readiness step, fix the ref write, or wire the fork model — those stay with the items that already describe them precisely. The one thing slice 1 must not do is add a consent check that runs after the branch is already upstream, which would satisfy this spec's acceptance criteria while leaving the defect BI-46E9AB38 describes intact.

BI-96253639 bounds the value of everything here and should be read before slice 2 is built. Making contribution reachable from more sources increases the traffic through a path that has no local-CI contract. Reach without a gate is not an improvement.

### 4.9 Cost — the harvester must be bounded, and mostly not inference

A weekly sweep over 239 stranded proposals plus a file-level delta is a recurring cost, and the parallel thread has already established that spend originating outside the portal is invisible to it (BI-FDB896D7) and that metered lanes are a governance concern rather than a coding one (BI-A20D9F82). A harvester that quietly calls a model per candidate every week is exactly the shape that becomes invisible spend.

Three rules keep it cheap, and they are design constraints rather than optimizations.

1. **Scope is derived, not inferred.** §4.6 makes reach a property of the corpus. A WWMD principle is `global-default` by construction; a WSID page is profession-scoped; a WWWD page is scoped to the archetype that seeded it. None of that needs a model.
2. **Deterministic first, inference only for the residue.** `evaluateSeedContributionFit` is already heuristic code, not a model call. Inference is reserved for candidates the deterministic pass cannot classify, and the count of those is reported every sweep so the residue is visible rather than assumed.
3. **Bounded and attributed.** The sweep declares a per-run ceiling on inference calls and attributes its spend, so it appears in the metering surface instead of arriving as unexplained usage. A sweep that would exceed its ceiling stops and says how many candidates it left unexamined, which is the honest failure and also the signal that the deterministic pass needs widening.

The first sweep is the expensive one, because it faces a fortnight's backlog of 239. It should be run once deliberately with its ceiling raised and its output reviewed, and only then put on a cadence.

---

## 5. Delivery slices

| # | Scope | Why this order |
|---|---|---|
| **1** | §4.5 reconcile egress: one allow-check on every path, ledger `source` rows, security scan blocks, delete dead code | Smallest, and it makes the safety controls honest before traffic increases |
| **2** | §4.1 contribution source: `artifacts` and `paths` branches, `build` unchanged | Unblocks everything; makes the doctrine's "only path" actually reachable |
| **3** | §4.2 serializer registry, skills moved in, prompt and wiki added | The "seed for DB" half of the premise |
| **4** | §4.3 the harvester and its candidate queue | Proactive discovery; depends on 2 and 3 to be actionable |
| **5** | §4.4 bind `Seed-Fit-Decision` to candidacy | Cheapest ongoing signal, best left until the queue exists to receive it |

Slice 1 is deliberately first. The measured state is zero contributions; the moment that changes, the pause toggle and the consent surface need to mean what they say.

---

## 6. Acceptance criteria

| ID | Criterion |
|---|---|
| **AC-HIVE-001** | Every path that can open an upstream pull request honours mode, master pause, DCO and disposition. Toggling the master pause blocks `create_portal_pr` and the skill seed pull request, proven by test. |
| **AC-HIVE-002** | Every source contribution writes a `HiveContributionLedger` row with `contributionType = "source"`. |
| **AC-HIVE-003** | A failing security scan prevents the pull request from opening. |
| **AC-HIVE-004** | An external session with no `FeatureBuild` can contribute, and the worked example in `dpf-route-learning-to-commons` executes end to end. |
| **AC-HIVE-005** | `contribute_to_hive` with a build produces a byte-identical pull request to today's. No regression for the existing path. |
| **AC-HIVE-006** | A wiki page, a prompt and a skill each round-trip: artifact → seed file → pull request, and the rendered file passes its own corpus gate. |
| **AC-HIVE-007** | An artifact kind with no serializer is named in the result, never silently dropped. |
| **AC-HIVE-008** | The sweep produces candidates from the local-changes ledger and from `contributionStatus = 'local'`, each carrying a seed-fit verdict, and never contributes. |
| **AC-HIVE-009** | Every one of the 239 existing proposals is classified as candidate or decided, with none left unexamined. |
| **AC-HIVE-010** | A branch finishing with a shareable `Seed-Fit-Decision` is recorded as a contribution candidate; `install-local-only` is recorded with its reason. |
| **AC-HIVE-011** | Measured after one sweep: the count of contributed artifacts is no longer zero, or the sweep states plainly why nothing qualified. |

---

## 7. Open decisions

1. **Where does the candidate queue live?** A new surface, or the existing Upgrade Center beside the local-changes ledger it reads. Recommend the latter: the operator already goes there to see what this install has that upstream does not.
2. **Does the harvester run on consumer installs?** A consumer install has no source checkout, so a file-shaped candidate is meaningless there, but an artifact-shaped one is not. Recommend artifact candidates everywhere, file candidates only where a checkout exists.
3. **Prompt and wiki serializers write into `docs/` and `prompts/`, which are seed corpora with their own review culture.** Whether an org-overlay page may propose a kernel principle edit, or only a profession page, is a governance question this spec should not settle alone.
4. **Inbound reconciliation stays out of scope but bounds the value.** Until the customization fingerprint and three-way merge exist, a receiving install either clobbers a local customization or skips the upstream improvement. Contributing seed data to a fleet that cannot safely merge it is worth doing and worth knowing the limit of.
