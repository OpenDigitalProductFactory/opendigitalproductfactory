# Local Git Substrate & Private/Public Change Segregation — Investigation & Recommendation

**Date:** 2026-06-18
**Status:** Analysis (pre-spec). Investigates whether DPF should install/integrate a local git repository for local checkin and tighter GitLab integration, and how proprietary-local vs shareable-public changes are threaded.
**Author:** Investigation per operator goal.

---

## 0. The question, restated

The operator asked three things that turn out to be one:

1. Is it worth installing/integrating a **local git repository** for local checkin/work?
2. Support **more seamless integration with a GitLab instance** for the project.
3. Support **local builds where the customer keeps some things proprietary** and does not contribute everything to the public repo.

The clarifying answer narrowed it: *"We have a contribution mode that can be set to not share with the public repo. When that happens, where do those changes go? How do we thread what stays local/proprietary vs shared publicly? The feature is there but we have no real way to segregate."* Priority: **both** the private/local-build capability **and** GitLab, equally.

**Finding in one line:** DPF already has a local git substrate and a private lane, but it has **no structural boundary** between proprietary and shareable changes — and a private git remote (which a self-hosted GitLab can be) is the missing physical home that would make the boundary real. "Install a local git repo / integrate GitLab" and "thread private vs public" are the same project viewed from two angles.

---

## 1. What already exists (do NOT rebuild)

### 1.1 A local git substrate is already in place
The install is not a stateless container. The governed self-upgrade path maintains a **durable per-install branch `dpf/install`** in a host clone (`~/.dpf/install/`) and prepares it inside an isolated `.upgrade-workspace/` sub-clone (`apps/web/lib/self-upgrade/prepare-source.ts`). It compares the install tree with its upstream merge base: no local content delta advances to the exact upstream commit, while real local content is preserved through `git merge --no-ff`. On conflict it aborts, returns `conflictFiles`, and **defers** — the operator is never broken, only not-yet-updated. The built image is stamped with the prepared commit: the canonical upstream SHA for an upstream-only install, or the honest **merge-commit SHA** when local delta exists (identity-equals-bytes, BI-5B6C1C35; canonical-peer provenance correction, BI-C6C92EE4).

> Implication: there is **no need to install a second git server for "local checkin."** That capability exists. The `dpf/install` branch *is* the local working substrate.

### 1.2 A private (non-contributed) lane already exists
`PlatformDevConfig.contributionMode` ∈ `fork_only | selective | contribute_all` (Admin → Platform Development, onboarding Step 7):
- **`fork_only`** — closed system; nothing pushed upstream by default. Optional backup to a user-configured `gitRemoteUrl`. DCO not required.
- **`selective`** — per-feature human decision; default = keep local.
- **`contribute_all`** — per-feature decision; default = contribute.

### 1.3 Customer-proprietary *data* is already off git
Secrets/credentials (`.env`, `Credential`), branding/org config (`Organization`, `PlatformConfig`), prompts (`PromptTemplate`), and skills (`SkillDefinition`) live in **env + Postgres**, never in the public source tree. This part of "proprietary stays local" is already handled.

---

## 2. The real gap: there is no structural private/public boundary

The unit of contribution is a **per-feature diff** (`FeatureBuild.diffPatch`), not repo state. At deploy:
- **Public:** the diff is pushed as a GitHub PR branch (`submitBuildAsPR` → `createBranchAndPR`, `apps/web/lib/integrate/contribution-pipeline.ts:299`).
- **Local:** the same diff is applied to `dpf/install` and **not pushed** (`mode: "local"`, `prUrl: null`, `contribution-pipeline.ts:359`).

Segregation today rests on three things, **none of which is a boundary**:

| Mechanism | What it is | What it does NOT do |
|---|---|---|
| `selective`/`fork_only` mode | A per-feature human choice | No policy/classifier; nothing stops proprietary logic from being chosen "share" by mistake |
| `scanDiffForSecurityIssues` + `redactHostnames` + pseudonymous author | Outbound redaction of **secrets & identity** | Does **not** detect proprietary *business logic* or customer-specific IP |
| Single `dpf/install` branch | Holds local diffs **intermingled** with merged-upstream commits | No separate private layer; no "these paths never leave the box" rule; no way to later audit "what have we kept private?" |

**Consequences the operator correctly sensed:**
1. **No declarative partition.** Nothing in the model says "directory/feature X is proprietary-local and structurally excluded from every public PR." It's re-decided per build, by a human, every time.
2. **No private *home*.** A `fork_only` change has nowhere durable to go except intermingled on `dpf/install`. The `gitRemoteUrl` backup hook is designed but only ever pushed to GitHub-shaped remotes in code (see §3).
3. **No reconciliation ledger for customizations.** Seeded content (prompts/skills) has `isOverridden` (a boolean) but **no `seedContentHash` / merge base** — true 3-way merge of customer edits vs upstream is impossible today (governed-upgrade-lifecycle spec §2.3). So "what's mine vs theirs" is unanswerable for seed data.

---

## 3. Why DPF is not ready for GitLab today (and the doctrine tension)

DPF is **100% GitHub-coupled** with **no forge abstraction**:
- The git-host type is a one-value union: `export type GitProvider = "github"` (`apps/web/lib/integrate/git-promotion-intake.ts`).
- `parseGitHubRepo()` regex-matches `github.com` and returns `null` otherwise — duplicated in `contribution-pipeline.ts:183`, `issue-bridge.ts:133`, and the change-lanes reader. A GitLab URL fails the regex → "Cannot determine repository."
- All API calls hardcode `https://api.github.com` (`github-api-commit.ts`, `github-fork.ts`, `github-rest-reader.ts`), webhooks read `x-github-*` headers, release-health reads GitHub Actions workflows, OAuth is GitHub device-flow, CI + DCO bot are GitHub Actions.
- GitLab appears **only in docs**, never in code; a test explicitly asserts `parseRepoFromUrl("https://gitlab.com/...")` returns `null`.

**Doctrine tension to resolve explicitly.** AGENTS.md §1: *"Learnings belong in the shared commons … local-only knowledge is a defect. Local, client-only storage is reserved for genuinely install-specific config."* A "keep it proprietary" feature must therefore **distinguish two kinds of local change**:
- **Proprietary business content** (a customer's pricing logic, vertical-specific workflow, private branding) → legitimately local; the private lane is correct.
- **Platform improvements** (a bug fix, a reusable capability) → the doctrine says these should flow to the hive; keeping them local is the defect the doctrine warns about.

The segregation design's hardest job is not plumbing — it's making *that* classification explicit so the private lane is used for genuinely-proprietary content, not as a quiet way to fork the platform.

---

## 4. Recommendation

**Yes, it is worth the work — but not as "install a local git repo."** You already have the local substrate. The worthwhile work is making the private/public boundary *structural* and giving the private lane a *real home*. GitLab is the natural home, but it should be reached through an abstraction, not hardcoded.

Three phases, in priority order. Phase 1 delivers most of the operator's value without any GitLab work.

### Phase 1 — Make the boundary real (no GitLab dependency). HIGHEST VALUE.
Turn segregation from a per-build human guess into a declared, auditable partition.
1. **Classification at the point of contribution.** Extend the `selective` gate so each change is tagged `shareable | proprietary` with a reason, persisted on `FeatureBuild`/`FeaturePack`. Default-deny outbound for anything not explicitly classified `shareable` (fail closed).
2. **Declarative proprietary scope.** A repo-level manifest (e.g. `.dpf/private-paths`) + DB policy listing paths/features that are structurally never eligible for a public PR. The contribution pipeline refuses to include them in an upstream diff regardless of mode.
3. **A "local changes ledger" UI** in the Upgrade Center: every commit on `dpf/install` that is not in upstream, labelled shareable/proprietary, so the operator can answer "what have we kept private?" at a glance.
4. **Seed reconciliation prerequisite** (close the §2.3 gap): add `seedContentHash` + merge-base capture so customer edits to prompts/skills are 3-way mergeable and visibly "mine vs upstream."

### Phase 2 — Give the private lane a home: a forge abstraction + private remote.
1. **Extract a `GitForgeProvider` interface** (`parseRepo`, `createBranch`, `commit`, `openChangeRequest`, `readChangeRequests`, webhook verification) behind the existing call sites. This is the unlock for *any* non-GitHub remote and pays down the duplication in §3. Scope ≈ the touchpoints listed above; mid-sized, low-risk refactor.
2. **Implement a plain-git private-remote target first** (cheapest, no API): the `fork_only` `gitRemoteUrl` backup becomes a real `git push` to the customer's private remote — this alone satisfies "proprietary work has a durable off-box home" and needs **no** GitLab API.
3. Route `shareable` → upstream (GitHub) provider; `proprietary` → private provider. The classification from Phase 1 now drives *where bytes physically go*, not just whether a PR opens.

### Phase 3 — First-class GitLab (only if a concrete instance/role is confirmed).
Add a `GitLabForgeProvider` implementing the Phase-2 interface (merge requests, GitLab OAuth, `gitlab-ci.yml` equivalent for self-hosted CI, webhook signature). Optionally ship a self-hosted `gitlab-ce` Docker service for air-gapped installs. This is the ~30–45 day item and should **not** start until §5 below is answered.

---

## 5. Decision resolved: the private git home ships *inside* the install

**Operator decision (2026-06-18):** the git instance is **part of this installation** — a self-hosted private home that ships with the install, not an external corporate GitLab DPF connects to. And it must be **invisible to non-technical users by default** (AGENTS.md §17: hide complexity, expose only to those who want access).

This settles the §4 phasing and adds a hard product constraint, with one new sub-decision (the bundled engine):

### 5.1 The non-technical-user constraint reshapes the design
The majority of users never see git. Therefore:
- **Segregation must be automatic and fail-closed**, with no git vocabulary in the default UI. A change is **private by default**; it only becomes public if a human with access explicitly approves contribution. The non-technical user sees "Keep on my system" vs "Share with the community" in plain language — never "branch", "remote", "PR", "merge".
- **The private git home is backstage plumbing**, like the worktree/lease coordination plane. It exists so proprietary work has a durable, versioned home on the box; the layman never logs into it.
- **Git/forge controls are admin-gated** (Admin → Platform Development), surfaced only to operators who opt into technical access. This mirrors how `.mcp.json`, leases, and `COMPOSE_PROJECT_NAME` are already operator-grade.

### 5.2 New sub-decision: which engine hosts the bundled private remote?
Because it ships *in the install* and serves *mostly non-technical users*, weight and admin-surface matter more than features:

| Option | RAM cost | Admin surface | Fit |
|---|---|---|---|
| **Bare git remote** on the existing host volume (no service) | ~0 | none | Lightest; gives a durable private home + push target with zero new service. No UI/MRs — but non-technical users don't need one. **Recommended default.** |
| **Gitea** (self-hosted, single Go binary) | ~100–300 MB | small, optional | Light enough to bundle; gives a real web UI + MR/issue API for the *technical* opt-in tier if wanted. Good middle ground. |
| **GitLab CE Omnibus** | ~4–8 GB | large, always-on | Heavy on an already-heavy stack; admin surface is the opposite of "hidden complexity." **Do NOT bundle by default.** Reserve for a technical customer who explicitly runs GitLab and wants DPF to integrate with *their* instance (the `GitForgeProvider` from Phase 2 covers this without bundling). |

**Recommendation:** bundle a **bare private remote** (Phase 2.2) as the default invisible home; offer **Gitea** as an opt-in technical upgrade for operators who want a private UI; treat **GitLab CE** only as an *external* integration target via the forge abstraction, never as a default bundled service. This keeps the layman's install light and silent while still letting a technical org point at their own GitLab.

### 5.3 What this does to the phasing
- Phase 1 (classify/ledger/seed merge-base) is unchanged and still highest value — and its UI must follow §5.1 (plain-language, private-by-default, no git terms).
- Phase 2.2 (plain-git private remote) is now **confirmed in scope** as the bundled private home, not optional.
- Phase 3 (first-class GitLab) is **demoted to "external integration only, on demand"** — not part of the default install. The bundled need is met by 2.2 (+ optional Gitea).

---

## 6. Bottom line

- **Don't install a second git repo** for local checkin — `dpf/install` already is one.
- **The feature the operator doubts is real — and they're right to doubt it.** Today's "private" lane is a per-build human choice plus secret/identity redaction, intermingled on one branch, with no structural boundary and no private home. That is the gap.
- **Highest-value, GitLab-independent work is Phase 1**: classify changes shareable/proprietary (fail-closed), declare proprietary scope structurally, add a local-changes ledger, and close the seed merge-base gap.
- **The private home ships inside the install and stays invisible to non-technical users** (§5). Default = a **bare private remote** on the existing host volume (zero new service); the layman sees "Keep on my system" vs "Share with the community," private-by-default and fail-closed, with no git vocabulary. Git/forge controls are admin-gated for the technical opt-in tier.
- **Do not bundle GitLab CE by default** — too heavy (~4–8 GB) and too much admin surface for a layman install. Offer **Gitea** as an opt-in private UI, and treat **GitLab CE only as an *external* integration target** via the `GitForgeProvider` abstraction (Phase 2.1), on demand — never the default bundled service.
