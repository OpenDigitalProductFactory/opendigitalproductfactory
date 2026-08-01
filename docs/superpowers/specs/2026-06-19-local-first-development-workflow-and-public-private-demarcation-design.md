# Local-First Development Workflow & the Public/Private Demarcation — Program Design

**Date:** 2026-06-19
**Status:** Program synthesis (pre-epic). Connects and extends existing per-area specs; identifies the unowned cross-cutting concern; proposes the epic/BI structure.
**Author:** Investigation per operator goal (local git + multi-tool AI CLI workflow; opt-in share vs keep-local with guided determination; GitHub-feature delta; Build Studio as the model; code-graph/SysML and archetype demarcation).
**Predecessors (authoritative, do not contradict):**
- [`2026-06-18-local-git-and-private-public-segregation-analysis.md`](2026-06-18-local-git-and-private-public-segregation-analysis.md) — operator decision: private git home ships *inside* the install, invisible by default; bare remote default; Gitea opt-in; GitLab external-only via a future `GitForgeProvider`.
- [`2026-06-18-private-public-change-segregation-design.md`](2026-06-18-private-public-change-segregation-design.md) — Phase 1: `FeatureBuild.disposition` (private default, fail-closed), `.dpf/private-paths`, local-changes ledger, plain-language ship UX.
- [`2026-06-19-hive-contribution-architecture-and-egress-model.md`](2026-06-19-hive-contribution-architecture-and-egress-model.md) — the boundary applies only at public-hive egress; hive = git + GitHub API + Postgres ledger; pseudonymous identity.
- [`2026-06-16-living-architecture-graph-and-operational-bridge-design.md`](2026-06-16-living-architecture-graph-and-operational-bridge-design.md) — the EA/SysML graph; **Open Question 3** (customer-scoped discovery: platform graph or per-tenant sub-graph?) is still open.
- [`2026-06-19-estate-sovereignty-governance-design.md`](2026-06-19-estate-sovereignty-governance-design.md) — sovereignty assessment (`EP-ESTATE-SOVEREIGNTY`).

---

## 0. The operator's goal, restated as one concern

The operator described what reads as six topics. Investigation shows they are **one axis seen from several surfaces**:

> A customer installs DPF and runs it **locally**. They develop with **multiple AI coding CLIs** (Claude, Codex, OpenCode, Grok) against a **local git substrate**. They **opt in to share some things and keep others private** — but *they don't always know what is appropriate to share*. Going local trades away **GitHub features** that must be accommodated. **Build Studio** is the most self-contained development path and should be the **model** for the external (CLI) paths. The **code graph** and **SysML** must distinguish what is public/shipped from what is the customer's private estate. And a single company should not drown in **archetypes outside its domain** — that machinery becomes noise.

The throughline is a **demarcation**: every artifact DPF produces or holds sits on one axis —

```
   PRIVATE / LOCAL  ◄──────────────────────────────►  SHARED / PUBLIC
   (this install's          (genuinely install-          (the commons / upstream /
    proprietary content)     specific config)             platform-shipped baseline)
```

…with a **companion relevance axis** for surfacing —

```
   IN-DOMAIN (this install's archetype + universal)  ◄──►  OUT-OF-DOMAIN (other archetypes = noise)
```

Everything below is about making **one** demarcation primitive real and applying it consistently across four planes — **code, knowledge, architecture-graph/SysML, and UI relevance** — inside a local-first multi-tool workflow. Today each plane treats the axis differently or not at all.

---

## 1. What already exists (the substrate — do NOT rebuild)

DPF is far denser here than a first read suggests. The investigation confirmed working substrate on every dimension.

### 1.1 Local git + multi-tool AI CLI — largely SHIPPED
- **Local git substrate exists.** The self-upgrade path maintains a durable per-install branch `dpf/install` in `~/.dpf/install/`, merging upstream via `git merge --no-ff` inside an isolated workspace, deferring on conflict ([`apps/web/lib/self-upgrade/prepare-source.ts:373`](apps/web/lib/self-upgrade/prepare-source.ts)). **There is no need to install a second git server for "local checkin."**
- **All four CLIs are real, not aspirational.** A unified runner registry registers `codex, claude, grok, dpf-native, opencode` ([`apps/web/lib/integrate/sandbox/agents/index.ts:8`](apps/web/lib/integrate/sandbox/agents/index.ts); `BuildAgentId` at [`agent-runner-types.ts:9`](apps/web/lib/integrate/sandbox/agent-runner-types.ts)). Each has a dispatcher + runner (`{claude,codex,grok,opencode}-dispatch.ts`). OpenCode is the **credential-free local-LLM** path (points at the install's own OpenAI-compatible endpoint, [`opencode-dispatch.ts:15`](apps/web/lib/integrate/opencode-dispatch.ts)); Grok has device-code OAuth ([`grok-device-login.ts:34`](apps/web/lib/actions/grok-device-login.ts)).
- **Build Studio CLI path** = the orchestrator dispatch branch at [`build-orchestrator.ts:793`](apps/web/lib/integrate/build-orchestrator.ts) (resolves a runner, calls `runner.run(...)`), with the legacy agentic loop as fallback. Lifecycle `ideate → plan → build → review → ship` is checkpoint-resumable ([`build-pipeline.ts:71`](apps/web/lib/integrate/build-pipeline.ts)).
- **Contributor-side toolchain bootstrap** writes per-CLI MCP config (`planCodexConfig`/`planClaudePluginConfig`/`planGrokConfig`) in `@dpf/bootstrap`; docs for Claude/Codex/Grok dev environments already landed (PRs #2051, #2053).

### 1.2 The private lane + egress boundary — partially built
- `PlatformDevConfig.contributionMode` ∈ `fork_only | selective | contribute_all`.
- The boundary applies **only at public-hive egress** — a diff to the install's own repo is unfiltered; only public-hive egress is gated (`classifyEgress()`, [`contribution-egress.ts:46`](apps/web/lib/integrate/contribution-egress.ts), PR #2079).
- **Structural strip:** `.dpf/private-paths` (gitignore-style, fail-closed) strips matching hunks before any push (`stripPrivatePathsFromDiff`, [`private-paths.ts:209`](apps/web/lib/integrate/private-paths.ts)). Ships **empty** (no-op until an operator opts in).
- **Reactive scans:** secret scan ([`security-scan.ts:45`](apps/web/lib/integrate/security-scan.ts)), org-identity sanitization ([`contribution-review.ts:114`](apps/web/lib/integrate/contribution-review.ts)), hostname/identity redaction + pseudonymous `dpf-agent-<shortId>`.
- **Hive consent surface:** device-fingerprint opt-in (default ON, PII-free), source/improvement (follows `contributionMode`), master pause ([`HiveContributionsPanel.tsx:60`](apps/web/components/admin/HiveContributionsPanel.tsx)).

### 1.3 Knowledge demarcation — the proven pattern
- **WikiPage kernel/org-overlay:** kernel rows (`organizationId = NULL`, `isKernel = true`) are global/public; org-overlay rows are proprietary/local. `principlePublic` marks a principle shareable. This is the **canonical demarcation pattern** the egress spec already names as the reuse target (`hive-contribution…:46-61`).
- Learning routing WWMD/WWWD/WSID → `principle_decide` / `propose_improvement` / `propose_skill_improvement` → `contribute_to_hive` (kernel principle `learnings-belong-in-the-shared-commons`; skill `dpf-route-learning-to-commons`).

### 1.4 Architecture graph / SysML — built, but NO demarcation
- EA graph in Postgres (`EaElement` [`schema.prisma:5775`](packages/db/prisma/schema.prisma), `EaRelationship`, `EaView`, `EaSnapshot`), layers in `properties.layer`; Neo4j code graph (`CodeFile`/`CodeSymbol`/…) bridged in. Nightly extractor/reconcile **Parity Engine** pattern (`reconcileSysmlProjections`, `runArchitectureParitySteward`). SysML v2 is an internal viewpoint over the same substrate (notation `sysml2`), not user-facing.
- **The only origin tag is `provenance` (`deterministic` | `architect`)** — orthogonal to public/private. There is **no `visibility`/`origin`/`scopeKey`/`organizationId`** on graph elements.

### 1.5 Archetype / domain model — known, but only corpus consumes it
- Install archetype is known: `StorefrontConfig.archetypeId` ([`schema.prisma:7061`](packages/db/prisma/schema.prisma)); regional/compliance profile on `BusinessContext` (`operatesIn/sellsTo/employsIn/dataResidency`).
- **The bridge exists:** `resolveInstallVariantContext` ([`install-variant-context.ts:44`](apps/web/lib/decision-perspective/install-variant-context.ts)) turns the install's declared domain into a scoping context. **Only the profession-corpus retrieval path consumes it** (`pageEligibleForInstall`, [`profession-corpus.ts:219`](apps/web/lib/decision-perspective/profession-corpus.ts)).
- `EP-WSID` (corpus) is **done**; `EP-ARCH-8D4F2A` (Archetype Model V2) is in-progress.

### 1.6 GitHub-equivalent work-management substrate — already local-capable
DPF already owns local equivalents for most of what GitHub provides (see §4 delta table): backlog `BacklogItem`/`Epic` ≈ issues; Build Studio phase gates + `reviewDesignDoc`/`saveBuildEvidence` ≈ PR review; leased local-CI sandbox + `run_sandbox_tests`/`run_release_gate` ≈ Actions; `ChangeRequest` register ≈ PR audit trail; AES-256-GCM credential vault ≈ Actions secrets; `ReleaseBundle` ≈ releases (diff-level).

---

## 2. The unowned concern: one demarcation primitive, four planes

The substrate is dense but the **demarcation axis is implemented four different ways** — and on two planes it does not exist at all:

| Plane | Demarcation today | State |
|---|---|---|
| **Code changes** | `FeatureBuild.disposition` + `.dpf/private-paths` (fail-closed) | **Specced** (2026-06-18 Phase 1), `disposition` not yet in schema |
| **Knowledge / learnings** | WikiPage kernel vs org-overlay; `contributionStatus` local→contributed | **Built** (the proven pattern) |
| **Architecture graph / SysML** | *(none)* — no visibility/origin/scope field; customer discovery leaks into the global graph | **GAP — explicit open question** |
| **UI relevance (domain)** | `resolveInstallVariantContext` → corpus only | **GAP — one consumer, starved of content** |

**Plus three cross-cutting gaps the operator named directly:**

1. **No guided "what's appropriate to share" determination.** Everything today is *reactive* (post-hoc secret/identity scans) or a *bare per-build human choice*. Nothing proactively tells a non-technical user "this looks proprietary — keep it" or "this is a reusable fix — the platform wants it." The Phase-1 spec itself says scans "catch secrets, not proprietary intent."
2. **No `GitForgeProvider` abstraction.** `GitProvider = "github"` is a one-value union; `parseGitHubRepo()` returns `null` for non-GitHub URLs. This blocks the bundled private remote and any non-GitHub forge. The GitHub-feature delta (§4) has no abstraction seam.
3. **Consistency defects** found in flight: the **master "Pause all contributions" toggle does not gate the `source`/`improvement` `contribute_to_hive` path** ([`mcp-tools.ts:11328`](apps/web/lib/mcp-tools.ts) never checks `hiveContributionsPaused`) — the UI claims it stops *every* type; the **network-bridge reconcile drops scope** ([`reconcile-network-bridge.ts:22`](apps/web/lib/ea/reconcile-network-bridge.ts) reads all `EdgeNode`/`InventoryEntity` with no `where`), leaking customer-scoped discovery into the global graph against its own header and spec.

**No epic frames the demarcation as one axis.** `EP-UPGRADE-LIFECYCLE` owns the code/upstream slice; `EP-LEARNING-COMMONS` the knowledge slice; `EP-ARCH-GRAPH-LIVE`/`EP-PARITY-ENGINE` the graph; `EP-ARCH-8D4F2A` archetypes; `EP-ESTATE-SOVEREIGNTY` sovereignty. The connective tissue — **the shared primitive + the guided advisor + the graph/domain application** — is unowned.

---

## 3. Design — the demarcation primitive and the workflow around it

### 3.1 One classification primitive (`DispositionClass`) reused on every plane

Define a single resolver that, given any artifact, returns a recommended placement on the axis with a reason and the signals behind it. This is the **Share-Determination Advisor** — the answer to "the user may not know what's appropriate to share."

```
classifyDisposition(artifact) -> {
  recommended: "keep_private" | "share_public",
  confidence:  "high" | "medium" | "low",
  reasonPlain: string,        // "This changes pricing logic specific to your business."
  signals: {
    artifactKind,             // platform_improvement | proprietary_content | install_config | unknown
    privatePathMatch: bool,   // .dpf/private-paths → forces keep_private
    secretOrPii: bool,        // security-scan → blocks share entirely
    orgIdentityLeak: [...],   // sanitization scan → must-fix before share
    provenance,               // kernel/platform-shipped → already public; org-overlay → proprietary
    domainSpecific: bool,     // tied to this install's archetype only?
    sovereigntyTarget,        // BusinessContext.dataResidency / targetAssuranceLevel tightens default
  },
  decidable: bool             // false → must escalate to a human (PAR)
}
```

Design rules:
- **Fail-closed.** Default `keep_private`; an artifact only becomes shareable on an explicit human acknowledgement (PAR — propose/acknowledge/reassign). This matches the Phase-1 `disposition default "private"`.
- **Doctrine-aware.** The platform-improvement vs proprietary-content distinction is the doctrine's core (AGENTS.md §1: "platform improvements flow to the hive; proprietary content stays local"). For a clear platform improvement the advisor *nudges toward share* (local-only is the defect); for proprietary content it defaults keep and explains why.
- **Sovereignty-aware.** An install with a high `targetAssuranceLevel` / strict `dataResidency` gets a stricter default and clearer warnings. This is the missing link between `EP-ESTATE-SOVEREIGNTY` and the sharing decision.
- **Reuses existing scanners** — it *orchestrates* `security-scan`, `contribution-review` sanitization, `private-paths`, and the WikiPage kernel/overlay flag rather than replacing them. It turns three reactive gates into one proactive recommendation.
- **Plain-language, progressive disclosure.** Non-technical users see "Keep on my system" / "Share with the community" + a one-line reason; git/forge controls stay admin-gated (per Phase-1 §3.3 and the operator's invisible-by-default constraint).
- **Records the why.** Persists `dispositionReason` (Phase-1 field) so "what have we kept private, and why?" is answerable.

The same resolver is invoked at every share decision point: Build Studio/CLI **ship phase** (code), **learning routing** (`contribute_to_hive`/`propose_improvement`), the **graph contribution** path (new, §3.4), and the **hive consent** surface.

### 3.2 Workstream A — local-first multi-tool development workflow

- **Build Studio is the model; the CLI path is the same orchestrator.** Codex/Claude/Grok/OpenCode already run through `runner.run()` at the same orchestrator seam ([`build-orchestrator.ts:793`](apps/web/lib/integrate/build-orchestrator.ts)) and through the same `ideate→plan→build→review→ship` gates. The external-development guidance should state this explicitly: **the gates are tool-agnostic; the CLI is just the implementer.** No new pipeline.
- **Converge the dispatch/runner duplication.** Both `*-dispatch.ts` and `sandbox/agents/*-agent-runner.ts` exist per CLI ("one concept, N parallel impls" debt). The orchestrator uses the runner path; the standalone dispatch fns should be folded behind the runner contract. Routing-adapter coverage is asymmetric (Claude/Codex CLI adapters exist; Grok/OpenCode are Build-Studio-only) — close or document the gap. → `EP-ROUTING-11` / arch-convergence.
- **The local git substrate is `dpf/install`** — no second git server. The bundled **bare private remote** (operator decision §5.2 of the analysis) gives proprietary work a durable off-box home; Gitea is the opt-in technical UI.

### 3.3 Workstream B — accommodate the GitHub-feature delta

The delta is concentrated in the **git-host transport** half; the **work-management** half is already local-capable. The accommodation is the `GitForgeProvider` abstraction (analysis Phase 2.1) plus an explicit map of what each lost GitHub feature falls back to locally.

| GitHub feature | What it provides | DPF local accommodation |
|---|---|---|
| Central repo / remote | Canonical origin | `dpf/install` + bundled **bare private remote** (no new service) |
| PR object + review UI | Reviewable diff, approvals | Build Studio phase gates + `reviewDesignDoc`/`saveBuildEvidence`; PR API behind `GitForgeProvider` (Gitea MRs for the technical tier) |
| CI runners (Actions) | Tests/build/audits on push | Leased local-CI sandbox (`claim_nonprod_environment_lease("local-integration-ci")`) + `run_sandbox_tests`/`run_release_gate`; **gap: event-driven trigger** off a local push (today the trigger is the GitHub webhook) — add a local `post-receive` hook posting the payload the portal already understands |
| Merge gating / branch protection | Server blocks merge until checks pass | Pre-PR `block` gates + `.githooks/pre-push-gate`; **gap: server-side enforcement** on a bare remote → pre-receive hook or Build-Studio discipline |
| Issue tracking | Work queue | `BacklogItem`/`Epic` in Postgres — full equivalent |
| Releases / artifacts | `gh release`, GHCR images | `ReleaseBundle` (diff-level); **gap: binary/image hosting** → local registry or pre-loaded image for self-upgrade |
| SAST / code scanning | CodeQL + SARIF dashboard | Gitleaks + 8 `audit-*` script guards run locally; **gap: hosted CodeQL dashboard** — keep script audits, lose the dashboard |
| DCO bot | Blocks unsigned commits | `git commit -s` discipline; pre-receive hook for server-side; moot for `fork_only` non-contributed work |
| Webhooks | Signed event delivery | Handler exists ([`route.ts`](apps/web/app/api/platform/git/updates/route.ts)); reuse via a local post-receive hook |

**The honest "what you lose" statement** (the operator asked for the delta explicitly): going fully local, you lose the *hosted* conveniences — a web PR-review UI (until Gitea), hosted CI runners, the CodeQL/SARIF dashboard, GHCR image hosting, and GitHub-App identity for DCO. You do **not** lose review, gating, issues, change-audit, secrets, or test execution — those are already local. The accommodation is: forge-abstract the transport, reuse the local equivalents, and surface the two genuine gaps (local CI trigger + local image registry) as scoped BIs.

### 3.4 Workstream D — code-graph / SysML public/private demarcation (resolves Open Question 3)

Adopt the **proven knowledge pattern** for the graph:
- Add an **origin/visibility tag** to `EaElement`/`EaRelationship` mirroring WikiPage kernel/overlay: `platform_shipped` (public — the DPF reference architecture, shareable to the commons) vs `install_private` (the customer's actual estate, local-only by default). Reuse the nullable-`organizationId` shape the egress spec already endorses.
- **Resolve Open Question 3:** customer-scoped discovery is a **per-tenant private overlay**, not part of the platform graph. The public graph = `platform_shipped` elements; the customer's living graph = their private overlay. SysML follows automatically (same substrate, notation `sysml2`).
- **Fix the leak (consistency defect):** carry `scopeKey`/`customerAccountId` from `EdgeNode`/`InventoryEntity` onto the emitted `EaElement`, and add the missing `where` scope filter in `reconcileNetworkTopology` ([`reconcile-network-bridge.ts:22`](apps/web/lib/ea/reconcile-network-bridge.ts)) so customer discovery does not project into the global graph. This is required before any graph element could ever be shared upstream.
- The **Share-Determination Advisor (§3.1) gates graph contribution** exactly like code: only `platform_shipped` elements are ever eligible; `install_private` is structurally excluded. → `EP-ARCH-GRAPH-LIVE` / `EP-PARITY-ENGINE`.

### 3.5 Workstream E — domain relevance / noise reduction

Generalize the **already-present bridge** beyond corpus:
- Promote `resolveInstallVariantContext` into an **install-domain-relevance service** consumed by nav, the agent/coworker roster, the skills surface, marketing surfaces, and the EA graph views — not just corpus injection.
- **Default behavior:** surface the install's archetype(s) + `universal`; **collapse (not delete)** out-of-domain archetype machinery behind an explicit "explore other business types" affordance. **Fail-open** — never hide something the user explicitly needs; relevance filtering reduces noise, it does not remove capability.
- Seed the corpus archetype axis with real per-archetype content (the shielding mechanism works but is starved — most pages are tagged `universal`).
- Reconcile the two parallel archetype taxonomies (`ArchetypeCategory` vs `PROFESSION_ARCHETYPES`, kept in sync by a test, not a type) as part of `EP-ARCH-8D4F2A`. → `EP-ARCH-8D4F2A`.

### 3.6 Workstream F — consistency fixes (small, high-value, fileable now)

1. **Master-pause gating bug.** Make the `source`/`improvement` `contribute_to_hive` path honor `hiveContributionsPaused` (call `isContributionEnabled`/`resolveHiveContributionStatuses` like the device-fingerprint and feedback-escalation paths do). The UI promises it; the handler must keep the promise. → `EP-LEARNING-COMMONS` (safety).
2. **Network-bridge scope leak** (see §3.4) → `EP-ARCH-GRAPH-LIVE`.

---

## 4. Build Studio as the model for external development

Build Studio is the most self-contained path and is the reference for the external (Claude/Codex/OpenCode/Grok) paths because **both already share the orchestrator and the gates**. The external-development contract should make this explicit:

- **Same gates, tool-agnostic.** `ideate→plan→build→review→ship` evidence gates apply regardless of who implements; the CLI is the implementer at `code_generated`. External work records the same evidence (`record_external_development_evidence` already exists).
- **Same demarcation.** The ship-phase Share-Determination Advisor (§3.1) is invoked identically whether BS or a CLI produced the diff. Disposition defaults private; fail-closed egress is shared.
- **Same coordination plane.** Work capsules, nonprod leases, change-register — the MCP coordination plane is the source of truth ("if it isn't in the MCP plane, it didn't happen").

This means *no new external-dev pipeline* — the work is to **document the contract** and ensure the CLI paths invoke the same gates/advisor, not to build a parallel system.

---

## 5. Research & standards (AGENTS.md §10)

Extends the Phase-1 spec's benchmarking (GitHub private-fork visibility; GitLab project visibility + CODEOWNERS; inner-source upstream-first classification; DLP default-deny) with the planes this program adds:

- **Data classification taxonomies (NIST SP 800-60 / ISO 27001 A.8 information classification).** The `DispositionClass` artifactKind (`platform_improvement | proprietary_content | install_config`) is a lightweight, doctrine-aligned classification scheme — confirm against the standard rather than inventing categories.
- **Multi-tenant graph scoping (row-level security / tenant tagging).** The `platform_shipped` vs `install_private` overlay mirrors the standard "shared baseline + tenant overlay" pattern; reuses DPF's own WikiPage precedent rather than per-row ACLs.
- **Forge abstraction (libraries like `go-git`/`gitea-sdk` and the GitLab/GitHub API shapes).** The `GitForgeProvider` surface (`parseRepo`, `createBranch`, `commit`, `openChangeRequest`, `readChangeRequests`, webhook verify) is the minimal common denominator.
- **Inner-source relevance filtering.** Collapsing out-of-domain content (not deleting) is the standard progressive-disclosure pattern; fail-open preserves discoverability.

(The chief-architect lens, `dpf-architecture-review`, should sharpen each area spec before its build.)

---

## 6. Epic & BI structure (substrate-verified; file via `dpf-file-backlog-item`)

**Proposed connective epic — `EP-DEMARCATION` (new):** *"The Public/Private Demarcation — one classification primitive applied across code, knowledge, the architecture graph, and UI relevance, with guided share-determination."* Justification for a new epic (per `verify-substrate-before-proposing-new`): no existing epic frames the axis as one primitive or owns the Share-Determination Advisor; the adjacent epics own per-plane slices only.

| BI (candidate) | Workstream | Home epic |
|---|---|---|
| Share-Determination Advisor: `classifyDisposition` primitive + plain-language ship/route UX (orchestrates existing scans; fail-closed; sovereignty-aware) | A/C | **EP-DEMARCATION** |
| Phase-1 segregation build (`FeatureBuild.disposition`, `.dpf/private-paths` DB override, ledger) — the 2026-06-18 design | C | EP-UPGRADE-LIFECYCLE |
| `GitForgeProvider` abstraction behind existing GitHub call sites (pays down `parseGitHubRepo` duplication) | B | EP-UPGRADE-LIFECYCLE |
| Bundled bare private remote as `dpf/install` push target (no new service) | B | EP-UPGRADE-LIFECYCLE |
| Local CI trigger (post-receive hook → existing webhook handler) + local image registry for self-upgrade | B | EP-UPGRADE-LIFECYCLE / EP-INSTALLER |
| Graph origin/visibility tag (`platform_shipped`/`install_private`) on `EaElement`/`EaRelationship`; resolve Open Question 3 | D | EP-ARCH-GRAPH-LIVE |
| Fix network-bridge scope leak (carry `scopeKey`, add `where`) | D/F | EP-ARCH-GRAPH-LIVE |
| Install-domain-relevance service (generalize `resolveInstallVariantContext`) consumed by nav/agents/skills/graph; collapse out-of-domain | E | EP-ARCH-8D4F2A |
| Seed per-archetype corpus content; reconcile dual archetype taxonomies | E | EP-ARCH-8D4F2A |
| Master-pause gating fix on `contribute_to_hive` source/improvement path | F | EP-LEARNING-COMMONS |
| External-development contract doc: BS gates are tool-agnostic; CLI paths invoke the same gates + advisor | A | EP-BUILD-STUDIO |

---

## 7. Phasing

- **Phase 0 (now, low-risk, high-value):** the two consistency fixes (§3.6) — master-pause gating + network-bridge scope leak. Independent, small, fixable as direct maintenance PRs.
- **Phase 1:** the Share-Determination Advisor (§3.1) + the 2026-06-18 Phase-1 segregation build. Delivers the operator's core ask ("help the user know what to share") with no forge work.
- **Phase 2:** `GitForgeProvider` + bundled bare private remote + local CI trigger / image registry (the GitHub-delta accommodation).
- **Phase 3:** graph/SysML demarcation (origin tag + Open Question 3 resolution).
- **Phase 4:** domain-relevance service rollout + corpus seeding.
- **On demand:** first-class GitLab/Gitea forge providers (external integration only).

---

## 8. Open questions resolved / remaining

**Resolved by this program:**
- *Where do `fork_only` changes go?* → the bundled bare private remote on `dpf/install` (operator decision); the advisor records why each is private.
- *How does a user know what to share?* → the Share-Determination Advisor (proactive, doctrine- and sovereignty-aware, fail-closed).
- *Living-graph Open Question 3 (customer discovery: platform graph or per-tenant?)* → per-tenant private overlay; only `platform_shipped` elements are public/shareable.

**Remaining for operator:**
1. **Scope of Phase 0 now.** The two consistency fixes are independent and shippable immediately — proceed as direct PRs, or fold into the epic?
2. **New epic vs anchor-only.** Create `EP-DEMARCATION` as the connective owner, or route every BI to existing epics and track the axis as a cross-epic theme?
3. **Graph contribution appetite.** Is sharing *platform_shipped* graph/SysML elements to the commons actually desired, or is the graph demarcation purely about keeping the customer estate private (no upstream graph contribution at all)? This changes whether the origin tag needs the full egress path or just a local privacy boundary.
