# AGENTS.md runtime-assumption audit

- **Backlog item:** BI-ACC7A2B5 — "Audit existing DPF skills + AGENTS.md sections for unmarked runtime assumptions"
- **Author:** Claude (external_coding_agent), 2026-07-24
- **Measured against:** `AGENTS.md` @ origin/main (112,515 bytes, 367 lines).
- **Coordinates with:** BI-0020D511 (instruction-plane split) — this audit is the committed **prerequisite** to that spec's Phase 1: an assumption must be *marked* before the split relocates the content, or a runtime-bound fact gets moved into an always-loaded skill as if it were durable doctrine.

## Why this matters (the correctness axis, not size)

AGENTS.md mixes two kinds of statement:

- **Doctrine** — durable rules true on every install, every day (e.g. "all changes land via PR", "never ask the user to run commands").
- **Runtime-bound facts** — true *of this install, at this moment, on this platform*: version pins, host/port literals, dated snapshots, in-flight transitions, and shallow-clone/Windows-junction environment shapes.

The two read identically today. When BI-0020D511's split moves content into on-demand skills and reference docs, a runtime-bound fact relocated **unmarked** becomes a landmine: an agent loads it from a skill months later and trusts "Prisma 7.x" or "the portal is at 127.0.0.1:3000" as doctrine, long after it drifted. The fix is a **marking convention** so every runtime-bound statement declares its contingency, and the split carries the marker with the content.

## Recommended marking convention

A single inline tag, cheap to grep and cheap to read, applied at the end of the sentence/bullet it qualifies:

> `⟦runtime: <what to re-verify> — snapshot <date-or-source>⟧`

Examples:
- Version pin → `⟦runtime: verify against packages/db/package.json — snapshot 2026-04-27⟧`
- Host/port literal → `⟦runtime: install-local topology — verify via Admin > Platform Development⟧`
- Transitional state → `⟦runtime: in-flight — expires when <condition>⟧`

The convention is greppable (`⟦runtime:`) so a future guard can assert that no `## ` doctrine section carries an *un*tagged version/host/date token — the enforcement half, deferred to the instruction-plane ratchet's `--strict` phase.

### Third clock — `⟦situational:⟧` (2026-08-01)

`⟦runtime:⟧` and `⟦model:⟧` are two instances of a more general fact: **a rule can be true only under conditions, and the corpus does not otherwise record them.** The generalisation is the third marker:

> `⟦situational: <condition that makes this true> — review <trigger or date>⟧`

It covers the contingencies the first two clocks miss — business phase, customer mix, team size, a regulatory moment, or a decision taken under circumstances that have since moved. Examples:

- `⟦situational: single-maintainer repo — review when a second full-time committer joins⟧`
- `⟦situational: pre-GA, no external installs — review at first customer install⟧`
- `⟦situational: while the seed shim is in place — review at the next release⟧`

Use it when a rule reads as absolute but was in fact a response to circumstances. The marker is not a weakening: an unmarked rule claims to hold unconditionally, and most do. The marker is how a rule that *doesn't* stops silently masquerading as one that does.

All three clocks feed the same review. `commons-are-curated-not-just-appended` question 2 (lapsed contingency) is the human's pass over them; a guard can only report that a marker exists, is malformed, or names a trigger that has passed — never that a condition still holds.

## Findings — five categories

### A. Dated snapshots stated as current fact

| Line | Statement | Note |
|---|---|---|
| 3 | "…none exist today, so this root file is the only AGENTS.md to consult." | Verifiable claim about subdirectory `AGENTS.md` files; will silently falsify the first time one is added. |
| 28 | `## 2. Project Architecture (current as of 2026-04-27)` | Marker exists but is ~3 months stale; the content beneath (§B) has almost certainly drifted. **The poster child** — BI-0020D511 §4b already routes all of §2 to a living arch doc. |
| 112 | "Implementation status: landed (re-audited 2026-06-19)…" | A dated verification snapshot presented inline as durable doctrine. |

### B. Version / toolchain pins (drift with every upgrade)

| Line | Pins |
|---|---|
| 30 | `Next.js 16`, `Prisma 7.x`, `postgres:16-alpine`, `Docker Desktop 4.40+`, the `/v1/chat/completions` contract |

These are runtime-bound facts about the current stack, stated as architecture. They belong in a living reference verified against `package.json` / compose files, not asserted in always-on doctrine. Highest-value targets for the convention (or for relocation under BI-0020D511 §4b, §2).

### C. Host / port / environment literals (install-specific topology)

| Line | Literal |
|---|---|
| 155 | `http://127.0.0.1:3000/api/mcp/token/refresh` |
| 332 | `localhost:12434` (DMR engine), `/platform/ai/runtime-health` |
| 333 | `:3001` (contributor preview) |

These assume a specific local topology. On a cloud/TAPPaaS target (which line 31 says is "in flight") they are wrong. Mark as install-local, verify via Admin > Platform Development. **Overlaps BI-ACC7A2B5's sibling concern** and is exactly the "each client/install has its own nuances" theme of BI-71310615.

### D. Transitional / expiring states (expiry unmarked)

| Line | Statement | Missing |
|---|---|---|
| 31 | "Windows installer today; macOS / Linux / cloud / TAPPaaS … in flight" | reasonably marked ("today"/"in flight") — keep |
| 33 | "Bash equivalents … are landing per …" | when do they stop "landing"? |
| 76 | "both names continue to work for **one release cycle**" | **which** release cycle — no anchor date/version; this expires and nobody will notice |
| 349 | "Build Studio is intentionally narrower … **today**" | marked; keep |

Line 76 is the sharpest: an expiry with no anchor. Mark with the release/date it expires, or it becomes a stale promise.

### E. Environment-shape assumptions (may not hold on every client/install)

| Line | Assumption |
|---|---|
| 7 | "AGENTS.md remains operationally authoritative when MCP is offline" — assumes MCP *can* be offline (correct, but it is an assumption the reader should see stated) |
| 82–83 | "This checkout is shallow (`…is-shallow-repository` → `true`)" — assumes a shallow clone; a full clone makes the shallow-rebase guidance a non-sequitur |
| 363–366 | The worktree/junction guidance is Windows-topology-specific (mostly marked "on Windows"; the junction-safety rules do not apply on macOS/Linux) |

These are correctly *conditional* rules, but the condition is sometimes buried mid-paragraph. Marking surfaces the precondition so a non-Windows / non-shallow agent knows the rule is inapplicable rather than mis-applying it.

## Skills pass (scope note)

The BI title also names DPF skills. A full `SKILL.md` sweep is a larger pass; the highest-density runtime assumptions live in the **procedure-heavy** skills that BI-0020D511 §4b relocates *out of* AGENTS.md (build-gate mechanics, worktree/compose setup, portal-driving host literals like `localhost:12434`). **Recommendation:** run the skill sweep *as part of* BI-0020D511 Phase 1, when each procedure section is already being rewritten into its skill — mark in the same edit rather than touching every `SKILL.md` twice. The AGENTS.md findings above are the load-bearing set because AGENTS.md is the always-on plane.

## Handoff to BI-0020D511 Phase 1

1. Apply the `⟦runtime:⟧` convention to categories A–D **as each section is relocated** in the split (marking travels with content — the whole point of sequencing this BI first).
2. §2 (category A/B) and the host literals (category C) are the prime candidates to move *out* of always-on doctrine into a living, verifiable reference, per BI-0020D511 §4b.
3. Line 76's unanchored "one release cycle" expiry should be resolved to a concrete anchor now (it is a correctness bug independent of the split).
4. Defer the enforcement guard (assert no doctrine section carries an untagged version/host/date token) to the instruction-plane ratchet's `--strict` phase.

---

## Application status (2026-07-31) — markers APPLIED to the pre-split file

The convention is now applied to `AGENTS.md` at `origin/main` (`c140cc60c`). **10 markers**, `grep -c "⟦runtime:" AGENTS.md` → 10.

This deliberately follows BI-0020D511 §8/§9 (*"ACC7A2B5's assumption-marking merges before Phase 1 begins, on the pre-split file, so the split relocates already-marked content"*) rather than handoff item 1 above (*"as each section is relocated"*). The two disagree; the spec's committed sequencing wins, and it is the stronger reading — marking during relocation means the marking never exists independently to review, and a section whose relocation slips is left unmarked indefinitely. **BI-0020D511's Phase 1 prerequisite is satisfied by this pass.**

| Finding | Where it landed | Marker gist |
|---|---|---|
| A — subdirectory `AGENTS.md` claim | line 3 | re-verify with `git ls-files '*AGENTS.md'` |
| A/B — stack version pins | §2 Stack bullet | pins drift; re-verify against `package.json` + compose files |
| A — "landed (re-audited 2026-06-19)" | §5 Build Studio gate | dated snapshot, not doctrine |
| C — `127.0.0.1:3000` token-refresh endpoint | after the PowerShell block | install-local topology |
| C — `:3001` Contributor preview | §17 lease bullet | the lease rule is doctrine, the number is not |
| D — Bash equivalents "landing per" | §2 PowerShell bullet | in-flight; expires when the plan closes |
| D — "one release cycle" shim promise | §4 worktree-seed bullet | expiry UNANCHORED — see below |
| E — shallow-clone rebase guidance | §4 rebase bullet | precondition: shallow checkouts only |
| E — `D:/DPF-worktrees/<topic>` | §17 worktree-location bullet | install-local path; §4 has the POSIX equivalent |
| E — junction-unsafe `--force` removal | §17 removal bullet | Windows-only hazard |

### Deviations from the audit as written, and why

- **Category C's `localhost:12434` / `/platform/ai/runtime-health` finding is obsolete.** Both literals have been removed from `AGENTS.md` by unrelated edits since 2026-07-24; `grep` returns nothing. No marker was invented for content that no longer exists.
- **Line 7 (MCP-offline authority) was NOT marked.** The audit itself scores it *"correct, but it is an assumption the reader should see stated"* — and the sentence already states it in its own words (*"remains operationally authoritative when MCP is offline"*). A marker here would add always-on bytes without changing any agent's action. Marking is reserved for assumptions whose failure would cause an agent to act wrongly.
- **Line 342 was NOT separately marked** — it already carries *"is NOT junction-safe on Windows"* inline, and line 345's marker covers the same hazard for the bullet group.
- **Handoff item 3 (the unanchored expiry) is surfaced, not resolved.** Resolving *"one release cycle"* to a concrete anchor requires knowing which release retires the `seed-worktree-mcp` / `ensure-dpf-skill-pack` shims — an owner call, not an audit finding. The marker says the expiry is unanchored so the defect is visible; **this remains open and is the one item this pass could not close.**

### Cost, stated plainly

The markers grew `AGENTS.md` 90,298 → 91,400 bytes (**+1,102**), so the instruction-plane ratchet was re-baselined upward (108,033 total) via the intentional-growth path the guard documents. This is a correctness pass adding bytes to the plane BI-0020D511 exists to shrink — a real, if small, tension. It is accepted because the alternative is worse: relocating unmarked runtime-bound facts into on-demand skills converts a visible staleness risk into an invisible one. Phase 1's ≤45,000-byte target now measures against 108,033.

Markers were kept terse for this reason — an earlier draft ran +1,707 bytes and was tightened by 35% with no loss of the actionable verb.

---

## Sibling convention (2026-07-31) — `⟦model:⟧`, a second clock

The `⟦runtime:⟧` convention tracks facts that drift with **the environment**. A second class drifts with **model releases**, and nothing tracked it:

> `⟦model: <what this compensates for, and the assumption behind it>⟧`

**"Re-verify on model upgrade" is implied by the kind and must not be restated in the text** — that redundancy cost 35% of the first draft's bytes for no added meaning.

### Why a separate clock is warranted

Anthropic's per-model prompting guidance shows the correct instruction *reversing between adjacent releases*:

| Behaviour | Claude Opus 4.8 guidance | Claude Opus 5 guidance |
|---|---|---|
| Subagent delegation | under-reaches — *add* "delegate more" | over-reaches — *cap* delegation |
| Verification instructions | prompt for them | **delete them** — they cause over-verification |
| Self-check ("double-check your answer") | standard good practice | counterproductive; inverts the usual advice |

A rule written to compensate for one model's tendency becomes actively wrong one release later, with no edit and no failing test. The byte ratchet freezes a baseline; model behaviour does not hold still that long.

### Applied — 2 markers, and why so few

Only two sites in `AGENTS.md` are genuine model-behaviour compensation:

| Location | Assumption marked |
|---|---|
| line 3, "Read in full before any action" | front-loading beats progressive disclosure — the load-bearing premise of the entire always-on plane (`DI-F844365B0DCC`, Option B) |
| §7 Subagent Dispatch Discipline | the injected "run the gate and fix errors" lines assume a subagent won't verify unprompted |

**That count is itself the finding.** `AGENTS.md`'s bulk is *enforced procedure*, not model-tuned prose — which means the over-specification problem is mostly a §12d enforcement-criterion problem (collapse a CI-enforced rule to statement + pointer), not a "delete the model-compensation" problem. The convention is therefore mostly **prospective**: it exists so Phase 1 and the destination skills don't accumulate model-tuned prose that silently inverts. Two markers now is the right number; manufacturing more would be marking rules that aren't model-dependent.

### Enforcement

`scripts/check-instruction-plane-size.mjs` exports `assumptionMarkers()`, counts both kinds across the always-on set, prints them in the summary line, and **hard-fails an unterminated marker** — the convention's only value is that `grep "⟦model:"` returns the complete set, so a broken marker is a broken index, not a cosmetic slip.

Cost: +234 bytes (`AGENTS.md` 91,400 → 91,634; plane total 108,267).
