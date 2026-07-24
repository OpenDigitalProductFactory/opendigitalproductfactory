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
