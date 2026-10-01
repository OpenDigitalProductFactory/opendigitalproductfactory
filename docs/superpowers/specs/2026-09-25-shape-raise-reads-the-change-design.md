---
status: active
title: A shape raise reads the change, names its trigger, and stays satisfiable
backlog_item: BI-243BC956
---

# A shape raise reads the change, names its trigger, and stays satisfiable

- **Date:** 2026-09-25
- **Scope:** platform — initiative readiness v3 (shape × sensitivity), backlog claim, completion, Build Studio entry gate, `get_backlog_item` projection
- **Backlog item:** `BI-243BC956`
- **Profile:** fix. The item's own prose raised it `small → medium` at claim (`IRD-3CB48BD52B5E`), and the body was left as written.
- **Decisions:** WWMD `DI-52BAAB9E6835` (source of change facts), `DI-B9DCC3F456F9` (what counts as substrate)
- **Supersedes:** §3.2 line "Sensitivity keyword regex plus org risk posture → sensitivity floor" of `2026-09-02-work-shape-taxonomy-and-proportional-gates-design.md`, for the readiness gate only. Build Studio model routing still uses the keyword heuristic.

**OBJ-SHAPE-RAISE-READS-CHANGE:** A delivery shape is raised by what the change touches, not by the words describing it. Every raise names its trigger. A raise never lands an item in a table it cannot satisfy.

## 1. Defect, on a named ref

Source at `origin/main` `865d42e658f`:

- `apps/web/lib/explore/build-process-matrix.ts:467`: `HIGH_SENSITIVITY_PATTERN`.
- `apps/web/lib/explore/build-process-matrix.ts:472`: `deriveDeliverableSensitivity` regex-matches `${title}\n${body}`.
- Every readiness caller passes that prose: `governed-work-claim.ts:441` (claim), `backlog-pack-read-tools.ts:445` (read), `build-entry-gate.ts:168` (Build Studio), `backlog-terminal-transition.ts:532` (completion).
- `initiative-readiness/profiles.ts:38` maps `refactor → feature`. `shape-requirements.ts:77` caps only the `fix` profile at medium.

Reproductions:

| Item | Change | Prose trigger | Result |
| --- | --- | --- | --- |
| BI-1669E08A | `scripts/pregate.mjs`, `scripts/lib/local-integration-ci.mjs` + tests | "infrastructure" (elevated) | small → medium, owes `OBJECTIVE_BASELINE_REQUIRED` (`IRD-C448AEF8B568`) |
| BI-7DCA6159 | 2-file import swap in `lib/actions/ap.ts`, `lib/finance/ai-provider-finance.ts` | "payment" (high), refactor → feature profile | small → large, ten gates, claim refused (`IRD-1ABAA5FF219B`) |

Causes ruled out by running them against 865d42e6:
- The risk-posture floor: the readiness callers pass no posture, and `balanced` still gives `high`.
- The title: title-only text gives `low`.
- A general effect of the body: replacing the one word "infrastructure" gives `low`.
- Shape resolution: the declared shape is `small`, so the raise happens after it.

The incentive this produces is backwards: a precise defect report raises its own shape, and authors learn to keep impact prose out of the body.

## 2. Design

### 2.1 Change facts govern; prose is the fallback (DI-52BAAB9E6835)

At claim time no diff exists, so change facts come from what the work declares:

1. **Declared scope.** The bound Workroom's `edit` claims of kind `path`, `module` or `package` (`claim_workroom_scope`). They are read live room first, then the newest closed room, which is the same rule as the bound shape. Completion therefore re-reads what the change said it edits.
2. **Body-cited paths.** Repo paths the item's title or body cites, under a known root (`apps/`, `packages/`, `scripts/`, `lib/`, …). An import specifier (`@/lib/…`) and a `:line` suffix are not read as files.
3. **Prose keywords.** The existing heuristic, used **only when (1) and (2) are both empty**. The raise then says it came from prose, so the author can see how to replace a word with a fact.

With change facts present, prose cannot raise above what the paths warrant.

Options rejected:
- **Agreement required.** With no path facts, prose alone never raises. That under-protects sensitive work nobody has scoped yet.
- **Declared paths only.** Ignoring prose entirely has the same gap, and it depends on an edit claim that does not exist at the first claim.
- **Status quo plus citation.** The incentive stays backwards.

### 2.2 Substrate is structural (DI-B9DCC3F456F9)

`classifyChangePath` in `initiative-readiness/delivery-sensitivity.ts`:

| Class | Level | Matches |
| --- | --- | --- |
| access-control | high | path tokens `auth`, `authn`, `authz`, `oauth`, `rbac`, `permission(s)`, `grant(s)`, `credential(s)`, `secret(s)`, `security`, `middleware`; `agent_registry.json` |
| migration | elevated | `prisma/migrations/**` |
| schema | elevated | `prisma/schema*.prisma`, `prisma/schema/**` |
| route | elevated | `app/**/route.*`, `app/api/**` |
| external-surface | elevated | `integrations/`, `infra/`, `docker/`, compose files, Dockerfiles, `.github/workflows/`; tokens `webhook(s)`, `outbound`, `federation` |

- Tests (`*.test.*`, `*.spec.*`, `__tests__/`, `tests/`, `e2e/`) and docs (`docs/`, `*.md`) are never substrate.
- A domain noun in a module name (`payment`, `invoice`, `finance`) is not substrate. Classifying on it would reproduce the keyword defect one level down.
- Money movement is still raised when its schema, migrations, routes or external surfaces change.

### 2.3 A raise names its trigger

`shapeDecision` gains `trigger: { signal, source, evidence }`:
- `source` is one of `declared-scope`, `item-body-paths` or `item-prose`.
- `evidence` is the path, or the matched word, that set the level.
- It is `null` when nothing matched.

### 2.4 A refactor takes the fix ceiling; an unsatisfiable raise is refused on the record

- `raiseCeilingFor(profile, workType)` returns `medium` for the `fix` profile **or** `workType: refactor`. A refactor is behavior-preserving by definition, so it may not be raised past what a fix in the same files gets. The profile mapping itself is unchanged, because a refactor's research lane is still design exploration.
- When the ceiling caps a raise, `shapeDecision.refusedRaise = { shape, reason }` records the shape that was asked for and why it was refused ("would owe gates with no reachable route"). It is not owed.

### 2.5 Unchanged

- Sensitivity still only raises.
- `break-fix` and `xlarge` are never reshaped.
- Build Studio's model routing and review intensity still read the keyword heuristic, which now lives in `explore/sensitivity-keywords.ts`, one copy shared by both.

## 3. Ordered deliverables

1. `explore/sensitivity-keywords.ts`: the keyword patterns plus `matchDeliverableSensitivityKeyword`. `build-process-matrix.ts` imports it, which shrinks that ratcheted module.
2. `initiative-readiness/delivery-sensitivity.ts`: `classifyChangePath`, `extractCitedRepoPaths` and `assessDeliverySensitivity`.
3. `bound-work-shape.ts`: `readBoundEditPaths`, sharing the room lookup with `readBoundWorkShapeRef`.
4. `shape-requirements.ts` gets `shapeRaise` and the work-type-aware `raiseCeilingFor`. `evaluate.ts` gets `trigger` and `refusedRaise` on `shapeDecision`. `types.ts` gets `sensitivityTrigger` and `workType` on the facts.
5. Callers switch to the assessment, and `entry-adapter` accepts it: claim, completion, the Build Studio entry gate, `get_backlog_item`, and the two shape-resolution signal sites.
6. The kernel principle `gates-proportional-to-shape` is updated to state where sensitivity is read from and the ceiling.

## 4. Acceptance → proof

| Criterion | Proof |
| --- | --- |
| A raise cites its trigger in `shapeDecision` | `shape-requirements.test.ts` "cites the trigger (signal and source)" |
| No raise from body text alone when the change touches no substrate | `delivery-sensitivity.test.ts` BI-1669E08A and BI-7DCA6159 fixtures → `{ level: "low", trigger: null }` |
| Regression: CLI-modules-and-tests change stays small, owes no `OBJECTIVE_BASELINE_REQUIRED` | `shape-requirements.test.ts` "regression: sensitive prose over a CLI-modules-and-tests change" |
| An unsatisfiable raise is refused, not owed | `shape-requirements.test.ts` "records the part of a raise it refused" |
| A refactor is not raised past a fix's ceiling | `shape-requirements.test.ts` "caps a behavior-preserving refactor at the fix ceiling" |
| Genuinely sensitive changes still raise | `delivery-sensitivity.test.ts` schema, declared auth path and prose-only fallback cases |

Live follow-on: re-claim BI-7DCA6159 as `delivery-small` after self-upgrade and confirm `shapeDecision.raised === false`.

## 5. Research & benchmarking

Path-based risk routing is the established pattern for deciding review depth from what a change touches:
- **GitHub CODEOWNERS** and **GitLab Code Owners with approval rules** require extra approvers when a change touches matching path globs. The trigger is the diff's paths, never the PR description.
- **Gerrit submit requirements** key on file predicates (`file:`, `directory:`).
- **Chromium's OWNERS / security-review triggers** route by directory (for example `//sandbox`, `//components/permissions`).

DPF adopts the path-glob principle and the structural substrate classes. It rejects PR-description keyword triggers, which none of these tools use for gating.

It deviates in one respect. At claim time no diff exists, so DPF reads declared scope and cited paths first. It keeps the prose heuristic only as a labelled fallback, and completion re-reads the declared scope.
