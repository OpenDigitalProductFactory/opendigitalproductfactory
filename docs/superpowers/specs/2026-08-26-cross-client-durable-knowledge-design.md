# Cross-client durable knowledge: commons-first defaults and enforcement

Backlog item: **BI-DE1333A1**
Status: design, for review
Date: 2026-08-26

## 1. Problem

Durable platform findings keep landing in **client-private stores** that no other agent can read.
Over one session an agent recorded confirmed findings to:

- `C:\Users\<user>\.claude\projects\D--DPF\memory\*.md` — Claude Code only
- `D:\Backups\dpf-reset-playbook\improvements-log.md` — 40+ entries, outside the repo

A Grok or Codex thread continuing the same work sees none of it. The operator asked directly:
*"I'm implementing in GROK, will it see that memory as well?"* It will not.

The cost is not only the lost finding. Each client silently accumulates a **rival source of
truth**, so two agents on the same platform hold different beliefs about it and neither knows.

## 2. The uncomfortable part: this is not a doctrine gap

The doctrine already exists and is precise.
`docs/founder-kernel/wiki/principles/learnings-belong-in-the-shared-commons.md`:

> "Reserve local, client-only memory (a Claude Code `~/.claude` memory file, a Codex note, an
> undocumented runtime tweak) for genuinely **install-specific configuration** — secrets, host
> paths, this machine's GPU count. Everything else is shared knowledge and must leave the client
> through a governed channel."

`AGENTS.md` §1 restates it: *"Local-only knowledge is a defect."* A skill,
`dpf-route-learning-to-commons`, implements the routing correctly, with lane classification and
a hive-contribution step.

**The agent that produced the violations above read that principle during the session, quoted it
back while filing an unrelated finding, and then violated it three more times.**

So this is not a doctrine gap, an awareness gap, or a tooling gap. It is a **defaults and
enforcement** gap:

| Path | Cost to the agent |
|---|---|
| Write to client memory | one tool call, always available, no classification required |
| Route to the commons | choose a lane, choose a tool, invoke a skill, at a boundary with no gate |

Under context pressure the cheap path wins every time. A rule that is correct, well-placed, and
free to ignore will be ignored.

## 3. Non-goals

- **Not a new memory store.** See §4 — the substrate already exists.
- **Not a new principle.** `learnings-belong-in-the-shared-commons` and
  `selective-memory-not-total-recall` are correct and sufficient.
- **Not eliminating client memory.** Per-client fast recall is useful; it must stop being
  authoritative.
- **Not capturing transcripts or raw events.** `selective-memory-not-total-recall` already rules
  that out and PROJECTMEM reports memory bloat as a real failure mode (§7).

## 4. What already exists

Verified against the live MCP endpoint on 2026-08-26. All reachable by **any** connected client —
Claude, Codex, Grok:

```
doc_save · doc_search · doc_load · doc_link · wiki_query · search_knowledge
search_knowledge_base · propose_improvement · contribute_to_hive
escalate_feedback_upstream · flag_stale_knowledge · propose_skill_improvement
save_build_notes
```

Plus the governed backlog (`create_backlog_item`, `query_backlog`) which is already the one store
every client shares — every finding filed as a BI in that session **is** visible to Grok today.

**MCP is the portability layer, and DPF already has one.** No new store is required. This is a
routing problem, which makes the work far smaller than "build cross-agent memory".

## 5. Design

### 5.1 Commons-first is the default write path

Routing to the commons must become the path of least resistance rather than the disciplined
exception. The lane classification in `dpf-route-learning-to-commons` is already correct and is
adopted unchanged:

| Lane | Destination |
|---|---|
| Decision rule / durable judgment | WWMD — kernel principle page, PR-only |
| Durable org / platform fact | WWWD — `propose_improvement` / `doc_save` |
| Role / profession technique | WSID — `propose_skill_improvement` |
| Code contract / invariant | repo + `AGENTS.md`, via a BI and a PR |

The change is not the taxonomy. It is that **a confirmed finding routes by default**, and staying
local requires justification.

### 5.2 Client memory is demoted to a pointer index

Client memory keeps its value (fast, always-loaded recall) and loses its authority.

**Format.** One line per entry, naming the commons id that holds the content:

```
- [short hook] -> BI-DE1333A1
- [short hook] -> docs/architecture/canonical-minimal-substrate.md
- [short hook] -> wiki:learnings-belong-in-the-shared-commons
```

**Rule.** A client memory entry carries a hook and a pointer. It does not carry the finding. If
the pointer cannot be written, the finding is not yet durable and the local note is a **staging
record**, explicitly marked as such and cleared when routed.

This preserves the one genuine advantage of client memory — it loads without a tool call — while
making it impossible for it to diverge from the commons, because it holds nothing to diverge.

### 5.3 The session boundary is closed

`dpf-route-learning-to-commons` exists and nothing invokes it. Add a boundary step: before a
session ends, confirmed findings are swept and routed. The skill already defines the procedure;
what is missing is the trigger.

### 5.4 Enforcement

The only mechanism that survives an agent under load is a check it cannot skip. Options, in
increasing order of strength:

1. **Advisory sweep** — a session-boundary reminder listing client-local writes made during the
   session. Cheap; relies on the same discipline that already failed.
2. **Ratchet guard** — in the style of the existing style-drift and label-association ratchets:
   fail when a session records durable findings only in client-local paths. Freezes current
   behaviour, blocks net-new.
3. **Write interception** — treat a client-local memory write of anything but install-specific
   config as a governed action requiring a lane declaration.

Recommendation: **(2)**, consistent with how this codebase already enforces things, with (1) as
an immediate stopgap. (3) is noted for completeness but likely over-constrains legitimate local
config.

**Open question for review:** a guard can see repo paths; client memory lives outside the repo.
Enforcement therefore needs either a client-side hook (`PreToolUse`, per AGENTS.md — Claude-format
today, aliased on Codex, unproven elsewhere) or an MCP-side signal. This is the load-bearing
unknown in the design and the reason it is filed for review rather than implemented.

### 5.5 Staleness and contradiction

`flag_stale_knowledge` already exists and `commons-are-curated-not-just-appended` already sets the
curation stance (guards nominate, only the accountable human consolidates or retires).

Adopt PROJECTMEM's **contradiction flagging** rather than silent overwrite: when a routed finding
conflicts with an existing commons entry, surface both and flag, do not replace. This session
produced two live examples of why — `verticals-care` was recorded as "built for humans" when it
had already been made subject-agnostic, and a memory note said `backlog:capture` was broken two
days after it was fixed. Both were stale rather than wrong-at-the-time, and both were repeated
confidently.

### 5.6 What legitimately stays local

Stating this explicitly so the fix does not over-reach:

- secrets, host paths, machine-specific config (GPU count, `COMPOSE_PROJECT_NAME`) — already
  carved out by the principle
- **the reset / teardown scaffolding** in `D:\Backups\dpf-reset-playbook\`. This is how the
  platform is stood up and torn down **from outside** during testing. It is operator tooling, not
  platform knowledge, and moving it into the repo would be a category error. The *findings*
  produced while using it are commons material; the scaffolding itself is not.
- a single session's scratch state — belongs in execution evidence or a backlog comment

## 6. Implementation phases

Dependency order, not priority order.

1. **Pointer-index conversion** — define the format (§5.2), convert the existing Claude memory
   entries, leave each pointing at its commons id. Immediately removes the current divergence.
2. **Session-boundary sweep** (§5.3) — advisory first, so the behaviour exists before it is
   enforced.
3. **Guard** (§5.4) — resolve the client-side visibility question first; that decision gates the
   implementation shape.
4. **Contradiction flagging** (§5.5) — extend `flag_stale_knowledge` usage into the routing path.

Phases 1 and 2 are independently shippable and worth doing regardless of how 3 resolves.

## 7. Prior art

We are not alone in this. MCP has become the portability layer for exactly this problem:
heterogeneous fleets (Claude, GPT, local Llama) share **one memory endpoint** rather than
diverging per-model context stores. Cognee and Mem0 both expose memory behind MCP for that
reason. Reconstructing lost context is estimated at 5,000-20,000 tokens per session.

`PROJECTMEM` (arXiv 2606.12329) is the closest published design: local-first, event-sourced, with
a **judgment layer that flags when a past finding conflicts with current observation**. Two of its
reported failure modes bear directly on this design — **memory bloat** over long runs, and
**difficulty disambiguating similar-but-distinct failures**. DPF's
`selective-memory-not-total-recall` already anticipates the first; §5.5 addresses the second.

The distinction worth keeping: those systems solve *storage and retrieval*. DPF already has both.
What DPF is missing is the **routing default and the gate** — which is a governance problem, and
is the part none of the referenced systems address.

## 8. Acceptance

1. A finding confirmed in a Claude session is readable by a Grok session without either agent
   sharing a filesystem path.
2. Client memory entries carry pointers, not content; no entry is the sole home of a finding.
3. A session that ends with durable findings recorded only in client-local paths is detectable —
   and, once phase 3 lands, refused.
4. The local carve-out in §5.6 still works: install-specific config and the reset scaffolding stay
   local without triggering the guard.
5. A routed finding that contradicts an existing commons entry surfaces both rather than
   overwriting.

## 9. Sources

- [Cognee — memory tooling for AI coding agents](https://www.cognee.ai/memory-tooling-ai-coding-agents)
- [PROJECTMEM: a local-first, event-sourced memory and judgment layer for AI coding agents](https://arxiv.org/pdf/2606.12329)
- [State of AI agent memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
