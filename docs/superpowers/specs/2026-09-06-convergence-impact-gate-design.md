---
status: active
title: Convergence-Impact Gate — deployment truth as a per-PR question
backlog_item: BI-B19BE117
decision_interaction: DI-9DF1A83ECACD
---

# Convergence-Impact Gate

- **Date:** 2026-09-06
- **Scope:** platform — pull-request policy profile, PR trailer contract, gate context
- **Backlog item:** `BI-B19BE117`
- **Status:** Design — implemented in this branch.

**OBJ-CONVERGENCE-GATE-1:** Every PR that changes an install-reachable surface records, in a machine-readable trailer, how an install that already exists converges to the state the PR describes.

> Every PR is reviewed for whether the change is correct. Nothing asks how an
> install created three versions ago arrives at the same state.

## 1. Problem

Changes land in source, reach a fresh install via the installer, and silently never reach the installs that already exist. Deployments are cumulative: any install may upgrade from any past version, so each increment has to state how it converges. Today that knowledge lives in release notes and human memory. It keeps surfacing as individual defects, each found by biting someone.

| Instance | What did not converge |
| --- | --- |
| `BI-3727106F` | Pre-push gate convergence ran only in `pnpm install` postinstall; 68 of 85 worktrees pushed ungated. |
| `BI-BE8BBDE9` | `promote.sh` hard-required a launcher-signed envelope only a newer launcher could produce; existing installs could not cross. |
| `BI-922EBB99` | Retiring Neo4j and Qdrant from compose left orphaned containers and volumes on every existing install. |
| `#3262` | A compose volume referenced `DPF_STATE_DIR`; the installer never wrote it, so the root-run promoter resolved it to `/root/.dpf`. |

## 2. What already exists

Verified against `origin/main` at `998d1c4cbaa`. None of this is rebuilt.

- `scripts/promote.sh` composes from the new release assets (`_compose_root="$PROMOTE_SOURCE"`), so compose changes do reach installs.
- `scripts/promoter-migration-envelope.mjs` self-issues an envelope for N-1 callers.
- `scripts/test-n-minus-one-upgrade.mjs` and `.github/workflows/self-upgrade-acceptance.yml` exercise the upgrade crossing.
- `scripts/check-data-impact.mjs` is the only per-PR forward-looking gate. It fires on six persistent data surfaces (schema, migration, projection, ai-context, mdm-domain, lifecycle) and demands a JSON manifest.
- `scripts/check-compose-env-contract.mjs` statically checks compose volume vars against `.env.example`. It catches one shape of the problem (#3262) and cannot ask the general question.

## 3. Decisions

Two questions changed the shape of the work. Both went through `principle_decide`.

**Blocking or shadow?** `DI-9DF1A83ECACD`, high confidence, no commandment conflict. Blocking from day one, with a deliberately narrow classifier. A shadow gate leaves the record empty for exactly the PRs it exists to record, and a false positive costs a one-line trailer. Narrowness is the false-positive control: every registered surface carries the defect that proves it bites, and the `not-reachable` mode records a false positive so the registry can be tightened.

**Sibling or extension of Data-Impact?** `DI-91594F6EF8FA`. Folding into `check-data-impact.mjs` lost decisively. Sibling guard and a shared classifier module tied within the margin (the embedding provider was down, so only commandments scored). Sibling chosen: one clean revert, Data-Impact untouched, and the two gates demand different evidence (JSON manifest vs. trailer). If a third forward-looking gate appears, extract the classifier then.

## 4. Design

### 4.1 Registry

`scripts/convergence-surfaces.json` names the install-reachable surfaces. Each entry carries a `why` citing the defect that proves the bite.

| Kind | Reaches an existing install through |
| --- | --- |
| `compose` | promoter compose-from-release; never removes dropped services or provisions new vars |
| `env-contract` | the installer writes `.env` once; existing installs keep theirs |
| `installer` | launcher, promoter, install-state schema and migration code |
| `git-hooks` | whatever re-runs the hook converger |
| `install-config` | `config/` is COPYd into the image and read at boot |
| `image-copied-by-name` | parsed live from `Dockerfile` single-file `COPY` sources; a rename breaks every upgrade |
| `seed-content` | the same `config/seed-content-paths.json` the Seed-Fit gate reads; Seed-Fit asks whether the content belongs, this gate asks whether an existing install ever receives it |

Tests, fixtures and `__tests__` never classify. App source under `apps/` and `packages/` never classifies here: it is reached by the normal image rebuild, and its data surfaces belong to Data-Impact.

### 4.2 Attestation

When a surface is hit, the PR must carry `Convergence-Impact-Decision: <mode> — <reason>` in a commit message or the PR body. Modes are a closed set; the reason is at least 20 characters and names the mechanism.

| Mode | Meaning |
| --- | --- |
| `auto-converges` | an existing mechanism carries the change on the next upgrade; name it |
| `self-upgrade-step` | this PR adds or changes the promoter or migration step that carries it |
| `operator-action` | an operator must act on each install; name the action and the runbook |
| `fresh-install-only` | the surface does not exist on older installs and they do not need it |
| `not-reachable` | classifier false positive; say why so the registry can be tightened |

The trailer is the durable record. `gate-context.mjs` advertises it before generation so every surface knows to write it; `pr-readiness` parses it as a supported trailer.

### 4.3 Where it runs

`Convergence-Impact Gate` in the `pull-request` policy profile (`scripts/lib/ci-policy-guards.mjs`), beside Data-Impact. Its red/green fixtures run before the guard so a validator that stops rejecting attestation theater fails loudly. `pnpm check:convergence-impact` runs it locally.

## 5. Acceptance criteria

| Criterion | Objective | Statement |
| --- | --- | --- |
| AC-1 | OBJ-CONVERGENCE-GATE-1 | A compose change with no trailer fails the gate (test "gate FAILS a compose change") |
| AC-2 | OBJ-CONVERGENCE-GATE-1 | A trailer with a mode and no reason fails (test "attestation is theater") |
| AC-3 | OBJ-CONVERGENCE-GATE-1 | Each of the three motivating defects classifies (test "three motivating defects") |
| AC-4 | OBJ-CONVERGENCE-GATE-1 | App source, tests, fixtures and docs never classify (test "never classify") |
| AC-5 | OBJ-CONVERGENCE-GATE-1 | The trailer is advertised in gate context and accepted by pr-readiness (trailer contract test) |
| AC-6 | OBJ-CONVERGENCE-GATE-1 | The guard runs in the pull-request profile and its test is listed (ci-policy-guards entry, test inventory) |
| AC-7 | OBJ-CONVERGENCE-GATE-1 | A trailer quoted inside a fenced code block is not an attestation (test "fenced code block") |

## 6. Non-goals

- Booting a container in CI. No CI job runs the edge-node image today; that is real and addressed separately.
- Classifying app source. Data surfaces stay with Data-Impact; behaviour changes converge by image rebuild.
- Verifying the attestation is true. The gate records the claim so a coworker or the N-1 acceptance run can check it later.

## 7. Research and benchmarking

- **Kubernetes `kubectl apply --prune` and Helm `--remove-orphans`** treat convergence as the deployer's problem and solve it mechanically for the resource set they own. DPF adopts the framing (convergence is a property of each increment) and rejects the mechanism for now: the promoter cannot yet prune, and a per-PR statement is the cheapest record that survives until it can.
- **Rails / Django migrations** make every schema increment carry its own forward path and refuse to deploy without it. Data-Impact already mirrors this for data; this gate extends the discipline to non-data install surfaces.
- **Debian `maintainer scripts` (`preinst`/`postinst`) and `NEWS.Debian`** require a package that changes configuration on existing systems to ship the convergence step or a note operators must read. The closed `operator-action` mode is the `NEWS.Debian` equivalent, kept machine-readable.
