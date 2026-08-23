# Thread Governance Conformance — make the work shape obvious and enforced

- **Date:** 2026-08-22
- **Status:** Draft for review
- **Umbrella BI:** BI-299C953D
- **Epic:** EP-5560770F (Development Process Spine — distribute & enforce spec/plan/doc discipline across surfaces)
- **Workroom:** WC-0D395540
- **Kernel decision:** DI-48014BCBA44F (doctrine delivery mechanism)
- **Operator direction (2026-08-22):** "the work shape needs to be 100% understandable and obvious, followed and enforced wherever possible to prevent catastrophe."

---

## 1. Problem

A new agent thread can begin substantive work in this repository without loading doctrine, without governed MCP, and without claiming a workroom. Nothing detects it and nothing prevents it. Every symptom the operator reported — threads not reading `AGENTS.md`, the workroom construct unused, AI coworkers never engaged — is downstream of one broken chain.

### 1.1 Measured state (host sweep, 2026-08-22)

| Fact | Measurement | Method |
|---|---|---|
| Worktrees whose `CLAUDE.md` loads no doctrine | **70 of 80** | `git worktree list` × grep for `^@AGENTS.md` |
| Worktrees where governed MCP can authenticate | **0** (root clone excepted) | unexpanded bearer header → HTTP 401; valid token → HTTP 200 |
| Hooks enforcing a workroom claim | **0 of 13** PreToolUse guards | `grep -rn claim_workroom_scope packages/dpf-skill-pack/` |
| Skills referencing a workroom claim | **0** | same grep; includes `dpf-worktree-per-session` and `worktree-create.mjs` |
| Worktrees with a live workroom capsule | **0 of 80** (22 ever had one) | `list_workrooms` × `git worktree list` |
| Capsules that are reap-candidates | **41 of 50** | `list_workrooms` liveness |
| Tool-native worktrees inside the root clone | **24** (against §12) | `ls .claude/worktrees/` |
| Skills/hooks triggering coworker engagement | **0** | `grep summon_coworker\|find_coworker` |

### 1.2 The causal chain

```
The bearer token never reaches the agent client process
   (it lives in ~/.zshenv → shells only; the client is launched from the GUI)
        │
        ├─► .mcp.json sends literal "Bearer ${DPF_MCP_BEARER_TOKEN}" ──► HTTP 401
        │     └─► no backlog tools, no workroom, no coworkers, no evidence recording
        │         (root clone escapes only via a hardcoded token in ~/.claude.json)
        │
70 of 80 worktrees carry the pre-#4477 prose-link CLAUDE.md
        │
        └─► AGENTS.md never enters context
              └─► §12 "claim a workroom before you work" reaches nobody
                    └─► and nothing else enforces it — so nobody claims one
```

Each link is independently sufficient to produce a rogue thread. The thread is not disobedient; it is uninformed and unconstrained. **It cannot know what it does not know.**

### 1.3 Why the existing fix is not enough

PR #4477 (BI-C6308D90) corrected `CLAUDE.md` to use `@AGENTS.md`. That is correct and necessary, but it only reaches branches created or rebased after it merged. Doctrine delivery remains a **per-branch file**, so any long-lived branch silently misses it, and nothing anywhere asserts that doctrine actually loaded. This is the *absence-is-invisible-to-every-gate* class: we check that a file is present, never that a rule is in force.

The operator's observation — "just pointing to the folder doesn't seem to work now, it used to" — is precisely this. Pointing worked when worktrees were short-lived and few. At 80 concurrent long-lived worktrees, a per-branch pointer is a race the pointer loses.

---

## 2. Design principles for this program

1. **One computation, two faces.** A single conformance module computes the thread's state. The session-start banner is its *readable* face; the PreToolUse guards are its *enforcing* face. They can never disagree, because there is nothing to disagree about.
2. **Fail closed, with a named door.** A check that cannot be evaluated is a failure, not a pass. Every denial names the exact remediation. Every bypass is explicit, attributed, and recorded — never silent.
3. **Obvious beats complete.** One ordered checklist, five lines, plain language, showing the first unmet step and how to fix it. Ten accurate paragraphs that nobody reads are a defect.
4. **Presence is not liveness.** Every probe proves the *behaviour* (a guard actually denies; an authenticated call actually returns 200), never that a file exists or an env var is set.
5. **Enforcement is per-surface and honestly reported.** A surface whose guards cannot be proven live is reported as **ungoverned**, not as green.

---

## 3. The work shape

This is the whole contract. It is intentionally five steps, ordered, with no branches.

| # | Step | Enforced by | Failure mode today |
|---|---|---|---|
| 1 | **Be in your own worktree** at the canonical sibling base — not the root clone, not `.claude/worktrees` | `root-clone-guard` (exists) + new canonical-base guard | 24 tool-native worktrees exist |
| 2 | **Doctrine is loaded** — the rulebook is in context and provably so | new: hook-injected doctrine + load assertion | inert in 70/80 worktrees |
| 3 | **Governed MCP is authenticated** — a real call returns 200 | new: authenticated probe, not env presence | 401 in every worktree |
| 4 | **A workroom claims this worktree** | new: `workroom-claim-guard` (PreToolUse) | 0 of 80 worktrees |
| 5 | **A live BI covers the work** | `plan-backlog-coverage-guard` (exists, narrow) | only gates xlarge plan work |

Steps 1, 4 and 5 are enforced at the moment of first mutation. Steps 2 and 3 are established at session start, before the thread can act.

---

## 4. Mechanism

### 4.1 Shared conformance module

`packages/dpf-skill-pack/hooks/lib/thread-conformance.mjs` exports one function returning a typed verdict per step:

```
{ step, status: 'pass'|'fail'|'unknown', detail, remediation, failurePolicy: 'deny'|'warn' }
```

`unknown` is treated as `fail` under a `deny` policy. Both the banner and the guards import this module; neither reimplements a check.

### 4.2 Session-start banner (BI-21B04901)

One block, replacing the current six independent paragraphs, which fold beneath it or are demoted:

```
DPF WORK SHAPE — 3 of 5 ready
  1. worktree ......... OK   ~/dpf-worktrees/thread-governance-conformance
  2. doctrine ......... OK   AGENTS.md loaded (hook-injected, skill-pack 0.2.5)
  3. governed MCP ..... OK   authenticated (200)
  4. workroom ......... MISSING
  5. BI coverage ...... MISSING
  → Next: claim a workroom.  create_workroom(...) then claim_workroom_scope(...)
     Editing is blocked until step 4 passes.
```

Only the first unmet step gets a remediation line. Nothing else is printed.

### 4.3 Doctrine delivery (BI-E659ED37) — kernel decision DI-48014BCBA44F

Options scored by `principle_decide` (external_coding_agent population, 47 principles applied):

| Option | Composite | Verdict |
|---|---|---|
| `repo-pointer-only` — status quo + one-off backfill | 6.04 | rejected |
| **`hook-injected-doctrine`** — SessionStart hook resolves doctrine from the installed skill pack, not the checked-out branch; asserts it loaded | **14.34** | **recommended, high confidence (margin 1.71)** |
| `mcp-served-doctrine` — serve doctrine from the MCP plane | 12.62 | rejected |

Top contributors to the recommendation: *Research and Use Standards*, *Worktree is source-control isolation not runtime isolation*, *Structural verification is not functional verification*, *Single Source of Truth*. No commandment conflict; autonomy eligible.

`mcp-served-doctrine` scored well on single-source but was rejected on `operational_independence` (0.2): it makes doctrine unavailable exactly when MCP auth is broken — which is the failure being fixed. Doctrine must not depend on the thing doctrine governs.

**Decision:** deliver doctrine from the hook plane, resolved from the installed skill pack so it cannot go stale per branch. Retain the repo `CLAUDE.md` pointer as the fallback for surfaces without a hook plane (Codex reads `AGENTS.md` natively and is already correct). Backfill the 70 stale worktrees as a one-off, but the backfill is a cleanup, not the mechanism.

### 4.4 Workroom claim guard (BI-865E1755)

PreToolUse, matchers `Write|Edit|MultiEdit` **and** `Bash`. The Bash matcher is not optional: bypass permissions mode routes file edits through Bash, around every `Write|Edit` hook. Denies when the worktree has no live capsule, with the exact call to make. Read-only tools are never gated.

### 4.5 Per-surface enforcement matrix

| Surface | Doctrine | Guards | Notes |
|---|---|---|---|
| Claude Code | hook-injected | native, live | reference implementation |
| Codex | native `AGENTS.md` + hook | **fail-open until a human clicks Trust** | BI-E8E7FCDF; upstream openai/codex#21615 blocks automation |
| Grok | hook-injected | live (`~/.grok/hooks/dpf-guards.json`) | ignores plugin-bundled hooks |
| Antigravity | unproven | unproven | report as ungoverned until probed |
| Build Studio | in-substrate | in-substrate | not a hook-plane surface |

A surface that cannot prove its guards deny is reported **ungoverned** in the banner. Honest degradation beats a false green.

---

## 5. Research & Benchmarking

| System | Pattern | DPF adopts / rejects |
|---|---|---|
| **Kubernetes admission controllers** (`ValidatingAdmissionWebhook`) | Requests are admitted or rejected at one chokepoint; each webhook declares an explicit `failurePolicy: Fail\|Ignore`; rejection returns a human-readable message | **Adopt.** Per-check explicit failure policy and deny-with-remediation are exactly what today's "reminder" hooks lack. `Fail` is our default; `Ignore` must be declared, never implicit. |
| **pre-commit** (pre-commit.com) | Declarative hook manifest; `pre-commit install` bootstraps local enforcement; the same hooks run in CI so a skipped local run is still caught | **Adopt the CI backstop.** Local hook planes are per-surface and defeatable (see Codex). The same conformance checks must run in the cloud merge queue so a fail-open local surface cannot land ungoverned work. |
| **Open Policy Agent / Conftest** | Policy expressed once as data, evaluated by many enforcement points | **Adopt the shape, reject the stack.** One shared policy module evaluated by banner + guards + CI is the right architecture; a separate policy language (Rego) is unjustified weight against thirteen existing plain-JS hooks. |

Standard chosen: the admission-controller model with an explicit per-check failure policy, one shared policy module, and a CI backstop. This is the mainstream answer to "advisory checks get ignored", and it is what the current reminder-style hooks are missing.

---

## 6. Non-goals

- Re-litigating #4477. The import fix is correct and stays.
- Coworker engagement design. The measured gap (no trigger anywhere) is real but is a distinct decision about *when* a thread should engage a coworker; it needs its own spec and is not blocked by this work.
- Reaping the 70 stale worktrees. Backfill brings them into conformance; reaping is `dpf-worktree-hygiene`'s job.

## 7. Open questions for the operator

1. **Bypass door.** Fail-closed needs exactly one documented, attributed escape for genuine emergencies. Preference: an env-var bypass that is recorded as workroom evidence and surfaces in the banner as `UNGOVERNED — bypassed by <principal> at <time>`.
2. **Codex trust.** Upstream provides no non-interactive hook-trust API. Accept an operator-attested trust state surfaced in the banner, or treat Codex as ungoverned until upstream ships one?
