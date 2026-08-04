# Agent local-CI / sandbox enforcement (close the optional-gap)

**Status:** design for new BI (filed from Grok delivery-surface incident, 2026-08-04)  
**Related:** BI-2272D840 (done ΓÇö auto-route pregate into sandbox from source-only worktrees), pre-PR gate docs, `pnpm pr:health`, AGENTS.md ┬º5 / ┬º17

## Problem

AGENTS.md already requires:

- worktree = source isolation only  
- runtime-bound gates via shared local-CI lease (or canonical runtime after self-upgrade)  
- unrun Γëá green  

Codex and Claude sessions commonly spend wall-clock on `pnpm run pregate` / lease queue / sandbox runs. A Grok session (2026-08-03/04) repeatedly shipped runtime-touching PRs after **worktree vitest + typecheck + GitHub CI only**, never claiming `local-integration-ci` or contributor-preview `:3001`. Operator noticed: ΓÇ£surprised it took so little time; other clients take longer using the sandbox.ΓÇ¥

**Root cause is not a corrupted AGENTS.md.** The rule is clear. The failure mode is:

1. **Normative without hard stop** ΓÇö agent can open a ready PR without a SHA-bound local-CI record.  
2. **Escape hatch is too wide** ΓÇö `Local-CI-Override: <reason>` / `DPF_SKIP_PREPUSH_GATE` can be agent-authored with free text (e.g. ΓÇ£unit tests onlyΓÇ¥) without operator go.  
3. **Surface variance** ΓÇö Claude/Codex skill+hook culture hits pregate; Grok (and any leaner surface) can optimize for speed and still look ΓÇ£done.ΓÇ¥  
4. **pr:health is optional** ΓÇö if the agent never runs it, soft NOT READY never blocks `gh pr create`.

Result: **same doctrine, different effective process per delivery surface** ΓÇö violates ΓÇ£one common process, peer surfaces.ΓÇ¥

## Research & Benchmarking

| Source | Adopt | Reject |
|--------|-------|--------|
| Existing DPF pregate + SHA-bound evidence (`scripts/pregate.mjs`, `pnpm pr:health`) | Single evidence store keyed by head SHA; do not invent a parallel ledger | Requiring agents to paste lease IDs into PR bodies (already discouraged) |
| Branch protection / required checks (GitHub) | Machine-checkable ΓÇ£local-CI evidence presentΓÇ¥ when install can attest, or CI job that fails open only for pure docs | Blocking all external forks without a local install (need fork policy) |
| Claude/Codex observed behavior | Treat their longer sandbox path as the **intended** default duration signal | Assuming Grok is ΓÇ£fasterΓÇ¥ as a product feature |
| Required review / CODEOWNERS | Optional escalation for override | Human review as the only enforcement (too late, too soft) |

**Verdict:** Harden the **existing** pregate/evidence path and **close agent-usable escape hatches**. Do not add a second ΓÇ£sandbox checkboxΓÇ¥ skill that can also be skipped.

## Completeness inventory (what already exists)

| Mechanism | What it does | Why agents still skip |
|-----------|--------------|------------------------|
| `pnpm run pregate` | Claims lease, runs sandbox local-CI, records evidence | Agent never invokes it |
| Pre-push hook | Blocks push without record | Bypass env vars; some agents force-push patterns; not always wired in every surface |
| `pnpm pr:health` | NOT READY without evidence | Advisory unless operator/agent runs it; Override trailer green-washes |
| AGENTS.md ┬º5 | Doctrine | Not mechanically enforced at `gh pr create` |
| BI-2272D840 | Node-native pregate when no `sh` | Solves *can't run* on Windows Codex; not *won't run* on Grok |

## Design options (enforcement shape)

### Option A ΓÇö Tighten PR attestation only
Narrow `Local-CI-Override` allowlist (docs-only, delete/tag, true emergency with `operator-go` token). `pr:health` fails closed on free-text agent overrides.  
**Pros:** small change. **Cons:** still skippable if agent never runs `pr:health`.

### Option B ΓÇö Client PreToolUse / stop hooks on all peer surfaces
Refuse `git push` / `gh pr create` for runtime paths without unexpired evidence for HEAD.  
**Pros:** catches Grok/Claude/Codex at the tool edge. **Cons:** surface-specific adapters; must stay thin.

### Option C ΓÇö Install-side gate record required for merge readiness bot
A required CI/status check (or `pr:health` bot comment + block) that queries the installΓÇÖs gate store by PR head SHA (or receives a signed artifact).  
**Pros:** merge-queue reality. **Cons:** multi-install / fork design needed.

### Option D ΓÇö Composite (recommended)
1. **Allowlist overrides** (A) so free-text ΓÇ£vitest onlyΓÇ¥ dies.  
2. **Surface hooks** (B) for Grok + Claude + Codex: before push/PR on runtime diffs, require pregate evidence or refuse with ΓÇ£run `pnpm run pregate` / wait for lease.ΓÇ¥  
3. **Merge-readiness** (C lite): `pr:health` failure is a **blocking** required check where already used; document that opening a PR without running it is a process defect filed under this BIΓÇÖs acceptance tests.  
4. **Metrics:** record `provider` + whether pregate ran (already partly in gate origin) and alert when a surfaceΓÇÖs runtime PRs systematically lack evidence.

## Recommended decision

**Ship Option D in phases:**

| Phase | Deliverable | Done when |
|-------|-------------|-----------|
| **P0** | File BI + this design; inventory current override trailers in last N merged PRs | BI open, epic linked |
| **P1** | Allowlist `Local-CI-Override` reasons; reject agent free-text; require `operator-attested` or docs-only classification for bypass | `pr:health` + tests red on ΓÇ£unit tests onlyΓÇ¥ override |
| **P2** | Grok (+ peers) PreToolUse/stop: refuse push/PR create for runtime-code diffs without SHA evidence | Grok regression: simulated PR blocked without pregate |
| **P3** | UX verification path: when changed files match UI/route patterns, require either local-CI UX gate or `:3001` lease evidence note in gate metadata (not PR body spam) | UI PR without either is NOT READY |
| **P4** | Surface health dashboard / ops signal: ΓÇ£% of runtime PRs with local-CI evidence by clientΓÇ¥ | Operator can see Grok vs Claude vs Codex |

## Acceptance criteria (BI)

1. **Doctrine unchanged, enforcement upgraded** ΓÇö AGENTS.md still owns the rule; implementation closes the skip path without a second competing rulebook.  
2. **Free-text Local-CI-Override cannot green-wash a runtime PR** authored by an agent without an explicit operator-attested reason code from a closed enum.  
3. **At least one peer surface (Grok) hard-refuses** `gh pr create` / push of runtime code without unexpired pregate evidence for HEAD (or admitted lease in progress with bounded wait).  
4. **Claude/Codex paths remain valid** ΓÇö their longer sandbox-using flow continues to pass without new ceremony beyond evidence already produced.  
5. **Escape hatches remain for true emergencies** ΓÇö operator-only, audited, never the default agent path.  
6. **Regression tests** prove: runtime PR without evidence = NOT READY; docs-only PR still exempt; allowlisted override still works.  
7. **Learning routed** ΓÇö WWMD/kernel or delivery-surfaces note: ΓÇ£surface speed without pregate is a defect signal, not a productivity win.ΓÇ¥

## Out of scope

- Replacing GitHub Actions unit tests with local-CI only.  
- Requiring `:3000` live self-upgrade before every PR.  
- Per-worktree private Docker stacks.  
- Blaming model quality alone without mechanical stops.

## Evidence from incident (2026-08-04)

- Grok completed MCP efficiency + AI Ops handoff PRs without lease claim; operator asked why sandbox unused.  
- Agent confirmed awareness of AGENTS.md and under-application.  
- Claude/Codex observed as taking longer *because* they use the sandbox ΓÇö desired baseline.  

## Docs impact

- `docs/testing/pre-pr-gate.md` ΓÇö override allowlist + agent refusal  
- `docs/architecture/delivery-surfaces-runbook.md` or unified-delivery-surfaces ΓÇö peer surface pregate parity  
- Grok process prompt / dpf-platform skills ΓÇö hard stop before PR  
- AGENTS.md ΓÇö only a one-line pointer if enforcement location changes; no rule duplication  

## Sequencing note

Prefer extending `scripts/pr-health.mjs` + pregate evidence contracts (single SoT) before inventing new MCP tools. New MCP tool only if clients cannot read local evidence files.
