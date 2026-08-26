---
title: "AI Workforce"
area: ai-workforce
order: 1
---

## Overview

AI Workforce is the directory and management home for the people-like AI roles that work in DPF. Start here to find who can help, what work they offer, whether that work is available for the current business type, and how much approval or review it requires.

Coworkers are grouped from customer-facing work inward:

1. **Customers and sales**
2. **Your team**
3. **Operations and delivery**
4. **Platform and back office**
5. **Other** — work that has not yet been explicitly classified

Provider, model, prompt, skill, runtime, and decision evidence remains available, but it is supporting detail rather than the directory's starting point.

The grouping describes the work a coworker offers, not where the coworker's
identity sits in the workforce hierarchy. A coworker appears in one of the four
areas only when an active service is assigned there. Unassigned work remains in
**Other** instead of being guessed from a title or team.

## Start With the End-to-End Picture

If you are new to how coworkers are governed, read
[How Governed Work Actually Runs](how-governed-work-runs.md) first. It walks one piece of work
from convening a room to reading the receipt, and names which control acts at each step — the
room's shape, the pace it sets, the corpus it consults, the gate on the tool, and where the
outcome is reviewed. The pages in this area own the detail for each of those steps.

## Find and Work With a Coworker

1. Open `/platform/ai/overview`.
2. Search by coworker name or the work you need done.
3. Filter by business area, interaction, availability, or attention state. Additional profession and lifecycle filters are under **More filters**.
4. Read the three compact signals on each coworker: who they interact with, whether their declared work supports this business type, and their approval/autonomy posture.
5. Choose **View coworker** for the full record.
6. Choose the named action, such as **Ask Marketing**, when the coworker is **Available for your business type**. This opens the selected coworker in the existing panel without sending a message for you.

The roster keeps filter state in the URL. Returning from a coworker record restores the same directory view.

An availability label is not a runtime guess. It is projected from the current storefront business type, explicit coworker service declarations, enabled skill assignments, registered tools, effective grants, lifecycle certification, governed blockers, and the same routing requirements used for a representative task from that service. Those routing requirements include task type, tool use, sensitivity clearance, capability and context floors, Golden Triangle priority, model assignment, policy, capacity, and local-only settings. Provider and model assignments are preferences: an eligible fallback may keep work available, while a provider known to need reauthentication or billing repair is not advertised as ready. **Available** means at least one applicable advertised service has verified backing and an eligible task route. The searchable work, area, job description, interaction labels, availability, and named Ask action all describe that same service. A ready service does not make unresolved sibling work ready; each sibling and its evidence remain visible under **Availability evidence**.

Missing declarations or unevaluated readiness appear as **Coverage not defined**. Missing backing appears as **Setup needed**, and lifecycle, safety, or routing blockers appear as **Needs attention**. These states fail closed and do not show the Ask action. A recovery action appears only when DPF has an owner-capable destination that the signed-in operator can access, such as business type, capabilities, capability needs, the runnable certification job, or AI readiness. Platform-managed catalog defects remain visible in Availability evidence without a misleading operator action. Coworker-specific actions preserve the current roster filters. Opening a named Ask action never sends work automatically; the operator must submit a message explicitly.

### Reading a Coworker's Shape

The coworker record opens with **Shape** — a picture of the gates that coworker's work passes
through, left to right, with one status mark per row. It answers "where is this coworker, and
what is holding it" without reading a paragraph.

Each stage shows one of five states: **passed**, **holding**, **declined**, **awaiting a
person**, or **not reached**. Declined and awaiting-a-person are deliberately different marks —
a decline is a settled answer to act on, while awaiting a person is an open question. A stage
with no records says **No records yet** rather than guessing: the picture shows only what the
audit trail recorded, so it never disagrees with the ledger.

**Governed action** lists the coworker's recent governed tool calls, each traceable to its audit
row; a call that did not land shows as declined. The **Decision gate** stage stays empty for now:
the decision record does not yet identify which coworker acted, and DPF will not attribute another
coworker's decisions on a guess.

Use **Shape / Detail** at the top right to choose whether the picture leads. The full record is
shown either way, and your choice is remembered on this browser. The same picture and the same
toggle appear on a Workroom, so what you learn to read here reads the same there.

Model assignments explicitly saved by an operator remain unchanged during upgrades. Platform-supplied defaults are system-owned and converge to the current release declaration, so an obsolete default from an earlier release cannot silently leave a coworker unavailable after the platform has corrected that default.

## Key Concepts

- **Provider Registry** — The list of AI providers connected to the platform (e.g., Anthropic/Claude, OpenAI/Codex, xAI/Grok, Docker Model Runner for local models). Each provider has its own credential path, status, sensitivity clearance, and set of available models.
- **Model Profiles** — Per-model configuration that controls routing behaviour: capability tier, cost sensitivity, latency requirements, and which task types the model is suitable for.
- **Routing** — The logic that selects which model handles a given request. Routing considers the task type, required capability level, current provider availability, and cost constraints.
- **Failover Chain** — The ordered sequence of fallback models to use if the primary model is unavailable or returns an error. Failover is automatic and transparent to users.
- **Token Spend** — Usage tracking per provider and model. Visible to admins to monitor cost and identify unexpected consumption patterns.
- **Finance Bridge** — When a provider is configured, the platform can seed finance ownership by linking the provider to a supplier, draft contract, and finance work items.
- **Tool Grants** — Each agent has a declared set of tool grants in `agent_registry.json` that control which platform tools it can invoke. Tool grants are enforced at runtime — an agent can only use tools that match its grants AND the user's role capabilities (effective permissions = user role intersection with agent grants).
- **Approval and autonomy** — The owner-facing record projects existing oversight and governance evidence into plain labels: **Cannot act**, **Advises only**, **Prepares work for approval**, **Acts with approval**, **Acts with review**, or **Can act within limits**. Incomplete or contradictory evidence appears as **Approval rules need review**.
- **Tool Evaluation Pipeline** — External tools (MCP servers, npm packages, APIs) must pass a multi-agent evaluation pipeline (security, architecture, compliance, integration) before adoption. See EP-GOVERN-002.

## What You Can Do

- Register new AI providers and configure their API keys and connection settings
- Find coworkers by business area, customer/partner interaction, business-type availability, approval posture, and attention state
- Open one coworker record with six sections: **Overview**, **Work Offered**, **Availability**, **Capabilities**, **Autonomy & Governance**, and **Activity**
- Open the selected coworker in the shared panel without creating a second conversation surface
- Review available models per provider and configure their routing profiles
- Set up failover chains to ensure continuity when a provider is degraded
- Monitor token spend and usage patterns across all active providers
- Open a decision record from AI Operations when investigating a gate result; legacy `/platform/ai/decisions/[interactionId]` links lead to the canonical Decision Log detail where the evidence and available owner action are shown
- Hand off configured providers into Finance so supplier ownership and committed spend stay visible
- Manage agent-to-provider assignments for specific platform capabilities
- Optionally give the standing COO a conversational name from its coworker record; DPF always keeps the `AI COO` role visible and does not change the coworker's identity, authority, or audit attribution
- View the **Authority** tab to understand agent tool grants, oversight levels, and escalation paths
- Review the **Action History** to see all agent proposals and their approval status
- Inspect the **Tool Execution Log** to audit every tool call made by any agent (who, what, when, result)
- Open a coworker record to review **Living Playbooks** and see when the platform is testing a better method
- Evaluate external tools via the **Tool Evaluation Pipeline** before adding them to the platform
- Connect external coding surfaces such as Claude, Codex, and Grok while keeping the same MCP, evidence, documentation, and PR gates as Build Studio
- Open **Runtime Health** to see which local services are required by enabled capabilities and which AI runtimes are managed by configured providers

## Reading the Skills Catalog

`/platform/ai/skills` answers one question on arrival: what your coworkers know how to do. It opens with a short summary, the count of catalog entries, and one action — **Grant a skill to a coworker**, which takes you to the directory, because skills are granted per coworker on their own record rather than from the catalog.

Skills are grouped by category and collapsed. Open a category to see its skills; open a skill to read its description, version, risk band, source, tags, and how many coworkers it is assigned to. Nothing is hidden from you and nothing is truncated — the grouping means you choose what to read instead of scrolling past everything.

Search and the status/source filters work across the whole catalog, and the groups open automatically when a filter is active so you see matches straight away.

If any skill has drifted from the seed, a warning appears under the summary: a fresh install would not match this one. A second warning says drift **can't be checked** for a skill — the repository is there but that skill has no seed file, so an approval can't be compared with what ships. Treat that as unresolved, not as healthy. When no repository is reachable at all, the page says so plainly; that one is normal on a production install. When a skill change is waiting for review, the Skills page says so at the top and links straight to it, and the item also appears in your Needs-you inbox. Before that, a pending change had no surface outside its own skill page, so one could wait indefinitely with nobody told.

Approving a skill proposal also opens a pull request carrying the change against the skill's seed file, and the panel links to it — merge that and the change is in what your coworkers load. Approving also writes the approved text to that skill's seed file, because the seed is the copy that ships. The panel names the file it wrote and asks you to commit it. If it could not write — no repository is reachable, or the skill has no seed file — it says the approval landed in the catalog only and a reseed will revert it. Read that as unfinished: the change is not yet in what your coworkers load.

The drift detail, along with route-level skills, observability, and the curator report, sits under **Technical details** — one control at the foot of the page. Those are diagnostics for when you are investigating something specific, not part of reading the catalog.

## Related Routes

- `/platform/ai/skills` — the global skills catalog and observatory
- `/platform/ai/overview` — customer-first coworker directory
- `/platform/ai/agent/[agentId]` — selected coworker record and work entry
- `/platform/ai/providers/[providerId]` — provider setup and the Finance Bridge panel
- `/platform/ai/agent/AGT-ORCH-000` — standing COO record, including its optional organization-visible conversational name
- `/platform/ai/runtime-health` — capability-aware local service and external-provider health
- `/finance/spend/ai` — finance-owned view of AI supplier commitments and work items

## Reading Runtime Health

Runtime Health explains infrastructure in terms of enabled capabilities. **Required — unavailable** needs attention because an enabled capability depends on that local service. **Optional — inactive** is expected when its capability is disabled and does not make the platform unhealthy. **Optional — degraded** means the capability is enabled but its local service is unavailable. **External — provider managed** reports reconciled provider evidence rather than pretending the provider is a local container. Each state includes text and an action; color is supplementary.

### Coworker routing

Runtime Health also lists every production coworker with whether it can reach
an eligible AI model **right now** — including at the stricter data class its
real conversations can be escalated to when they touch restricted material.
A coworker shown **Blocked** here would fail its next conversation, and the
"Why" column names the cause in plain language. A scheduled preflight runs the
same check every few hours and raises one owner-visible alert when any
coworker has zero eligible models, so a routing dead-end announces itself
instead of being discovered mid-conversation.

### Context budget: what recent turns were given

Every coworker turn assembles context — page data, recalled facts, prior conversation — against a token budget for the model running it. When it does not all fit, the least important sources are shortened or left out. **Context budget** is a collapsed panel at the foot of Runtime Health that reports what was left out, across the most recent turns that recorded a decision.

Expand it when a coworker seems not to know something it should. It separates three cases that otherwise look identical: the fact was never found, it was found but left out for budget, or it was supplied and the model did not use it. The first two show here; the third does not, which is itself the answer.

It reports **what was withheld from the model, not whether the reply was worse for it** — that judgement stays yours. "No turns recorded a trace" means nothing has arbitrated in the sample yet, which is different from nothing being left out. If one source dominates the table, that is the candidate for a larger budget or a smaller payload.

## Capability Completeness

Each coworker record carries a **Capability completeness** panel. It answers a
question the roster alone cannot: not "is this coworker configured?" but "can it
actually do its job?"

A capability is only real when seven things all resolve for that coworker:

| Plane | What it asserts |
|-------|-----------------|
| Identity | It is one reconciled identity, not a name in a single registry |
| Corpus | It can reach its profession's craft corpus before deciding |
| Governance | It can consult the kernel, and has somewhere to escalate |
| Shape | Its work has declared stages and gates |
| Cadence | Something makes it run without being asked |
| Tools + Skills | It has skills assigned to it and tools it can call |
| Evidence | Certification exercises a real act of its domain, not a generic probe |

Each plane is graded **absent → declared → reachable → proven** rather than
pass/fail, because a capability that is declared but unreachable is the failure
that looks most like success.

### Reading the two percentages

The panel shows two numbers, and the gap between them is the point:

- **of what the platform allows today** — how complete this coworker is against
  what the platform currently supports.
- **of the target** — how complete it is against the full design.

A coworker at 100% of the first and well below the second is *finished*; the
remaining gap belongs to the platform, not to this coworker. Planes in that
state are labelled **Blocked by the platform, not this coworker** so you do not
go looking for a setting to change.

### What to watch

- A plane showing a **gap** names the specific missing piece — often a permission.
- **Cadence: absent** means this coworker has no recurring work, so raising its
  Proactivity will not by itself make it act.
- The measure is refreshed from the platform's own source, not hand-maintained.
  It reflects the shipped build, not the running install's data.

### What you must still do

The panel reports; it never changes a coworker's authority. Granting a
permission, assigning a skill, or raising an autonomy level remains a deliberate
human action.

## Authority & Governance

The **Authority** tab (`/platform/ai/authority`) provides visibility into the agent governance model:

### Agent Authority Overview
Each agent card shows:
- **Tool grant count** — how many platform tools the agent can invoke
- **Oversight** — how much employee involvement the coworker needs: **Employee only**, **Needs approval**, **Employee review**, or **Runs on its own**. Stored internally as the HITL tier (0-3); "HITL" is the technical name for the same setting, and the portal shows the plain label.
- **Escalation path** — which employee role receives escalations and the SLA
- **Value stream** — which IT4IT value stream the agent operates in

### Tool Execution Log
Every tool call — not just proposals — is recorded in the `ToolExecution` table with:
- Which agent made the call
- Which user triggered the conversation
- What tool was called, with what parameters
- Whether it succeeded or failed, and how long it took

Filter by agent, tool name, success/failure, or time range to answer questions like:
- "What did AGT-190 (Security Auditor) do last week?"
- "How many backlog items were created by agents this month?"
- "Which tools are failing most often?"

### Effective Permissions
Agent tool availability is the **intersection** of two authority systems:
1. **User role capabilities** — what the logged-in user's platform role allows (HR-000 through HR-500)
2. **Agent tool grants** — what the agent's declared grants in `agent_registry.json` permit

An action is only possible if BOTH allow it. This prevents agents from exceeding their design scope, even when triggered by a user with broad permissions.

## Reading Decision Separation

The decision review inbox (`/platform/ai/founder-review`) opens with **Decision separation** — how
your coworkers' decisions are landing, and whether the confident ones held up.

Every decision the kernel weighs produces a *margin*: how far the winning option beat the
runner-up. Decisions fall in three bands. **Proceed** and **decline** are both settled answers.
The **uncertain** band in the middle is where the platform could not call it either way, and it
is the only band that costs someone's attention.

The chart shows where decisions landed. Bars left of the band edge are the uncertain ones. The
headline percentage is the share that landed there — the number to drive down by improving the
corpora and principles your coworkers decide against, so that decisions separate cleanly.

Beneath it, **reversed** shows how often a settled answer was later overturned by a person. This
is the honesty check on the first number. Lowering the bar would shrink the uncertain band
without making anything clearer, and the reversal rate is what shows the difference: a shrinking
middle band alongside a rising reversal rate is a step backwards, not progress. Where a decision
has no recorded human choice to compare against, the table says **no call could be checked**
rather than counting it as agreement.

A thin sample is labelled as one: the panel states how many decisions carried a margin, so a
tidy-looking chart over a handful of rows is not mistaken for a settled picture. Decisions taken
before the three bands existed cannot be classified after the fact, and the panel says so rather
than counting them as settled — an unmeasured band reads as unmeasured, never as zero.

## Living Playbook experiments

An approved Living Playbook candidate can carry an evidence-cleared replay definition. For those
candidates, DPF schedules a bounded shadow experiment automatically; approval still does not make
the candidate active.

The coworker record shows **Testing a better method**, the number of valid comparison pairs, the
evidence origin, the current result, and whether more evidence is needed. Expand **Experiment
evidence details** for method/model factors, corpus and oracle versions, invalid-pair reasons,
freshness, and engineer IDs.

Only immutable, versioned replay fixtures execute autonomously in this first lane. The compared
provider or model is evidence, while the orchestrating coworker remains the accountable agent in
the audit ledger. Missing fixtures, live-environment requests, mutable code-workspace work, and
authority-ceiling cases stop without activation or customer-state mutation.

When the required comparison cells are complete, fresh, non-regressing, and within the promotion
policy's activity and risk ceiling, DPF can activate the winning method without another approval.
Activation is limited to the installations, organizations, task corpora, and model profile proven
by that evidence. It never adds tool authority. The coworker's **Living Playbooks** panel shows the
active method, where it may run, when its evidence was last checked, and what evidence is still
needed before broader use.

A rejected candidate remains useful negative knowledge: DPF will not repeat the materially same
experiment unless the corpus, model, oracle, or promotion policy changes. If an active method later
regresses, DPF rolls back to the recorded prior-safe method and retains both versions in the audit
history. Unsupported risks, regulatory human-control requirements, and missing rollback targets
still escalate.

## Tool Evaluation Pipeline

External tools must be evaluated before adoption (EP-GOVERN-002). The pipeline runs 6 agents with different perspectives:

| Agent | Role | What It Checks |
|-------|------|---------------|
| AGT-112 (Gap Analysis) | Discovery Scout | Searches registries, finds 2-5 candidates |
| AGT-190 (Security Auditor) | Security Review | CoSAI 12-category threat checklist |
| AGT-181 (Architecture Guardrail) | Architecture Fit | Trust boundaries, coupling, API surface |
| AGT-902 (Data Governance) | Compliance | License, data residency, regulatory |
| AGT-131 (SBOM Management) | Integration Test | Sandboxed install, smoke tests, rollback |
| AGT-111 (Investment Analysis) | Risk Adjudicator | Final GO/CONDITIONAL/REJECT verdict |

Approved tools are version-pinned with conditions and scheduled for periodic re-evaluation.

## Development Surfaces

Build Studio is the guided in-product development surface. Claude, Codex, and Grok are first-class external agent surfaces for contributors who need direct source access. All of them use the same DPF MCP coordination plane, branch/worktree isolation, evidence gates, documentation impact check, DCO-signed PR process, and release-readiness rules.

Use [Agent Development Environments](../contributing/agent-dev-environments.md) to set up those external clients, and [Build Studio](../build-studio/index.md) for the guided operator workflow.
