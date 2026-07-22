# Agent Process Efficiency Hardening — Dependency-Work Edition

| Field | Value |
|-------|-------|
| **Status** | Draft — authored 2026-07-21 |
| **Created** | 2026-07-21 |
| **Author** | Claude (Opus 4.8) + Mark Bodman |
| **Trigger** | Retrospective on the PR #3357 (Dependabot clear) / #3359 (sovereignty spec) session: extract the lessons into shared substrate so every agent client is faster next time. |
| **Epic** | `EP-DEP-SOVEREIGNTY` (Phase-0 enabling tooling) · tracking `BI-3FB75D09` |
| **Companion specs** | `2026-07-21-dependency-sovereignty-and-supply-chain-intake-hardening-design.md`, `2026-05-21-supply-chain-and-desired-state-assurance-design.md` |

---

## 1. The root lesson

The single session that produced PR #3357/#3359 wasted the most effort on things that were **knowable but not written where an agent would find them**:

- ~8 lockfile re-resolve cycles rediscovering that editing pnpm `overrides:` re-resolves the whole tree offline-stale from the populated store, and that the fix is a fresh-empty `--config.storeDir`.
- Hand-rolling the spec / BI / architecture-review / decision-escalation flow, then discovering DPF already has skills that specify each step.
- Nearly duplicating an existing supply-chain spec.

Every one of those lessons was saved to **client-local memory** (`~/.claude/.../memory/`), which **Codex, Grok, and Build Studio never read**. The meta-principle: *a lesson that lives in one client's memory has not been captured* — the durable fix must land in AGENTS.md, a skill, or CI/scripts, the substrate all four surfaces read (`learnings-belong-in-the-shared-commons`, `single-source-of-truth`).

This spec turns that session's lessons into shared substrate, scoped to dependency work (the domain that generated them).

## 2. Change / Remove / Add

### Add

1. **`scripts/regen-lockfile.mjs`** — the sanctioned lockfile regeneration path. Runs pnpm `install --lockfile-only` against a fresh, empty store+cache dir (forcing fresh registry metadata), then asserts the resulting diff is scoped to an expected package set and that a second plain re-resolve is a no-op (proving `--frozen-lockfile` will pass). Replaces an 8-cycle rediscovery with `pnpm regen:lockfile`.
2. **`scripts/check-override-comments.mjs` (+ `.test.mjs`) + a CI job** — enforce that every *security-floor* entry under `overrides:` in `pnpm-workspace.yaml` carries a machine-readable `Dependabot #NN` / GHSA tag in a comment. This is the precondition that makes the stale-override audit (`BI-CDB2E8AB`) able to cross-check "is this alert still open?".
3. **`dpf-clear-dependabot-alerts` skill** (`packages/dpf-skill-pack/skills/…/SKILL.md`) — the runbook for the recurring "clear Dependabot alerts" task: categorize transitive-vs-direct → floor via `overrides` with a tagged comment → regenerate via the helper → verify no vuln + no drift → DCO PR. Composes with `dpf-verify-substrate-first` (before) and `dpf-pr-with-dco` (after).
4. **AGENTS.md dependency-hygiene rule** (§5) — a short, pointer-only rule naming the regen helper, the override-comment convention, and the two supply-chain specs, so Codex/Grok inherit the same doctrine.

### Change

5. **Skill-first for governed artifacts.** The session's clearest miss was hand-rolling spec/BI/review/decision before reaching for the skills that own them. AGENTS.md §16 already lists these; the change is a one-line nudge in §6 that authoring a spec/plan/BI/decision starts by reaching for the matching `dpf-*` skill (they carry the substrate-verify and kernel-record steps).
6. **Route learnings to commons by default.** `dpf-route-learning-to-commons` already exists; the change is behavioral — a confirmed *platform* learning goes to AGENTS.md / a skill / the hive, with client memory holding only a pointer. Dogfooded by this very spec.

### Remove

7. **Client-memory-as-primary-store for platform-durable facts** — the anti-pattern that let this session's lessons stay invisible to other clients. (Enforced by habit, not code; called out in §6 above.)
8. **The 8 redundant override floors** — `BI-316CCCD7`, already filed; each dead floor is noise the next agent reasons past.

## 3. Design details

### 3.1 `regen-lockfile.mjs`

- Inputs: optional `--expect <comma-list>` of package names allowed to change (the security targets); default warns on any change outside a small allowlist.
- Steps: create fresh temp `storeDir`+`cacheDir` → `pnpm install --lockfile-only --config.storeDir=… --config.cacheDir=…` → `git diff` the lockfile → parse changed `name@version` keys → fail if any changed package is outside `--expect` → re-run plain `pnpm install --lockfile-only` and fail if it produces further changes (instability).
- Output: a scoped diff summary and a `STABLE`/`UNSTABLE` + `SCOPED`/`DRIFT` verdict. Advisory when run manually; the CI angle is the override-comment lint, not this.
- Safety: never touches the developer's real pnpm store (uses temp dirs), cleans them up on exit.

### 3.2 `check-override-comments.mjs`

- Parses `pnpm-workspace.yaml`, walks the `overrides:` block, and for each entry classifies it as *security-floor* vs *dedup/pin* vs *known-block* (jest-30, diagram pins — allowlisted by a small curated set).
- A security-floor entry must have, on the entry line or the comment lines immediately above it, a token matching `Dependabot #\d+` or `GHSA-[\w-]+` or `CVE-\d{4}-\d+`.
- Fails with the offending keys listed. The `.test.mjs` covers: tagged-pass, untagged-fail, allowlisted-block-skip, dedup-skip.
- Wired as CI job **"Override Provenance Guard"** and `pnpm check:override-comments`.
- Deliberately narrow: it checks *documentation provenance*, not whether the floor is still needed (that is the audit's job). Keeps single responsibility.

### 3.3 `dpf-clear-dependabot-alerts` skill

- Superset SKILL.md (both surfaces), `category: ops`, `assignTo: ["build-specialist","platform-engineer","ops-coordinator"]`, `composesFrom: ["dpf-verify-substrate-first"]`, trigger on `dependabot|security alert|vulnerability alert|clear .* (alert|CVE|advisory)|bump .* (vulnerable|CVE)`.
- Body: the runbook, explicitly naming the fresh-store regen helper and the override-comment convention, and the transitive-vs-direct decision (override the transitive floor; bump the direct dep).

## 4. Non-goals

- A generic "regenerate any lockfile for any reason" tool — scoped to the security-floor/override workflow.
- Auto-pruning overrides — the audit (`BI-CDB2E8AB`) proposes, humans/agents verify each prune (`BI-316CCCD7`).
- Re-specifying SBOM/SCA or the tiered sovereignty posture — owned by the companion specs.
- A new epic — this is Phase-0 tooling under `EP-DEP-SOVEREIGNTY`.

## 5. Verification

- `pnpm check:override-comments` passes on the current (tagged) `pnpm-workspace.yaml` and its unit test is green.
- `node --test scripts/check-override-comments.test.mjs` green.
- `scripts/regen-lockfile.mjs` reproduces the committed lockfile as a scoped, stable no-op on `main` (source-only: exercised against the fresh-store path).
- AGENTS.md §16 lists the new skill; `seed-skills` auto-discovers the SKILL.md (no explicit registration list).

## 6. Acceptance criteria

1. The regen helper exists and is the AGENTS.md-sanctioned path for lockfile regeneration.
2. The override-provenance lint is a required-adjacent CI job and green on the current tree.
3. `dpf-clear-dependabot-alerts` exists and is registered in AGENTS.md §16.
4. AGENTS.md carries the dependency-hygiene pointer rule (reaches Codex/Grok).
5. This session's durable rulings are routed to the commons (AGENTS.md / hive), not left in client memory.
