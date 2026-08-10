# DPF Pre-Work Checklist (mandatory)

Before doing ANY research, file reads, spec writing, or implementation on a backlog
item or feature request, complete ALL of the following steps in order. Skipping any
step — even when the task feels urgent or obvious — is a process defect.

## Step 0: Ensure a backlog item exists

If the user gives an ad-hoc request ("fix this bug", "add this feature") without
referencing a backlog item ID, create one first via `create_backlog_item` before
proceeding. Every piece of work enters through the backlog. (AGENTS.md §5)

## Step 1: Claim the work capsule

Call the DPF MCP `claim_backlog_item_for_work` with worktreePath, branchName,
provider, and sessionRef for the target BI. Do this before implementation.
(AGENTS.md §12)

## Step 2: Branch guard

Run `git branch --show-current`. If the result is `main` or `HEAD (no branch)`, STOP
and complete steps 3–4 before any further action.

## Step 3: Create a worktree

```
git fetch origin main
git worktree add D:/DPF-worktrees/<topic> -b <prefix>/<topic>
```

- Prefix: `fix/` for bugs, `feat/` for features, `chore/` for chores, `doc/` for docs.
- All implementation work happens inside the worktree. Never in the root clone.
- Run `scripts/dpf-bootstrap-agent-toolchain.ps1` inside the worktree to seed MCP config.
(AGENTS.md §3)

## Step 4: Multi-option platform decisions → principle_decide first

If the work has 2+ architecturally distinct options (approach A vs B, scope altitude,
schema shape, process trade-off), call `principle_decide` **before** committing to one:

- `callingPopulation: "external_coding_agent"` for Grok/Claude/Codex/Antigravity
- `callingSurface`: normalized `grok-desktop` | `claude-desktop` | `codex-desktop` |
  `antigravity-desktop` | `build-studio` | `coworker` (optional `:<slug>`)
- Features map on every option (magnitudes, not goodness; cost axes higher = worse)
- Read `data.signalQuality.usable` then `data.ledger` (`recorded`, `interactionId`)
- Report the DI id; operator audit is `/coworker-decisions/decisions` — not wiki DEC pages

Skills: `dpf-decision-via-kernel`, then `dpf-record-decision-outcome`.
(AGENTS.md §11; BI-D5ACBAE2; BI-IMP-024C7B2B)

## Step 5: Write the spec first (when building)

Before touching any source file for a build-size BI, create the design spec inside
the worktree at:

```
docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md
```

This is the single source of truth for the work and must exist before implementation
begins. (AGENTS.md §5)

## Step 6: Then implement

Only after steps 0–5 are complete (as applicable), proceed with codebase research
and implementation.

---

> This rule exists because the AGENTS.md process rules are present in context but
> were skipped under activation pressure in live sessions (2026-08-02, 2026-08-10
> Grok decision-process investigation). This closer enforcement surface prevents
> the same compliance gap from recurring across Grok, Claude, Codex, and peers.
