---
status: binding
---

# Consumer-Install Rulebook Pointer

| Field | Value |
| --- | --- |
| Date | 2026-08-23 |
| Epic | `EP-1FABA22D` — Purpose-Aware Installation and Ecosystem Productivity |
| Backlog item | `BI-649C1F7E` |
| Surface | `config/consumer-install/agent-pointer.md` (ships as `AGENTS.md` to every install) |
| Owners | Platform installation lifecycle, agent host contract |
| Decision ledgers | `DI-DD513E6FD1F9` (scope, margin 1.225) · `DI-584EDA33EDD2` (word budget, margin 2.223) — both `principle_decide`, high confidence |
| Related | `2026-08-22-installation-identity-and-agent-stance-design.md`; `2026-08-22-installation-identity-declaration-surface-design.md`; `2026-08-22-external-agent-operating-contract-design.md` |

## 1. Decision

The file an installation ships as `AGENTS.md` shall tell an agent that the
**source checkout's** `AGENTS.md` is the canonical contract for code work, that
it must be read in full, and that **it will not load automatically**.

The pointer states where the contract is and that it is required. It does not
restate any rule from it.

## 2. The gap

`config/consumer-install/agent-pointer.md` ships byte-identical as `AGENTS.md`
to every install. Today it ends with:

> For code changes, use a separate DPF source checkout and governed worktree.

That names the *place* and stops. It never says the checkout carries a contract,
that reading it is mandatory, or that an install-anchored session will not
receive it.

### 2.1 Why the omission bites

Agent clients auto-load `CLAUDE.md` from the working-directory tree. Verified on
a live host on 2026-08-23:

| Path | Contents |
| --- | --- |
| `<install>/CLAUDE.md` | **absent** |
| `<install>/AGENTS.md` | this 795-byte pointer |
| `<source>/AGENTS.md` | the canonical rulebook, §1–§12 |
| `<source>/CLAUDE.md` | `@AGENTS.md` — the import that loads it |

The import lives in the source tree. A session anchored to the install is
outside that tree, so the rulebook is absent from context and **nothing signals
the absence**. The agent does not experience a missing file; it experiences no
file at all.

This is the same class of defect the parent identity work addressed from the
other side: `2026-08-22-installation-identity-and-agent-stance-design.md` §2
found that `agent-pointer.md` "ships as a byte-identical `AGENTS.md` to every
install, so a file-scanning agent learns nothing instance-specific." That slice
made the file say what *this installation* is. This slice makes it say where the
*contract* is.

### 2.2 Observed cost

An external coding agent delivered PR #4483 without ever loading the rulebook,
producing three violations from that one omission:

1. **§3** — "All changes land via PR against `main`". It opened a PR stacked on
   a feature branch. `ci.yml` is `pull_request: branches: [main]`, so roughly
   thirty checks never ran while `mergeStateStatus` still reported `CLEAN`.
2. **§4.2** — "Production build … TypeScript errors surface only here, not in
   `vitest` or IDE checks". Skipped, and the omission shipped verbatim that
   failure: `node:fs/promises` reached the client bundle, invisible to typecheck
   and to 24,321 passing unit tests.
3. **§12** — work-scope decisions route through `principle_decide`; "Option
   1/2/3, you pick" without a ledger is the named anti-pattern. It surfaced
   exactly that menu, for a question §3 and §4 already answered.

Each was diagnosed at the time as an isolated lesson and given its own narrow
fix. They were one cause.

## 3. Contract

Two sentences are added to the existing "For code changes" paragraph. They are
**pointer text only** — no rule, threshold, or section content is copied into
the install, so `single-source-of-truth` holds and the rulebook stays the only
place a rule is authored.

The text must:

- name `AGENTS.md` in the source checkout as the canonical operating contract
  for code changes;
- say it must be read in full before source work;
- say plainly that it does **not** load automatically from this directory.

The third clause is the load-bearing one. An agent that believes a contract will
arrive on its own does not go looking for it.

### 3.1 The word budget had to move first

`check-release-asset-contract.test.mjs` caps this file at **under 120 words**,
with the rationale "the pointer must not duplicate the contributor rulebook".
After `#4474` added the identity and capture lines the file sat at **118**, so
the cap had **one word** of headroom. The shortest useful form of this change is
nine words.

The cap is a *proxy* for an intent, and the proxy had begun to block the intent:
what it forbade here was a reference **to** the rulebook, which is the opposite
of duplicating it. The only way to satisfy the number was to delete shipped
guidance another concern deliberately added.

So the assertion is sharpened to test the intent directly:

| Assertion | Forbids |
| --- | --- |
| `doesNotMatch(/§/)` | rulebook section citations — point at it, do not quote it |
| `doesNotMatch(/…absolute path…/)` | path literals; checkout locations differ per host |
| `doesNotMatch(/^\s*(?:[-*+]|\d+\.)\s+/m)` | a rule list — the rulebook leaking in |
| `match(/AGENTS\.md/)` | *requires* the file to name what it points at |
| `< 200 words` | backstop only, orders of magnitude below the rulebook |

Each was verified to fail on a violation, not merely to pass on a clean tree —
a guard that cannot fail is the `severity === "error"` defect this repository
already paid for once.

`Principle-Based Rules Over Enumeration` and `Remove avoidable failure
opportunities` are the two core principles that carried this in the ledger
(`DI-584EDA33EDD2`, composite 9.81 against 7.58 for deferring and 6.31 for
trimming shipped prose).

## 4. Non-goals

- **No rule text in the install.** The install carries a pointer. Copying even
  one §-numbered rule creates the second home `single-source-of-truth` forbids,
  and installs upgrade on their own cadence, so the copy would drift.
- **No path literal.** Checkout locations differ per host; naming one would be
  wrong on most installs and stale on the rest. The pointer describes the
  relationship ("the source checkout you use for code changes"), not a path.
- **No new file in the install.** Adding `CLAUDE.md` to the install directory
  would make an installed runtime carry agent-client configuration, and its
  `@AGENTS.md` would import the install's own stub rather than the rulebook.
- **No installer change.** The file already ships; only its content changes.
- **Does not supersede the MCP handshake.** Server instructions remain the
  authoritative contract for *this install and this token's authority*. The
  rulebook governs *source changes*. The pointer keeps that split explicit.

## 5. Acceptance criteria

1. The shipped pointer names the source checkout's `AGENTS.md` as required
   reading for code changes.
2. It states that the rulebook does not load automatically from the install
   directory.
3. It contains no rule text, no §-number, and no absolute path.
4. It continues to say the install is not a source repository, that MCP server
   instructions are authoritative for this install, and that backlog items must
   be captured before teardown — the existing content is preserved.
5. It remains a single short file an agent reads in full without cost.
6. The release-asset contract test forbids section citations, path literals, and
   rule lists, and each of those assertions fails when violated.

## 6. Decision record

- **Pointer, not a copy.** `single-source-of-truth` is a commandment. An install
  that restated the rules would drift from the repository the moment either
  changed, and installs upgrade independently.
- **State the non-loading explicitly.** "Use a separate source checkout" was
  already present and was not enough — it reads as a location, not as an
  obligation. The failure was an agent that never knew a contract existed, so the
  fix has to address belief, not just address the filesystem.
- **The install file is the right surface.** It is the only artifact that reaches
  every install and is positioned where an install-anchored session actually
  looks. `plan-before-install-paths` is why this carries a spec rather than
  landing as a drive-by edit.
- **Scope routed, not guessed.** `principle_decide` ranked spec-then-fix above
  both backlog-only and a drive-by edit (composite 10.96 / 9.73 / 8.24, margin
  1.225, high confidence, ledger `DI-DD513E6FD1F9`). The agent's own instinct had
  been backlog-only, which the ledger ranked last.

## Design grounding

- Existing specs/plans reviewed:
  - `docs/superpowers/specs/2026-08-22-installation-identity-and-agent-stance-design.md`
    §2, which first identified `agent-pointer.md` as carrying nothing
    instance-specific.
  - `docs/superpowers/specs/2026-08-22-installation-identity-declaration-surface-design.md`
    for the authority split this pointer must not contradict.
  - `docs/superpowers/specs/2026-08-22-external-agent-operating-contract-design.md`
    for the source-free external agent contract boundary.
  - `search_specs_and_plans` and `search_knowledge` returned no existing spec or
    backlog item covering agent contract discovery from an install.
- Current code substrate reviewed:
  - `config/consumer-install/agent-pointer.md` — the shipped file and its git
    history (#4452 made the consumer boundary explicit; #4474 added the identity
    and capture lines).
  - `AGENTS.md` §1 (`single-source-of-truth`, `learnings-belong-in-the-shared-commons`),
    §3, §4, §12.
  - `docs/founder-kernel/wiki/principles/plan-before-install-paths.md`,
    `single-source-of-truth.md`, `learnings-belong-in-the-shared-commons.md`.
- Source of truth:
  - the source checkout's `AGENTS.md` remains the only home for the rules; this
    file only points at it. MCP server instructions remain authoritative for the
    install's own operating limits.
- Decision:
  - extend the shipped pointer with required-reading and does-not-auto-load
    clauses; copy no rule text; name no path.
