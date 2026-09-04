---
name: dpf-route-learning-to-commons
description: "Use in the DPF codebase at a task or session boundary when a finding has been confirmed and is durable."
disable-model-invocation: false
user-invocable: true
allowed-tools: mcp__dpf__propose_improvement mcp__dpf__doc_save mcp__dpf__propose_skill_improvement mcp__dpf__create_backlog_item mcp__dpf__save_build_notes mcp__dpf__contribute_to_hive mcp__dpf__escalate_feedback_upstream mcp__dpf__flag_stale_knowledge
category: governance
assignTo: ["documentation-specialist", "doc-specialist", "platform-engineer", "external-coding-agent"]
capability: null
taskType: reflection
triggerPattern: "route .*(learning|finding|insight)|share (this|the) (learning|finding)|capture .*(learning|insight)|propagate|to the commons|to the hive|don't silo|remember this for (everyone|all agents)|promote to (WWMD|WWWD|WSID)|end of (session|task) learnings"
userInvocable: true
agentInvocable: true
allowedTools: ["mcp__dpf__propose_improvement", "mcp__dpf__doc_save", "mcp__dpf__propose_skill_improvement", "mcp__dpf__create_backlog_item", "mcp__dpf__save_build_notes", "mcp__dpf__contribute_to_hive", "mcp__dpf__escalate_feedback_upstream", "mcp__dpf__flag_stale_knowledge"]
composesFrom: ["dpf-capture-kernel-gap", "dpf-record-decision-outcome", "dpf-file-backlog-item"]
contextRequirements: ["DPF MCP write tools reachable or explicit scope escalation path", "A confirmed, durable finding (not a situational scratch note)"]
riskBand: medium
enforces:
  - kernel/principles/learnings-belong-in-the-shared-commons
  - kernel/principles/single-source-of-truth
  - kernel/principles/governance-approves-evidence-not-provenance
---

# DPF Route Learning to the Commons

Turn a confirmed finding into durable, shared knowledge for **every** DPF agent and install. The default destination is the shared commons, not the client's local memory. Local memory is a staging/origin record at most.

## When to use

- A finding has been **confirmed** during a task or session (a decision rule that held, a platform fact that proved true, a technique that worked, a code invariant that must hold).
- At a task or session boundary, when sweeping what was learned before the context is lost.
- Whenever you are tempted to write a learning into a client-local memory file (`~/.claude` memory, a Codex note) and stop there — that is the smell this skill exists to catch.

Do **not** use this for install-specific configuration (secrets, host paths, this machine's GPU count, `COMPOSE_PROJECT_NAME`). Those are correctly local. Do not use it for a single session's scratch state — that belongs in execution evidence or a backlog comment.

## Enforces

- `kernel/principles/learnings-belong-in-the-shared-commons` — the principle this skill operationalizes.
- `kernel/principles/single-source-of-truth` — the commons is the one canonical home; everything else points at it.
- `kernel/principles/governance-approves-evidence-not-provenance` — a learning from the local model is as promotable as one from Claude; the gate reads evidence, not which client found it.

## Steps

1. **Confirm and state the finding** in one sentence, with the evidence that confirmed it (a log line, a DB query result, a passing test, an observed behavior). No evidence -> it is not yet a learning; gather evidence first (compose `dpf-evidence-before-diagnosis`).

2. **Classify** the learning into exactly one commons lane:
   - **Decision rule / durable judgment** ("when X, prefer Y") -> **WWMD** (founder kernel principle).
   - **Durable org / platform fact** ("X is true about this platform / this org") -> **WWWD** (platform knowledge).
   - **Role / profession technique** ("how a dispatcher / accountant / field tech does Z") -> **WSID** (profession corpus / skill).
   - **Code contract / invariant** -> **repo + AGENTS.md**.

3. **Route through the governed channel for that lane** (reuse existing tools — never invent a parallel store):

   | Lane | Primary tool(s) | Notes |
   |---|---|---|
   | WWMD | PR a `docs/founder-kernel/wiki/principles/*.md` page; or `mcp__dpf__save_build_notes` + `dpf-capture-kernel-gap` when the kernel can't yet answer | Kernel pages are PR-only (ratified on merge). Do not invent a principle in-place; draft it for review. |
   | WWWD | `mcp__dpf__propose_improvement` (files a reviewable proposal + indexes platform knowledge); or `mcp__dpf__doc_save` for a managed document; flag a superseded fact with `mcp__dpf__flag_stale_knowledge` | Org-overlay WikiPages go draft -> review -> publish. |
   | WSID | `mcp__dpf__propose_skill_improvement` against the target skill; or author a `SKILL.md` in `packages/dpf-skill-pack/skills/` | Techniques seed as governed skills for both surfaces. |
   | code+AGENTS.md | `mcp__dpf__create_backlog_item` (BI) then PR the code + doc together | A code contract isn't real until it's in the tree and the rulebook. |

4. **Contribute it to the hive** so other installs inherit it: `mcp__dpf__contribute_to_hive` for a shipped improvement, or `mcp__dpf__escalate_feedback_upstream` for feedback-shaped findings. This is the step that turns install-local knowledge into platform-wide knowledge. Skipping it leaves the learning robust on one install only.

5. **Record the route** so the boundary is auditable: note which lane, which tool, the proposal/PR/BI id, and the hive contribution id. If local memory was the origin record, leave a pointer from it to the commons entry — do not leave the local copy as the source of truth.

## Guardrails

- **Local-only is a defect, not a default.** If you finish this skill with the learning still living only in a client memory file, you have not applied it. The only correct local-only outcome is genuinely install-specific config — and you must say so explicitly.
- **Do not bypass MCP scope with direct SQL or runtime patches.** If a write tool returns `insufficient_token_scope`, stop and surface the required scope (per AGENTS.md §8); issue a scoped token, then retry through MCP.
- **Do not duplicate.** Check for an existing commons entry first; update or point at it rather than creating a parallel one (`single-source-of-truth`).
- **One lane per learning.** If a finding seems to belong in two lanes, it is usually two learnings — split it.
- **Evidence travels with the learning.** Every routed entry carries the confirming evidence; the gate approves on that, not on which agent produced it.

## Worked example

The local model confirms, from `docker logs`, that single-GPU local inference must be serialized or builds time out. Classification: **durable platform fact -> WWWD**. Route: `mcp__dpf__propose_improvement` with the log evidence and the fix (serialize local inference), which files a reviewable proposal and indexes it in platform knowledge. Then `mcp__dpf__contribute_to_hive` so other single-GPU installs inherit the constraint. Record: proposal id + hive contribution id noted in the session's route log; the local note is reduced to a pointer at the WWWD entry. The next build on any install reads the constraint instead of timing out — the platform got robust on its own.
